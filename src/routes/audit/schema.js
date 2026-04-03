export const getAuditsSchema = {
	tags: ['Audit'],
	summary: 'Get all audits',
	description: 'Returns paginated list of audits ordered by creation date descending',
	querystring: {
		type: 'object',
		properties: {
			page:  { type: 'integer', minimum: 1, default: 1 },
			limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
			auditorId: { type: 'string' },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				data: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id:          { type: 'string', format: 'uuid' },
							is_passed:   { type: 'string' },
							score:       { type: 'string' },
							created_at:  { type: 'string' },
							response:    { type: 'object', additionalProperties: true },
							auditImages: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										url:  { type: 'string' },
										type: { type: 'string' },
									},
								},
							},
						},
					},
				},
				pagination: {
					type: 'object',
					properties: {
						total:       { type: 'integer' },
						page:        { type: 'integer' },
						limit:       { type: 'integer' },
						totalPages:  { type: 'integer' },
						hasNextPage: { type: 'boolean' },
						hasPrevPage: { type: 'boolean' },
					},
				},
			},
		},
	},
};

// ─── POST /audit/upload ────────────────────────────────────────────────────────

const imageFileSchema = {
	type: 'object',
	required: ['filename', 'mimetype'],
	properties: {
		filename: { type: 'string' },
		mimetype: { type: 'string' },
		_buf:     { type: 'object' },
	},
};

/**
 * Step 1 — upload raw images to Supabase Storage.
 * Returns [{ id, url }] for each uploaded file.
 */
export const uploadAuditImagesSchema = {
	tags: ['Audit'],
	summary: 'Upload audit images',
	description: 'Uploads shipment images to Supabase Storage and returns their storage IDs and public URLs. Call this before POST /audit.',
	consumes: ['multipart/form-data'],
	body: {
		type: 'object',
		required: ['images'],
		properties: {
			images: {
				anyOf: [
					imageFileSchema,
					{
						type: 'array',
						minItems: 1,
						maxItems: 15,
						items: imageFileSchema,
					},
				],
			},
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				images: {
					type: 'array',
					items: {
						type: 'object',
						required: ['id', 'url'],
						properties: {
							id:  { type: 'string', description: 'Supabase storage key — pass back as imageIds[]' },
							url: { type: 'string', description: 'Public URL of the uploaded image' },
						},
					},
				},
			},
		},
	},
};

// ─── POST /audit ───────────────────────────────────────────────────────────────

/**
 * Step 2 — create an audit from previously uploaded image IDs.
 * Claude fetches images by URL (no base64 transfer).
 */
export const createAuditSchema = {
	tags: ['Audit'],
	summary: 'Create new audit',
	description:
		'Runs a full hazmat compliance audit. Pass the storage IDs returned by POST /audit/upload. ' +
		'Claude fetches each image by URL, auto-classifies it (BOL / placard / cargo), and returns structured results.',
	body: {
		type: 'object',
		required: ['imageIds'],
		properties: {
			imageIds: {
				type: 'array',
				minItems: 1,
				maxItems: 15,
				items: { type: 'string' },
				description: 'Supabase storage keys returned by POST /audit/upload',
			},
			auditorId: {
				type: 'string',
				description: 'Auditor ID',
			},
		},
	},
};