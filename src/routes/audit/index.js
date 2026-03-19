import { createAudit } from './handlers.js';
import { createAuditSchema } from './schema.js';
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
};

export default routes;
