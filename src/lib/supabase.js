import { createClient } from '@supabase/supabase-js';

export const getSupabase = () => {
	const url = process.env.SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const bucket = 'audit-images';

	if (!url || !key) {
		throw Object.assign(
			new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.'),
			{ statusCode: 500 },
		);
	}
	const client = createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false },
	});

	return { client, bucket };
};
