import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config/index.js';
import * as schema from './schema.js';
import { createClient } from '@supabase/supabase-js';

if (!config.database.connectionString) {
	throw new Error('DATABASE_URL is not set in environment variables');
}

const connectionString = config.database.connectionString;
const client = postgres(connectionString, {
	max: 50,
	idle_timeout: 20,
	connect_timeout: 10,
});

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);

export const db = drizzle(client, { schema });
