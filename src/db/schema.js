import { pgTable, uuid, jsonb, timestamp, text, pgEnum, boolean } from 'drizzle-orm/pg-core';

export const memberRoleEnum = pgEnum('member_role', ['admin', 'user']);
export const inviteStatusEnum = pgEnum('invite_status', ['pending', 'accepted', 'expired']);

export const audits = pgTable('audits', {
  id:         uuid('id').primaryKey().defaultRandom(),
  load_id:    text('load_id'),                          
  response:   jsonb('response').notNull(),              
  is_passed:  text('is_passed').notNull(),              
  score:      text('score').notNull(),                  
  created_at: timestamp('created_at').defaultNow().notNull(),
  auditImages: jsonb('audit_images').default([]),
  auditorId: uuid('auditor_id')
});

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  dotNumber: text('dot_number').notNull().unique(),
  mcNumber: text('mc_number'),
  ownerId: uuid('owner_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  isEmailConfirmed: boolean('is_email_confirmed').notNull().default(false),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by').notNull(),
  email: text('email').notNull(),
  role: memberRoleEnum('role').notNull().default('user'),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  status: inviteStatusEnum('status').notNull().default('pending'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email').notNull().unique(),
  role: memberRoleEnum('role').notNull().default('user'),
  registrationData: timestamp('registration_data').defaultNow().notNull(),
  isEmailConfirmed: boolean('is_email_confirmed').notNull().default(false)
});