import { requireAnthropic } from "../lib/cloudeClient.js";

// ==========================
// Claude client
// ==========================

const getClient = () => requireAnthropic();

const buildSystemPrompt = (imageType) => {
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
            '- Hazard Class: Extract the primary hazard class AND any subsidiary classes in parentheses. ' +
			'FORMATTING RULE: You MUST remove any commas or spaces immediately preceding the parenthesis. ' +
			'Always format strictly as "Primary(Subsidiary)", for example, convert "5.2,(8)" or "5.1, (8)" to exactly "5.2(8)" or "5.1(8)". ' +
			'CRITICAL SEPARATION RULE: If the Packing Group is printed right next to the class (e.g., "8,II" or "5.1(8),II"), ' +
			'extract ONLY the hazard class portion into this field and put the Roman numerals into the packingGroup field. ' +
			'NEVER concatenate classes from multiple different cargo rows into a single string.\n\n' +
            'STEP 2: EXTRACT REMAINING FIELDS\n' +
            '- Packing Group: Roman numerals (I, II, III) where required.\n' +
            '- HM Column Marking: "X" or "RQ" marking in hazardous material column.\n' +
            '- Emergency Phone: Extract ALL visible 24-Hour monitored phone numbers. You MUST put all found numbers in "mainValue" separated by a semicolon (e.g., "+1-800-424-9300; +1-703-527-3887"). In "meaning", specify the purpose of each number respectively (e.g., "USA; International").\n' +
            '- Shipper Certification: Check if the signature block at the bottom is signed.\n\n' +
            'FIELD DEFINITIONS (CRITICAL):\n' +
            '- properShippingName: Extract the EXACT text of the Proper Shipping Name printed on the document (e.g., "TOLUENE", "COATING SOLUTION", "CORROSIVE LIQUID, N.O.S."). Do not alter, guess, or abbreviate the text.\n' +
            '- entrySequenceCompliant: true if entry follows DOT order (name → class → UN → PG). false if order differs. null if uncertain.\n' +
            '- sealNumber: Look for "SEAL#", "Seal Number", or handwritten seal numbers. Extract the exact alphanumeric string. null if not found.\n' +
			'- hmColumnMarked: STRICT RULE. Search ONLY the data row under the HM column. ' +
			'If the cell on the data row is visually blank or empty, you MUST return false. ' +
			'DO NOT count the "X" in the column header "HM(X)". ' +
			'DO NOT count the letter "X" inside normal words like "TX", "BOX", or "MEXICO". ' +
			'Only return true if a standalone "X" or "RQ" is intentionally entered for that specific cargo line. ' +
			'Set true if ANY "X" or "RQ" is found specifically on the hazmat line row data, NOT the header.\n' +
            'MULTIPLE HAZMAT ENTRIES:\n' +
            '- If this document shows TWO OR MORE distinct hazmat line items, return a SEPARATE object for each.\n' +
            '- PAIRING RULE: pair each UN number with its corresponding hazard class and packing group from that specific line item.\n\n' +
            HAZMAT_CLASS_REFERENCE +
            'CRITICAL OUTPUT RULE:\n' +
            '- ONE hazmat entry → single JSON object.\n' +
            '- TWO OR MORE hazmat entries → JSON ARRAY of objects, one per entry.\n' +
            '- STRICT SCHEMA RULE: The "extracted" field MUST NEVER BE AN ARRAY. If you have multiple entries, return a ROOT array of objects, like this:\n' +
            '  [ { "slotName": "bol", "extracted": {...} }, { "slotName": "bol", "extracted": {...} } ]\n' +
            '- Never use comma-separated UN numbers or hazard classes inside a single object.\n' +
			'- TOKEN LIMIT PREVENTION: Keep "meaning" strings concise but highly specific (approx 10-15 words). Include exact evidence (e.g., "Standalone X found in HM column for UN1866"). DO NOT use conversational filler phrases like "Extracted exactly as printed".\n' +
            '- Leave "otherNotes" empty [] UNLESS there is a critical DOT violation not covered by other fields. Do not extract Qty or Gross Weight into notes.\n\n' +
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
			'      "sealNumber":                 { "mainValue": null,   "meaning": "" },\n' +
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
			'- Hazard Class: The single small number at the very bottom tip.\n' +
			'  * HARD RULE: Output EXACTLY the digit(s) physically printed at the bottom corner. If the placard visually prints "2", you MUST output "2". NEVER infer or convert it to "2.1" based on the red color or flame symbol.\n' +
			'  * HARD RULE: Output ONLY the raw numeric value. DO NOT output descriptive text like "Flammable Gas", symbols, or long explanations.\n' +
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
			'}\n' +
			'DO NOT include any reasoning, explanations, preamble, or postamble. Output ONLY raw JSON.'
		);
	}

	if (imageType === 'sealPhoto') {
		return (
			'You are a strict computer vision assistant for a Hazmat Load Audit System. ' +
			'You will receive exactly ONE image of a physical security seal attached to a truck trailer door. ' +
			'Follow these steps EXACTLY:\n\n' +
			'STEP 1: IDENTIFY THE SEAL\n' +
			'- Locate the plastic or metal security seal. ' +
			'- Extract the alphanumeric seal number physically printed or embossed on it.\n' +
			'- CRITICAL WARNING: For stamped/embossed numbers on shiny metal, reflections and shadows heavily distort digits. ' +
			'Pay extreme attention to distinguishing 8 vs 0, 9 vs 6, 1 vs 7, and 5 vs S. Take your time to analyze the depth and shadow of the engraving.\n\n' +
			'STEP 2: FORMAT OUTPUT\n' +
			'- Read ONLY what is physically visible. Do not guess.\n' +
			'- If no seal number is visible or legible, set mainValue to null.\n\n' +
			'Respond ONLY with this JSON shape:\n' +
			'{\n' +
			'  "slotName": "seal",\n' +
			'    "extracted": {\n' +
			'      "sealNumber": { "mainValue": null, "meaning": "" },\n' +
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

const bolHelper = async (bolFiles) => {
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
				}
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

// Keys used for deduplication per slot type (compared by mainValue, otherNotes excluded)
const DEDUP_KEYS = {
	bol:     ['isValid', 'unNumber', 'hazardClass', 'packingGroup', 'emergencyPhone',
	          'hmColumnMarked', 'shipperCertificationPresent', 'entrySequenceCompliant', 'properShippingName', 'sealNumber'],
	placard: ['isValid', 'unNumber', 'hazardClass', 'placardCondition', 'correctOrientation', 'fourSidedPlacementVerified'],
	intrier: ['isValid', 'unNumber', 'hazardClass', 'packageLabelsPresent', 'loadSecured', 'securementType', 'palletUsed', 'noShiftingHazards'],
	seal:    ['sealNumber'],
};

const extractionFingerprint = (result) => {
	const keys = DEDUP_KEYS[result.slotName] ?? Object.keys(result.extracted ?? {}).filter((k) => k !== 'otherNotes');
	const ext = result.extracted ?? {};
	return keys.map((k) => {
		const val = ext[k]?.mainValue ?? null;
		return `${k}:${val === null ? '__null__' : String(val).trim().toLowerCase()}`;
	}).join('|');
}

const deduplicateResults = (results) => {
	const seen = new Set();
	return results.filter((r) => {
		const fp = extractionFingerprint(r);
		if (seen.has(fp)) return false;
		seen.add(fp);
		return true;
	});
}

// ==========================
// Claude API calls
// ==========================

// file — single { buffer, mimetype }
const callClaude = async (systemPrompt, file, userText) => {
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
						{ 
							type: 'text', 
							text: userText + '\n\nCRITICAL: Respond STRICTLY with raw JSON. Start your response immediately with { or [. DO NOT wrap in ```json markdown. NO explanations, NO preamble, NO conversational text.' 
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
		const objMatch = textBlock.text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
		
		if (!objMatch) {
			throw new Error('No JSON structure found in response.');
		}
		
		parsed = JSON.parse(objMatch[1]);
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

// files — array of { _buf, mimetype }; each file is sent as a separate request and results are collected
const analyzeImageWithClaude = async (files, imageType) => {
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

// ==========================
// Image classification
// ==========================

const CLASSIFY_SYSTEM_PROMPT =
	'You are an image classifier for a Hazmat Load Audit System. ' +
	'Your ONLY job is to look at the provided image and return exactly ONE of these four category labels:\n\n' +
	'  "bolPhoto"     — A Bill of Lading (BOL) or shipping paper document. ' +
	'Recognisable by printed tables, text fields, shipper/consignee information, signatures, and form-like layout.\n' +
	'  "markerPhoto"  — The rear or side exterior of a truck trailer showing hazmat placards / diamond-shaped warning signs ' +
	'mounted on the doors or sides. May also show the trailer number and carrier name on the outside.\n' +
	'  "cargoPhoto"   — The interior of a trailer or truck showing the loaded cargo (boxes, drums, pallets, straps, etc.).\n' +
	'  "sealPhoto"    — A close-up photo of a plastic or metal security seal on a trailer door, typically showing a printed or engraved number.\n\n' +
	'Rules:\n' +
	'- Respond ONLY with a JSON object: { "imageType": "<label>" }\n' +
	'- Do NOT include any explanation, markdown, or extra fields.\n' +
	'- If truly ambiguous, pick the closest match — never return null or an unknown label.';

/**
 * Asks Claude to classify a single image as bolPhoto / markerPhoto / cargoPhoto.
 * Returns the imageType string.
 */
const classifyImage = async (file) => {
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

	const VALID_TYPES = ['bolPhoto', 'markerPhoto', 'cargoPhoto', 'sealPhoto'];
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
export const classifyAndAnalyzeAll = async (files) => {
	const classifiedFiles = await Promise.all(
		files.map(async (f) => {
			const imageType = await classifyImage({ url: f.url, mimetype: f.mimetype });
			return { file: f, imageType };
		}),
	);
 
	const groups = { bolPhoto: [], markerPhoto: [], cargoPhoto: [], sealPhoto: [] };
	for (const { file, imageType } of classifiedFiles) {
		groups[imageType].push(file);
	}
 
	const [helperResult, bolResults, markerResults, cargoResults, sealResults] = await Promise.all([
		groups.bolPhoto.length ? bolHelper(groups.bolPhoto) : Promise.resolve({ isHazmat: true, weights: [] }),
		groups.bolPhoto.length    ? analyzeImageWithClaude(groups.bolPhoto,    'bolPhoto')    : Promise.resolve([]),
		groups.markerPhoto.length ? analyzeImageWithClaude(groups.markerPhoto, 'markerPhoto') : Promise.resolve([]),
		groups.cargoPhoto.length  ? analyzeImageWithClaude(groups.cargoPhoto,  'cargoPhoto')  : Promise.resolve([]),
		groups.sealPhoto.length   ? analyzeImageWithClaude(groups.sealPhoto,   'sealPhoto')   : Promise.resolve([]),
	]);
 
	// Return classifiedFiles so createAudit can tag each image URL with its slot type
	return { bolResults, markerResults, cargoResults, sealResults, classifiedFiles, isGlobalHazmat: helperResult.isHazmat, bolWeights: helperResult.weights };
}

export const IMAGE_TYPE_TO_SLOT = {
	bolPhoto:    'bol',
	markerPhoto: 'placard',
	cargoPhoto:  'cargo',
	sealPhoto:   'seal',
};