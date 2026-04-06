import { signIn, createInvitation, getInviteInfo, getCompanyUsers, signUpByInvite, signUpAdmin } from './handlers.js';
import { signInSchema, createInvitationSchema, getInviteInfoSchema, getCompanyUsersSchema, signUpByInviteSchema, signUpAdminSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/sign-up-invite', {
		handler: signUpByInvite,
		schema:  signUpByInviteSchema,
	});

	fastify.post('/sign-up-company', {
		handler: signUpAdmin,
		schema:  signUpAdminSchema,
	});

	fastify.post('/sign-in', {
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