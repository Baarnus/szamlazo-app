// backend/src/routes/partners.ts
// Partner Memória: a felhasználó korábbi számláiból ismert egyedi partnernevek lekérdezése.
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import type { InvoiceData } from '@szamlazo/shared';

export const partnersRouter = new Hono();

/**
 * GET /api/partners/suggest?q=keresési_szöveg
 *
 * A bejelentkezett felhasználó összes (nem törölt) számlájából összegyűjti az egyedi
 * vevo_neve és kiallito_neve értékeket, majd a `q` paraméter alapján szűri azokat.
 * Maximum 8 egyedi nevet ad vissza, névsor szerint rendezve.
 */
partnersRouter.get('/suggest', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  const q = (c.req.query('q') || '').trim().toLowerCase();
  if (q.length < 1) {
    return c.json({ success: true, partners: [] });
  }

  try {
    // Lekérdezzük az összes nem törölt számlát (csak az adatmezőt kell)
    const list = await db
      .select({ data: invoices.data })
      .from(invoices)
      .where(and(eq(invoices.userId, user.id), eq(invoices.isDeleted, false)))
      .limit(200); // Elegendő minta, nem kell az összes rekord

    // Egyedi partner adatok összegyűjtése és egyesítése a korábbi számlákból
    interface PartnerRecord {
      name: string;
      taxNumber: string | null;
      country: string | null;
      zip: string | null;
      city: string | null;
      address: string | null;
      email: string | null;
    }

    const partnerMap = new Map<string, PartnerRecord>();

    for (const row of list) {
      const data = row.data as InvoiceData;
      if (!data) continue;

      if (data.vevo_neve && typeof data.vevo_neve === 'string') {
        const name = data.vevo_neve.trim();
        if (name) {
          const key = name.toLowerCase();
          const existing = partnerMap.get(key);
          partnerMap.set(key, {
            name: existing?.name || name,
            taxNumber: data.vevo_adoszam ? String(data.vevo_adoszam).trim() : (existing?.taxNumber || null),
            country: data.vevo_orszag ? String(data.vevo_orszag).trim() : (existing?.country || 'Magyarország'),
            zip: data.vevo_iranyitoszam ? String(data.vevo_iranyitoszam).trim() : (existing?.zip || null),
            city: data.vevo_telepules ? String(data.vevo_telepules).trim() : (existing?.city || null),
            address: data.vevo_cim ? String(data.vevo_cim).trim() : (existing?.address || null),
            email: data.vevo_email ? String(data.vevo_email).trim() : (existing?.email || null),
          });
        }
      }

      if (data.kiallito_neve && typeof data.kiallito_neve === 'string') {
        const name = data.kiallito_neve.trim();
        if (name) {
          const key = name.toLowerCase();
          const existing = partnerMap.get(key);
          partnerMap.set(key, {
            name: existing?.name || name,
            taxNumber: data.kiallito_adoszam ? String(data.kiallito_adoszam).trim() : (existing?.taxNumber || null),
            country: data.kiallito_orszag ? String(data.kiallito_orszag).trim() : (existing?.country || 'Magyarország'),
            zip: existing?.zip || null,
            city: existing?.city || null,
            address: existing?.address || null,
            email: existing?.email || null,
          });
        }
      }
    }

    // Szűrés a keresési szöveg alapján, majd rendezés és limitálás
    const matches = [...partnerMap.values()]
      .filter((p) => p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Előre kerülnek azok, amelyek a keresési szóval kezdődnek
        const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.name.localeCompare(b.name, 'hu');
      })
      .slice(0, 8);

    return c.json({ success: true, partners: matches });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});
