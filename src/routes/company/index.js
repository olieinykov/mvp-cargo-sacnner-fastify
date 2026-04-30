import { getCompany, updateCompany, getCompanyHazmat, getCompanyInspections, getInspectionViolations } from './handlers.js';
import { getCompanySchema, updateCompanySchema, getCompanyHazmatSchema, getCompanyInspectionsSchema, getInspectionViolationsSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.get('/:companyId', {
		handler: getCompany,
		schema:  getCompanySchema,
	});

	fastify.patch('/:companyId', {
		handler: updateCompany,
		schema:  updateCompanySchema,
	});

	fastify.get('/:dotNumber/fmcsa/hazmat', {
		handler: getCompanyHazmat,
		schema:  getCompanyHazmatSchema,
	});

	fastify.get('/:dotNumber/fmcsa/inspections', {
		handler: getCompanyInspections,
		schema:  getCompanyInspectionsSchema,
	});

	fastify.get('/inspections/:id/violations', {
		handler: getInspectionViolations,
		schema:  getInspectionViolationsSchema,
	});
};

export default routes;