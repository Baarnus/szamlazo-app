// backend/src/routes/invoices.ts
// Számla CRUD végpontok: lista, soft delete, szerkesztés.
import { Hono } from 'hono';
import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices, auditLogs } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import { getInvoiceImageUrl } from '../lib/s3.js';
import { InvoiceDataSchema } from '../schemas/invoice.js';
import type { InvoiceData } from '../../../shared/types.js';

export const invoicesRouter = new Hono();

// Számlák lekérdezése (a MinIO s3Key-ekből ideiglenes aláírt URL generálásával, lapozással)
invoicesRouter.get('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const limitQuery = Number(c.req.query('limit')) || 50;
    const offsetQuery = Number(c.req.query('offset')) || 0;
    const safeLimit = Math.min(Math.max(limitQuery, 1), 200);

    const list = await db.select()
      .from(invoices)
      .where(and(eq(invoices.userId, user.id), eq(invoices.isDeleted, false)))
      .orderBy(desc(invoices.createdAt))
      .limit(safeLimit)
      .offset(offsetQuery);

    const invoicesWithUrls = await Promise.all(
      list.map(async (inv) => {
        let displayUrl = inv.imageUrl;
        if (inv.imageUrl && !inv.imageUrl.startsWith('data:') && !inv.imageUrl.startsWith('http')) {
          try {
            displayUrl = await getInvoiceImageUrl(inv.imageUrl);
          } catch {
            displayUrl = inv.imageUrl;
          }
        }
        return { ...inv, imageUrl: displayUrl };
      })
    );

    return c.json({
      success: true,
      count: invoicesWithUrls.length,
      limit: safeLimit,
      offset: offsetQuery,
      invoices: invoicesWithUrls,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Számla törlése (soft delete)
invoicesRouter.delete('/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  const invoiceId = c.req.param('id');
  
  try {
    const [existing] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, user.id)));
      
    if (!existing) {
      return c.json({ success: false, error: 'Számla nem található vagy nincs jogosultságod hozzá.' }, 404);
    }

    await db.update(invoices)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    await db.insert(auditLogs).values({
      userId: user.id,
      action: 'invoice_soft_delete',
      details: { invoiceId, originalStatus: existing.status }
    });

    return c.json({ success: true, message: 'Számla sikeresen (soft) törölve.' });
  } catch (error) {
    console.error('Hiba a törlés során:', error);
    return c.json({ success: false, error: 'Belső szerverhiba' }, 500);
  }
});

// Számla javítása a Split View-ból (validációval)
invoicesRouter.patch('/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ data: unknown; isValid?: boolean }>();

    if (!body.data) {
      return c.json({ success: false, error: 'Hiányzó számlaadatok.' }, 400);
    }

    const validation = InvoiceDataSchema.safeParse(body.data);
    const isValid = validation.success;
    const cleanData = (isValid ? validation.data : body.data) as InvoiceData;

    await db.update(invoices)
      .set({
        data: cleanData,
        isValid: body.isValid !== undefined ? body.isValid : isValid,
        status: isValid ? 'reviewed' : 'needs_review',
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.userId, user.id)));

    return c.json({
      success: true,
      isValid,
      errors: !isValid ? validation.error.issues.map((i) => i.message) : [],
      message: 'Számla sikeresen frissítve az adatbázisban.'
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
