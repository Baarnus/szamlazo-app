// backend/src/routes/partners.ts
// Partner Memória: a felhasználó korábbi számláiból ismert egyedi partnernevek lekérdezése.
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import type { InvoiceData } from '../../../shared/types.js';

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

    // Egyedi partnernevek összegyűjtése mindkét mezőből
    const nameSet = new Set<string>();
    for (const row of list) {
      const data = row.data as InvoiceData;
      if (data?.vevo_neve && typeof data.vevo_neve === 'string') {
        nameSet.add(data.vevo_neve.trim());
      }
      if (data?.kiallito_neve && typeof data.kiallito_neve === 'string') {
        nameSet.add(data.kiallito_neve.trim());
      }
    }

    // Szűrés a keresési szöveg alapján, majd rendezés és limitálás
    const matches = [...nameSet]
      .filter((name) => name.toLowerCase().includes(q))
      .sort((a, b) => {
        // Előre kerülnek azok, amelyek a keresési szóval kezdődnek
        const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b, 'hu');
      })
      .slice(0, 8);

    return c.json({ success: true, partners: matches });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Szerverhiba.' }, 500);
  }
});
