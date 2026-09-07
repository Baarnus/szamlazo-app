// backend/src/auth.ts
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { users } from './db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'szamla-ai-secret-key-change-in-prod-2026';

const AuthSchema = z.object({
  email: z.string().email('Érvénytelen e-mail cím formátum.'),
  password: z.string().min(6, 'A jelszónak legalább 6 karakterből kell állnia.'),
});

export const authRouter = new Hono();

// 1. Regisztráció
authRouter.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = AuthSchema.safeParse(body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues[0]?.message || 'Érvénytelen adatok.';
      return c.json({ success: false, error: errorMsg }, 400);
    }

    const { email, password } = parsed.data;
    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
    if (existing.length > 0) {
      return c.json({ success: false, error: 'Ezzel az e-mail címmel már regisztráltak.' }, 400);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const insertedUsers = await db.insert(users).values({
      email: email.toLowerCase().trim(),
      passwordHash,
      monthlyCredits: 15,
      tier: 'free',
    }).returning();

    const newUser = insertedUsers[0];
    if (!newUser) {
      return c.json({ success: false, error: 'Nem sikerült létrehozni a felhasználót.' }, 500);
    }

    const token = await sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, 'HS256');

    return c.json({
      success: true,
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        credits: newUser.monthlyCredits,
        tier: newUser.tier,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});

// 2. Bejelentkezés
authRouter.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = AuthSchema.safeParse(body);
    if (!parsed.success) {
      const errorMsg = parsed.error.issues[0]?.message || 'Érvénytelen adatok.';
      return c.json({ success: false, error: errorMsg }, 400);
    }

    const { email, password } = parsed.data;
    const existingUsers = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
    const user = existingUsers[0];

    if (!user) {
      return c.json({ success: false, error: 'Hibás e-mail cím vagy jelszó.' }, 401);
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return c.json({ success: false, error: 'Hibás e-mail cím vagy jelszó.' }, 401);
    }

    const token = await sign({ id: user.id, email: user.email }, JWT_SECRET, 'HS256');

    return c.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        credits: user.monthlyCredits,
        tier: user.tier,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});

// 3. Jelenlegi felhasználó lekérése (Token alapján)
authRouter.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const token = authHeader.split(' ')[1] || '';
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as { id: string; email: string };
    
    if (!payload?.id) {
      return c.json({ success: false, error: 'Érvénytelen munkamenet.' }, 401);
    }

    const existingUsers = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
    const user = existingUsers[0];

    if (!user) {
      return c.json({ success: false, error: 'Felhasználó nem található.' }, 404);
    }

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        credits: user.monthlyCredits,
        tier: user.tier,
      },
    });
  } catch {
    return c.json({ success: false, error: 'Érvénytelen vagy lejárt munkamenet.' }, 401);
  }
});

// 4. Token ellenőrző segédfüggvény a védett végpontokhoz
export async function getAuthUser(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1] || '';
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as { id: string; email: string };
    if (!payload?.id) return null;

    const existingUsers = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
    return existingUsers[0] || null;
  } catch {
    return null;
  }
}