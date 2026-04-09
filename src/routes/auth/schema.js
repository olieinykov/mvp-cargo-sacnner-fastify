// ─── POST /auth/signUpByInvite ────────────────────────────────────────────────────────

export const signUpByInviteSchema = {
	tags: ['Auth'],
	summary: 'Register a new user by invite',
	description:
		'**Invited user:** provide `inviteToken`. The user is linked to the inviting company automatically.\n\n',
	body: {
		type: 'object',
		required: ['email', 'password', 'firstName', 'lastName'],
		properties: {
			email:       { type: 'string', format: 'email' },
			password:    { type: 'string', minLength: 8 },
			firstName:   { type: 'string', minLength: 1 },
			lastName:    { type: 'string', minLength: 1 },
			inviteToken: {
				type: 'string',
				description: 'Path A only. Token received in the invitation email.',
			},
		},
	},
	response: {
		201: {
			type: 'object',
			properties: {
				user: {
					type: 'object',
					properties: {
						id:        { type: 'string', format: 'uuid' },
						email:     { type: 'string', format: 'email' },
						firstName: { type: 'string' },
						lastName:  { type: 'string' },
						role:      { type: 'string' },
						companyId: { type: 'string', format: 'uuid', nullable: true },
					},
				},
			},
		},
	},
};

// ─── POST /auth/signUpAdmin ────────────────────────────────────────────────────────

export const signUpAdminSchema = {
	tags: ['Auth'],
	summary: 'Register a new user and company',
	description:
		'**Admin + new company:** omit `inviteToken` and include a `company` object with `name` and `dotNumber`. ' +
		'The company is created, the user is set as its admin, and `company.ownerId` is back-filled in one transaction.',
	body: {
		type: 'object',
		required: ['email', 'password', 'firstName', 'lastName'],
		properties: {
			email:       { type: 'string', format: 'email' },
			password:    { type: 'string', minLength: 8 },
			firstName:   { type: 'string', minLength: 1 },
			lastName:    { type: 'string', minLength: 1 },
			company: {
				type: 'object',
				description: 'Path B only. Required when registering without an invite token.',
				required: ['name', 'dotNumber'],
				properties: {
					name:      { type: 'string', minLength: 1 },
					dotNumber: { type: 'string', minLength: 1 },
					mcNumber:  { type: 'string', description: 'Optional MC number.' },
				},
			},
		},
	},
	response: {
		201: {
			type: 'object',
			properties: {
				user: {
					type: 'object',
					properties: {
						id:        { type: 'string', format: 'uuid' },
						email:     { type: 'string', format: 'email' },
						firstName: { type: 'string' },
						lastName:  { type: 'string' },
						role:      { type: 'string' },
						companyId: { type: 'string', format: 'uuid', nullable: true },
					},
				},
				company: {
					type: 'object',
					nullable: true,
					properties: {
						id:        { type: 'string', format: 'uuid' },
						name:      { type: 'string' },
						dotNumber: { type: 'string' },
						mcNumber:  { type: 'string', nullable: true },
						ownerId:   { type: 'string', format: 'uuid' },
						status:    { type: 'string' },
					},
				},
			},
		},
	},
};

// ─── POST /auth/signIn ────────────────────────────────────────────────────────

export const signInSchema = {
	tags: ['Auth'],
	summary: 'Login',
	description: 'Authenticates with Supabase and returns access + refresh tokens together with the user profile.',
	body: {
		type: 'object',
		required: ['email', 'password'],
		properties: {
			email:    { type: 'string', format: 'email' },
			password: { type: 'string' },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				accessToken:  { type: 'string', description: 'JWT — include as Authorization: Bearer <token>' },
				refreshToken: { type: 'string' },
				expiresIn:    { type: 'integer', description: 'Seconds until the access token expires' },
				user: {
					type: 'object',
					properties: {
						id:        { type: 'string', format: 'uuid' },
						email:     { type: 'string', format: 'email' },
						firstName: { type: 'string' },
						lastName:  { type: 'string' },
						role:      { type: 'string' },
						companyId: { type: 'string', format: 'uuid', nullable: true },
					},
				},
			},
		},
	},
};

// ─── POST /auth/invitation ────────────────────────────────────────────────────

export const createInvitationSchema = {
	tags: ['Auth'],
	summary: 'Invite a user to your company',
	description:
		'Admin-only. Creates an invitation record and sends an email with a registration link. ' +
		'Requires `Authorization: Bearer <access_token>`.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: {
			authorization: { type: 'string', description: 'Bearer <access_token>' },
		},
	},
	body: {
		type: 'object',
		required: ['email'],
		properties: {
			email: { type: 'string', format: 'email' },
			role: {
				type: 'string',
				enum: ['user', 'admin'],
				default: 'user',
				description: 'Role to assign when the invitee registers.',
			},
		},
	},
	response: {
		201: {
			type: 'object',
			properties: {
				invitation: {
					type: 'object',
					properties: {
						id:         { type: 'string', format: 'uuid' },
						email:      { type: 'string', format: 'email' },
						role:       { type: 'string' },
						expiresAt:  { type: 'string', format: 'date-time' },
						inviteLink: { type: 'string', description: 'Full registration URL with token (for testing)' },
					},
				},
			},
		},
	},
};

// ─── GET /auth/invite/:token ──────────────────────────────────────────────────

export const getInviteInfoSchema = {
	tags: ['Auth'],
	summary: 'Resolve invite info',
	description: 'Returns invitation details (email, role, expiration date, and company info) based on the provided token.',
	params: {
		type: 'object',
		required: ['token'],
		properties: {
			token: { 
				type: 'string', 
				description: 'Unique invitation token.' 
			},
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				email:     { type: 'string', format: 'email' },
				role:      { type: 'string' },
				expiresAt: { type: 'string', format: 'date-time' },
				company: {
					type: 'object',
					properties: {
						id:   { type: 'string', format: 'uuid' },
						name: { type: 'string' },
					},
				},
			},
		},
		400: {
			type: 'object',
			description: 'Invitation is already used, revoked, or expired.',
			properties: {
				error: { type: 'string' },
			},
		},
		404: {
			type: 'object',
			description: 'Invitation not found.',
			properties: {
				error: { type: 'string' },
			},
		},
	},
};

// ─── GET /auth/users ──────────────────────────────────────────────────────────

export const getCompanyUsersSchema = {
	tags: ['Auth'],
	summary: 'List company members',
	description: 'Admin-only endpoint that returns a list of all users belonging to the requester\'s company. Requires `Authorization: Bearer <access_token>`.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: {
			authorization: { type: 'string', description: 'Bearer <access_token>' },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				users: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id:        { type: 'string', format: 'uuid' },
							email:     { type: 'string', format: 'email' },
							firstName: { type: 'string' },
							lastName:  { type: 'string' },
							role:      { type: 'string' },
							companyId: { type: 'string', format: 'uuid', nullable: true },
							registrationData: { type: 'string' },
						},
					},
				},
			},
		},
		401: {
			type: 'object',
			description: 'Missing or invalid Authorization header.',
			properties: {
				error: { type: 'string' },
			},
		},
		403: {
			type: 'object',
			description: 'User is not an admin, has no company, or profile is not found.',
			properties: {
				error: { type: 'string' },
			},
		},
	},
};

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

export const getMeSchema = {
	tags: ['Auth'],
	summary: 'Get current user profile',
	description: 'Returns the profile of the currently authenticated user along with their company details. Requires `Authorization: Bearer <access_token>`.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: {
			authorization: { type: 'string', description: 'Bearer <access_token>' },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				id:               { type: 'string', format: 'uuid' },
				email:            { type: 'string', format: 'email' },
				firstName:        { type: 'string' },
				lastName:         { type: 'string' },
				role:             { type: 'string' },
				companyId:        { type: 'string', format: 'uuid', nullable: true },
				registrationData: { type: 'string', format: 'date-time' },
				isEmailConfirmed: { type: 'boolean' },
				companyName:      { type: 'string' },
			},
		},
		401: {
			type: 'object',
			description: 'Missing or invalid Authorization header.',
			properties: { error: { type: 'string' } },
		},
		404: {
			type: 'object',
			description: 'User profile not found.',
			properties: { error: { type: 'string' } },
		},
	},
};

// ─── POST /auth/request-password-reset ────────────────────────────────────────

export const requestPasswordResetSchema = {
	tags: ['Auth'],
	summary: 'Request password reset',
	description: 'Sends a password reset link to the specified email address.',
	body: {
		type: 'object',
		required: ['email'],
		properties: {
			email: { type: 'string', format: 'email' },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
		},
	},
};

// ─── POST /auth/update-password ───────────────────────────────────────────────

export const updatePasswordSchema = {
	tags: ['Auth'],
	summary: 'Update password',
	description: 'Updates the user password. Requires `Authorization: Bearer <recovery_token>` obtained from the email link.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: {
			authorization: { type: 'string', description: 'Bearer <recovery_token>' },
		},
	},
	body: {
		type: 'object',
		required: ['password'],
		properties: {
			password: { type: 'string', minLength: 8 },
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				message: { type: 'string' },
			},
		},
	},
};

// ─── GET /auth/invitations ────────────────────────────────────────────────────

export const getPendingInvitationsSchema = {
	tags: ['Auth', 'Admin'],
	summary: 'Get pending invitations',
	description: 'Admin-only. Returns a list of all pending invitations for the company.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: { authorization: { type: 'string', description: 'Bearer <access_token>' } },
	},
	response: {
		200: {
			type: 'object',
			properties: {
				invitations: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							id: { type: 'string', format: 'uuid' },
							email: { type: 'string', format: 'email' },
							role: { type: 'string' },
							expiresAt: { type: 'string', format: 'date-time' },
							token: { type: 'string' }
						},
					},
				},
			},
		},
	},
};

// ─── POST /auth/invitation/:id/cancel ─────────────────────────────────────────

export const cancelInvitationSchema = {
	tags: ['Auth', 'Admin'],
	summary: 'Cancel an invitation',
	description: 'Admin-only. Revokes a pending invitation.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: { authorization: { type: 'string' } },
	},
	params: {
		type: 'object',
		required: ['id'],
		properties: { id: { type: 'string', format: 'uuid' } },
	},
	response: {
		200: {
			type: 'object',
			properties: { message: { type: 'string' } },
		},
	},
};

// ─── POST /auth/invitation/:id/resend ─────────────────────────────────────────

export const resendInvitationSchema = {
	tags: ['Auth', 'Admin'],
	summary: 'Resend an invitation',
	description: 'Admin-only. Extends expiration date and resends the invitation email.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: { authorization: { type: 'string' } },
	},
	params: {
		type: 'object',
		required: ['id'],
		properties: { id: { type: 'string', format: 'uuid' } },
	},
	response: {
		200: {
			type: 'object',
			properties: { 
				message: { type: 'string' },
				expiresAt: { type: 'string', format: 'date-time' }
			},
		},
	},
};

// ─── PATCH /auth/users/:userId/role ───────────────────────────────────────────

export const updateUserRoleSchema = {
	tags: ['Auth', 'Admin'],
	summary: 'Change user role',
	description: 'Admin-only. Updates the role of a user within the same company.',
	headers: {
		type: 'object',
		required: ['authorization'],
		properties: { authorization: { type: 'string' } },
	},
	params: {
		type: 'object',
		required: ['userId'],
		properties: { userId: { type: 'string', format: 'uuid' } },
	},
	body: {
		type: 'object',
		required: ['role'],
		properties: {
			role: { type: 'string', enum: ['user', 'admin'] }
		},
	},
	response: {
		200: {
			type: 'object',
			properties: {
				message: { type: 'string' },
				user: {
					type: 'object',
					properties: {
						id: { type: 'string' },
						email: { type: 'string' },
						role: { type: 'string' },
					}
				}
			},
		},
	},
};