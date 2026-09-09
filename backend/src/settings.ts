import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { users } from './db/schema.js';
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

