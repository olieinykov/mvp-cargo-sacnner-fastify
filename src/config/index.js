import dotenv from 'dotenv';

dotenv.config();

export const config = {
	port: process.env.PORT || 3000,
	host: process.env.HOST || '0.0.0.0',
	nodeEnv: process.env.NODE_ENV || 'development',
	supabase: {
		url: process.env.SUPABASE_URL || '',
		anonKey: process.env.SUPABASE_ANON_KEY || '',
		serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
	},
	database: {
		connectionString: process.env.DATABASE_URL || '',
	},
};
