import { signUp, signIn, createInvitation, getInviteInfo, getCompanyUsers } from './handlers.js';
import { signUpSchema, signInSchema, createInvitationSchema, getInviteInfoSchema, getCompanyUsersSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/signUp', {
		handler: signUp,
		schema:  signUpSchema,
	});

	fastify.post('/signIn', {
		handler: signIn,
		schema:  signInSchema,
	});

	fastify.post('/invitation', {
		handler: createInvitation,
		schema:  createInvitationSchema,
	});

	fastify.get('/invite/:token', {
		handler: getInviteInfo,
		schema:  getInviteInfoSchema,
	});

	fastify.get('/users', {
		handler: getCompanyUsers,
		schema:  getCompanyUsersSchema,
	});
};

export default routes;