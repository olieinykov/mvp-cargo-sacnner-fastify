export const getAuditsSchema = {
	tags: ['Audit'],
	summary: 'Get all audits',
	description: 'Returns list of all audits ordered by creation date descending',
	response: {
		200: {
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
	},
};

export const createAuditSchema = {
	tags: ['Audit'],
	summary: 'Create new audit',
	description: 'Create new audit',
	consumes: ['multipart/form-data'],
	body: {
		type: 'object',
		required: ['bol', 'placard', 'intrier', 'exterier'],
		properties: {
			bol: {
				// With multipart uploads the same field may be provided once (object)
				// or multiple times (array). We support both shapes.
				anyOf: [
					{
						type: 'object',
						required: ['filename', 'mimetype'],
						properties: {
							filename: { type: 'string' },
							mimetype: { type: 'string' },
							_buf: { type: 'object' },
						},
					},
					{
						type: 'array',
						maxItems: 3,
						items: {
							type: 'object',
							required: ['filename', 'mimetype'],
							properties: {
								filename: { type: 'string' },
								mimetype: { type: 'string' },
								_buf: { type: 'object' },
							},
						},
					},
				],
			},
			placard: {
				anyOf: [
					{
						type: 'object',
						required: ['filename', 'mimetype'],
						properties: {
							filename: { type: 'string' },
							mimetype: { type: 'string' },
							_buf: { type: 'object' },
						},
					},
					{
						type: 'array',
						maxItems: 3,
						items: {
							type: 'object',
							required: ['filename', 'mimetype'],
							properties: {
								filename: { type: 'string' },
								mimetype: { type: 'string' },
								_buf: { type: 'object' },
							},
						},
					},
				],
			},
			intrier: {
				anyOf: [
					{
						type: 'object',
						required: ['filename', 'mimetype'],
						properties: {
							filename: { type: 'string' },
							mimetype: { type: 'string' },
							_buf: { type: 'object' },
						},
					},
					{
						type: 'array',
						maxItems: 3,
						items: {
							type: 'object',
							required: ['filename', 'mimetype'],
							properties: {
								filename: { type: 'string' },
								mimetype: { type: 'string' },
								_buf: { type: 'object' },
							},
						},
					},
				],
			},
			exterier: {
				anyOf: [
					{
						type: 'object',
						required: ['filename', 'mimetype'],
						properties: {
							filename: { type: 'string' },
							mimetype: { type: 'string' },
							_buf: { type: 'object' },
						},
					},
					{
						type: 'array',
						maxItems: 3,
						items: {
							type: 'object',
							required: ['filename', 'mimetype'],
							properties: {
								filename: { type: 'string' },
								mimetype: { type: 'string' },
								_buf: { type: 'object' },
							},
						},
					},
				],
			},
		},
	},
};
