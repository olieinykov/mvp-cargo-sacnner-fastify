import { signIn, createInvitation, getInviteInfo, getCompanyUsers, signUpByInvite, signUpAdmin, getMe, requestPasswordReset, updatePassword, getPendingInvitations, cancelInvitation, resendInvitation, updateUserRole } from './handlers.js';
import { signInSchema, createInvitationSchema, getInviteInfoSchema, getCompanyUsersSchema, signUpByInviteSchema, signUpAdminSchema, getMeSchema, requestPasswordResetSchema, updatePasswordSchema, getPendingInvitationsSchema, cancelInvitationSchema, resendInvitationSchema, updateUserRoleSchema } from './schema.js';

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

	fastify.get('/me', {
		handler: getMe,
		schema:  getMeSchema,
	});

	fastify.post('/request-password-reset', {
		handler: requestPasswordReset,
		schema:  requestPasswordResetSchema,
	});

	fastify.post('/update-password', {
		handler: updatePassword,
		schema:  updatePasswordSchema,
	});

	fastify.get('/invitations', {
		handler: getPendingInvitations,
		schema:  getPendingInvitationsSchema,
	});

	fastify.post('/invitation/:id/cancel', {
		handler: cancelInvitation,
		schema:  cancelInvitationSchema,
	});

	fastify.post('/invitation/:id/resend', {
		handler: resendInvitation,
		schema:  resendInvitationSchema,
	});

	fastify.patch('/users/:userId/role', {
		handler: updateUserRole,
		schema:  updateUserRoleSchema,
	});
};

export default routes;