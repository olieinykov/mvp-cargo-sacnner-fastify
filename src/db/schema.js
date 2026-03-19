import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';

export const profiles = pgTable('profiles', {
	userId: uuid('user_id').primaryKey().notNull(),
	email: varchar('email', { length: 255 }).notNull(),
	username: varchar('username', { length: 255 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
