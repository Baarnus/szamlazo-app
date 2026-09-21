import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { users, invoices, auditLogs } from './db/schema.js';
import { getAuthUser } from './auth.js';
import { encrypt, decrypt } from './lib/crypto.js';
import { deleteUserS3Folder } from './lib/s3.js';

export const settingsRouter = new Hono();

/**
 * Maszkolja a titkos kulcsokat a kliens felé küldés előtt.
 * Csak az első 4 és utolsó 4 karaktert hagyja meg, a köztes részt kitakarja.
 */
function maskSecret(val: string | null | undefined): string {
  if (!val) return '';
  const decrypted = decrypt(val);
  if (!decrypted) return '';
  if (decrypted.length <= 8) return '••••••••';
  return `${decrypted.slice(0, 4)}••••••••${decrypted.slice(-4)}`;
}

/**
 * Eldönti, hogy új titkosítandó érték érkezett-e:
 * - Ha undefined: nem változott, megtartjuk a jelenlegit.
 * - Ha üres string vagy null: a felhasználó törölni akarta a kulcsot.
 * - Ha tartalmaz '••••'-t: a maszkolt értéket küldte vissza a form változtatás nélkül, megtartjuk a jelenlegit.
 * - Ha új szöveg: titkosítjuk és mentjük.
 */
function resolveEncryptedValue(newVal: unknown, currentVal: string | null | undefined): string | null | undefined {
  if (newVal === undefined) return currentVal;
  if (newVal === null || newVal === '') return null;
  if (typeof newVal === 'string' && newVal.includes('••••')) return currentVal;
  return encrypt(String(newVal).trim());
}

settingsRouter.get('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  return c.json({
    success: true,
    settings: {
      hasSzamlazzHuApiKey: Boolean(user.szamlazzHuApiKey),
      szamlazzHuApiKey: maskSecret(user.szamlazzHuApiKey),
      navTechnicalUser: user.navTechnicalUser || '',
      hasNavTechnicalPassword: Boolean(user.navTechnicalPassword),
      hasNavSignKey: Boolean(user.navSignKey),
      navSignKey: maskSecret(user.navSignKey),
      hasNavExchangeKey: Boolean(user.navExchangeKey),
      navExchangeKey: maskSecret(user.navExchangeKey),
      companyName: user.companyName || '',
      companyTaxNumber: user.companyTaxNumber || ''
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
        szamlazzHuApiKey: resolveEncryptedValue(body.szamlazzHuApiKey, user.szamlazzHuApiKey),
        navTechnicalUser: body.navTechnicalUser !== undefined ? (body.navTechnicalUser ? String(body.navTechnicalUser).trim() : null) : user.navTechnicalUser,
        navTechnicalPassword: resolveEncryptedValue(body.navTechnicalPassword, user.navTechnicalPassword),
        navSignKey: resolveEncryptedValue(body.navSignKey, user.navSignKey),
        navExchangeKey: resolveEncryptedValue(body.navExchangeKey, user.navExchangeKey),
        companyName: body.companyName !== undefined ? (body.companyName ? String(body.companyName).trim() : null) : user.companyName,
        companyTaxNumber: body.companyTaxNumber !== undefined ? (body.companyTaxNumber ? String(body.companyTaxNumber).trim() : null) : user.companyTaxNumber,
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
    await db.transaction(async (tx) => {
      // 1. Töröljük a felhasználóhoz tartozó összes számlát (Hard delete, GDPR)
      await tx.delete(invoices).where(eq(invoices.userId, user.id));

      // 2. Anonimizáljuk a felhasználói fiókot
      await tx.update(users)
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

      // 3. Audit log rekord készítése
      await tx.insert(auditLogs).values({
        userId: user.id,
        action: 'account_gdpr_deleted',
        details: { reason: 'user_requested_deletion', timestamp: new Date().toISOString() }
      });
    });

    // 4. Fizikai számlaképek és fájlok törlése S3 / MinIO tárolóból (GDPR)
    await deleteUserS3Folder(user.id);

    return c.json({ success: true, message: 'A fiók és a kapcsolódó adatok sikeresen törölve lettek.' });
  } catch (err: any) {
    console.error('Hiba a fiók törlésekor:', err);
    return c.json({ success: false, error: 'Szerverhiba történt a fiók törlése során.' }, 500);
  }
});

