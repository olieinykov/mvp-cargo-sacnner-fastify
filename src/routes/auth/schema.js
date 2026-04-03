// ─── POST /auth/signUp ────────────────────────────────────────────────────────
//
// Two paths share the same endpoint:
//   • inviteToken present  → invited user joining an existing company
//   • no inviteToken       → admin registering a brand-new company
//     (requires company.name + company.dotNumber in the body)

export const signUpSchema = {
	tags: ['Auth'],
	summary: 'Register a new user',
	description:
		'**Path A — invited user:** provide `inviteToken`. The user is linked to the inviting company automatically.\n\n' +
		'**Path B — admin + new company:** omit `inviteToken` and include a `company` object with `name` and `dotNumber`. ' +
		'The company is created, the user is set as its admin, and `company.ownerId` is back-filled in one transaction.',
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
				// Only present in Path B
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