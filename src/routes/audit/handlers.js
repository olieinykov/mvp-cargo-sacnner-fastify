import { requireAnthropic } from '../../lib/cloudeClient.js';

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
	if (imageType === 'bolPhoto') {
		return (
			'You are a computer vision assistant for a Hazmat Load Audit System. ' +
			'You receive a single image of a BOL / shipping paper and must analyze it according to US DOT / FMCSA hazmat rules (49 CFR 172.200–204). ' +
			'Evaluate compliance using ONLY what is visible on the document. Specifically check:\n' +
			'- Proper Shipping Name: exact DOT-authorized name, no unauthorized abbreviations.\n' +
			'- Hazard Class / Division: numeric class (e.g., "3", "8", "5.2") following shipping name.\n' +
			'- UN/NA Identification Number: format like "UN1170" or "NA1993".\n' +
			'- Packing Group: Roman numerals I, II, or III where required.\n' +
			'- Total Quantity: amount and unit of measure for each hazmat line item.\n' +
			'- HM Column Marking: "X" or "RQ" clearly marked in hazardous material column.\n' +
			'- Entry Sequence: shipping name, hazard class, UN number, packing group in required order.\n' +
			'- 24-Hour Emergency Phone: monitored phone number (e.g., CHEMTREC 800-424-9300).\n' +
			'- Shipper Certification: signed statement of proper classification/packaging/etc.\n' +
			'- RQ Notation: "RQ" present where reportable quantity applies.\n' +
			'- Technical Name for N.O.S.: chemical name in parentheses for N.O.S. entries.\n' +
			'- No Forbidden Combinations: obviously incompatible materials not listed for same vehicle.\n\n' +
			'You MUST respond strictly in JSON with this exact shape. Do not include any text outside of JSON.\n' +
			'Every field except otherNotes must be an object with "mainValue" and "meaning".\n' +
			'"mainValue" is the extracted value (string, boolean, or null).\n' +
			'"meaning" is a short human-readable explanation of what that value means in DOT/FMCSA context.\n' +
			'"otherNotes" must be an array of { "sign_name": string, "meaning": string } objects ' +
			'for any compliance-relevant findings that do not fit the named fields above (e.g. RQ notation, forbidden combinations, N.O.S. technical names). Use empty array [] if none.\n\n' +
			'{\n' +
			'  "slotName": "bol",\n' +
			'  "extracted": {\n' +
			'    "isValid":                    { "mainValue": false,  "meaning": "" },\n' +
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
			'You receive a single image of a truck / trailer placard or marker on the vehicle exterior and must analyze it according to US DOT / FMCSA hazmat rules (49 CFR 172.500–560). ' +
			'Evaluate compliance using ONLY what is visible. Specifically check:\n' +
			'- Correct Placard Class: placard hazard class matches BOL hazard class.\n' +
			'- UN Number Display: for bulk shipments, UN number on placard matches BOL.\n' +
			'- Four-Sided Placement: placards visible on front, rear, and both sides (as far as the photo allows).\n' +
			'- Placard Condition: readable, not faded/obscured, correct diamond orientation (point-up).\n' +
			'- DANGEROUS Placard: used correctly if multiple hazard classes each exceed 1,000 lbs.\n' +
			'- Subsidiary Hazard Placards: present where required by subsidiary hazards.\n\n' +
			'You MUST respond strictly in JSON with this exact shape. Do not include any text outside of JSON.\n' +
			'Every field except otherNotes must be an object with "mainValue" and "meaning".\n' +
			'"mainValue" is the extracted value (string, boolean, or null).\n' +
			'"meaning" is a short human-readable explanation of what that value means in DOT/FMCSA context.\n' +
			'"otherNotes" must be an array of { "sign_name": string, "meaning": string } objects ' +
			'for any compliance-relevant findings that do not fit the named fields (e.g. DANGEROUS placard, subsidiary hazard placards). Use empty array [] if none.\n\n' +
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
		'You receive a single image of cargo / load inside or on the vehicle and must analyze it according to US DOT / FMCSA hazmat rules. ' +
		'Evaluate load verification and securement. Specifically check:\n' +
		'- Package Markings Match BOL: visible UN number and proper shipping name on packages.\n' +
		'- Package Labels Match BOL: hazard class labels on packages.\n' +
		'- Load Securement: cargo properly secured, no visible shifting hazards, meets FMCSA rules.\n' +
		'- Material Compatibility: no incompatible materials loaded adjacent to each other.\n' +
		'- Orientation Compliance: "THIS SIDE UP" arrows and orientation markings respected.\n\n' +
		'You MUST respond strictly in JSON with this exact shape. Do not include any text outside of JSON.\n' +
		'Every field except otherNotes must be an object with "mainValue" and "meaning".\n' +
		'"mainValue" is the extracted value (string, boolean, or null).\n' +
		'"meaning" is a short human-readable explanation of what that value means in DOT/FMCSA context.\n' +
		'"otherNotes" must be an array of { "sign_name": string, "meaning": string } objects ' +
		'for any compliance-relevant findings that do not fit the named fields (e.g. orientation markings, compatibility issues). Use empty array [] if none.\n\n' +
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
			max_tokens: 1024,
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
	return callClaude(
		buildSystemPrompt(imageType),
		imageBuffer,
		mimetype,
		'Analyze this image according to the provided hazmat checklist and respond ONLY with JSON.',
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

	// Normalise class strings for comparison (trim, lowercase)
	const norm = (s) => (s ? String(s).trim().toLowerCase() : null);

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

	// CRITICAL: missing emergency phone
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
	if (!v(bolExt.packingGroup)) {
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

	// MAJOR: entry sequence non-compliant
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
	// 2. BOL-TO-PLACARD CROSS-MATCH (49 CFR 172.504)
	// ─────────────────────────────────────────────

	if (bolClass && markerClass && norm(bolClass) !== norm(markerClass)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.504',
			check: 'BOL-Placard Match (172.504)',
			message: `BOL shows Class ${bolClass} but placard shows Class ${markerClass}. Hazard class mismatch.`,
			fix: `Replace placard with the correct Class ${bolClass} placard on all 4 sides of the trailer.`,
		});
	}

	if (bolUN && markerUN && norm(bolUN) !== norm(markerUN)) {
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
	// 3. BOL-TO-PACKAGE CROSS-MATCH
	// ─────────────────────────────────────────────

	if (bolClass && cargoClass && norm(bolClass) !== norm(cargoClass)) {
		issues.push({
			source: 'CROSS',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.301',
			check: 'BOL-Package Class Match',
			message: `Hazard class on BOL (${bolClass}) does not match hazard class label on cargo packages (${cargoClass}).`,
			fix: 'Ensure package labels match the hazard class declared on the BOL.',
		});
	}

	if (bolUN && cargoUN && norm(bolUN) !== norm(cargoUN)) {
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
	// 4. COMPATIBILITY CHECK (49 CFR 177.848)
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
	// 5. PLACARD CONDITION CHECKS
	// ─────────────────────────────────────────────

	if (!extExt.placardingPresent?.mainValue) {
		issues.push({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.504',
			check: 'Placard Present',
			message: 'No hazmat placards detected on vehicle exterior.',
			fix: 'Affix the required hazmat placards on all 4 sides of the trailer before departure.',
		});
	}

	const placardCond = v(extExt.placardingCondition);
	if (placardCond === 'damaged') {
		issues.push({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.516(a)',
			check: 'Placard Condition',
			message: 'Placard is damaged and may be unreadable at inspection.',
			fix: 'Replace damaged placards with new, legible ones before departure.',
		});
	} else if (placardCond === 'blurry') {
		issues.push({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(a)',
			check: 'Placard Condition',
			message: 'Placard is blurry or partially obscured — may be flagged at inspection.',
			fix: 'Clean or replace the placard to ensure it is fully legible.',
		});
	}

	if (!v(markerExt.fourSidedPlacementVerified)) {
		issues.push({
			source: 'PLACARD',
			severity: 'WARNING',
			cfr: '49 CFR 172.516(b)',
			check: 'Four-Sided Placement',
			message: 'Four-sided placard placement could not be verified from available photos.',
			fix: 'Submit photos of all 4 sides of the trailer to confirm placard placement.',
		});
	}

	if (!v(markerExt.correctOrientation)) {
		issues.push({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(c)',
			check: 'Placard Orientation',
			message: 'Placard orientation does not appear to be point-up (diamond orientation required).',
			fix: 'Re-affix the placard in the correct point-up diamond orientation.',
		});
	}

	// ─────────────────────────────────────────────
	// 6. CARGO / LOAD SECUREMENT
	// ─────────────────────────────────────────────

	if (!v(cargoExt.loadSecured)) {
		issues.push({
			source: 'CARGO',
			severity: 'CRITICAL',
			cfr: '49 CFR 177.834(a)',
			check: 'Load Securement',
			message: 'Cargo does not appear to be properly secured against shifting during transport.',
			fix: 'Secure all cargo with appropriate tie-downs, straps, or blocking before departure.',
		});
	}

	if (v(extExt.damagesOrLeaksObserved)) {
		issues.push({
			source: 'CARGO',
			severity: 'CRITICAL',
			cfr: '49 CFR 173.24',
			check: 'Leaks / Damage',
			message: 'Visible damage or hazmat leakage observed on vehicle exterior.',
			fix: 'Do not depart. Identify and contain the leak, inspect all packages, and repair damage before transport.',
		});
	}

	if (!v(cargoExt.noShiftingHazards)) {
		issues.push({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834',
			check: 'Shifting Hazards',
			message: 'Potential cargo shifting hazard detected — load securement could be improved.',
			fix: 'Add additional tie-downs or bracing to prevent cargo movement in transit.',
		});
	}

	// ─────────────────────────────────────────────
	// 7. OTHER NOTES from each slot
	// ─────────────────────────────────────────────

	for (const note of (bolExt.otherNotes ?? [])) {
		issues.push({ source: 'BOL', severity: 'WARNING', cfr: null, check: note.sign_name, message: note.meaning, fix: null });
	}
	for (const note of (markerExt.otherNotes ?? [])) {
		issues.push({ source: 'PLACARD', severity: 'WARNING', cfr: null, check: note.sign_name, message: note.meaning, fix: null });
	}
	for (const note of (cargoExt.otherNotes ?? [])) {
		issues.push({ source: 'CARGO', severity: 'WARNING', cfr: null, check: note.sign_name, message: note.meaning, fix: null });
	}
	for (const note of (extExt.otherNotes ?? [])) {
		issues.push({ source: 'PLACARD', severity: 'WARNING', cfr: null, check: note.sign_name, message: note.meaning, fix: null });
	}

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

	return reply.send({
		bol:      bolResult,
		marker:   markerResult,
		cargo:    cargoResult,
		exterier: exterierResult,
		audit,
	});
}