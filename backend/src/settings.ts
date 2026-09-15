import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { users, invoices, auditLogs } from './db/schema.js';
import { getAuthUser } from './auth.js';

export const settingsRouter = new Hono();

settingsRouter.get('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  return c.json({
    success: true,
    settings: {
      szamlazzHuApiKey: user.szamlazzHuApiKey || '',
      navTechnicalUser: user.navTechnicalUser || '',
      navSignKey: user.navSignKey || '',
      navExchangeKey: user.navExchangeKey || ''
    }
  });
});

settingsRouter.post('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  try {
    const body = await c.req.json();
    
    await db.update(users)
      .set({
        szamlazzHuApiKey: body.szamlazzHuApiKey || null,
        navTechnicalUser: body.navTechnicalUser || null,
        navTechnicalPassword: body.navTechnicalPassword || user.navTechnicalPassword,
        navSignKey: body.navSignKey || null,
        navExchangeKey: body.navExchangeKey || null,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

settingsRouter.delete('/account', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  try {
    // 1. Töröljük a felhasználóhoz tartozó összes számlát (Hard delete, GDPR miatt a személyes adatokat tartalmazó számlákat is törölni kell)
    await db.delete(invoices).where(eq(invoices.userId, user.id));

    // 2. Anonimizáljuk a felhasználói fiókot (hogy az audit logok és a foreign key-ek ne törjenek el)
    await db.update(users)
      .set({
        email: `deleted_${crypto.randomUUID()}@deleted.local`,
        passwordHash: 'deleted',
        szamlazzHuApiKey: null,
        navTechnicalUser: null,
        navTechnicalPassword: null,
        navSignKey: null,
        navExchangeKey: null,
        resetToken: null,
        resetTokenExpiry: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id));

    // 3. Audit log (ez már az anonimizált user sorra hivatkozik, de az id ugyanaz marad)
    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'account_gdpr_deleted',
      details: { reason: 'user_requested_deletion', timestamp: new Date().toISOString() }
    });

    return c.json({ success: true });
  } catch (err: any) {
    console.error('Hiba a fiók törlésekor:', err);
    return c.json({ success: false, error: 'Szerverhiba történt a fiók törlése során.' }, 500);
  }
});

