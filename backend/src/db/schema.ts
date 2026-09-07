import { pgTable, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';
import type { InvoiceData } from '../../../shared/types.js';

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id'),
  imageUrl: text('image_url'),
  source: text('source'),
  data: jsonb('data').$type<InvoiceData>().notNull(),
  isValid: boolean('is_valid').default(true).notNull(),
  status: text('status').default('processed').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type InvoiceRecord = typeof invoices.$inferSelect;