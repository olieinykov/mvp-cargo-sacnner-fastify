export const getAuditsSchema = {
	tags: ['Audit'],
	summary: 'Get all audits',
	description: 'Returns paginated list of audits ordered by creation date descending',
	querystring: {
		type: 'object',
		properties: {
			page:  { type: 'integer', minimum: 1, default: 1 },
			limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
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
							id:         { type: 'string', format: 'uuid' },
							is_passed:  { type: 'string' },
							score:      { type: 'string' },
							created_at: { type: 'string' },
							response:   { type: 'object', additionalProperties: true },
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

const imageFileSchema = {
	type: 'object',
	required: ['filename', 'mimetype'],
	properties: {
		filename: { type: 'string' },
		mimetype: { type: 'string' },
		_buf:     { type: 'object' },
	},
};

export const createAuditSchema = {
	tags: ['Audit'],
	summary: 'Create new audit',
	description: 'Create new audit — all images are passed in a single "images" field; Claude auto-classifies each one.',
	consumes: ['multipart/form-data'],
	body: {
		type: 'object',
		required: ['images'],
		properties: {
			// A single field accepting one image (object) or multiple images (array).
			// Claude will classify each image as bolPhoto / markerPhoto / cargoPhoto.
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
};