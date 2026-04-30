import { createClient } from '@supabase/supabase-js';
import { db } from '../../db/connection.js';
import { users, companies, invitations } from '../../db/schema.js';
import { eq, and, ne, or } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getSupabase } from '../../lib/supabase.js';

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function resolveAdmin(request, reply) {
	const authHeader = request.headers.authorization ?? '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();

	if (!token) {
		reply.code(401).send({ error: 'Missing Authorization header.' });
		return null;
	}

	const { client: supabase } = getSupabase();
	const { data: { user: authUser }, error: userError } = await supabase.auth.getUser(token);

	if (userError || !authUser) {
		reply.code(401).send({ error: 'Invalid or expired token.' });
		return null;
	}

	const [admin] = await db
		.select()
		.from(users)
		.where(eq(users.id, authUser.id))
		.limit(1);

	if (!admin || admin.role !== 'admin' || !admin.companyId) {
		reply.code(403).send({ error: 'Admin access required.' });
		return null;
	}

	return admin;
}

// ==========================
// GET /companies/:companyId
// ==========================
export async function getCompany(request, reply) {
	const admin = await resolveAdmin(request, reply);
	if (!admin) return;

	const { companyId } = request.params;

	if (admin.companyId !== companyId) {
		return reply.code(403).send({ error: 'You do not have access to this company.' });
	}

	const [company] = await db
		.select()
		.from(companies)
		.where(eq(companies.id, companyId))
		.limit(1);

	if (!company) {
		return reply.code(404).send({ error: 'Company not found.' });
	}

	return reply.send(company);
}

// ==========================
// PATCH /companies/:companyId
// ==========================
export async function updateCompany(request, reply) {
	const admin = await resolveAdmin(request, reply);
	if (!admin) return;

	const { companyId } = request.params;

	if (admin.companyId !== companyId) {
		return reply.code(403).send({ error: 'You do not have access to this company.' });
	}

	const { name, dotNumber, mcNumber } = request.body;

	if (dotNumber) {
		const [existing] = await db
			.select({ id: companies.id })
			.from(companies)
			.where(
				and(
					eq(companies.dotNumber, dotNumber),
					ne(companies.id, companyId)
				)
			)
			.limit(1);

		if (existing) {
			return reply.code(409).send({ error: 'A company with this DOT number already exists.' });
		}
	}

	const [updatedCompany] = await db
		.update(companies)
		.set({
			...(name && { name }),
			...(dotNumber && { dotNumber }),
			...(mcNumber !== undefined && { mcNumber }),
		})
		.where(eq(companies.id, companyId))
		.returning();

	if (!updatedCompany) {
		return reply.code(404).send({ error: 'Company not found.' });
	}

	return reply.send(updatedCompany);
}

// ─── FMCSA dotNumber ownership helper ─────────────────────────────────────────

async function resolveAdminWithDotNumber(request, reply) {
	const admin = await resolveAdmin(request, reply);
	if (!admin) return null;

	const { dotNumber } = request.params;

	const [adminCompany] = await db
		.select({ dotNumber: companies.dotNumber })
		.from(companies)
		.where(eq(companies.id, admin.companyId))
		.limit(1);

	if (!adminCompany || adminCompany.dotNumber !== dotNumber) {
		reply.code(403).send({ error: 'You do not have access to this company.' });
		return null;
	}

	return admin;
}

// ==========================
// GET /companies/:dotNumber/fmcsa/hazmat
// ==========================
export async function getCompanyHazmat(request, reply) {
	const admin = await resolveAdminWithDotNumber(request, reply);
	if (!admin) return;

	const { dotNumber } = request.params;
	const FMCSA_API_KEY = process.env.FMCSA_API_KEY;

	try {
		const res = await fetch(`https://fmcsa-integration.vercel.app/api/companies/${dotNumber}?fields=hm_ind`, {
			headers: { Authorization: `Bearer ${FMCSA_API_KEY}` },
		});

		if (!res.ok) throw new Error(`FMCSA API error: ${res.status}`);

		const { data } = await res.json();

		return reply.send({ hm_ind: data?.hm_ind ?? null });
	} catch (err) {
		return reply.code(502).send({ error: 'Failed to fetch Hazmat status from FMCSA.' });
	}
}

// ==========================
// GET /companies/:dotNumber/fmcsa/inspections
// ==========================
export async function getCompanyInspections(request, reply) {
	const admin = await resolveAdminWithDotNumber(request, reply);
	if (!admin) return;

	const { dotNumber } = request.params;
	const FMCSA_API_KEY = process.env.FMCSA_API_KEY;

	try {
		const res = await fetch(`https://fmcsa-integration.vercel.app/api/companies/${dotNumber}/inspections`, {
			headers: { Authorization: `Bearer ${FMCSA_API_KEY}` },
		});

		if (!res.ok) throw new Error(`FMCSA API error: ${res.status}`);

		const data = await res.json();
		return reply.send(data);
	} catch (err) {
		return reply.code(502).send({ error: 'Failed to fetch inspections from FMCSA.' });
	}
}

// ==========================
// GET /inspections/:id/violations
// ==========================
export async function getInspectionViolations(request, reply) {
	const admin = await resolveAdmin(request, reply);
	if (!admin) return;

	const { id } = request.params;
	const FMCSA_API_KEY = process.env.FMCSA_API_KEY;

	try {
		const res = await fetch(`https://fmcsa-integration.vercel.app/api/inspections/${id}/violations`, {
			headers: { Authorization: `Bearer ${FMCSA_API_KEY}` },
		});

		if (!res.ok) throw new Error(`FMCSA API error: ${res.status}`);

		const data = await res.json();
		return reply.send(data);
	} catch (err) {
		return reply.code(502).send({ error: 'Failed to fetch violations from FMCSA.' });
	}
}