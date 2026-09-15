// backend/src/db/schema.ts
import { pgTable, text, timestamp, boolean, jsonb, integer } from 'drizzle-orm/pg-core';
import type { InvoiceData } from '../../../shared/types.js';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  tier: text('tier').default('free').notNull(), // 'free' | 'pro'
  monthlyCredits: integer('monthly_credits').default(15).notNull(), // Ingyenes kezdő számlakeret
  szamlazzHuApiKey: text('szamlazz_hu_api_key'),
  navTechnicalUser: text('nav_technical_user'),
  navTechnicalPassword: text('nav_technical_password'),
  navSignKey: text('nav_sign_key'),
  navExchangeKey: text('nav_exchange_key'),
  resetToken: text('reset_token'),
  resetTokenExpiry: timestamp('reset_token_expiry'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id), // Kapcsolat a felhasználóhoz
  imageUrl: text('image_url'),
  source: text('source'),
  data: jsonb('data').$type<InvoiceData>().notNull(),
  isValid: boolean('is_valid').default(true).notNull(),
  status: text('status').default('processed').notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type UserRecord = typeof users.$inferSelect;
export type InvoiceRecord = typeof invoices.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;