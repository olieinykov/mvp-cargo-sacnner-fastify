import { createClient } from '@supabase/supabase-js';
import { db } from '../../db/connection.js';
import { users, companies, invitations } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getSupabase } from '../../lib/supabase.js';

// ==========================
// POST /auth/signUp-invite
// ==========================

export async function signUpByInvite(request, reply) {
	const { email, password, firstName, lastName, inviteToken } = request.body;

	if (!inviteToken) {
		return reply.code(400).send({ error: 'Invite token is required.' });
	}

	const { client: supabase } = getSupabase();

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

	const { data: { users: authUsers }, error: listError } = await supabase.auth.admin.listUsers();

	if (listError) {
		return reply.code(500).send({ error: `Auth service error: ${listError.message}` });
	}

	const authUser = authUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());

	if (!authUser) {
		return reply.code(404).send({ error: 'User record not found in Auth system. Contact admin.' });
	}

	const authUserId = authUser.id;

	const { error: updateError } = await supabase.auth.admin.updateUserById(authUserId, {
		password: password,
		email_confirm: true,
	});

	if (updateError) {
		return reply.code(updateError.status ?? 400).send({ error: updateError.message });
	}

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
					isActive:  true,
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
				isActive:  newUser.isActive,
			},
		});
	} catch (err) {
		return reply.code(502).send({ error: `Failed to create database profile: ${err.message}` });
	}
}

// ==========================
// POST /auth/signUp-admin
// ==========================

export async function signUpAdmin(request, reply) {
	const { email, password, firstName, lastName, company } = request.body;

	if (!company?.name || !company?.dotNumber) {
		return reply.code(400).send({
			error: 'Fields company.name and company.dotNumber are required for admin registration.',
		});
	}

	const supabaseUrl = process.env.SUPABASE_URL;
	const supabaseAnonKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !supabaseAnonKey) {
		return reply.code(500).send({ 
			error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.' 
		});
	}

	const anonSupabase = createClient(supabaseUrl, supabaseAnonKey, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	const { client: adminSupabase } = getSupabase();

	const { data: authData, error: authError } = await anonSupabase.auth.signUp({
		email,
		password,
	});

	if (authError) {
		return reply.code(authError.status ?? 400).send({ error: authError.message });
	}

	const authUserId = authData.user?.id;

	if (!authUserId) {
		return reply.code(400).send({ error: 'Failed to retrieve user ID after signup.' });
	}

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

			const [user] = await tx
				.insert(users)
				.values({
					id:        authUserId,
					companyId: company_.id,
					firstName,
					lastName,
					email:     email.toLowerCase(),
					role:      'admin',
					isActive:  true,
				})
				.returning();

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
		await adminSupabase.auth.admin.deleteUser(authUserId).catch(() => {});
		return reply.code(502).send({ error: `Failed to create company or user profile: ${err.message}` });
	}
}

// ==========================
// POST /auth/signIn
// ==========================

export async function signIn(request, reply) {
	const { email, password } = request.body;

	const { client: supabase } = getSupabase();

	const { data, error } = await supabase.auth.signInWithPassword({ email, password });

	if (error) {
		return reply.code(error.status ?? 400).send({ error: error.message });
	}

	const { session, user: authUser } = data;

	if (!authUser.email_confirmed_at) {
		return reply.code(403).send({ error: 'EMAIL_NOT_CONFIRMED' });
	}

	const [profile] = await db
		.select()
		.from(users)
		.where(eq(users.id, authUser.id))
		.limit(1);

	if (profile && profile.isActive === false) {
		return reply.code(403).send({ error: 'Account is deactivated. Please contact your administrator.' });
	}

	if (profile && !profile.isEmailConfirmed) {
		await db
			.update(users)
			.set({ isEmailConfirmed: true })
			.where(eq(users.id, authUser.id));

		if (profile.companyId) {
			await db
				.update(companies)
				.set({ isEmailConfirmed: true })
				.where(eq(companies.id, profile.companyId));
		}
	}

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

	const { client: supabase } = getSupabase();

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

	// Send invite email via Supabase
	const appUrl     = 'https://mvp-cargo-sacnner-fe.vercel.app';
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
		return reply.code(500).send({ error: `Failed to resend email: ${emailError.message}` });
	}

	try{
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

		return reply.code(201).send({
			invitation: {
				id:        newInvite.id,
				email:     newInvite.email,
				role:      newInvite.role,
				expiresAt: newInvite.expiresAt,
				inviteLink,
			},
		});
	} catch(e) {
		return reply.code(500).send({ error: 'Failed to save invitation to database.' });
	}
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
 
	const { client: supabase } = getSupabase();
 
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
	
	if (requester.isActive === false) {
		return reply.code(401).send({ error: 'Account deactivated.' });
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

// ==========================
// GET /auth/me
// ==========================

export async function getMe(request, reply) {
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) {
		return reply.code(401).send({ error: 'Missing Authorization header.' });
	}

	const { client: supabase } = getSupabase();

	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) {
		return reply.code(401).send({ error: 'Invalid or expired token.' });
	}

	const [result] = await db
		.select({
			id:               users.id,
			email:            users.email,
			firstName:        users.firstName,
			lastName:         users.lastName,
			role:             users.role,
			companyId:        users.companyId,
			registrationData: users.registrationData,
			isEmailConfirmed: users.isEmailConfirmed,
			isActive: 		  users.isActive,
			companyName:      companies.name,
		})
		.from(users)
		.leftJoin(companies, eq(users.companyId, companies.id))
		.where(eq(users.id, authUser.id))
		.limit(1);

	if (!result) {
		return reply.code(404).send({ error: 'User profile not found.' });
	}

	if (result.isActive === false) {
		return reply.code(401).send({ error: 'Account deactivated' });
	}

	return reply.send({
		id: result.id,
		email: result.email,
		firstName: result.firstName,
		lastName: result.lastName,
		role: result.role,
		companyId: result.companyId,
		registrationData: result.registrationData,
		isEmailConfirmed: result.isEmailConfirmed,
		companyName: result.companyName,
	});
}

// ==========================
// POST /auth/request-password-reset
// ==========================

export async function requestPasswordReset(request, reply) {
	const { email } = request.body;

	const [existingUser] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email.toLowerCase()))
		.limit(1);

	if (!existingUser) {
		return reply.code(404).send({ error: 'User with this email does not exist.' });
	}

	const { client: supabase } = getSupabase();
	
	const appUrl = 'https://mvp-cargo-sacnner-fe.vercel.app';
	const resetLink = `${appUrl}/update-password`;

	const { error } = await supabase.auth.resetPasswordForEmail(email, {
		redirectTo: resetLink,
	});

	if (error) {
		return reply.code(error.status ?? 400).send({ error: error.message });
	}

	return reply.send({ message: 'A password reset link has been sent to your email' });
}
// ==========================
// POST /auth/update-password
// ==========================

export async function updatePassword(request, reply) {
	const { password } = request.body;
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) {
		return reply.code(401).send({ error: 'Missing Authorization header.' });
	}

	const { client: supabase } = getSupabase();

	const { data: { user }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !user) {
		return reply.code(401).send({ error: 'Invalid or expired recovery token.' });
	}

	const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
		password: password
	});

	if (updateError) {
		return reply.code(updateError.status ?? 400).send({ error: updateError.message });
	}

	return reply.send({ message: 'Password updated successfully' });
}

// ==========================
// GET /auth/invitations
// ==========================

export async function getPendingInvitations(request, reply) {
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) return reply.code(401).send({ error: 'Missing Authorization header.' });

	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) return reply.code(401).send({ error: 'Invalid or expired token.' });

	const [admin] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);

	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		return reply.code(403).send({ error: 'Admin access required.' });
	}

	const pendingInvites = await db
		.select({
			id: invitations.id,
			email: invitations.email,
			role: invitations.role,
			expiresAt: invitations.expiresAt,
			token: invitations.token
		})
		.from(invitations)
		.where(
			and(
				eq(invitations.companyId, admin.companyId),
				eq(invitations.status, 'pending')
			)
		);

	return reply.send({ invitations: pendingInvites });
}

// ==========================
// POST /auth/invitation/:id/cancel
// ==========================

export async function cancelInvitation(request, reply) {
	const { id } = request.params;
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) return reply.code(401).send({ error: 'Missing Authorization header.' });

	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) return reply.code(401).send({ error: 'Invalid or expired token.' });

	const [admin] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);

	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		return reply.code(403).send({ error: 'Admin access required.' });
	}

	const [deletedInvite] = await db
		.delete(invitations)
		.where(
			and(
				eq(invitations.id, id),
				eq(invitations.companyId, admin.companyId),
				eq(invitations.status, 'pending')
			)
		)
		.returning();

	if (!deletedInvite) {
		return reply.code(404).send({ error: 'Pending invitation not found or already processed.' });
	}

	return reply.send({ message: 'Invitation has been canceled and removed successfully.' });
}

// ==========================
// POST /auth/invitation/:id/resend
// ==========================

export async function resendInvitation(request, reply) {
	const { id } = request.params;
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) return reply.code(401).send({ error: 'Missing Authorization header.' });

	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) return reply.code(401).send({ error: 'Invalid or expired token.' });

	const [admin] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);

	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		return reply.code(403).send({ error: 'Admin access required.' });
	}

	const [invite] = await db
		.select()
		.from(invitations)
		.where(
			and(
				eq(invitations.id, id),
				eq(invitations.companyId, admin.companyId),
				eq(invitations.status, 'pending')
			)
		)
		.limit(1);

	if (!invite) {
		return reply.code(404).send({ error: 'Pending invitation not found.' });
	}

	const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	await db
		.update(invitations)
		.set({ expiresAt: newExpiresAt })
		.where(eq(invitations.id, invite.id));

	const appUrl = 'https://mvp-cargo-sacnner-fe.vercel.app';
	const inviteLink = `${appUrl}/invite?token=${invite.token}`;

	const { error: emailError } = await supabase.auth.admin.inviteUserByEmail(invite.email, {
		data: {
			invite_token: invite.token,
			company_id: admin.companyId,
			invited_by: admin.id,
		},
		redirectTo: inviteLink,
	});

	if (emailError) {
		return reply.code(500).send({ error: `Failed to resend email: ${emailError.message}` });
	}

	return reply.send({ message: 'Invitation resent successfully.', expiresAt: newExpiresAt });
}

// ==========================
// PATCH /auth/users/:userId/role
// ==========================

export async function updateUserRole(request, reply) {
	const { userId } = request.params;
	const { role } = request.body;
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) return reply.code(401).send({ error: 'Missing Authorization header.' });

	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) return reply.code(401).send({ error: 'Invalid or expired token.' });

	const [admin] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);

	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		return reply.code(403).send({ error: 'Admin access required.' });
	}

	if (admin.id === userId) {
		return reply.code(400).send({ error: 'You cannot change your own role.' });
	}

	const [targetUser] = await db
		.select({ id: users.id, role: users.role })
		.from(users)
		.where(
			and(
				eq(users.id, userId),
				eq(users.companyId, admin.companyId)
			)
		)
		.limit(1);

	if (!targetUser) {
		return reply.code(404).send({ error: 'User not found in your company.' });
	}

	if (targetUser.role === role) {
		return reply.code(400).send({ error: `User already has the '${role}' role.` });
	}

	const [updatedUser] = await db
		.update(users)
		.set({ role })
		.where(eq(users.id, userId))
		.returning();

	return reply.send({
		message: 'User role updated successfully.',
		user: {
			id: updatedUser.id,
			email: updatedUser.email,
			role: updatedUser.role,
		}
	});
}

// ==========================
// PATCH /auth/users/:userId/status
// ==========================
 
export async function updateUserStatus(request, reply) {
	const { userId } = request.params;
	const { isActive } = request.body;
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();
 
	if (!token) return reply.code(401).send({ error: 'Missing Authorization header.' });
 
	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);
 
	if (userError || !authUser) return reply.code(401).send({ error: 'Invalid or expired token.' });
 
	const [admin] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
 
	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		return reply.code(403).send({ error: 'Admin access required.' });
	}
 
	if (admin.id === userId) {
		return reply.code(400).send({ error: 'You cannot change your own status.' });
	}
 
	const [targetUser] = await db
		.select({ id: users.id, isActive: users.isActive })
		.from(users)
		.where(
			and(
				eq(users.id, userId),
				eq(users.companyId, admin.companyId)
			)
		)
		.limit(1);
 
	if (!targetUser) {
		return reply.code(404).send({ error: 'User not found in your company.' });
	}
 
	if (targetUser.isActive === isActive) {
		return reply.code(400).send({
			error: `User is already ${isActive ? 'active' : 'inactive'}.`,
		});
	}
 
	const [updatedUser] = await db
		.update(users)
		.set({ isActive })
		.where(eq(users.id, userId))
		.returning();
 
	return reply.send({
		message: `User ${isActive ? 'activated' : 'deactivated'} successfully.`,
		user: {
			id:       updatedUser.id,
			email:    updatedUser.email,
			role:     updatedUser.role,
			isActive: updatedUser.isActive,
		}
	});
}