import { pgTable, uuid, jsonb, timestamp, text } from 'drizzle-orm/pg-core';

export const audits = pgTable('audits', {
  id:         uuid('id').primaryKey().defaultRandom(),
  load_id:    text('load_id'),                          
  response:   jsonb('response').notNull(),              
  is_passed:  text('is_passed').notNull(),              
  score:      text('score').notNull(),                  
  created_at: timestamp('created_at').defaultNow().notNull(),
});