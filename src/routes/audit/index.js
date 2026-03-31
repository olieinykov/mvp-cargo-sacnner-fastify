import { createAudit, getAudits, uploadAuditImages } from './handlers.js';
import { createAuditSchema, getAuditsSchema, uploadAuditImagesSchema } from './schema.js';
import multipart from '@fastify/multipart';

const routes = async (fastify) => {
	fastify.register(multipart, {
		attachFieldsToBody: true,
		limits: {
			fileSize: 100 * 1024 * 1024,
		},
	});

	fastify.post('/', {
		handler: createAudit,
		schema: createAuditSchema,
	});

	fastify.post('/upload', {
		handler: uploadAuditImages,
		schema: uploadAuditImagesSchema,
	});

	fastify.get('/', {
		handler: getAudits,
		schema: getAuditsSchema,
	});
};

export default routes;
