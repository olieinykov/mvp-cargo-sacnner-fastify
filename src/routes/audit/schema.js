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

export const createAuditSchema = {
	tags: ['Audit'],
	summary: 'Create new audit',
	description: 'Create new audit',
	consumes: ['multipart/form-data'],
	body: {
		type: 'object',
		required: ['bol', 'placard', 'intrier'/*, 'exterier'*/],
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
			//exterier: {
			//	anyOf: [
			//		{
			//			type: 'object',
			//			required: ['filename', 'mimetype'],
			//			properties: {
			//				filename: { type: 'string' },
			//				mimetype: { type: 'string' },
			//				_buf: { type: 'object' },
			//			},
			//		},
			//		{
			//			type: 'array',
			//			maxItems: 3,
			//			items: {
			//				type: 'object',
			//				required: ['filename', 'mimetype'],
			//				properties: {
			//					filename: { type: 'string' },
			//					mimetype: { type: 'string' },
			//					_buf: { type: 'object' },
			//				},
			//			},
			//		},
			//	],
			//},
		},
	},
};
