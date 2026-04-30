export const getCompanySchema = {
	tags: ['Companies'],
	summary: 'Get company details',
	params: {
		type: 'object',
		required: ['companyId'],
		properties: { companyId: { type: 'string', format: 'uuid' } },
	},
};

export const updateCompanySchema = {
	tags: ['Companies'],
	summary: 'Update company details',
	params: {
		type: 'object',
		required: ['companyId'],
		properties: { companyId: { type: 'string', format: 'uuid' } },
	},
	body: {
		type: 'object',
		properties: {
			name: { type: 'string', minLength: 1 },
			dotNumber: { type: 'string', minLength: 1 },
			mcNumber: { type: 'string', nullable: true },
		},
	},
};

export const getCompanyHazmatSchema = {
	tags: ['FMCSA'],
	summary: 'Check if company is authorized for Hazmat',
	params: {
		type: 'object',
		required: ['dotNumber'],
		properties: { dotNumber: { type: 'string' } },
	},
};

export const getCompanyInspectionsSchema = {
	tags: ['FMCSA'],
	summary: 'Get FMCSA inspections by DOT number',
	params: {
		type: 'object',
		required: ['dotNumber'],
		properties: { dotNumber: { type: 'string' } },
	},
};

export const getInspectionViolationsSchema = {
	tags: ['FMCSA'],
	summary: 'Get violations for a specific inspection',
	params: {
		type: 'object',
		required: ['id'],
		properties: { id: { type: 'string' } },
	},
};