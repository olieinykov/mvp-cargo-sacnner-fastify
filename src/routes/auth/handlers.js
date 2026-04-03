import { createClient } from '@supabase/supabase-js';
import { db } from '../../db/connection.js';
import { users, companies, invitations } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

// ==========================
// Supabase client
// ==========================

const getSupabase = () => {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !key) {
		throw Object.assign(
			new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.'),
			{ statusCode: 500 },
		);
	}

	return createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false },
	});
};

// ==========================
// POST /auth/signUp
// ==========================

export async function signUp(request, reply) {
	const { email, password, firstName, lastName, inviteToken, company } = request.body;

	const supabase = getSupabase();

	// ── PATH A: invited user ───────────────────────────────────────────────────
	if (inviteToken) {
		const [found] = await db
			.select()
			.from(invitations)
			.where(
				and(
					eq(invitations.token, inviteToken),
					eq(invitations.status, 'pending'),
				),
			)
			.limit(1);

		if (!found) {
			return reply.code(400).send({ error: 'Invalid or expired invitation token.' });
		}

		if (new Date(found.expiresAt) < new Date()) {
			await db
				.update(invitations)
				.set({ status: 'expired' })
				.where(eq(invitations.id, found.id));

			return reply.code(400).send({ error: 'Invitation token has expired.' });
		}

		if (found.email.toLowerCase() !== email.toLowerCase()) {
			return reply.code(400).send({ error: 'Email does not match the invitation.' });
		}

		// Create Supabase Auth user
		const { data: authData, error: authError } = await supabase.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
		});

		if (authError) {
			return reply.code(authError.status ?? 400).send({ error: authError.message });
		}

		const authUserId = authData.user.id;

		try {
			const newUser = await db.transaction(async (tx) => {
				const [user] = await tx
					.insert(users)
					.values({
						id:        authUserId,
						companyId: found.companyId,
						firstName,
						lastName,
						email:     email.toLowerCase(),
						role:      found.role,
					})
					.returning();

				await tx
					.update(invitations)
					.set({ status: 'accepted' })
					.where(eq(invitations.id, found.id));

				return user;
			});

			return reply.code(201).send({
				user: {
					id:        newUser.id,
					email:     newUser.email,
					firstName: newUser.firstName,
					lastName:  newUser.lastName,
					role:      newUser.role,
					companyId: newUser.companyId,
				},
			});
		} catch (err) {
			await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
			return reply.code(502).send({ error: `Failed to create user profile: ${err.message}` });
		}
	}

	if (!company?.name || !company?.dotNumber) {
		return reply.code(400).send({
			error: 'Fields company.name and company.dotNumber are required for admin registration.',
		});
	}

	// Create Supabase Auth user first
	const { data: authData, error: authError } = await supabase.auth.admin.createUser({
		email,
		password,
		email_confirm: true,
	});

	if (authError) {
		return reply.code(authError.status ?? 400).send({ error: authError.message });
	}

	const authUserId = authData.user.id;

	try {
		const { newUser, newCompany } = await db.transaction(async (tx) => {
			const [company_] = await tx
				.insert(companies)
				.values({
					name:      company.name,
					dotNumber: company.dotNumber,
					mcNumber:  company.mcNumber ?? null,
				})
				.returning();

			// 2. Create the admin user linked to this company
			const [user] = await tx
				.insert(users)
				.values({
					id:        authUserId,
					companyId: company_.id,
					firstName,
					lastName,
					email:     email.toLowerCase(),
					role:      'admin',
				})
				.returning();

			// 3. Set ownerId on the company now that we have the user id
			const [updatedCompany] = await tx
				.update(companies)
				.set({ ownerId: user.id })
				.where(eq(companies.id, company_.id))
				.returning();

			return { newUser: user, newCompany: updatedCompany };
		});

		return reply.code(201).send({
			user: {
				id:        newUser.id,
				email:     newUser.email,
				firstName: newUser.firstName,
				lastName:  newUser.lastName,
				role:      newUser.role,
				companyId: newUser.companyId,
			},
			company: {
				id:        newCompany.id,
				name:      newCompany.name,
				dotNumber: newCompany.dotNumber,
				mcNumber:  newCompany.mcNumber,
				ownerId:   newCompany.ownerId,
				status:    newCompany.status,
			},
		});
	} catch (err) {
		await supabase.auth.admin.deleteUser(authUserId).catch(() => {});
		return reply.code(502).send({ error: `Failed to create company or user profile: ${err.message}` });
	}
}

// ==========================
// POST /auth/signIn
// ==========================

export async function signIn(request, reply) {
	const { email, password } = request.body;

	const supabase = getSupabase();

	const { data, error } = await supabase.auth.signInWithPassword({ email, password });

	if (error) {
		return reply.code(error.status ?? 400).send({ error: error.message });
	}

	const { session, user: authUser } = data;

	const [profile] = await db
		.select()
		.from(users)
		.where(eq(users.id, authUser.id))
		.limit(1);

	return reply.send({
		accessToken:  session.access_token,
		refreshToken: session.refresh_token,
		expiresIn:    session.expires_in,
		user: profile
			? {
				id:        profile.id,
				email:     profile.email,
				firstName: profile.firstName,
				lastName:  profile.lastName,
				role:      profile.role,
				companyId: profile.companyId,
			}
			: { id: authUser.id, email: authUser.email },
	});
}

// ==========================
// POST /auth/invitation
// ==========================

export async function createInvitation(request, reply) {
	const { email, role = 'user' } = request.body;

	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) {
		return reply.code(401).send({ error: 'Missing Authorization header.' });
	}

	const supabase = getSupabase();

	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) {
		return reply.code(401).send({ error: 'Invalid or expired token.' });
	}

	// Load admin profile & verify they belong to a company
	const [admin] = await db
		.select()
		.from(users)
		.where(eq(users.id, authUser.id))
		.limit(1);

	if (!admin) {
		return reply.code(403).send({ error: 'User profile not found.' });
	}

	if (admin.role !== 'admin') {
		return reply.code(403).send({ error: 'Only admins can send invitations.' });
	}

	if (!admin.companyId) {
		return reply.code(403).send({ error: 'Admin is not associated with any company.' });
	}

	// Check for existing user or pending invite
	const [existingUser] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.toLowerCase()))
		.limit(1);

	if (existingUser) {
		return reply.code(409).send({ error: 'A user with this email already exists.' });
	}

	const [pendingInvite] = await db
		.select({ id: invitations.id })
		.from(invitations)
		.where(
			and(
				eq(invitations.email, email.toLowerCase()),
				eq(invitations.companyId, admin.companyId),
				eq(invitations.status, 'pending'),
			),
		)
		.limit(1);

	if (pendingInvite) {
		return reply.code(409).send({ error: 'A pending invitation for this email already exists.' });
	}

	// Create invitation record
	const inviteToken = randomBytes(32).toString('hex');
	const expiresAt   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

	const [newInvite] = await db
		.insert(invitations)
		.values({
			companyId: admin.companyId,
			invitedBy: admin.id,
			email:     email.toLowerCase(),
			role,
			token:     inviteToken,
			expiresAt,
			status:    'pending',
		})
		.returning();

	// Send invite email via Supabase
	const appUrl     = process.env.APP_URL ?? 'http://localhost:5173';
	const inviteLink = `${appUrl}/invite?token=${inviteToken}`;

	const { error: emailError } = await supabase.auth.admin.inviteUserByEmail(email, {
		data: {
			invite_token: inviteToken,
			company_id:   admin.companyId,
			invited_by:   admin.id,
		},
		redirectTo: inviteLink,
	});

	if (emailError) {
		// Non-fatal — invitation is stored; email can be resent later
		console.error('Failed to send invite email:', emailError.message);
	}

	return reply.code(201).send({
		invitation: {
			id:        newInvite.id,
			email:     newInvite.email,
			role:      newInvite.role,
			expiresAt: newInvite.expiresAt,
			inviteLink,
		},
	});
}

// ─── GET /auth/invite/:token ──────────────────────────────────────────────────
 
export async function getInviteInfo(request, reply) {
	const { token } = request.params;
 
	const [invite] = await db
		.select({
			email:     invitations.email,
			role:      invitations.role,
			expiresAt: invitations.expiresAt,
			status:    invitations.status,
			companyId: invitations.companyId,
		})
		.from(invitations)
		.where(eq(invitations.token, token))
		.limit(1);
 
	if (!invite) {
		return reply.code(404).send({ error: 'Invitation not found.' });
	}
 
	if (invite.status !== 'pending') {
		return reply.code(400).send({ error: `Invitation is already ${invite.status}.` });
	}
 
	if (new Date(invite.expiresAt) < new Date()) {
		await db
			.update(invitations)
			.set({ status: 'expired' })
			.where(eq(invitations.token, token));
		return reply.code(400).send({ error: 'Invitation has expired.' });
	}
 
	// Fetch company name
	const [company] = await db
		.select({ id: companies.id, name: companies.name })
		.from(companies)
		.where(eq(companies.id, invite.companyId))
		.limit(1);
 
	return reply.send({
		email:     invite.email,
		role:      invite.role,
		expiresAt: invite.expiresAt,
		company: {
			id:   company?.id ?? invite.companyId,
			name: company?.name ?? 'Unknown company',
		},
	});
}
 
// ─── GET /auth/users ──────────────────────────────────────────────────────────
 
export async function getCompanyUsers(request, reply) {
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();
 
	if (!token) {
		return reply.code(401).send({ error: 'Missing Authorization header.' });
	}
 
	const supabase = getSupabase();
 
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);
 
	if (userError || !authUser) {
		return reply.code(401).send({ error: 'Invalid or expired token.' });
	}
 
	const [requester] = await db
		.select()
		.from(users)
		.where(eq(users.id, authUser.id))
		.limit(1);
 
	if (!requester) {
		return reply.code(403).send({ error: 'User profile not found.' });
	}
 
	if (requester.role !== 'admin') {
		return reply.code(403).send({ error: 'Admin access required.' });
	}
 
	if (!requester.companyId) {
		return reply.code(403).send({ error: 'Not associated with a company.' });
	}
 
	const members = await db
		.select()
		.from(users)
		.where(eq(users.companyId, requester.companyId));
 
	return reply.send({ users: members });
}