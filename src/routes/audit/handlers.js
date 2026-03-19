import { requireAnthropic } from '../../lib/cloudeClient.js';

const normalizeFiles = (value) => {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
};

const safeJsonParse = (text) => {
	if (typeof text !== 'string') {
		throw new Error('Model returned empty response');
	}

	const cleaned = text
		.replace(/```json/gi, '```')
		.replace(/```/g, '')
		.trim();

	const startIndex = cleaned.indexOf('{');
	const endIndex = cleaned.lastIndexOf('}');

	if (startIndex === -1 || endIndex === -1) {
		throw new Error('Failed to locate JSON in model response');
	}

	return JSON.parse(cleaned.slice(startIndex, endIndex + 1));
};

const getImageBase64 = (file) => {
	const buf = file?._buf;
	if (!buf) return null;

	if (Buffer.isBuffer(buf)) {
		return buf.toString('base64');
	}

	// multipart buffers are usually Buffer, but handle Uint8Array defensively
	return Buffer.from(buf).toString('base64');
};

const buildImageContent = (file) => {
	const base64 = getImageBase64(file);
	if (!base64) return null;

	const mimetype =
		typeof file?.mimetype === 'string' && file.mimetype.startsWith('image/')
			? file.mimetype
			: 'image/jpeg';

	return {
		type: 'image',
		source: {
			type: 'base64',
			media_type: mimetype,
			data: base64,
		},
	};
};

const MODEL_NAME = process.env.CLAUDE_VISION_MODEL || 'claude-sonnet-4-20250514';

const extractFromSlot = async ({ slotName, files }) => {
	const anthropic = requireAnthropic();
	const imageFiles = files
		.map((file) => buildImageContent(file))
		.filter(Boolean);

	if (imageFiles.length === 0) {
		return { slotName, extracted: null, confidence: null, notes: ['No image data'] };
	}

	const extractionPromptBySlot = {
		bol: `
You are analyzing Bills of Lading (BOL) images for hazmat compliance.
Extract the following fields from the document (if present):
- unNumber: string|null (e.g., "UN1993")
- properShippingName: string|null
- hazardClass: string|null (e.g., "3", "6.1", "8")
- packingGroup: string|null (e.g., "II", "III", or null)
- emergencyPhone: string|null
- shipperCertificationPresent: boolean
- shipperCertificationText: string|null
- shipperName: string|null
- otherHazmatNotes: string|null

Return ONLY valid JSON with this exact shape:
{
  "slotName": "bol",
  "extracted": {
    "unNumber": null,
    "properShippingName": null,
    "hazardClass": null,
    "packingGroup": null,
    "emergencyPhone": null,
    "shipperCertificationPresent": false,
    "shipperCertificationText": null,
    "shipperName": null,
    "otherHazmatNotes": null
  },
  "confidence": { "overall": 0.0, "fields": {} },
  "notes": []
}
`.trim(),
		placard: `
You are analyzing hazmat placard images.
Extract the following fields (if present):
- unNumber: string|null
- hazardClass: string|null
- condition: "clear"|"blurry"|"damaged"|"unknown"
- placement: "proper"|"partial"|"obstructed"|"unknown"
- otherNotes: string|null

Return ONLY valid JSON with this exact shape:
{
  "slotName": "placard",
  "extracted": {
    "unNumber": null,
    "hazardClass": null,
    "condition": "unknown",
    "placement": "unknown",
    "otherNotes": null
  },
  "confidence": { "overall": 0.0, "fields": {} },
  "notes": []
}
`.trim(),
		intrier: `
You are analyzing interior load/cargo photos for securement evidence.
Extract:
- securementAssessment: "satisfactory"|"issues"|"unknown"
- securementPresent: boolean
- issues: array of strings
- otherNotes: string|null

Return ONLY valid JSON with this exact shape:
{
  "slotName": "intrier",
  "extracted": {
    "securementAssessment": "unknown",
    "securementPresent": false,
    "issues": [],
    "otherNotes": null
  },
  "confidence": { "overall": 0.0, "fields": {} },
  "notes": []
}
`.trim(),
		exterier: `
You are analyzing trailer exterior photos for hazmat placarding/condition evidence.
Extract:
- placardingPresent: boolean
- placardingCondition: "clear"|"blurry"|"damaged"|"unknown"
- damagesOrLeaksObserved: boolean
- otherNotes: string|null

Return ONLY valid JSON with this exact shape:
{
  "slotName": "exterier",
  "extracted": {
    "placardingPresent": false,
    "placardingCondition": "unknown",
    "damagesOrLeaksObserved": false,
    "otherNotes": null
  },
  "confidence": { "overall": 0.0, "fields": {} },
  "notes": []
}
`.trim(),
	};

	const content = [
		{ type: 'text', text: extractionPromptBySlot[slotName] || '' },
		...imageFiles,
	];

	const response = await anthropic.messages.create({
		model: MODEL_NAME,
		max_tokens: 1200,
		temperature: 0,
		messages: [
			{
				role: 'user',
				content,
			},
		],
	});

	const text = response?.content?.find((p) => p.type === 'text')?.text;
	const parsed = safeJsonParse(text);
	return parsed;
};

const buildFinalAuditReport = async ({ bol, placard, intrier, exterier }) => {
	const anthropic = requireAnthropic();
	const reportPrompt = `
You are an AI hazmat load auditor.
Using the extracted evidence below (from BOL/placard/interior/exterior images),
produce a pass/fail audit report for DOT/FMCSA hazmat transportation compliance.

Rules you MUST apply deterministically based on provided extracted values:
1) If bol is null OR any required BOL fields are null/empty (unNumber, properShippingName, hazardClass, packingGroup, emergencyPhone)
   OR shipperCertificationPresent is not true,
   then create a violation with severity "high" and include a corrective suggestion.
2) If bol.unNumber and placard.unNumber are both present and they differ, add a violation severity "high".
3) If bol.hazardClass and placard.hazardClass are both present and they differ, add a violation severity "high".
4) If exterier is null OR exterier.damagesOrLeaksObserved is true, add a violation severity "high".
5) If intrier is null OR intrier.securementPresent=false OR intrier.securementAssessment is "issues",
   add a violation severity "medium".

Then set pass = (violations.length === 0).

Include CFR references as best-effort strings (e.g., "49 CFR 172.200", "49 CFR 172.502")
and for each violation include:
- id (string)
- title (string)
- severity ("low"|"medium"|"high")
- cfrRefs (array of strings)
- rationale (string)
- correctiveSuggestions (array of strings)

Return ONLY valid JSON with this exact shape:
{
  "pass": false,
  "overallSeverity": "low",
  "summary": {
    "unNumber": { "bol": null, "placard": null },
    "hazardClass": { "bol": null, "placard": null },
    "packingGroup": { "bol": null }
  },
  "violations": [],
  "correctiveSuggestions": [],
  "evidenceUsed": ["bol","placard","intrier","exterier"],
  "auditNotes": []
}
`.trim();

	const response = await anthropic.messages.create({
		model: MODEL_NAME,
		max_tokens: 1600,
		temperature: 0,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: reportPrompt },
					{
						type: 'text',
						text: JSON.stringify(
							{ bol, placard, intrier, exterier },
							null,
							2,
						),
					},
				],
			},
		],
	});

	const text = response?.content?.find((p) => p.type === 'text')?.text;
	return safeJsonParse(text);
};

export const createAudit = async (request, reply) => {
	try {
		const bolFiles = normalizeFiles(request.body.bol);
		const placardFiles = normalizeFiles(request.body.placard);
		const intrierFiles = normalizeFiles(request.body.intrier);
		const exterierFiles = normalizeFiles(request.body.exterier);

		const slots = [
			{ name: 'bol', files: bolFiles },
			{ name: 'placard', files: placardFiles },
			{ name: 'intrier', files: intrierFiles },
			{ name: 'exterier', files: exterierFiles },
		];

		for (const slot of slots) {
			if (slot.files.length > 3) {
				reply.code(400).send({
					success: false,
					error: `${slot.name} allows up to 3 photos`,
				});
				return;
			}
		}

		// 1) Extract data from images using Claude Vision
		const [bol, placard, intrier, exterier] = await Promise.all([
			extractFromSlot({ slotName: 'bol', files: bolFiles }),
			extractFromSlot({ slotName: 'placard', files: placardFiles }),
			extractFromSlot({ slotName: 'intrier', files: intrierFiles }),
			extractFromSlot({ slotName: 'exterier', files: exterierFiles }),
		]);

		// 2) Build the final audit report (pass/fail + violations)
		const report = await buildFinalAuditReport({
			bol: bol?.extracted || null,
			placard: placard?.extracted || null,
			intrier: intrier?.extracted || null,
			exterier: exterier?.extracted || null,
		});

		reply.send({
			success: true,
			data: report,
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};
