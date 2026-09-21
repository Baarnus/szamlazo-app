// backend/src/index.ts
// Alkalmazás belépési pont — csak app init, middleware, router mount-ok és szerver indítás.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import { initDatabase } from './db/index.js';
import { authRouter } from './auth.js';
import { billingRouter } from './billing.js';
import { settingsRouter } from './settings.js';
import { szamlazzRouter } from './szamlazz-integration.js';
import { invoicesRouter } from './routes/invoices.js';
import { parseRouter } from './routes/parse.js';
import { exportRouter } from './routes/export.js';
import { partnersRouter } from './routes/partners.js';

// Re-export a schema-t a visszafelé kompatibilitás kedvéért
export { InvoiceDataSchema } from './schemas/invoice.js';

dotenv.config();

export const app = new Hono();
app.use('/*', cors());

// Router-ek bekötése
app.route('/api/auth', authRouter);
app.route('/api/billing', billingRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/szamlazz', szamlazzRouter);
app.route('/api/invoices', invoicesRouter);
app.route('/api/invoices/export', exportRouter);
app.route('/api/partners', partnersRouter);
app.route('/api', parseRouter);

const port = Number(process.env.PORT) || 3000;
initDatabase().then(() => {
  console.log(`Backend fut a porton: ${port}`);
  serve({ fetch: app.fetch, port });
});