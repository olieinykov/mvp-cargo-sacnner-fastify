import { requireAnthropic } from '../../lib/cloudeClient.js';
import { db } from '../../db/connection.js';
import { audits } from '../../db/schema.js';
import { count, desc } from 'drizzle-orm';

// ==========================
// Claude client
// ==========================

const getClient = () => requireAnthropic();

// ==========================
// Helpers
// ==========================

function encodeImageToBase64(buffer) {
	return Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(buffer).toString('base64');
}

function toArray(field) {
	return Array.isArray(field) ? field : [field];
}

// ==========================
// System prompts
// ==========================

function buildSystemPrompt(imageType) {
	// Shared hazmat class reference injected into all prompts
	const HAZMAT_CLASS_REFERENCE =
		'HAZMAT CLASS REFERENCE — for identifying classes from labels and BOL text:\n' +
		'- Class 3   | Flammable Liquids        | Red diamond, flame symbol, "3" at bottom\n' +
		'- Class 5.2 | Organic Peroxides         | Yellow/red diamond\n' +
		'- Class 8   | Corrosives               | Black-and-white diamond, corrosion symbol\n' +
		'- Class 9   | Miscellaneous            | White diamond, black stripes at TOP only\n' +
		'- Class 2.1 | Flammable Gas            | Red diamond, flame symbol\n' +
		'- Class 2.2 | Non-Flammable Gas        | Green diamond\n' +
		'- Class 2.3 | Poison Gas               | White diamond, skull symbol\n' +
		'- Class 4.1 | Flammable Solid          | Red-and-white striped diamond\n' +
		'- Class 4.2 | Spontaneously Combustible| Red-and-white diamond\n' +
		'- Class 4.3 | Dangerous When Wet       | Blue diamond\n' +
		'- Class 5.1 | Oxidizer                 | Yellow diamond, flame-over-circle symbol\n' +
		'- Class 6.1 | Poison / Toxic           | White diamond, skull-and-crossbones\n' +
		'- Class 7   | Radioactive              | Yellow-and-white diamond, trefoil symbol\n\n' +
		'GHS vs DOT — CRITICAL:\n' +
		'- GHS pictograms: RED border, white background, black symbol — on product labels. NOT DOT class labels.\n' +
		'- DOT labels: SOLID-COLOR diamonds with class NUMBER at bottom corner.\n' +
		'- If labels unclear or too small — set hazardClass to null and lower confidence. Do NOT guess.\n\n';

	if (imageType === 'bolPhoto') {
		return (
			'You are a computer vision assistant for a Hazmat Load Audit System. ' +
			'You receive a single image of a BOL / shipping paper. ' +
			'READ ALL VALUES ONLY FROM THE ACTUAL DOCUMENT IN THE IMAGE. Never use memory or assumptions.\n\n' +
			'Specifically check:\n' +
			'- Proper Shipping Name: exact DOT-authorized name.\n' +
			'- Hazard Class / Division: the numeric DOT hazard class (e.g., "2.2", "3", "8"). In a standard DOT sequence, it appears AFTER the Proper Shipping Name. It may be followed by a subsidiary class in parentheses (e.g., "3 (6.1)") or a Packing Group (e.g., "PG III"). Note: Class 2 gases do not have a Packing Group. ABSOLUTELY IGNORE any right-hand table columns labeled "CLASS" (these contain NMFC freight classes like 55, 60, or 70).\n' +
			'- UN/NA Identification Number: 4-digit number after "UN" or "NA".\n' +
			'- Packing Group: Roman numerals I, II, or III where required.\n' +
			'- HM Column Marking: "X" or "RQ" marking in hazardous material column.\n' +
			'- Entry Sequence: shipping name, hazard class, UN number, packing group order.\n' +
			'- 24-Hour Emergency Phone: monitored phone number.\n' +
			'- Shipper Certification: signed statement at bottom of document.\n' +
			'- Technical Name for N.O.S.: chemical name in parentheses.\n\n' +
			'EXTRACTION RULES:\n' +
			'- Scan ALL text in the document including small print, handwriting, and multi-line entries.\n' +
			'- UN number, hazard class, and packing group may appear inline within commodity description text.\n' +
			'- Example inline format: "COMPRESSED GAS, N.O.S. (contains X), 2.2, UN1956" — class=2.2, UN=1956.\n' +
			'- Report ONLY values you can actually read from this specific document image.\n' +
			'- If multiple hazmat entries exist, report the primary one; list additional UN numbers comma-separated.\n\n' +
			'FIELD DEFINITIONS:\n' +
			'- isValid: true if ALL required hazmat fields are present and BOL appears DOT-compliant. false if critical fields missing.\n' +
			'- properShippingNameValid: true for any recognized DOT name from 49 CFR 172.101 including "COMPRESSED GAS, N.O.S.", "ESTERS, N.O.S.", "FLAMMABLE LIQUID, N.O.S.", "CORROSIVE LIQUID, N.O.S.", "PAINT", "ENVIRONMENTALLY HAZARDOUS SUBSTANCE, SOLID, N.O.S." and similar. false ONLY if clearly fabricated or misspelled. null if uncertain.\n' +
			'- entrySequenceCompliant: true if entry follows DOT order (name → class → UN → PG). false if order differs. null if uncertain.\n' +
			'- hmColumnMarked: true if X, RQ, or any hazmat marking is visible next to the hazmat line item anywhere on the document.\n\n' +
			HAZMAT_CLASS_REFERENCE +
			'Respond ONLY with this JSON shape:\n' +
			'{\n' +
			'  "slotName": "bol",\n' +
			'  "extracted": {\n' +
			'    "isValid":                    { "mainValue": false,  "meaning": "" },\n' +
			'    "properShippingNameValid":    { "mainValue": null,   "meaning": "" },\n' +
			'    "unNumber":                   { "mainValue": null,   "meaning": "" },\n' +
			'    "hazardClass":                { "mainValue": null,   "meaning": "" },\n' +
			'    "packingGroup":               { "mainValue": null,   "meaning": "" },\n' +
			'    "emergencyPhone":             { "mainValue": null,   "meaning": "" },\n' +
			'    "hmColumnMarked":             { "mainValue": false,  "meaning": "" },\n' +
			'    "shipperCertificationPresent":{ "mainValue": false,  "meaning": "" },\n' +
			'    "entrySequenceCompliant":     { "mainValue": false,  "meaning": "" },\n' +
			'    "otherNotes": []\n' +
			'  },\n' +
			'  "confidence": { "overall": 0.0, "fields": {} },\n' +
			'  "notes": []\n' +
			'}'
		);
	}

	if (imageType === 'markerPhoto') {
		return (
			'You are a computer vision assistant for a Hazmat Load Audit System. ' +
			'You receive a single image of a truck / trailer placard. ' +
			'READ ALL VALUES ONLY FROM WHAT IS PHYSICALLY VISIBLE IN THIS IMAGE. Never use memory.\n\n' +
			'Specifically check:\n' +
			'- UN Number: 4-digit number displayed on the placard.\n' +
			'- Hazard Class: identify from placard color, symbol, and class number using the reference below.\n' +
			'- Placard Condition: readable, not faded/obscured, correct diamond orientation (point-up).\n' +
			'- Four-Sided Placement: placards visible on all sides (as far as the photo allows).\n\n' +
			HAZMAT_CLASS_REFERENCE +
			'Respond ONLY with this JSON shape:\n' +
			'{\n' +
			'  "slotName": "placard",\n' +
			'  "extracted": {\n' +
			'    "isValid":                    { "mainValue": false,     "meaning": "" },\n' +
			'    "unNumber":                   { "mainValue": null,      "meaning": "" },\n' +
			'    "hazardClass":                { "mainValue": null,      "meaning": "" },\n' +
			'    "placardCondition":           { "mainValue": "unknown", "meaning": "" },\n' +
			'    "correctOrientation":         { "mainValue": false,     "meaning": "" },\n' +
			'    "fourSidedPlacementVerified": { "mainValue": false,     "meaning": "" },\n' +
			'    "otherNotes": []\n' +
			'  },\n' +
			'  "confidence": { "overall": 0.0, "fields": {} },\n' +
			'  "notes": []\n' +
			'}'
		);
	}

	// cargoPhoto
	return (
		'You are a computer vision assistant for a Hazmat Load Audit System. ' +
		'You receive a single image of cargo inside a vehicle. ' +
		'READ ALL VALUES ONLY FROM WHAT IS PHYSICALLY VISIBLE IN THIS IMAGE. Never use memory.\n\n' +
		'Specifically check:\n' +
		'- UN Number: 4-digit number on package/drum labels if visible.\n' +
		'- Hazard Class: from DOT diamond labels only (not GHS pictograms).\n' +
		'- Package Labels: DOT hazard class diamond labels present on packages.\n' +
		'- Load Securement: cargo secured against shifting.\n' +
		'- Material Compatibility: incompatible materials not loaded together.\n\n' +
		'SECUREMENT RULES:\n' +
		'- Securement = any of: ratchet straps, belts, chains, load bars, cages, nets, shrink wrap.\n' +
		'- If straps/belts visible even partially → loadSecured = true.\n' +
		'- Cargo on pallets/cradles appearing stable → positive securement indicator.\n' +
		'- Set loadSecured = false ONLY if cargo clearly loose with zero restraint visible.\n' +
		'- Dark image + stable cargo → loadSecured = true with lower confidence.\n\n' +
		HAZMAT_CLASS_REFERENCE +
		'Respond ONLY with this JSON shape:\n' +
		'{\n' +
		'  "slotName": "intrier",\n' +
		'  "extracted": {\n' +
		'    "isValid":               { "mainValue": false, "meaning": "" },\n' +
		'    "unNumber":              { "mainValue": null,  "meaning": "" },\n' +
		'    "hazardClass":           { "mainValue": null,  "meaning": "" },\n' +
		'    "packageLabelsPresent":  { "mainValue": false, "meaning": "" },\n' +
		'    "loadSecured":           { "mainValue": false, "meaning": "" },\n' +
		'    "securementType":        { "mainValue": null,  "meaning": "" },\n' +
		'    "palletUsed":            { "mainValue": false, "meaning": "" },\n' +
		'    "noShiftingHazards":     { "mainValue": false, "meaning": "" },\n' +
		'    "otherNotes": []\n' +
		'  },\n' +
		'  "confidence": { "overall": 0.0, "fields": {} },\n' +
		'  "notes": []\n' +
		'}'
	);
}

function buildExterierSystemPrompt() {
	return (
		'You are analyzing trailer exterior photos for hazmat placarding/condition evidence.\n' +
		'Evaluate ONLY what is visible on the exterior. Specifically check:\n' +
		'- Placarding: whether hazmat placards are present and their condition.\n' +
		'- Damages or leaks: any visible physical damage or hazmat leakage on exterior surfaces.\n\n' +
		'PLACARDING CONDITION RULES — placardingCondition must be one of: "good", "blurry", "damaged", "unknown".\n' +
		'- "good": the placard diamond label is readable and numbers/class are visible, even if the metal mounting frame around it is worn, bent, or dirty.\n' +
		'- "blurry": placard text is partially obscured or faded but still somewhat readable.\n' +
		'- "damaged": the placard label itself is physically torn, missing, or so deteriorated the class/UN number cannot be read. A worn metal holder does NOT make the placard damaged.\n' +
		'- "unknown": placard not visible or cannot be assessed.\n' +
		'- Judge the PLACARD LABEL condition only — ignore the condition of the mounting hardware.\n\n' +
		'You MUST respond strictly in JSON with this exact shape. Do not include any text outside of JSON.\n' +
		'Every field except otherNotes must be an object with "mainValue" and "meaning".\n' +
		'"mainValue" is the extracted value (string, boolean, or null).\n' +
		'"meaning" is a short human-readable explanation of what that value means in DOT/FMCSA context.\n' +
		'"otherNotes" must be an array of { "sign_name": string, "meaning": string } objects ' +
		'for any compliance-relevant findings that do not fit the named fields. Use empty array [] if none.\n\n' +
		'{\n' +
		'  "slotName": "exterier",\n' +
		'  "extracted": {\n' +
		'    "placardingPresent":      { "mainValue": false,     "meaning": "" },\n' +
		'    "placardingCondition":    { "mainValue": "unknown", "meaning": "" },\n' +
		'    "damagesOrLeaksObserved": { "mainValue": false,     "meaning": "" },\n' +
		'    "otherNotes": []\n' +
		'  },\n' +
		'  "confidence": { "overall": 0.0, "fields": {} },\n' +
		'  "notes": []\n' +
		'}'
	);
}

// ==========================
// Claude API calls
// ==========================

async function callClaude(systemPrompt, imageBuffer, mimetype, userText) {
	const base64Data = encodeImageToBase64(imageBuffer);

	let response;
	try {
		response = await getClient().messages.create({
			model: process.env.CLAUDE_VISION_MODEL,
			max_tokens: 4096,
			system: systemPrompt,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: {
								type: 'base64',
								media_type: mimetype,
								data: base64Data,
							},
						},
						{
							type: 'text',
							text: userText,
						},
					],
				},
			],
		});
	} catch (err) {
		throw Object.assign(new Error(`Claude API error: ${err.message}`), { statusCode: 502 });
	}

	const textBlock = response.content.find((b) => b.type === 'text');
	if (!textBlock?.text) {
		throw Object.assign(new Error('Claude returned empty content.'), { statusCode: 502 });
	}

	let parsed;
	try {
		const clean = textBlock.text.replace(/```json|```/g, '').trim();
		parsed = JSON.parse(clean);
	} catch {
		throw Object.assign(new Error('Failed to parse JSON from Claude response.'), { statusCode: 502 });
	}

	if (typeof parsed !== 'object' || parsed === null || typeof parsed.extracted !== 'object') {
		throw Object.assign(new Error('Claude response does not match expected schema.'), { statusCode: 502 });
	}

	return parsed;
}

async function analyzeImageWithClaude(imageBuffer, mimetype, imageType) {
	const userText = imageType === 'bolPhoto'
		? 'Carefully examine every part of this BOL document. ' +
		  'Find and extract: UN number (4 digits after "UN" or "NA"), ' +
		  'hazard class (number like 2, 2.2, 3, 8, 9), ' +
		  'packing group (Roman numerals I, II, III), ' +
		  'HM column marking (X or RQ next to hazmat line). ' +
		  'These may be in narrow columns, inline in description text, handwritten, or small print. ' +
		  'Report ONLY what you actually read from this document. Respond ONLY with JSON.'
		: 'Analyze this image and respond ONLY with JSON.';

	return callClaude(
		buildSystemPrompt(imageType),
		imageBuffer,
		mimetype,
		userText,
	);
}

async function analyzeExterierWithClaude(imageBuffer, mimetype) {
	const result = await callClaude(
		buildExterierSystemPrompt(),
		imageBuffer,
		mimetype,
		'Analyze this trailer exterior image and respond ONLY with the specified JSON.',
	);

	if (result.slotName !== 'exterier') {
		throw Object.assign(new Error('Claude exterier response does not match expected schema.'), { statusCode: 502 });
	}

	return result;
}

// ==========================
// Audit logic — Rules Engine
// ==========================

/**
 * Severity levels (per spec):
 *   CRITICAL — OOS-level violation, must fix before departure
 *   MAJOR    — likely fine, strong recommendation to fix
 *   MINOR    — technical violation, warning-level
 *   WARNING  — best-practice recommendation, not a violation
 */

// 49 CFR 177.848 — forbidden segregation pairs by hazard class.
// Each entry means: class A cannot be loaded with class B.
const FORBIDDEN_COMBINATIONS = [
	['1', '1'],   // incompatible explosive divisions handled separately, simplified here
	['1', '3'],
	['1', '4'],
	['1', '5'],
	['1', '6'],
	['1', '8'],
	['3', '5.1'],
	['3', '5.2'],
	['4.1', '5.1'],
	['4.2', '5.1'],
	['4.3', '5.1'],
	['4.3', '8'],
	['5.1', '3'],
	['5.1', '4.1'],
	['5.1', '4.2'],
	['5.1', '4.3'],
	['5.1', '6.1'],
	['5.1', '8'],
	['6.1', '5.1'],
];

function isForbiddenCombination(classA, classB) {
	return FORBIDDEN_COMBINATIONS.some(
		([a, b]) => (a === classA && b === classB) || (a === classB && b === classA),
	);
}

// Placard recommendation map: hazard class → human-readable placard description
const PLACARD_MAP = {
	'1':   'Class 1 EXPLOSIVE (orange placard)',
	'1.1': 'Division 1.1 EXPLOSIVE (orange placard)',
	'1.2': 'Division 1.2 EXPLOSIVE (orange placard)',
	'1.3': 'Division 1.3 EXPLOSIVE (orange placard)',
	'1.4': 'Division 1.4 EXPLOSIVE (orange placard)',
	'1.5': 'Division 1.5 EXPLOSIVE (orange placard)',
	'1.6': 'Division 1.6 EXPLOSIVE (orange placard)',
	'2.1': 'Class 2.1 FLAMMABLE GAS (red placard)',
	'2.2': 'Class 2.2 NON-FLAMMABLE GAS (green placard)',
	'2.3': 'Class 2.3 POISON GAS (white placard)',
	'3':   'Class 3 FLAMMABLE LIQUID (red placard)',
	'4.1': 'Class 4.1 FLAMMABLE SOLID (red-and-white striped placard)',
	'4.2': 'Class 4.2 SPONTANEOUSLY COMBUSTIBLE (red-and-white placard)',
	'4.3': 'Class 4.3 DANGEROUS WHEN WET (blue placard)',
	'5.1': 'Class 5.1 OXIDIZER (yellow placard)',
	'5.2': 'Class 5.2 ORGANIC PEROXIDE (yellow/red placard)',
	'6.1': 'Class 6.1 POISON (white placard)',
	'6.2': 'Class 6.2 INFECTIOUS SUBSTANCE (white placard)',
	'7':   'Class 7 RADIOACTIVE (yellow/white placard)',
	'8':   'Class 8 CORROSIVE (black-and-white placard)',
	'9':   'Class 9 MISCELLANEOUS (black-and-white striped placard)',
};

function recommendPlacards(classes) {
	const recommendations = [];
	for (const cls of classes) {
		const label = PLACARD_MAP[cls];
		if (label) recommendations.push(label);
	}
	return recommendations;
}

function runAudit(bol, marker, cargo, exterier) {
	const issues = [];

	const bolExt    = bol.extracted      ?? {};
	const markerExt = marker.extracted   ?? {};
	const cargoExt  = cargo.extracted    ?? {};
	const extExt    = exterier.extracted ?? {};

	// Convenience: get mainValue safely
	const v = (field) => field?.mainValue ?? null;

	// Collect all hazard classes found across BOL, placard, cargo
	const bolClass    = v(bolExt.hazardClass);
	const markerClass = v(markerExt.hazardClass);
	const cargoClass  = v(cargoExt.hazardClass);
	const bolUN       = v(bolExt.unNumber);
	const markerUN    = v(markerExt.unNumber);
	const cargoUN     = v(cargoExt.unNumber);

	// Normalise class strings for comparison (trim, lowercase, strip "class " prefix)
	const norm = (s) => (s ? String(s).trim().toLowerCase().replace(/^class\s+/, '') : null);

	// Normalise UN/NA numbers: strip "UN"/"NA" prefix, keep only digits
	const normUN = (s) => (s ? String(s).trim().replace(/^(un|na)/i, '').trim() : null);

	// ─────────────────────────────────────────────
	// 1. BOL FIELD VALIDATION (49 CFR 172.200–204)
	// ─────────────────────────────────────────────

	// CRITICAL: missing UN number
	if (!bolUN) {
		issues.push({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.202(a)(1)',
			check: 'UN Number',
			message: 'UN/NA identification number is missing from BOL.',
			fix: 'Add the UN/NA number (e.g. UN1170) to the hazmat entry on the BOL.',
		});
	}

	// CRITICAL: missing hazard class
	if (!bolClass) {
		issues.push({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.202(a)(2)',
			check: 'Hazard Class',
			message: 'Hazard class / division is missing from BOL.',
			fix: 'Add the numeric hazard class (e.g. "3", "8", "5.2") to the BOL entry.',
		});
	}

	// CRITICAL: HM column not marked
	if (!v(bolExt.hmColumnMarked)) {
		issues.push({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.201(a)(1)',
			check: 'HM Column (172.201)',
			message: 'HM column is not clearly marked with "X" or "RQ" on the BOL.',
			fix: 'Mark "X" in the HM column next to each hazmat entry on the BOL.',
		});
	}

	// CRITICAL: missing emergency phone (per spec: no emergency phone = CRITICAL / OOS level)
	if (!v(bolExt.emergencyPhone)) {
		issues.push({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.201(d)',
			check: 'Emergency Phone',
			message: '24-hour emergency response phone number is missing from BOL.',
			fix: 'Add a monitored 24-hour emergency phone number (e.g. CHEMTREC 800-424-9300).',
		});
	}

	// MAJOR: missing packing group
	// Class 2 gases (2.1, 2.2, 2.3) and Class 7 do NOT require packing group
	const bolClassNorm = norm(bolClass);
	const isPG_exempt = bolClassNorm && (bolClassNorm.startsWith('2') || bolClassNorm === '7');
	const pgValue = v(bolExt.packingGroup);
	const packingGroupMissing = !pgValue ||
		String(pgValue).trim() === '—' ||
		String(pgValue).trim() === '-';

	if (packingGroupMissing && !isPG_exempt) {
		issues.push({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.202(a)(4)',
			check: 'Packing Group',
			message: 'Packing group (I, II, or III) is missing from BOL.',
			fix: 'Add the required packing group designation to the BOL hazmat entry.',
		});
	}

	// MAJOR: shipper certification absent or unsigned
	if (!v(bolExt.shipperCertificationPresent)) {
		issues.push({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.204',
			check: 'Shipper Cert (172.204)',
			message: 'Shipper certification signature is absent or illegible on the BOL.',
			fix: 'Have the shipper sign the certification statement on the BOL.',
		});
	}

	// MAJOR: entry sequence non-compliant — per spec "improper entry sequence on BOL" = MAJOR
	// Only flag when explicitly false — null means Claude couldn't determine, avoid false positive
	if (v(bolExt.entrySequenceCompliant) === false) {
		issues.push({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.201(a)',
			check: 'Entry Sequence',
			message: 'Hazmat entry sequence on BOL does not follow required DOT order (shipping name → class → UN number → packing group).',
			fix: 'Reorder the BOL hazmat entry to: Proper Shipping Name, Hazard Class, UN/NA Number, Packing Group.',
		});
	}

	// ─────────────────────────────────────────────
	// 2. PROPER SHIPPING NAME VERIFICATION (49 CFR 172.101 / 172.202)
	// Per spec: abbreviated/minor spelling = MINOR, not MAJOR.
	// Uses dedicated properShippingNameValid field — NOT isValid which reflects overall BOL compliance.
	// ─────────────────────────────────────────────

	if (v(bolExt.properShippingNameValid) === false) {
		issues.push({
			source: 'BOL',
			severity: 'MINOR',
			cfr: '49 CFR 172.202(a)(1)',
			check: 'Proper Shipping Name (172.101)',
			message: 'Proper shipping name on BOL appears incorrect, abbreviated, or does not match the DOT Hazardous Materials Table (49 CFR 172.101).',
			fix: 'Verify the exact DOT-authorized Proper Shipping Name from 49 CFR 172.101. Unauthorized abbreviations are not permitted.',
		});
	}

	// ─────────────────────────────────────────────
	// 3. BOL-TO-PLACARD CROSS-MATCH (49 CFR 172.504)
	// ─────────────────────────────────────────────

	if (bolClass && markerClass && norm(bolClass) !== norm(markerClass)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.504(a)',
			check: 'BOL-Placard Class Match',
			message: `BOL shows Class ${bolClass} but placard shows Class ${markerClass}. Hazard class mismatch.`,
			fix: `Replace placard with the correct Class ${bolClass} placard on all 4 sides of the trailer.`,
		});
	}

	if (bolUN && markerUN && normUN(bolUN) !== normUN(markerUN)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.332',
			check: 'BOL-Placard UN Match',
			message: `UN number on BOL (${bolUN}) does not match UN number on placard (${markerUN}).`,
			fix: `Update the placard to display the correct UN number: ${bolUN}.`,
		});
	}

	// ─────────────────────────────────────────────
	// 4. BOL-TO-PACKAGE CROSS-MATCH (49 CFR 172.301 / 172.400)
	// ─────────────────────────────────────────────

	if (bolClass && cargoClass && norm(bolClass) !== norm(cargoClass)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.400',
			check: 'BOL-Package Class Match',
			message: `Hazard class on BOL (${bolClass}) does not match hazard class label on cargo packages (${cargoClass}).`,
			fix: 'Ensure package labels match the hazard class declared on the BOL.',
		});
	}

	if (bolUN && cargoUN && normUN(bolUN) !== normUN(cargoUN)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.301(a)',
			check: 'BOL-Package UN Match',
			message: `UN number on BOL (${bolUN}) does not match UN number on cargo packages (${cargoUN}).`,
			fix: `Ensure cargo package markings show the correct UN number: ${bolUN}.`,
		});
	}

	if (!v(cargoExt.packageLabelsPresent)) {
		issues.push({
			source: 'CARGO',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.400',
			check: 'Package Labels',
			message: 'Required hazard class labels are not visible on cargo packages.',
			fix: 'Affix the correct hazard class label(s) to each package as required by 49 CFR 172.400.',
		});
	}

	// ─────────────────────────────────────────────
	// 5. COMPATIBILITY CHECK (49 CFR 177.848)
	// ─────────────────────────────────────────────

	// Collect all classes visible across BOL, placard, cargo
	const allClasses = [...new Set([bolClass, markerClass, cargoClass].filter(Boolean).map(norm))];

	if (allClasses.length >= 2) {
		for (let i = 0; i < allClasses.length; i++) {
			for (let j = i + 1; j < allClasses.length; j++) {
				if (isForbiddenCombination(allClasses[i], allClasses[j])) {
					issues.push({
						source: 'CROSS',
						severity: 'CRITICAL',
						cfr: '49 CFR 177.848',
						check: 'Compatibility (177.848)',
						message: `Forbidden combination: Class ${allClasses[i]} and Class ${allClasses[j]} cannot be transported together per segregation table.`,
						fix: 'Separate the incompatible hazmat classes onto different trailers before departure.',
					});
				}
			}
		}
	}

	// ─────────────────────────────────────────────
	// 6. PLACARD CONDITION CHECKS
	// ─────────────────────────────────────────────

	if (!extExt.placardingPresent?.mainValue) {
		issues.push({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.504(a)',
			check: 'Placard Present',
			message: 'No hazmat placards detected on vehicle exterior.',
			fix: 'Affix the required hazmat placards on all 4 sides of the trailer before departure.',
		});
	}

	// Placard condition — markerExt (dedicated placard photo) is primary source.
	// extExt.placardingCondition only used as fallback if markerExt has no data.
	const markerPlacardCond = v(markerExt.placardCondition);
	const extPlacardCond    = v(extExt.placardingCondition);
	const placardCond = (markerPlacardCond && markerPlacardCond !== 'unknown')
		? markerPlacardCond
		: extPlacardCond;
	if (placardCond === 'damaged') {
		// Damaged = unreadable at inspection → CRITICAL (OOS level per spec)
		issues.push({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.516(c)(1)',
			check: 'Placard Condition',
			message: 'Placard is damaged and may be unreadable at inspection.',
			fix: 'Replace damaged placards with new, legible ones before departure.',
		});
	} else if (placardCond === 'blurry') {
		// Faded but readable → MINOR per spec ("faded but readable placard")
		issues.push({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(c)(1)',
			check: 'Placard Condition',
			message: 'Placard is blurry or partially obscured — may be flagged at inspection.',
			fix: 'Clean or replace the placard to ensure it is fully legible.',
		});
	}

	if (!v(markerExt.fourSidedPlacementVerified)) {
		// Cannot verify from photo — WARNING, not a confirmed violation
		issues.push({
			source: 'PLACARD',
			severity: 'WARNING',
			cfr: '49 CFR 172.504(a)',
			check: 'Four-Sided Placement',
			message: 'Four-sided placard placement could not be verified from available photos.',
			fix: 'Submit photos of all 4 sides of the trailer to confirm placard placement.',
		});
	}

	// Only flag orientation if explicitly false — null means not visible in photo, skip to avoid false positive
	if (v(markerExt.correctOrientation) === false) {
		issues.push({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(c)(2)',
			check: 'Placard Orientation',
			message: 'Placard orientation does not appear to be point-up (diamond orientation required).',
			fix: 'Re-affix the placard in the correct point-up diamond orientation.',
		});
	}

	// ─────────────────────────────────────────────
	// 7. CARGO / LOAD SECUREMENT
	// ─────────────────────────────────────────────

	// Leaks/damage = CRITICAL (OOS level — do not depart)
	if (v(extExt.damagesOrLeaksObserved)) {
		issues.push({
			source: 'CARGO',
			severity: 'CRITICAL',
			cfr: '49 CFR 173.24(b)',
			check: 'Leaks / Damage',
			message: 'Visible damage or hazmat leakage observed on vehicle exterior.',
			fix: 'Do not depart. Identify and contain the leak, inspect all packages, and repair damage before transport.',
		});
	}

	// Load not secured = WARNING per spec ("load securement could be improved" is listed under WARNING examples)
	// Only flag if explicitly false — null means cargo photo inconclusive
	if (v(cargoExt.loadSecured) === false) {
		issues.push({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Load Securement',
			message: 'Cargo does not appear to be properly secured against shifting during transport.',
			fix: 'Secure all cargo with appropriate tie-downs, straps, or blocking before departure.',
		});
	}

	// Shifting hazards = WARNING per spec
	if (v(cargoExt.noShiftingHazards) === false) {
		issues.push({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Shifting Hazards',
			message: 'Potential cargo shifting hazard detected — load securement could be improved.',
			fix: 'Add additional tie-downs or bracing to prevent cargo movement in transit.',
		});
	}

	// ─────────────────────────────────────────────
	// 7. OTHER NOTES from each slot
	// ─────────────────────────────────────────────

	// Guard: skip plain strings and objects missing sign_name or meaning
	const pushNote = (source, note) => {
		if (!note || typeof note !== 'object' || Array.isArray(note)) return;
		const check   = typeof note.sign_name === 'string' ? note.sign_name.trim() : null;
		const message = typeof note.meaning   === 'string' ? note.meaning.trim()   : null;
		if (!check || !message) return;
		issues.push({ source, severity: 'WARNING', cfr: null, check, message, fix: null });
	};

	for (const note of (bolExt.otherNotes    ?? [])) pushNote('BOL',     note);
	for (const note of (markerExt.otherNotes  ?? [])) pushNote('PLACARD', note);
	for (const note of (cargoExt.otherNotes   ?? [])) pushNote('CARGO',   note);
	for (const note of (extExt.otherNotes     ?? [])) pushNote('PLACARD', note);

	// ─────────────────────────────────────────────
	// 8. SCORING & SUMMARY
	// ─────────────────────────────────────────────

	const countBySeverity = (sev) => issues.filter((i) => i.severity === sev).length;
	const criticalCount = countBySeverity('CRITICAL');
	const majorCount    = countBySeverity('MAJOR');
	const minorCount    = countBySeverity('MINOR');
	const warningCount  = countBySeverity('WARNING');

	// Score: start at 100, deduct per severity
	const score = Math.max(0, 100 - criticalCount * 20 - majorCount * 10 - minorCount * 3 - warningCount * 1);
	const isPassed = criticalCount === 0 && majorCount === 0;

	// ─────────────────────────────────────────────
	// 9. PLACARD RECOMMENDATIONS
	// ─────────────────────────────────────────────

	const allClassesForRec = [...new Set([bolClass, markerClass, cargoClass].filter(Boolean))];
	const placardRecommendations = recommendPlacards(allClassesForRec);

	return {
		is_passed: isPassed,
		score,
		issues,
		counts: { critical: criticalCount, major: majorCount, minor: minorCount, warning: warningCount },
		placardRecommendations,
		summary: isPassed
			? `No critical or major compliance issues detected. Score: ${score}/100.`
			: `Audit FAILED. Score: ${score}/100. ${criticalCount} Critical, ${majorCount} Major, ${minorCount} Minor.`,
	};
}

// ==========================
// Route handler
// ==========================

export async function createAudit(request, reply) {
	const { bol, placard, intrier, exterier } = request.body;

	const bolFile      = toArray(bol)[0];
	const placardFile  = toArray(placard)[0];
	const intierFile   = toArray(intrier)[0];
	const exterierFile = toArray(exterier)[0];

	const files = [
		{ file: bolFile,      name: 'bol' },
		{ file: placardFile,  name: 'placard' },
		{ file: intierFile,   name: 'intrier' },
		{ file: exterierFile, name: 'exterier' },
	];

	for (const { file, name } of files) {
		if (!file.mimetype || !file.mimetype.startsWith('image/')) {
			return reply.code(400).send({ error: `Field "${name}" must be an image (image/*). Got: ${file.mimetype}` });
		}
		if (!file._buf || file._buf.length === 0) {
			return reply.code(400).send({ error: `Field "${name}" is empty.` });
		}
	}

	let bolResult, markerResult, cargoResult, exterierResult;
	try {
		[bolResult, markerResult, cargoResult, exterierResult] = await Promise.all([
			analyzeImageWithClaude(bolFile._buf,      bolFile.mimetype,      'bolPhoto'),
			analyzeImageWithClaude(placardFile._buf,  placardFile.mimetype,  'markerPhoto'),
			analyzeImageWithClaude(intierFile._buf,   intierFile.mimetype,   'cargoPhoto'),
			analyzeExterierWithClaude(exterierFile._buf, exterierFile.mimetype),
		]);
	} catch (err) {
		return reply.code(err.statusCode ?? 502).send({ error: err.message });
	}

	const audit = runAudit(bolResult, markerResult, cargoResult, exterierResult);

	const auditResponse = {
		bol:      bolResult,
		marker:   markerResult,
		cargo:    cargoResult,
		exterier: exterierResult,
		audit,
	};

	let savedId = null;
	try {
		const [saved] = await db.insert(audits).values({
			response:  auditResponse,
			is_passed: String(audit.is_passed),
			score:     String(audit.score),
		}).returning({ id: audits.id });
		savedId = saved.id;
	} catch (err) {
		// Не блокируем ответ если БД недоступна — логируем и идём дальше
		console.error('Failed to save audit to DB:', err.message);
	}

	return reply.send({
		id: savedId,
		...auditResponse,
	});
}

// ==========================
// GET /audit
// ==========================
 
export async function getAudits(request, reply) {
	const { page = 1, limit = 20 } = request.query;
	const offset = (page - 1) * limit;
 
	try {
		const [rows, [{ total }]] = await Promise.all([
			db
				.select({
					id:         audits.id,
					is_passed:  audits.is_passed,
					score:      audits.score,
					created_at: audits.created_at,
					response:   audits.response,
				})
				.from(audits)
				.orderBy(desc(audits.created_at))
				.limit(limit)
				.offset(offset),
			db.select({ total: count() }).from(audits),
		]);
 
		const totalPages = Math.ceil(total / limit);
 
		return reply.send({
			data: rows,
			pagination: {
				total,
				page,
				limit,
				totalPages,
				hasNextPage: page < totalPages,
				hasPrevPage: page > 1,
			},
		});
	} catch (err) {
		return reply.code(502).send({ error: `Failed to fetch audits: ${err.message}` });
	}
}