import Fastify from 'fastify';
import auditRoutes from './routes/audit/index.js';
import authRoutes from './routes/auth/index.js';
import companyRoutes from './routes/company/index.js';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { config } from './config/index.js';
import corsPlugin from './plugins/cors.js';

const fastify = Fastify({
	logger: true,
});


console.log("config", config)
await fastify.register(corsPlugin);
await fastify.register(swagger, {
	openapi: {
		info: { title: 'Hazmat Audit API', version: '0.0.1' },
	},
});

await fastify.register(swaggerUi, { routePrefix: '/docs' });

fastify.register(auditRoutes, { prefix: 'api/v1/audit' });
fastify.register(authRoutes, { prefix: 'api/v1/auth' });
fastify.register(companyRoutes, { prefix: 'api/v1/companies' });

try {
	await fastify.listen({
		port: config.port,
		host: config.host,
	});
} catch (err) {
	fastify.log.error(err);
	process.exit(1);
}
