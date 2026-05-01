import { db } from '../../db/connection.js';
import { audits } from '../../db/schema.js';
import { count, desc, asc, eq, and, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { pdf } from 'pdf-to-img';
import { isPdfBuffer, toArray } from '../../utils/helpers.js';
import { getSupabase } from '../../lib/supabase.js';
import { classifyAndAnalyzeAll, IMAGE_TYPE_TO_SLOT } from '../../services/visionService.js';
import { runAudit } from '../../services/auditService.js';

// ==========================
// POST /audit/upload
// ==========================

export async function uploadAuditImages(request, reply) {
	const allFiles = toArray(request.body.images);

	if (allFiles.length === 0) {
		return reply.code(400).send({ error: 'Field "images" is required.' });
	}

	let processedFiles = [];

	for (const file of allFiles) {
		if (!file._buf || file._buf.length === 0) {
			return reply.code(400).send({ error: 'One or more files are empty.' });
		}

		if (isPdfBuffer(file._buf)) {
			try {
				const document = await pdf(file._buf, { scale: 1.0 });

				for await (const pageBuf of document) {
					processedFiles.push({
						mimetype: 'image/png',
						_buf: pageBuf,
					});
				}
			} catch (err) {
				return reply.code(500).send({ error: `Failed to parse PDF: ${err.message}` });
			}
		} else {
			if (!file.mimetype || !file.mimetype.startsWith('image/')) {
				return reply
					.code(400)
					.send({ error: `Expected image or PDF. Got: ${file.mimetype}` });
			}
			processedFiles.push(file);
		}
	}

	const { client: supabase, bucket } = getSupabase();

	const uploaded = await Promise.all(
		processedFiles.map(async (file) => {
			const ext = file.mimetype.split('/')[1] ?? 'jpg';
			const storageId = `${randomUUID()}.${ext}`;

			const { error } = await supabase.storage
				.from(bucket)
				.upload(storageId, file._buf, { contentType: file.mimetype, upsert: false });

			if (error) {
				throw Object.assign(new Error(`Supabase upload failed: ${error.message}`), {
					statusCode: 502,
				});
			}

			const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(storageId);

			return { id: storageId, url: publicData.publicUrl };
		}),
	);

	return reply.send({ images: uploaded });
}

// ==========================
// POST /
// ==========================

export async function createAudit(request, reply) {
	const { imageIds, auditorId } = request.body;

	if (!Array.isArray(imageIds) || imageIds.length === 0) {
		return reply
			.code(400)
			.send({ error: 'Field "imageIds" must be a non-empty array of storage IDs.' });
	}

	const { client: supabase, bucket } = getSupabase();

	// Resolve public URLs and detect mimetype from file extension.
	const MIME_MAP = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		webp: 'image/webp',
		gif: 'image/gif',
	};
	const files = imageIds.map((id) => {
		const { data } = supabase.storage.from(bucket).getPublicUrl(id);
		const ext = id.split('.').pop()?.toLowerCase() ?? 'jpeg';
		return { id, url: data.publicUrl, mimetype: MIME_MAP[ext] ?? 'image/jpeg' };
	});

	let bolResults,
		markerResults,
		cargoResults,
		sealResults,
		classifiedFiles,
		isGlobalHazmat,
		bolWeights;
	try {
		({
			bolResults,
			markerResults,
			cargoResults,
			classifiedFiles,
			isGlobalHazmat,
			bolWeights,
			sealResults,
		} = await classifyAndAnalyzeAll(files));
	} catch (err) {
		return reply.code(err.statusCode ?? 502).send({ error: err.message });
	}

	if (bolWeights && bolWeights.length > 0) {
		const formattedWeightsStr = bolWeights
			.map((w) => {
				const packType = w.isBulk ? 'Bulk (IBC/Tank)' : 'Non-Bulk';
				return `UN: ${String(w.unNumber).replace(/\D/g, '')} | Weight: ${w.weight} lbs | Type: ${packType};`;
			})
			.join('\n');

		bolResults.forEach((bol) => {
			if (bol.extracted) {
				bol.extracted.totalWeights = {
					mainValue: formattedWeightsStr,
					meaning: 'Total aggregate gross weights calculated across all BOL pages',
				};
			}
		});
	}

	const audit = runAudit(
		bolResults,
		markerResults,
		cargoResults,
		isGlobalHazmat,
		bolWeights,
		sealResults,
	);

	const auditResponse = {
		bol: bolResults,
		marker: markerResults,
		cargo: cargoResults,
		seal: sealResults,
		audit,
	};

	// Each image stored with its detected slot type so the UI can show them per-section
	const auditImages = classifiedFiles.map(({ file, imageType }) => ({
		url: file.url,
		type: IMAGE_TYPE_TO_SLOT[imageType] ?? 'cargo',
	}));

	let savedId = null;
	try {
		const [saved] = await db
			.insert(audits)
			.values({
				response: auditResponse,
				is_passed: String(audit.is_passed),
				score: String(audit.score),
				auditImages,
				auditorId,
			})
			.returning({ id: audits.id });
		savedId = saved.id;
	} catch (err) {
		console.error('Failed to save audit to DB:', err.message);
	}

	return reply.send({ id: savedId, auditImages, ...auditResponse });
}

// ==========================
// GET /audit
// ==========================

export async function getAudits(request, reply) {
	const {
		page = 1,
		limit = 20,
		auditorId,
		sortBy = 'date', // 'date' | 'score'
		sortOrder = 'desc', // 'asc' | 'desc'
		status, // 'passed' | 'failed'
		dateFrom, // ISO строка (напр. '2026-04-01T00:00:00Z')
		dateTo, // ISO строка
	} = request.query;

	const offset = (Number(page) - 1) * Number(limit);

	try {
		const conditions = [eq(audits.auditorId, auditorId)];

		if (status === 'passed') {
			conditions.push(eq(audits.is_passed, 'true'));
		} else if (status === 'failed') {
			conditions.push(eq(audits.is_passed, 'false'));
		}

		if (dateFrom) {
			conditions.push(gte(audits.created_at, new Date(dateFrom)));
		}
		if (dateTo) {
			conditions.push(lte(audits.created_at, new Date(dateTo)));
		}

		const whereFilter = conditions.length === 1 ? conditions[0] : and(...conditions);

		const sortColumn = sortBy === 'score' ? audits.score : audits.created_at;
		const orderByClause = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

		const [rows, [{ total }]] = await Promise.all([
			db
				.select({
					id: audits.id,
					is_passed: audits.is_passed,
					score: audits.score,
					created_at: audits.created_at,
					response: audits.response,
					auditImages: audits.auditImages,
				})
				.from(audits)
				.where(whereFilter)
				.orderBy(orderByClause)
				.limit(Number(limit))
				.offset(offset),

			db.select({ total: count() }).from(audits).where(whereFilter),
		]);

		const totalPages = Math.ceil(total / Number(limit));

		return reply.send({
			data: rows,
			pagination: {
				total,
				page: Number(page),
				limit: Number(limit),
				totalPages,
				hasNextPage: page < totalPages,
				hasPrevPage: page > 1,
			},
		});
	} catch (err) {
		return reply.code(502).send({ error: `Failed to fetch audits: ${err.message}` });
	}
}
