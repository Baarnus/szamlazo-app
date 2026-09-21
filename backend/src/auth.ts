// backend/src/auth.ts
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { users } from './db/schema.js';

let _jwtSecret: string | null = null;
function getJwtSecret(): string {
  if (!_jwtSecret) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('KRITIKUS HIBA: JWT_SECRET környezeti változó nincs beállítva! Az alkalmazás nem indulhat el nélküle.');
    }
    _jwtSecret = secret;
  }
  return _jwtSecret;
}

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

    const token = await sign({ id: newUser.id, email: newUser.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, getJwtSecret(), 'HS256');

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

    const token = await sign({ id: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 }, getJwtSecret(), 'HS256');

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
    const payload = (await verify(token, getJwtSecret(), 'HS256')) as { id: string; email: string };
    
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
// 4. Elfelejtett jelszó (Forgot Password)
authRouter.post('/forgot-password', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.email) {
      return c.json({ success: false, error: 'E-mail cím megadása kötelező.' }, 400);
    }
    
    const email = body.email.toLowerCase().trim();
    const existingUsers = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = existingUsers[0];
    
    if (!user) {
      // Biztonsági okokból nem áruljuk el, hogy nincs ilyen e-mail (enumerációs támadás védelem)
      return c.json({ success: true });
    }
    
    const resetToken = crypto.randomUUID();
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1 óra érvényesség
    
    await db.update(users)
      .set({ resetToken, resetTokenExpiry: expiry })
      .where(eq(users.id, user.id));
      
    // Biztonságos link generálása a konfigurált FRONTEND_URL alapján (Host header injection / poisoning védelem)
    const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:4321').replace(/\/+$/, '');
    const resetLink = `${frontendBaseUrl}/?resetToken=${resetToken}`;
    
    // Email küldése Resend API-val
    if (!process.env.RESEND_API_KEY) {
      throw new Error('A RESEND_API_KEY környezeti változó nincs beállítva!');
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'Számla AI <info@szamlazzjol.hu>',
        to: email,
        subject: 'Új jelszó beállítása - Számla AI',
        html: `
          <h2>Jelszó visszaállítása</h2>
          <p>Kattints az alábbi linkre a jelszavad megváltoztatásához (a link 1 óráig érvényes):</p>
          <a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#007bff;color:#fff;text-decoration:none;border-radius:5px;">Új jelszó beállítása</a>
          <br><br>
          <p>Ha a gomb nem működik, másold be ezt a linket a böngésződbe:</p>
          <p>${resetLink}</p>
        `
      })
    });
    
    if (!resendRes.ok) {
      console.error('Resend API hiba:', await resendRes.text());
      return c.json({ success: false, error: 'Nem sikerült kiküldeni az e-mailt.' }, 500);
    }
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});

// 5. Új jelszó megadása (Reset Password)
authRouter.post('/reset-password', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.token || !body.newPassword) {
      return c.json({ success: false, error: 'Hiányzó adatok.' }, 400);
    }

    if (body.newPassword.length < 6) {
      return c.json({ success: false, error: 'A jelszónak legalább 6 karakterből kell állnia.' }, 400);
    }

    // Keresés token alapján
    const existingUsers = await db.select().from(users).where(eq(users.resetToken, body.token)).limit(1);
    const user = existingUsers[0];

    if (!user || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
      return c.json({ success: false, error: 'A jelszó-visszaállító link érvénytelen vagy lejárt.' }, 400);
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 10);

    // Új jelszó mentése és token törlése
    await db.update(users)
      .set({ 
        passwordHash, 
        resetToken: null, 
        resetTokenExpiry: null 
      })
      .where(eq(users.id, user.id));

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});

// 6. Token ellenőrző segédfüggvény a védett végpontokhoz
export async function getAuthUser(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const token = authHeader.split(' ')[1] || '';
    const payload = (await verify(token, getJwtSecret(), 'HS256')) as { id: string; email: string };
    if (!payload?.id) return null;

    const existingUsers = await db.select().from(users).where(eq(users.id, payload.id)).limit(1);
    return existingUsers[0] || null;
  } catch {
    return null;
  }
}