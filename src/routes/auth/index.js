import { signIn, createInvitation, getInviteInfo, getCompanyUsers, signUpByInvite, signUpAdmin, handleConfirmationWebhook } from './handlers.js';
import { signInSchema, createInvitationSchema, getInviteInfoSchema, getCompanyUsersSchema, signUpByInviteSchema, signUpAdminSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/signUp-invite', {
		handler: signUpByInvite,
		schema:  signUpByInviteSchema,
	});

	fastify.post('/signUp-admin', {
		handler: signUpAdmin,
		schema:  signUpAdminSchema,
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

	fastify.post('/webhook/confirm', {
		handler: handleConfirmationWebhook,
		schema:  getCompanyUsersSchema,
	});
};

export default routes;