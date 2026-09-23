// backend/src/index.ts
// Alkalmazás belépési pont — csak app init, middleware, router mount-ok és szerver indítás.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
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
import { worksheetsRouter } from './routes/worksheets.js';
import { createRateLimiter } from './middlewares/rate-limiter.js';

// Re-export a schema-t a visszafelé kompatibilitás kedvéért
export { InvoiceDataSchema } from '@szamlazo/shared';

dotenv.config();

export const app = new Hono();

// Szigorú CORS beállítás: konfigurálható whitelist, dev fallback
const rawAllowed = process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:4321,http://127.0.0.1:4321';
const allowedOrigins = rawAllowed.split(',').map((s) => s.trim().replace(/\/$/, ''));

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return allowedOrigins[0] || '*';
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return origin;
    }
    // Fejlesztői és teszt módban engedélyezzük a helyi portokat
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return origin;
    }
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-test-bypass-rate-limit'],
  credentials: true,
}));

// Kérésméret korlátozás (Memory DoS / Buffer overflow védelem)
app.use('/*', bodyLimit({
  maxSize: 30 * 1024 * 1024, // 30 MB globális maximum (10 db base64 kép kényelmesen elfér)
  onError: (c) => {
    return c.json({ success: false, error: 'A kérés mérete meghaladja a megengedett 30 MB-os felső határt!' }, 413);
  }
}));

// Rate limiterek
export const authLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Túl sok próbálkozás az azonosítási végpontokon. Kérjük, próbáld újra egy perc múlva!',
  skip: (c) => process.env.NODE_ENV === 'test' && c.req.header('x-test-bypass-rate-limit') === 'true',
});

export const parseLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Túl sok számlafeldolgozási kérés érkezett rövid időn belül. Kérjük, várj egy percet!',
  skip: (c) => process.env.NODE_ENV === 'test' && c.req.header('x-test-bypass-rate-limit') === 'true',
});

app.use('/api/auth/*', authLimiter);
app.use('/api/parse-batch-stream', parseLimiter);
app.use('/api/invoices/parse-text', parseLimiter);

// Router-ek bekötése
app.route('/api/auth', authRouter);
app.route('/api/billing', billingRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/szamlazz', szamlazzRouter);
app.route('/api/invoices', invoicesRouter);
app.route('/api/invoices/export', exportRouter);
app.route('/api/partners', partnersRouter);
app.route('/api/worksheets', worksheetsRouter);
app.route('/api', parseRouter);

// Globális 404 kezelő
app.notFound((c) => {
  return c.json({ success: false, error: 'A kért útvonal nem található.' }, 404);
});

// Globális 500 hibakezelő (nem szivárogtat ki belső stack trace-t élesben)
app.onError((err, c) => {
  console.error('🚨 [Szerverhiba]:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  return c.json(
    {
      success: false,
      error: isDev ? (err.message || 'Ismeretlen hiba történt.') : 'Belső szerverhiba történt. Kérjük, próbáld újra később.',
      ...(isDev && err.stack ? { stack: err.stack } : {}),
    },
    500
  );
});

const port = Number(process.env.PORT) || 3000;
if (process.env.NODE_ENV !== 'test') {
  initDatabase().then(() => {
    console.log(`Backend fut a porton: ${port}`);
    serve({ fetch: app.fetch, port });
  });
}