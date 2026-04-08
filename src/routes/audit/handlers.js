import { requireAnthropic } from '../../lib/cloudeClient.js';
import { db } from '../../db/connection.js';
import { audits } from '../../db/schema.js';
import { count, desc, asc, eq, and, gte, lte } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import hazmatTable from '../../data/hazmat_data.json' with { type: 'json' };
import { HAZMAT_PLACARD_RULES } from '../../data/placard_data.js';
import { pdf } from 'pdf-to-img';

// ==========================
// Supabase client
// ==========================
 
const getSupabase = () => {
	const url    = process.env.SUPABASE_URL;
	const key    = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const bucket = 'audit-images';
 
	if (!url || !key) {
		throw Object.assign(
			new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.'),
			{ statusCode: 500 },
		);
	}
 
	return { client: createClient(url, key), bucket };
};

// ==========================
// Claude client
// ==========================

const getClient = () => requireAnthropic();

// ==========================
// Helpers
// ==========================

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
            'You are a strict computer vision assistant for a Hazmat Load Audit System. ' +
            'You will receive exactly ONE image of a BOL / shipping paper document. ' +
            'Follow these steps EXACTLY:\n\n' +
            'STEP 1: STRICT TEXT PARSING (ANTI-HALLUCINATION)\n' +
            '- Act as a literal text scanner. DO NOT use your internal hazmat database. DO NOT autocomplete or guess.\n' +
            '- Find the letters "UN" or "NA" in the description. Extract EXACTLY the 4 digits physically printed immediately after them.\n' +
            '- NEVER alter the printed UN number to match the Proper Shipping Name.\n' +
            '- Hazard Class: Extract ONLY the number (e.g., "8", "3") printed in the hazmat description. COMPLETELY IGNORE the right-hand table column labeled "Class or Rate".\n\n' +
            'STEP 2: EXTRACT REMAINING FIELDS\n' +
            '- Packing Group: Roman numerals (I, II, III) where required.\n' +
            '- HM Column Marking: "X" or "RQ" marking in hazardous material column.\n' +
            '- Emergency Phone: Extract ALL visible 24-Hour monitored phone numbers. You MUST put all found numbers in "mainValue" separated by a semicolon (e.g., "+1-800-424-9300; +1-703-527-3887"). In "meaning", specify the purpose of each number respectively (e.g., "USA; International").\n' +
            '- Shipper Certification: Check if the signature block at the bottom is signed.\n\n' +
            'FIELD DEFINITIONS (CRITICAL):\n' +
            '- properShippingName: Extract the EXACT text of the Proper Shipping Name printed on the document (e.g., "TOLUENE", "COATING SOLUTION", "CORROSIVE LIQUID, N.O.S."). Do not alter, guess, or abbreviate the text.\n' +
            '- entrySequenceCompliant: true if entry follows DOT order (name → class → UN → PG). false if order differs. null if uncertain.\n' +
            '- hmColumnMarked: Search the ENTIRE document — not just the table column — for an "X" or "RQ" ' +
            'associated with the hazmat line item. On many BOL formats the HM column is merged with other columns ' +
            'or the marking may appear inline within the description text itself, near the UN number, ' +
            'or as a standalone character adjacent to the cargo line. ' +
            'Set true if ANY "X" or "RQ" is found anywhere on the hazmat line row or description block.\n' +
            'Check if an "X" appears in that column ON THE DATA ROW (not the header). ' +
            'The column is often very narrow and placed between package count and units columns. ' +
            'true if X or RQ found on any hazmat data row in that column.\n' +
            'MULTIPLE HAZMAT ENTRIES:\n' +
            '- If this document shows TWO OR MORE distinct hazmat line items, return a SEPARATE object for each.\n' +
            '- PAIRING RULE: pair each UN number with its corresponding hazard class and packing group from that specific line item.\n\n' +
            HAZMAT_CLASS_REFERENCE +
            'CRITICAL OUTPUT RULE:\n' +
            '- ONE hazmat entry → single JSON object.\n' +
            '- TWO OR MORE hazmat entries → JSON ARRAY of objects, one per entry.\n' +
            '- STRICT SCHEMA RULE: The "extracted" field MUST NEVER BE AN ARRAY. If you have multiple entries, return a ROOT array of objects, like this:\n' +
            '  [ { "slotName": "bol", "extracted": {...} }, { "slotName": "bol", "extracted": {...} } ]\n' +
            '- Never use comma-separated UN numbers or hazard classes inside a single object.\n\n' +
            'Respond ONLY with this JSON shape:\n' +
            '{\n' +
            '  "slotName": "bol",\n' +
            '    "extracted": {\n' +
            '      "isValid":                    { "mainValue": false,  "meaning": "" },\n' +
            '      "properShippingName":         { "mainValue": null,   "meaning": "" },\n' +
            '      "unNumber":                   { "mainValue": null,   "meaning": "" },\n' +
            '      "hazardClass":                { "mainValue": null,   "meaning": "" },\n' +
            '      "packingGroup":               { "mainValue": null,   "meaning": "" },\n' +
            '      "emergencyPhone":             { "mainValue": null,   "meaning": "" },\n' +
            '      "hmColumnMarked":             { "mainValue": false,  "meaning": "" },\n' +
            '      "shipperCertificationPresent":{ "mainValue": false,  "meaning": "" },\n' +
            '      "entrySequenceCompliant":     { "mainValue": false,  "meaning": "" },\n' +
            '      "otherNotes": []\n' +
            '    },\n' +
            '    "confidence": { "overall": 0.0, "fields": {} },\n' +
            '  "notes": []\n' +
            '}'
        );
    }

	if (imageType === 'markerPhoto') {
		return (
			'You are a strict computer vision assistant for a Hazmat Load Audit System. ' +
			'You will receive exactly ONE image of a truck / trailer. ' +
			'Follow these steps EXACTLY:\n\n' +
			'STEP 1: IDENTIFY VALID PLACARDS\n' +
			'- Look ONLY for SOLID-COLORED diamonds (yellow, red, blue, black/white, etc.).\n' +
			'- COMPLETELY IGNORE bare metal frames, unpainted brackets, or hinges. They contain ZERO information. Do not attempt to read text or numbers from empty metal frames.\n\n' +
			'STEP 2: EXTRACT DATA FROM COLORED PLACARDS ONLY\n' +
			'- UN Number: The 4 large digits in the center (e.g., "2880").\n' +
			'- Hazard Class: The single small number at the very bottom tip. \n' +
			'  * HARD RULE: If the background is YELLOW, the class is 5.1 or 5.2. It is NEVER 8.\n' +
			'  * HARD RULE: Do NOT use the digits from the UN number as the hazard class.\n\n' +
			'STEP 3: FORMAT OUTPUT\n' +
			'- Count how many ACTUAL COLORED placards you found.\n' +
			'- If ZERO colored placards, return an empty array [].\n' +
			'- If ONE colored placard, return a single JSON object.\n' +
			'- If MULTIPLE colored placards (with DIFFERENT numbers), return a JSON array.\n\n' +
			HAZMAT_CLASS_REFERENCE +
			'Each object must follow this exact shape:\n' +
			'{\n' +
			'  "slotName": "placard",\n' +
			'    "extracted": {\n' +
			'      "isValid":                    { "mainValue": false,     "meaning": "" },\n' +
			'      "unNumber":                   { "mainValue": null,      "meaning": "" },\n' +
			'      "hazardClass":                { "mainValue": null,      "meaning": "" },\n' +
			'      "placardCondition":           { "mainValue": "unknown", "meaning": "" },\n' +
			'      "correctOrientation":         { "mainValue": false,     "meaning": "" },\n' +
			'      "fourSidedPlacementVerified": { "mainValue": false,     "meaning": "" },\n' +
			'      "otherNotes": []\n' +
			'    },\n' +
			'    "confidence": { "overall": 0.0, "fields": {} },\n' +
			'  "notes": []\n' +
			'}'
		);
	}

	// cargoPhoto
	return (
		'You are a computer vision assistant for a Hazmat Load Audit System. ' +
		'ANTI-HALLUCINATION RULE — CRITICAL:\n' +
		'- UN Number: ONLY extract if you physically see 4 digits preceded by "UN" or "NA" on a label. ' +
		'If no UN number is printed/visible → set unNumber to null. NEVER infer UN number from class or product name.\n' +
		'- Hazard Class: read ONLY from the DOT diamond color and bottom digit. ' +
		'Red diamond = Class 3 (Flammable). Black/white = Class 8. NEVER guess from context.\n\n' +
		'You will receive exactly ONE image of cargo inside a vehicle. ' +
		'READ ALL VALUES ONLY FROM WHAT IS PHYSICALLY VISIBLE IN THIS IMAGE. Never use memory.\n\n' +
		'Specifically check for this image:\n' +
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
		'MULTIPLE CARGO ENTRIES:\n' +
		'- If this image shows packages with TWO OR MORE distinct hazmat labels (different UN numbers or different hazard classes on separate packages/drums), you MUST return a SEPARATE object for each distinct entry.\n' +
		'- PAIRING RULE: Pair each UN number with the hazard class label visible on the same package. Do NOT combine values from different packages into one object.\n' +
		'- Fields like loadSecured, securementType, palletUsed, noShiftingHazards apply to the overall load — copy the same values to all returned objects.\n\n' +
		'CRITICAL OUTPUT RULE:\n' +
		'- If there is exactly ONE hazmat entry visible → respond with a single JSON object.\n' +
		'- If there are TWO OR MORE distinct hazmat entries → respond with a JSON ARRAY of objects, one per entry.\n' +
		'- STRICT SCHEMA RULE: The "extracted" field MUST NEVER BE AN ARRAY. If you have multiple entries, return a ROOT array of objects, like this:\n' +
		'  [ { "slotName": "bol", "extracted": {...} }, { "slotName": "bol", "extracted": {...} } ]\n' +
		'- Never use comma-separated UN numbers or hazard classes inside a single object.\n\n' +
		'Each object in the array (or the single object) must follow this exact shape:\n' +
		'{\n' +
		'  "slotName": "intrier",\n' +
		'    "extracted": {\n' +
		'      "isValid":               { "mainValue": false, "meaning": "" },\n' +
		'      "unNumber":              { "mainValue": null,  "meaning": "" },\n' +
		'      "hazardClass":           { "mainValue": null,  "meaning": "" },\n' +
		'      "packageLabelsPresent":  { "mainValue": false, "meaning": "" },\n' +
		'      "loadSecured":           { "mainValue": false, "meaning": "" },\n' +
		'      "securementType":        { "mainValue": null,  "meaning": "" },\n' +
		'      "palletUsed":            { "mainValue": false, "meaning": "" },\n' +
		'      "noShiftingHazards":     { "mainValue": false, "meaning": "" },\n' +
		'      "otherNotes": []\n' +
		'    },\n' +
		'    "confidence": { "overall": 0.0, "fields": {} },\n' +
		'  "notes": []\n' +
		'}'
	);
}

// ==========================
// Triage: Global BOL Helper
// ==========================

async function bolHelper(bolFiles) {
	if (!bolFiles || bolFiles.length === 0) {
		return { isHazmat: false, weights: [] };
	}

	const imageContents = bolFiles.map((file) => ({
		type: 'image',
		source: { type: 'url', url: file.url },
	}));

	const TRIAGE_SYSTEM_PROMPT =
		'You are a document triage assistant for a Hazmat Load Audit System. ' +
		'You will receive one or multiple images representing pages of a single Bill of Lading (BOL). ' +
		'Your job is to determine if this shipment contains hazardous materials AND extract their total weights.\n\n' +
		'INSTRUCTIONS:\n' +
		'1. isHazmat: true if ANY hazmat is found (look for UN/NA numbers, hazard classes, or X/RQ in HM column).\n' +
		'2. weights: An array with one entry per UN number. For each entry extract:\n' +
		'   - unNumber: 4-digit UN/NA number as a string (digits only, no "UN" prefix), e.g. "1203".\n' +
		'   - hazardClass: the hazard class printed on that same BOL line item, e.g. "3", "8", "2.1". null if not found.\n' +
		'   - weight: total GROSS weight in LBS for that UN number. ' +
		'ALWAYS prioritize the GROSS weight (e.g., "Gross Wgt Lbs", "Gross", or "Total Weight") over Net Weight. ' +
		'If weight is in KG, multiply by 2.20462 to get LBS. ' +
		'CORRELATION RULE: If the first page is a Master BOL and subsequent pages are Supplements, DO NOT duplicate the line items. Merge them into a single entry using the most precise weight available.\n\n' +
		'CRITICAL: You MUST respond with ONLY a raw JSON object. ' +
		'NO explanations, NO markdown, NO code fences, NO preamble. ' +
		'Your entire response must start with { and end with }.\n\n' +
		'Required format:\n' +
		'{"isHazmat": true|false, "weights": [{"unNumber": "1203", "hazardClass": "3", "weight": 45000}]}';

	try {
		const response = await getClient().messages.create({
			model: process.env.CLAUDE_VISION_MODEL,
			max_tokens: 512, 
			system: TRIAGE_SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: [
						...imageContents,
						{ type: 'text', text: 'Review all pages, determine if hazmat is present, and extract the weights.' },
					],
				},
			],
		});

		const textBlock = response.content.find((b) => b.type === 'text');
		if (!textBlock) throw new Error('No text block in response');

		let clean = textBlock.text
			.replace(/```json\s*/gi, '')
			.replace(/```\s*/g, '')
			.trim();

		const objMatch = clean.match(/\{[\s\S]*\}/);
		if (!objMatch) throw new Error(`No JSON object found in response: ${clean.slice(0, 100)}`);

		const parsed = JSON.parse(objMatch[0]);
		
		return {
			isHazmat: parsed.isHazmat === true,
			weights: Array.isArray(parsed.weights) ? parsed.weights : []
		};

	} catch (err) {
		console.error('[bolHelper] Error:', err.message);
		return { isHazmat: true, weights: [] }; 
	}
}

// TODO: exterior slot temporarily disabled
/*
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
*/

// ==========================
// Claude API calls
// ==========================

// file — single { buffer, mimetype }
async function callClaude(systemPrompt, file, userText) {
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
								type: 'url',
								url: file.url
							},
						},
						{ type: 'text', text: userText },
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
		// Strip markdown code fences if present
		let clean = textBlock.text.replace(/```json\s*|```\s*/g, '').trim();

		// Claude sometimes wraps the JSON in explanatory text — extract the first {...} or [...]
		if (!clean.startsWith('{') && !clean.startsWith('[')) {
			const objMatch = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
			if (objMatch) clean = objMatch[1];
		}

		parsed = JSON.parse(clean);
	} catch (parseErr) {
		console.error('[callClaude] JSON parse error:', parseErr.message);
		console.error('[callClaude] Raw Claude response:\n', textBlock.text);
		throw Object.assign(
			new Error(`Failed to parse JSON from Claude response: ${parseErr.message}`),
			{ statusCode: 502 },
		);
	}

	// Normalise: Claude may return a single object OR an array (multi-entry documents).
	// Always return an array so analyzeImageWithClaude can flatten consistently.
	const results = Array.isArray(parsed) ? parsed : [parsed];

	for (const result of results) {
		if (typeof result !== 'object' || result === null || typeof result.extracted !== 'object') {
			throw Object.assign(new Error('Claude response does not match expected schema.'), { statusCode: 502 });
		}
	}

	return results;
}

// Keys used for deduplication per slot type (compared by mainValue, otherNotes excluded)
const DEDUP_KEYS = {
	bol:     ['isValid', 'unNumber', 'hazardClass', 'packingGroup', 'emergencyPhone',
	          'hmColumnMarked', 'shipperCertificationPresent', 'entrySequenceCompliant', 'properShippingName'],
	placard: ['isValid', 'unNumber', 'hazardClass', 'placardCondition', 'correctOrientation', 'fourSidedPlacementVerified'],
	intrier: ['isValid', 'unNumber', 'hazardClass', 'packageLabelsPresent', 'loadSecured', 'securementType', 'palletUsed', 'noShiftingHazards'],
};

function extractionFingerprint(result) {
	const keys = DEDUP_KEYS[result.slotName] ?? Object.keys(result.extracted ?? {}).filter((k) => k !== 'otherNotes');
	const ext = result.extracted ?? {};
	return keys.map((k) => {
		const val = ext[k]?.mainValue ?? null;
		return `${k}:${val === null ? '__null__' : String(val).trim().toLowerCase()}`;
	}).join('|');
}

function deduplicateResults(results) {
	const seen = new Set();
	return results.filter((r) => {
		const fp = extractionFingerprint(r);
		if (seen.has(fp)) return false;
		seen.add(fp);
		return true;
	});
}

// files — array of { _buf, mimetype }; each file is sent as a separate request and results are collected
async function analyzeImageWithClaude(files, imageType) {
	const userText = imageType === 'bolPhoto'
		? 'Carefully examine every part of this BOL document. ' +
		  'Find and extract: UN number (4 digits after "UN" or "NA"), ' +
		  'hazard class (number like 2, 2.2, 3, 8, 9), ' +
		  'packing group (Roman numerals I, II, III), ' +
		  'HM column marking: look for X or RQ in the narrow "HM(X)" column on the cargo line itself, not the header row. ' +
		  'These may be in narrow columns, inline in description text, handwritten, or small print. ' +
		  'Report ONLY what you actually read from this document. Respond ONLY with JSON.'
		: 'Analyze this image and respond ONLY with JSON.';

	const systemPrompt = buildSystemPrompt(imageType);

	// Send each image as an independent request so Claude analyses every file separately.
	// callClaude returns an array per file (1 item for single-entry, N for multi-entry).
	// Flatten so bolResults / markerResults / cargoResults are always flat arrays.
	const nestedResults = await Promise.all(
		files.map((f) => callClaude(systemPrompt, { url: f.url, mimetype: f.mimetype }, userText)),
	);
	const results = nestedResults.flat();

	return deduplicateResults(results);
}

// TODO: exterior slot temporarily disabled
// async function analyzeExterierWithClaude(files) { ... }

// ==========================
// Image classification
// ==========================

const CLASSIFY_SYSTEM_PROMPT =
	'You are an image classifier for a Hazmat Load Audit System. ' +
	'Your ONLY job is to look at the provided image and return exactly ONE of these three category labels:\n\n' +
	'  "bolPhoto"     — A Bill of Lading (BOL) or shipping paper document. ' +
	'Recognisable by printed tables, text fields, shipper/consignee information, signatures, and form-like layout.\n' +
	'  "markerPhoto"  — The rear or side exterior of a truck trailer showing hazmat placards / diamond-shaped warning signs ' +
	'mounted on the doors or sides. May also show the trailer number and carrier name on the outside.\n' +
	'  "cargoPhoto"   — The interior of a trailer or truck showing the loaded cargo (boxes, drums, pallets, straps, etc.).\n\n' +
	'Rules:\n' +
	'- Respond ONLY with a JSON object: { "imageType": "<label>" }\n' +
	'- Do NOT include any explanation, markdown, or extra fields.\n' +
	'- If truly ambiguous, pick the closest match — never return null or an unknown label.';

/**
 * Asks Claude to classify a single image as bolPhoto / markerPhoto / cargoPhoto.
 * Returns the imageType string.
 */
async function classifyImage(file) {
	let response;
	try {
		response = await getClient().messages.create({
			model: process.env.CLAUDE_VISION_MODEL,
			max_tokens: 64,
			system: CLASSIFY_SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: {
								type: 'url',
								url:  file.url,
							},
						},
						{ type: 'text', text: 'Classify this image.' },
					],
				},
			],
		});
	} catch (err) {
		throw Object.assign(new Error(`Claude classify error: ${err.message}`), { statusCode: 502 });
	}

	const textBlock = response.content.find((b) => b.type === 'text');
	if (!textBlock?.text) {
		throw Object.assign(new Error('Claude returned empty classification response.'), { statusCode: 502 });
	}

	let parsed;
	try {
		let clean = textBlock.text.replace(/```json\s*|```\s*/g, '').trim();
		if (!clean.startsWith('{')) {
			const m = clean.match(/\{[\s\S]*\}/);
			if (m) clean = m[0];
		}
		parsed = JSON.parse(clean);
	} catch (e) {
		throw Object.assign(new Error(`Failed to parse classification JSON: ${e.message}`), { statusCode: 502 });
	}

	const VALID_TYPES = ['bolPhoto', 'markerPhoto', 'cargoPhoto'];
	if (!VALID_TYPES.includes(parsed.imageType)) {
		throw Object.assign(
			new Error(`Claude returned unknown image type: "${parsed.imageType}"`),
			{ statusCode: 502 },
		);
	}

	return parsed.imageType;
}

/**
 * 1. Classifies every file in parallel.
 * 2. Groups files by detected imageType.
 * 3. Runs analyzeImageWithClaude for each non-empty group.
 * Returns { bolResults, markerResults, cargoResults }.
 */
async function classifyAndAnalyzeAll(files) {
	const classifiedFiles = await Promise.all(
		files.map(async (f) => {
			const imageType = await classifyImage({ url: f.url, mimetype: f.mimetype });
			return { file: f, imageType };
		}),
	);
 
	const groups = { bolPhoto: [], markerPhoto: [], cargoPhoto: [] };
	for (const { file, imageType } of classifiedFiles) {
		groups[imageType].push(file);
	}
 
	const [helperResult, bolResults, markerResults, cargoResults] = await Promise.all([
		groups.bolPhoto.length ? bolHelper(groups.bolPhoto) : Promise.resolve({ isHazmat: true, weights: [] }),
		groups.bolPhoto.length    ? analyzeImageWithClaude(groups.bolPhoto,    'bolPhoto')    : Promise.resolve([]),
		groups.markerPhoto.length ? analyzeImageWithClaude(groups.markerPhoto, 'markerPhoto') : Promise.resolve([]),
		groups.cargoPhoto.length  ? analyzeImageWithClaude(groups.cargoPhoto,  'cargoPhoto')  : Promise.resolve([]),
	]);
 
	// Return classifiedFiles so createAudit can tag each image URL with its slot type
	return { bolResults, markerResults, cargoResults, classifiedFiles, isGlobalHazmat: helperResult.isHazmat, bolWeights: helperResult.weights };
}

const IMAGE_TYPE_TO_SLOT = {
	bolPhoto:    'bol',
	markerPhoto: 'placard',
	cargoPhoto:  'cargo',
};

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
    ['2.1', '2.3'], ['3', '2.3'], ['4.1', '2.3'], 
    ['4.2', '2.3'], ['4.3', '2.3'], ['5.1', '2.3'], ['5.2', '2.3'],
    ['4.2', '8'],
    ['1', '2.1'], ['1', '2.2'], ['1', '2.3'], ['1', '3'], 
    ['1', '4.1'], ['1', '4.2'], ['1', '4.3'], ['1', '5.1'], 
    ['1', '5.2'], ['1', '6.1'], ['1', '8']
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

const LARGE_SINGLE_UN_THRESHOLD_LBS = 8820;

/**
 * Returns the total aggregated weight (lbs) for all UN entries that belong to
 * a given hazard class, using the hazardClass field now returned by bolHelper.
 */
function getWeightForClass(targetClass, bolWeights) {
	if (!bolWeights || bolWeights.length === 0) return 0;
	const norm = (s) => (s ? String(s).trim().toLowerCase().replace(/^class\s+/, '') : null);
	const target = norm(String(targetClass));
	return bolWeights.reduce((sum, entry) => {
		if (norm(String(entry.hazardClass ?? '')) === target) {
			return sum + (Number(entry.weight) || 0);
		}
		return sum;
	}, 0);
}

/**
 * Determines whether an exterior placard is required for a given class based on weight rules.
 * Returns true if the placard MUST be present.
 */
function isPlacardsRequired(hazardClass, bolWeights) {
	const norm = (s) => (s ? String(s).trim().toLowerCase().replace(/^class\s+/, '') : null);
	const cls = norm(String(hazardClass));
 
	// Find rule — try exact match, then base class (e.g. '1.4' → '1')
	const rule = HAZMAT_PLACARD_RULES[cls]
		?? HAZMAT_PLACARD_RULES[cls?.split('.')[0]];
 
	if (!rule) return false; // unknown class — don't require
	if (rule.placard === 'NOT_REQUIRED_DOMESTIC') return false;
	if (rule.placard === 'ANY_QUANTITY') return true;
	if (rule.placard === 'OVER_1001_LBS') {
		return getWeightForClass(cls, bolWeights) >= 1001;
	}
	// DEPENDS_ON_PIH / DEPENDS_ON_TYPE — treat as Table 2 for standard LTL
	if (rule.placard === 'DEPENDS_ON_PIH' || rule.placard === 'DEPENDS_ON_TYPE') {
		return getWeightForClass(cls, bolWeights) >= 1001;
	}
	return false;
}

/**
 * Determines whether a UN number must appear on an exterior placard.
 * Returns true only for PIH materials or a large single-UN shipment.
 */
function isUNNumberRequiredOnPlacard(unNumber, bolWeights) {
	if (!bolWeights || bolWeights.length === 0) return false;
	const cleanUN = String(unNumber).replace(/\D/g, '');
	if (cleanUN.length !== 4) return false;
 
	// Find this UN entry in bolWeights (now carries hazardClass directly)
	const entry = bolWeights.find((e) => String(e.unNumber).replace(/\D/g, '') === cleanUN);
	if (!entry) return false;
 
	const cls  = String(entry.hazardClass ?? '').trim();
	const rule = HAZMAT_PLACARD_RULES[cls] ?? HAZMAT_PLACARD_RULES[cls.split('.')[0]];
 
	// PIH: Poison Gas (2.3) or Class 6.1 PIH — always needs UN# on exterior placard
	if (rule?.unNumber === 'ALWAYS_PIH' || rule?.unNumber === 'ALWAYS_PIH_OR_LARGE_SINGLE') {
		return true;
	}
 
	// BULK_OR_LARGE_SINGLE: only require UN# if this is the sole hazmat UN and weight > threshold
	const allHazmatEntries = bolWeights.filter((e) => String(e.unNumber).replace(/\D/g, '').length === 4);
	if (allHazmatEntries.length === 1 && (Number(entry.weight) || 0) > LARGE_SINGLE_UN_THRESHOLD_LBS) {
		return true;
	}
 
	return false;
}

function recommendPlacards(classes, bolWeights) {
	const recommendations = [];
	for (const cls of classes) {
		if (isPlacardsRequired(cls, bolWeights)) {
			const label = PLACARD_MAP[cls];
			if (label) recommendations.push(label);
		}
	}
	return recommendations;
}

function runAudit(bolResults, markerResults, cargoResults, isGlobalHazmat, bolWeights/*, exterierResults*/) {
	const issues = [];
 
	// Convenience: get mainValue safely
	const v = (field) => field?.mainValue ?? null;
 
	// Normalise a single class string (trim, lowercase, strip "class " prefix)
	const norm = (s) => (s ? String(s).trim().toLowerCase().replace(/^class\s+/, '') : null);
 
	// Normalise a single UN/NA number: strip "UN"/"NA" prefix, keep only digits
	const normUN = (s) => (s ? String(s).trim().replace(/^(un|na)/i, '').trim() : null);
 
	// Parse a class field that may contain multiple values like "Class 8, Class 3" or "3 / 8".
	// Returns an array of normalised non-empty class strings.
	const parseClasses = (raw) => {
		if (!raw) return [];
		return String(raw)
			.split(/[\s,;/|&+()+]+/)
			.map((token) => norm(token.trim()))
			.filter((token) => token && /^\d/.test(token));
	};
 
	// Parse a UN field that may contain multiple values like "UN1170, UN1993" or "1170/1993".
	// Returns an array of normalised digit-only strings.
	const parseUNs = (raw) => {
		if (!raw) return [];
		return String(raw)
			.split(/[\s,;/|&+()+]+/)
			.map((token) => normUN(token.trim()))
			.filter((token) => token && /^\d{4}$/.test(token));
	};
 
	// Helper to check if a specific subclass matches a base class on a placard/label
    const isClassMatch = (cls1, cls2) => {
        if (cls1 === cls2) return true;
        
        const base1 = String(cls1).split('.')[0];
        const base2 = String(cls2).split('.')[0];
        
        if (cls1 === base2 || cls2 === base1) return true;
        
        return false;
    };
 
	// Helper to add an issue only if not already present (same cfr + check + message)
	const addIssue = (issue) => {
		const dup = issues.some(
			(i) => i.cfr === issue.cfr && i.check === issue.check && i.message === issue.message,
		);
		if (!dup) issues.push(issue);
	};
 
	// ─────────────────────────────────────────────
	// 0. GLOBAL HAZMAT SPLIT
	// ─────────────────────────────────────────────
 
	if (!isGlobalHazmat) {
		// ── FALSE PLACARDING CHECK (49 CFR 171.2(k)) ──────────────────────────
		// Shipment is declared non-hazmat. If the AI found hazmat placards on the
		// trailer or hazmat diamond labels on cargo, that is a critical violation.
		const hasPlacardOnTruck = markerResults.some((m) => {
			const cls = v(m.extracted?.hazardClass);
			return cls !== null && String(cls).trim() !== '';
		});
		const hasDiamondOnCargo = cargoResults.some((c) => {
			const cls = v(c.extracted?.hazardClass);
			return cls !== null && String(cls).trim() !== '';
		});
		if (hasPlacardOnTruck || hasDiamondOnCargo) {
			addIssue({
				source:   'CROSS',
				severity: 'CRITICAL',
				cfr:      '49 CFR 171.2(k)',
				check:    'False Placarding',
				message:  'Shipment is declared as non-hazardous on the BOL, but hazmat placards or hazard class labels were detected on the vehicle or cargo. Displaying hazmat placards on a non-hazmat shipment is a federal violation.',
				fix:      'If this shipment IS hazardous, update the BOL accordingly. If it is not, remove all hazmat placards and labels before departure.',
			});
		}
	} else {
	// ─────────────────────────────────────────────
	// 1. BOL FIELD VALIDATION — "at least one BOL satisfies" logic (49 CFR 172.200–204)
	// An issue is raised only if NO BOL image satisfies the condition.
	// ─────────────────────────────────────────────
 
	const noBolHasUN = bolResults.every((bol) => parseUNs(v(bol.extracted?.unNumber)).length === 0);
	if (noBolHasUN) {
		addIssue({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.202(a)(1)',
			check: 'UN Number',
			message: 'UN/NA identification number is missing from all BOL documents.',
			fix: 'Add the UN/NA number (e.g. UN1170) to the hazmat entry on the BOL.',
		});
	}
 
	{
		for (const bol of bolResults) {
			const bolExt = bol.extracted ?? {};
			const bolUNs = parseUNs(v(bolExt.unNumber));
 
			for (const unNum of bolUNs) {
				const cleanUnNum = String(unNum).replace(/\D/g, '');
 
				if (cleanUnNum.length !== 4) continue;
 
				const rawEntry = hazmatTable?.[`UN${cleanUnNum}`];
				if (!rawEntry) continue;

				const entryList = Array.isArray(rawEntry) ? rawEntry : [rawEntry];

				const bolPGForLookup = v(bolExt.packingGroup);
				const normalizedPGForLookup = bolPGForLookup
					? String(bolPGForLookup).toUpperCase().replace(/[^IV]/g, '')
					: null;

				const entry =
					(normalizedPGForLookup &&
						entryList.find(
							(e) =>
								String(e.expectedData?.packingGroup ?? '').toUpperCase() ===
								normalizedPGForLookup,
						)) ??
					entryList[0];

				if (!entry) continue;

				const expected = entry.expectedData ?? {};
				const errors   = entry.errors       ?? {};
				const refs     = entry.references   ?? {};
 
				// ── 1. Hazard Class ──────────────────────────────────────────
				const bolClassArr = parseClasses(v(bolExt.hazardClass));
				if (
					expected.hazardClass != null &&
					bolClassArr.length > 0 &&
					!bolClassArr.some((c) => isClassMatch(c, norm(String(expected.hazardClass))))
				) {
					addIssue({
						source:   'BOL',
						severity: 'CRITICAL',
						cfr:      '49 CFR 172.101',
						check:    'Hazard Class',
						message:  errors.hazardClassMismatch
							?? `UN${unNum}: hazard class mismatch. BOL shows ${bolClassArr.join('/')}, expected ${expected.hazardClass}.`,
						fix: `Correct the hazard class to "${expected.hazardClass}" per the DOT Hazardous Materials Table.`,
					});
				}
 
				// ── 2. Packing Group ─────────────────────────────────────────
				const bolPG        = v(bolExt.packingGroup);
				const normalizedPG = bolPG ? String(bolPG).trim().toUpperCase() : null;
				if (
					expected.packingGroup != null &&
					normalizedPG &&
					normalizedPG !== '—' &&
					normalizedPG !== '-' &&
					normalizedPG !== expected.packingGroup.toUpperCase()
				) {
					addIssue({
						source:   'BOL',
						severity: 'CRITICAL',
						cfr:      '49 CFR 172.101',
						check:    'Packing Group',
						message:  errors.packingGroupMismatch
							?? `UN${unNum}: packing group mismatch. BOL shows PG ${normalizedPG}, expected PG ${expected.packingGroup}.`,
						fix: `Correct the packing group to "${expected.packingGroup}" per the DOT Hazardous Materials Table.`,
					});
				}
 
				// ── 3. Proper Shipping Name ───────────────────────────────────
				const bolPSN      = v(bolExt.properShippingName);
				const expectedPSN = expected.properShippingName;
 
				if (
					expectedPSN != null &&
					bolPSN      != null &&
					typeof bolPSN === 'string'
				) {
					const normPSN = (str) => {
						return str
							.toLowerCase()
							.replace(/\s*\(.*?\)\s*/g, ' ') 
							.replace(/\bn\.?o\.?s\.?\b/gi, 'nos')
							.replace(/[-/]/g, ' ')
							.replace(/[^a-z0-9\s]/g, '')
							.replace(/\b(liquid|solid)s\b/g, '$1')
							.replace(/\bgases\b/g, 'gas')
							.replace(/\s+/g, ' ')
							.trim();
					};
 
					const bolNorm = normPSN(bolPSN);
					const expNorm = normPSN(expectedPSN);
 
					const isMatch = bolNorm === expNorm || bolNorm.startsWith(expNorm);
 
					if (!isMatch) {
						addIssue({
							source:   'BOL',
							severity: 'MAJOR',
							cfr:      '49 CFR 172.202(a)(1)',
							check:    'Proper Shipping Name',
							message:  `UN${unNum}: proper shipping name mismatch. BOL shows "${bolPSN.trim()}", expected "${expectedPSN}".`,
							fix: `Use the exact DOT proper shipping name: "${expectedPSN}".`,
						});
					}
				}
 
				// ── 4. Label Codes ────────────────────────────────────────────
				if (expected.labelCodes != null) {
					const requiredLabels = parseClasses(String(expected.labelCodes));
					const bolCls         = parseClasses(v(bolExt.hazardClass));
					const missingLabels  = requiredLabels.filter(
						(rl) => !bolCls.some((bc) => isClassMatch(bc, rl))
					);
					if (missingLabels.length > 0) {
						addIssue({
							source:   'BOL',
							severity: 'MAJOR',
							cfr:      '49 CFR 172.400',
							check:    'Label Codes',
							message:  errors.labelingViolation
								?? `UN${unNum}: missing or incorrect label codes on BOL. Required: ${requiredLabels.join(', ')}.`,
							fix: `Ensure all required label codes (${requiredLabels.join(', ')}) are reflected on the BOL and cargo packaging.`,
						});
					}
				}
 
				// ── 5. Packaging references (informational MINOR) ─────────────
				//if (refs.packagingNonBulk || refs.packagingBulk || refs.packagingExceptions) {
				//	const parts = [
				//		refs.packagingExceptions && `Exceptions § ${refs.packagingExceptions.replace('173.', '173.')}`,
				//		refs.packagingNonBulk    && `Non-bulk § ${refs.packagingNonBulk}`,
				//		refs.packagingBulk       && `Bulk § ${refs.packagingBulk}`,
				//	].filter(Boolean).join(', ');
 
				//	const hasPackagingViolation = v(bolExt.packagingViolation) === true;
				//	if (hasPackagingViolation) {
				//		addIssue({
				//			source:   'BOL',
				//			severity: 'MAJOR',
				//			cfr:      '49 CFR 173',
				//			check:    'Packaging Requirements',
				//			message:  errors.packagingViolation
				//				?? `UN${unNum}: packaging requirements violation. Refer to 49 CFR: ${parts}.`,
				//			fix: `Verify packaging against 49 CFR ${parts}.`,
				//		});
				//	}
				//}
 
				//if (refs.specialProvisions) {
				//	const hasSpecialViolation = v(bolExt.specialProvisionsViolation) === true;
				//	if (hasSpecialViolation) {
				//		addIssue({
				//			source:   'BOL',
				//			severity: 'WARNING',
				//			cfr:      '49 CFR 172.102',
				//			check:    'Special Provisions',
				//			message:  errors.specialProvisionsViolation
				//				?? `UN${unNum}: special provisions violation (${refs.specialProvisions}). See 49 CFR § 172.102.`,
				//			fix: `Review and comply with special provisions: ${refs.specialProvisions}.`,
				//		});
				//	}
				//}
			}
		}
	}
 
	const noBolHasClass = bolResults.every((bol) => parseClasses(v(bol.extracted?.hazardClass)).length === 0);
	if (noBolHasClass) {
		addIssue({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.202(a)(2)',
			check: 'Hazard Class',
			message: 'Hazard class / division is missing from all BOL documents.',
			fix: 'Add the numeric hazard class (e.g. "3", "8", "5.2") to the BOL entry.',
		});
	}
 
	const noBolHasHM = bolResults.every((bol) => !v(bol.extracted?.hmColumnMarked));
	if (noBolHasHM) {
		addIssue({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.201(a)(1)',
			check: 'HM Column (172.201)',
			message: 'HM column is not clearly marked with "X" or "RQ" on any BOL document.',
			fix: 'Mark "X" in the HM column next to each hazmat entry on the BOL.',
		});
	}
 
	const noBolHasPhone = bolResults.every((bol) => !v(bol.extracted?.emergencyPhone));
	if (noBolHasPhone) {
		addIssue({
			source: 'BOL',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.201(d)',
			check: 'Emergency Phone',
			message: '24-hour emergency response phone number is missing from all BOL documents.',
			fix: 'Add a monitored 24-hour emergency phone number (e.g. CHEMTREC 800-424-9300).',
		});
	}
 
	const noBolHasPG = bolResults.every((bol) => {
		const bolExt      = bol.extracted ?? {};
		const bolClsArr   = parseClasses(v(bolExt.hazardClass));
		// BOL is PG-exempt if ANY of its classes is Class 2.x or Class 7
		const isPG_exempt = bolClsArr.some((c) => c.startsWith('2') || c === '7');
		if (isPG_exempt) return false; // exempt BOL — does not count as "missing"
		const pgValue = v(bolExt.packingGroup);
		return !pgValue || String(pgValue).trim() === '—' || String(pgValue).trim() === '-';
	});
	if (noBolHasPG) {
		addIssue({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.202(a)(4)',
			check: 'Packing Group',
			message: 'Packing group (I, II, or III) is missing from all applicable BOL documents.',
			fix: 'Add the required packing group designation to the BOL hazmat entry.',
		});
	}
 
	const noBolHasCert = bolResults.every((bol) => !v(bol.extracted?.shipperCertificationPresent));
	if (noBolHasCert) {
		addIssue({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.204',
			check: 'Shipper Cert (172.204)',
			message: 'Shipper certification signature is absent or illegible on all BOL documents.',
			fix: 'Have the shipper sign the certification statement on the BOL.',
		});
	}
 
	const noBolSequenceOk = bolResults.every((bol) => v(bol.extracted?.entrySequenceCompliant) === false);
	if (noBolSequenceOk) {
		addIssue({
			source: 'BOL',
			severity: 'MAJOR',
			cfr: '49 CFR 172.201(a)',
			check: 'Entry Sequence',
			message: 'Hazmat entry sequence does not follow required DOT order on any BOL document (shipping name → class → UN number → packing group).',
			fix: 'Reorder the BOL hazmat entry to: Proper Shipping Name, Hazard Class, UN/NA Number, Packing Group.',
		});
	}
 
	// ─────────────────────────────────────────────
	// 2. PROPER SHIPPING NAME VERIFICATION (49 CFR 172.101 / 172.202)
	// ─────────────────────────────────────────────
 
	const noBolHasShippingName = bolResults.every((bol) => {
        const psn = v(bol.extracted?.properShippingName);
        return !psn || String(psn).trim() === '';
    });
 
    if (noBolHasShippingName) {
        addIssue({
            source: 'BOL',
            severity: 'CRITICAL',
            cfr: '49 CFR 172.202(a)(1)',
            check: 'Proper Shipping Name',
            message: 'Proper shipping name is missing from all BOL documents.',
            fix: 'Add the exact DOT-authorized Proper Shipping Name from 49 CFR 172.101.',
        });
    }
 
	} // end isGlobalHazmat — BOL field validation
 
	// ─────────────────────────────────────────────
	// 3. BOL × PLACARD CROSS-MATCH — weight-aware (49 CFR 172.504 / 172.332)
	// Placards are only REQUIRED when the weight/class rules demand them.
	// UN numbers on exterior placards are only required for PIH or large single-UN loads.
	// ─────────────────────────────────────────────
 
	const bolClasses     = [...new Set(bolResults    .flatMap((b) => parseClasses(v(b.extracted?.hazardClass))))];
	const bolUNs         = [...new Set(bolResults    .flatMap((b) => parseUNs(v(b.extracted?.unNumber))))];
	const placardClasses = [...new Set(markerResults .flatMap((m) => parseClasses(v(m.extracted?.hazardClass))))];
	const placardUNs     = [...new Set(markerResults .flatMap((m) => parseUNs(v(m.extracted?.unNumber))))];
 
	if (isGlobalHazmat) {
		// BOL class requires a placard → check if one is present on the truck
		for (const bc of bolClasses) {
			const required = isPlacardsRequired(bc, bolWeights);
			if (!required) continue; // weight threshold not met — placard not mandatory
 
			if (placardClasses.length > 0 && !placardClasses.some((pc) => isClassMatch(bc, pc))) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.504(a)',
					check: 'BOL-Placard Class Match',
					message: `BOL declares Class ${bc} and the weight threshold requires a placard, but no matching placard was found on the vehicle (placard classes: ${placardClasses.join(', ') || 'none'}).`,
					fix: `Affix a Class ${bc} placard on all 4 sides of the trailer before departure.`,
				});
			}
		}
 
		// Placard found on truck but not declared on BOL → false placarding
		for (const pc of placardClasses) {
			if (bolClasses.length > 0 && !bolClasses.some((bc) => isClassMatch(bc, pc))) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.504(a)',
					check: 'BOL-Placard Class Match',
					message: `Placard on vehicle shows Class ${pc} but this class is not declared on any BOL (BOL classes: ${bolClasses.join(', ')}).`,
					fix: `Remove or replace the incorrect Class ${pc} placard, or update the BOL to include this class.`,
				});
			}
		}
 
		// ── UN number on exterior placard (49 CFR 172.332) ─────────────────
		// Required only for PIH or a single-UN large load (> 8,820 lbs).
		for (const bu of bolUNs) {
			if (!isUNNumberRequiredOnPlacard(bu, bolWeights)) continue; // not required
 
			if (placardUNs.length > 0 && !placardUNs.includes(bu)) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.332',
					check: 'BOL-Placard UN Match',
					message: `UN${bu} requires a UN number on the exterior placard (PIH material or large single-UN load) but was not found on any placard (placard UNs: ${placardUNs.map((u) => 'UN' + u).join(', ') || 'none'}).`,
					fix: `Ensure a placard panel displaying UN${bu} is present on all 4 sides of the trailer.`,
				});
			}
		}
 
		// Placard has a UN number that doesn't appear on the BOL — always an error
		for (const pu of placardUNs) {
			if (bolUNs.length > 0 && !bolUNs.includes(pu)) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.332',
					check: 'BOL-Placard UN Match',
					message: `UN${pu} is shown on a placard but was not found on any BOL (BOL UNs: ${bolUNs.map((u) => 'UN' + u).join(', ')}).`,
					fix: `Remove or replace the incorrect placard, or update the BOL to include UN${pu}.`,
				});
			}
		}
	}
 
	// ─────────────────────────────────────────────
	// 4. BOL × CARGO CROSS-MATCH — set-based (49 CFR 172.301 / 172.400)
	// ─────────────────────────────────────────────
 
	const cargoClasses = [...new Set(cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass))))];
	const cargoUNs     = [...new Set(cargoResults.flatMap((c) => parseUNs(v(c.extracted?.unNumber))))];
 
	// BOL classes that have no matching cargo class
    for (const bc of bolClasses) {
        if (cargoClasses.length > 0 && !cargoClasses.some((cc) => isClassMatch(bc, cc))) {
            addIssue({
                source: 'CROSS',
                severity: 'CRITICAL',
                cfr: '49 CFR 172.400',
                check: 'BOL-Package Class Match',
                message: `BOL declares Class ${bc} but no cargo package label matching this class was found (cargo classes: ${cargoClasses.join(', ')}).`,
                fix: 'Ensure package labels match the hazard class declared on the BOL.',
            });
        }
    }
 
    // Cargo classes that have no matching BOL class
    for (const cc of cargoClasses) {
        if (bolClasses.length > 0 && !bolClasses.some((bc) => isClassMatch(bc, cc))) {
            addIssue({
                source: 'CROSS',
                severity: 'CRITICAL',
                cfr: '49 CFR 172.400',
                check: 'BOL-Package Class Match',
                message: `Cargo package shows Class ${cc} but this class is not declared on any BOL (BOL classes: ${bolClasses.join(', ')}).`,
                fix: 'Update the BOL to include all hazard classes present on cargo packages, or re-label the packages.',
            });
        }
    }
 
	// BOL UN numbers that have no matching cargo UN
	for (const bu of bolUNs) {
		if (cargoUNs.length > 0 && !cargoUNs.includes(bu)) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.301(a)',
				check: 'BOL-Package UN Match',
				message: `UN${bu} is listed on BOL but was not found on any cargo package (cargo UNs: ${cargoUNs.map((u) => 'UN' + u).join(', ')}).`,
				fix: `Ensure cargo packages are marked with UN${bu} as required.`,
			});
		}
	}
	// Cargo UN numbers that have no matching BOL UN
	for (const cu of cargoUNs) {
		if (bolUNs.length > 0 && !bolUNs.includes(cu)) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.301(a)',
				check: 'BOL-Package UN Match',
				message: `UN${cu} is marked on cargo but was not found on any BOL (BOL UNs: ${bolUNs.map((u) => 'UN' + u).join(', ')}).`,
				fix: `Update the BOL to include UN${cu}, or verify the correct UN marking on cargo packages.`,
			});
		}
	}
 
	// Package labels check — issue only if NO cargo image has labels present
	const noCargoHasLabels = cargoResults.every((cargo) => !v(cargo.extracted?.packageLabelsPresent));
	if (noCargoHasLabels) {
		addIssue({
			source: 'CARGO',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.400',
			check: 'Package Labels',
			message: 'Required hazard class labels are not visible on cargo packages in any provided photo.',
			fix: 'Affix the correct hazard class label(s) to each package as required by 49 CFR 172.400.',
		});
	}
 
	// ─────────────────────────────────────────────
	// 5. COMPATIBILITY CHECK (49 CFR 177.848)
	// Collect all unique classes across all slots
	// ─────────────────────────────────────────────
 
	const allClasses = [
		...new Set([
			...bolResults.flatMap((b) => parseClasses(v(b.extracted?.hazardClass))),
			...markerResults.flatMap((m) => parseClasses(v(m.extracted?.hazardClass))),
			...cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass))),
		]),
	];
 
	if (allClasses.length >= 2) {
		for (let i = 0; i < allClasses.length; i++) {
			for (let j = i + 1; j < allClasses.length; j++) {
				if (isForbiddenCombination(allClasses[i], allClasses[j])) {
					addIssue({
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
	// 6. PLACARD CONDITION CHECKS — "at least one placard satisfies" logic
	// ─────────────────────────────────────────────
 
	const allPlacardsDamaged = markerResults.every((marker) => {
		const cond = v(marker.extracted?.placardCondition);
		return cond && cond !== 'unknown' && cond === 'damaged';
	});
	if (allPlacardsDamaged && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.516(c)(1)',
			check: 'Placard Condition',
			message: 'All placards are damaged and may be unreadable at inspection.',
			fix: 'Replace damaged placards with new, legible ones before departure.',
		});
	} else {
		const anyPlacardBlurry = markerResults.every((marker) => {
			const cond = v(marker.extracted?.placardCondition);
			return cond && cond !== 'unknown' && (cond === 'blurry' || cond === 'damaged');
		});
		if (anyPlacardBlurry && markerResults.length > 0) {
			addIssue({
				source: 'PLACARD',
				severity: 'MINOR',
				cfr: '49 CFR 172.516(c)(1)',
				check: 'Placard Condition',
				message: 'No clearly legible placard found — all placards are blurry, damaged or obscured.',
				fix: 'Clean or replace all placards to ensure they are fully legible.',
			});
		}
	}
 
	const noPlacardFourSided = markerResults.every((marker) => !v(marker.extracted?.fourSidedPlacementVerified));
	if (noPlacardFourSided && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'WARNING',
			cfr: '49 CFR 172.504(a)',
			check: 'Four-Sided Placement',
			message: 'Four-sided placard placement could not be verified from any of the provided photos.',
			fix: 'Submit photos of all 4 sides of the trailer to confirm placard placement.',
		});
	}
 
	const noPlacardCorrectOrientation = markerResults.every((marker) => v(marker.extracted?.correctOrientation) === false);
	if (noPlacardCorrectOrientation && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(c)(2)',
			check: 'Placard Orientation',
			message: 'No placard appears to be in the correct point-up (diamond) orientation.',
			fix: 'Re-affix the placard(s) in the correct point-up diamond orientation.',
		});
	}
 
	// ─────────────────────────────────────────────
	// 7. CARGO / LOAD SECUREMENT — "at least one cargo satisfies" logic
	// ─────────────────────────────────────────────
 
	const noCargoSecured = cargoResults.every((cargo) => v(cargo.extracted?.loadSecured) === false);
	if (noCargoSecured && cargoResults.length > 0) {
		addIssue({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Load Securement',
			message: 'Cargo does not appear to be properly secured against shifting in any of the provided photos.',
			fix: 'Secure all cargo with appropriate tie-downs, straps, or blocking before departure.',
		});
	}
 
	const noCargoNoShifting = cargoResults.every((cargo) => v(cargo.extracted?.noShiftingHazards) === false);
	if (noCargoNoShifting && cargoResults.length > 0) {
		addIssue({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Shifting Hazards',
			message: 'Potential cargo shifting hazards detected in all provided cargo photos.',
			fix: 'Add additional tie-downs or bracing to prevent cargo movement in transit.',
		});
	}
 
	// ─────────────────────────────────────────────
	// 8. OTHER NOTES from each slot
	// ─────────────────────────────────────────────
 
	const pushNote = (source, note) => {
		if (!note || typeof note !== 'object' || Array.isArray(note)) return;
		const check   = typeof note.sign_name === 'string' ? note.sign_name.trim() : null;
		const message = typeof note.meaning   === 'string' ? note.meaning.trim()   : null;
		if (!check || !message) return;
		addIssue({ source, severity: 'WARNING', cfr: null, check, message, fix: null });
	};
 
	for (const bol    of bolResults)    for (const note of (bol.extracted?.otherNotes    ?? [])) pushNote('BOL',     note);
	for (const marker of markerResults) for (const note of (marker.extracted?.otherNotes ?? [])) pushNote('PLACARD', note);
	for (const cargo  of cargoResults)  for (const note of (cargo.extracted?.otherNotes  ?? [])) pushNote('CARGO',   note);
 
	// ─────────────────────────────────────────────
	// 9. SCORING & SUMMARY
	// ─────────────────────────────────────────────
 
	const countBySeverity = (sev) => issues.filter((i) => i.severity === sev).length;
	const criticalCount = countBySeverity('CRITICAL');
	const majorCount    = countBySeverity('MAJOR');
	const minorCount    = countBySeverity('MINOR');
	const warningCount  = countBySeverity('WARNING');
 
	const score    = Math.max(0, 100 - criticalCount * 20 - majorCount * 10 - minorCount * 3 - warningCount * 1);
	const isPassed = criticalCount === 0 && majorCount === 0;
 
	// ─────────────────────────────────────────────
	// 10. PLACARD RECOMMENDATIONS
	// ─────────────────────────────────────────────
 
	const allClassesForRec = [
		...new Set([
			...bolResults.flatMap((b) => parseClasses(v(b.extracted?.hazardClass))),
			...markerResults.flatMap((m) => parseClasses(v(m.extracted?.hazardClass))),
			...cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass))),
		]),
	];
	const placardRecommendations = recommendPlacards(allClassesForRec, bolWeights);
 
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
// POST /audit/upload
// ==========================
 

const isPdfBuffer = (buffer) => {
	if (!buffer || buffer.length < 4) return false;
	return buffer.subarray(0, 4).toString('ascii') === '%PDF';
};

export async function uploadAuditImages(request, reply) {
	const allFiles = toArray(request.body.images);

	if (allFiles.length === 0) {
		return reply.code(400).send({ error: 'Field "images" is required.' });
	}

	let processedFiles = [];

	for (const file of allFiles) {
		if (!file._buf || file._buf.length === 0) {
			return reply.code(400).send({ error: 'One or more files are empty.' });
		}

		if (isPdfBuffer(file._buf)) {
			try {
				const document = await pdf(file._buf, { scale: 1.0 }); 
				
				for await (const pageBuf of document) {
					processedFiles.push({
						mimetype: 'image/png',
						_buf: pageBuf,
					});
				}
			} catch (err) {
				return reply.code(500).send({ error: `Failed to parse PDF: ${err.message}` });
			}
		} else {
			if (!file.mimetype || !file.mimetype.startsWith('image/')) {
				return reply.code(400).send({ error: `Expected image or PDF. Got: ${file.mimetype}` });
			}
			processedFiles.push(file);
		}
	}

	const { client: supabase, bucket } = getSupabase();

	const uploaded = await Promise.all(
		processedFiles.map(async (file) => {
			const ext = file.mimetype.split('/')[1] ?? 'jpg'; 
			const storageId = `${randomUUID()}.${ext}`;

			const { error } = await supabase.storage
				.from(bucket)
				.upload(storageId, file._buf, { contentType: file.mimetype, upsert: false });

			if (error) {
				throw Object.assign(new Error(`Supabase upload failed: ${error.message}`), { statusCode: 502 });
			}

			const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storageId);

			return { id: storageId, url: publicData.publicUrl };
		}),
	);

	return reply.send({ images: uploaded });
}

// ==========================
// Route handler
// ==========================

export async function createAudit(request, reply) {
	const { imageIds, auditorId } = request.body;
 
	if (!Array.isArray(imageIds) || imageIds.length === 0) {
		return reply.code(400).send({ error: 'Field "imageIds" must be a non-empty array of storage IDs.' });
	}
 
	const { client: supabase, bucket } = getSupabase();
 
	// Resolve public URLs and detect mimetype from file extension.
	const MIME_MAP = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
	const files = imageIds.map((id) => {
		const { data } = supabase.storage.from(bucket).getPublicUrl(id);
		const ext      = id.split('.').pop()?.toLowerCase() ?? 'jpeg';
		return { id, url: data.publicUrl, mimetype: MIME_MAP[ext] ?? 'image/jpeg' };
	});
 
	let bolResults, markerResults, cargoResults, classifiedFiles, isGlobalHazmat, bolWeights;
	try {
		({ bolResults, markerResults, cargoResults, classifiedFiles, isGlobalHazmat, bolWeights } = await classifyAndAnalyzeAll(files));
	} catch (err) {
		return reply.code(err.statusCode ?? 502).send({ error: err.message });
	}

	if (bolWeights && bolWeights.length > 0) {
		const formattedWeightsStr = bolWeights
			.map(w => `UN: ${String(w.unNumber).replace(/\D/g, '')} | Weight: ${w.weight} lbs;`)
			.join('\n');

		bolResults.forEach(bol => {
			if (bol.extracted) {
				bol.extracted.totalWeights = {
					mainValue: formattedWeightsStr,
					meaning: "Total aggregate gross weights calculated across all BOL pages"
				};
			}
		});
	}

	const audit = runAudit(bolResults, markerResults, cargoResults, isGlobalHazmat, bolWeights);
 
	const auditResponse = { bol: bolResults, marker: markerResults, cargo: cargoResults, audit };
 
	// Each image stored with its detected slot type so the UI can show them per-section
	const auditImages = classifiedFiles.map(({ file, imageType }) => ({
		url:  file.url,
		type: IMAGE_TYPE_TO_SLOT[imageType] ?? 'cargo',
	}));
 
	let savedId = null;
	try {
		const [saved] = await db.insert(audits).values({
			response:    auditResponse,
			is_passed:   String(audit.is_passed),
			score:       String(audit.score),
			auditImages,
			auditorId
		}).returning({ id: audits.id });
		savedId = saved.id;
	} catch (err) {
		console.error('Failed to save audit to DB:', err.message);
	}
 
	return reply.send({ id: savedId, auditImages, ...auditResponse });
}

// ==========================
// GET /audit
// ==========================
 
export async function getAudits(request, reply) {
	const { 
		page = 1, 
		limit = 20, 
		auditorId,
		sortBy = 'date',     // 'date' | 'score'
		sortOrder = 'desc',  // 'asc' | 'desc'
		status,              // 'passed' | 'failed'
		dateFrom,            // ISO строка (напр. '2026-04-01T00:00:00Z')
		dateTo               // ISO строка
	} = request.query;

	const offset = (Number(page) - 1) * Number(limit);
 
	try {
		const conditions = [eq(audits.auditorId, auditorId)];

		if (status === 'passed') {
			conditions.push(eq(audits.is_passed, 'true'));
		} else if (status === 'failed') {
			conditions.push(eq(audits.is_passed, 'false'));
		}

		if (dateFrom) {
			conditions.push(gte(audits.created_at, new Date(dateFrom)));
		}
		if (dateTo) {
			conditions.push(lte(audits.created_at, new Date(dateTo)));
		}

		const whereFilter = conditions.length === 1 ? conditions[0] : and(...conditions);

		const sortColumn = sortBy === 'score' ? audits.score : audits.created_at;
		const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

		const [rows, [{ total }]] = await Promise.all([
			db
				.select({
					id:         audits.id,
					is_passed:  audits.is_passed,
					score:      audits.score,
					created_at: audits.created_at,
					response:   audits.response,
					auditImages: audits.auditImages,
				})
				.from(audits)
				.where(whereFilter)
				.orderBy(orderByClause)
				.limit(Number(limit))
				.offset(offset),
			
			db.select({ total: count() }).from(audits).where(whereFilter),
		]);
 
		const totalPages = Math.ceil(total / Number(limit));
 
		return reply.send({
			data: rows,
			pagination: {
				total,
				page: Number(page),
				limit: Number(limit),
				totalPages,
				hasNextPage: page < totalPages,
				hasPrevPage: page > 1,
			},
		});
	} catch (err) {
		return reply.code(502).send({ error: `Failed to fetch audits: ${err.message}` });
	}
}