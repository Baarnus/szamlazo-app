// backend/src/routes/worksheets.ts
// MesterMunkalap PWA API: munkalapok kezelése, fotó- és aláírásfeltöltés (MinIO),
// valamint 1-kattintásos konvertálás Számlázz.hu számlává.
import { Hono } from 'hono';
import { eq, and, desc, sql, ilike, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worksheets, invoices, users, type WorksheetRecord } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import { uploadInvoiceBuffer, getInvoiceImageUrl } from '../lib/s3.js';
import { WorksheetSchema, type InvoiceData } from '@szamlazo/shared';

export const worksheetsRouter = new Hono();

/**
 * Automatikus sorszám generálás az aktuális évre: pl. ML-2026-0001
 */
async function generateWorksheetNumber(userId: string): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `ML-${currentYear}-`;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(worksheets)
    .where(
      and(
        eq(worksheets.userId, userId),
        sql`${worksheets.worksheetNumber} LIKE ${prefix + '%'}`
      )
    );

  const nextNumber = Number(countResult?.count || 0) + 1;
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

/**
 * Fotók és aláírások presigned URL-jeinek feloldása a kliens számára
 */
async function resolveWorksheetUrls(ws: WorksheetRecord) {
  let resolvedSignatureUrl = ws.signatureUrl;
  if (ws.signatureUrl && !ws.signatureUrl.startsWith('http') && !ws.signatureUrl.startsWith('data:')) {
    try {
      resolvedSignatureUrl = await getInvoiceImageUrl(ws.signatureUrl);
    } catch {
      // Ha nem s3Key, meghagyjuk az eredetit
    }
  }

  const resolvedBeforePhotos = await Promise.all(
    (ws.beforePhotos || []).map(async (key) => {
      if (key && !key.startsWith('http') && !key.startsWith('data:')) {
        try {
          return await getInvoiceImageUrl(key);
        } catch {
          return key;
        }
      }
      return key;
    })
  );

  const resolvedAfterPhotos = await Promise.all(
    (ws.afterPhotos || []).map(async (key) => {
      if (key && !key.startsWith('http') && !key.startsWith('data:')) {
        try {
          return await getInvoiceImageUrl(key);
        } catch {
          return key;
        }
      }
      return key;
    })
  );

  return {
    ...ws,
    signatureUrl: resolvedSignatureUrl,
    beforePhotos: resolvedBeforePhotos,
    afterPhotos: resolvedAfterPhotos,
  };
}

// ==========================================
// 1. Munkalapok listázása
// ==========================================
worksheetsRouter.get('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const status = c.req.query('status');
  const q = c.req.query('q')?.trim().toLowerCase();

  const conditions = [eq(worksheets.userId, user.id)];

  if (status && status !== 'all') {
    conditions.push(eq(worksheets.status, status));
  }

  if (q) {
    const searchPattern = `%${q}%`;
    conditions.push(
      or(
        ilike(worksheets.clientName, searchPattern),
        ilike(worksheets.worksheetNumber, searchPattern),
        ilike(worksheets.clientCity, searchPattern),
        ilike(worksheets.deviceType, searchPattern),
        ilike(worksheets.description, searchPattern)
      )!
    );
  }

  const list = await db
    .select()
    .from(worksheets)
    .where(and(...conditions))
    .orderBy(desc(worksheets.createdAt))
    .limit(100);

  const resolvedList = await Promise.all(list.map((ws) => resolveWorksheetUrls(ws)));

  return c.json({
    success: true,
    worksheets: resolvedList,
  });
});

// ==========================================
// 2. Új munkalap létrehozása
// ==========================================
worksheetsRouter.post('/', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  try {
    const body = await c.req.json();
    const parsed = WorksheetSchema.parse(body);

    const worksheetNumber = await generateWorksheetNumber(user.id);

    const inserted = await db
      .insert(worksheets)
      .values({
        userId: user.id,
        worksheetNumber,
        clientName: parsed.clientName,
        clientTaxNumber: parsed.clientTaxNumber || null,
        clientZip: parsed.clientZip || null,
        clientCity: parsed.clientCity || null,
        clientAddress: parsed.clientAddress || null,
        clientEmail: parsed.clientEmail || null,
        clientPhone: parsed.clientPhone || null,
        deviceType: parsed.deviceType || null,
        description: parsed.description || '',
        items: parsed.items || [],
        beforePhotos: parsed.beforePhotos || [],
        afterPhotos: parsed.afterPhotos || [],
        signatureUrl: parsed.signatureUrl || null,
        signedAt: parsed.signatureUrl ? new Date() : null,
        status: parsed.signatureUrl ? 'signed' : (parsed.status || 'draft'),
      })
      .returning();

    const created = inserted[0];
    if (!created) {
      return c.json({ error: 'Munkalap létrehozása sikertelen.' }, 500);
    }
    const resolved = await resolveWorksheetUrls(created);

    return c.json({
      success: true,
      worksheet: resolved,
    }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Érvénytelen munkalap adatok' }, 400);
  }
});

// ==========================================
// 3. Munkalap lekérése azonosító alapján
// ==========================================
worksheetsRouter.get('/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const id = c.req.param('id');
  const [ws] = await db
    .select()
    .from(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
    .limit(1);

  if (!ws) {
    return c.json({ error: 'Munkalap nem található.' }, 404);
  }

  const resolved = await resolveWorksheetUrls(ws);
  return c.json({ success: true, worksheet: resolved });
});

// ==========================================
// 4. Munkalap módosítása / Aláírás mentése
// ==========================================
worksheetsRouter.patch('/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const id = c.req.param('id');
  const [existing] = await db
    .select()
    .from(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Munkalap nem található.' }, 404);
  }

  try {
    const body = await c.req.json();
    const updateData: Partial<typeof worksheets.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.clientName !== undefined) updateData.clientName = body.clientName;
    if (body.clientTaxNumber !== undefined) updateData.clientTaxNumber = body.clientTaxNumber;
    if (body.clientZip !== undefined) updateData.clientZip = body.clientZip;
    if (body.clientCity !== undefined) updateData.clientCity = body.clientCity;
    if (body.clientAddress !== undefined) updateData.clientAddress = body.clientAddress;
    if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail;
    if (body.clientPhone !== undefined) updateData.clientPhone = body.clientPhone;
    if (body.deviceType !== undefined) updateData.deviceType = body.deviceType;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.items !== undefined) updateData.items = body.items;
    if (body.beforePhotos !== undefined) updateData.beforePhotos = body.beforePhotos;
    if (body.afterPhotos !== undefined) updateData.afterPhotos = body.afterPhotos;
    if (body.status !== undefined) updateData.status = body.status;

    // Aláírás rögzítése
    if (body.signatureUrl !== undefined) {
      updateData.signatureUrl = body.signatureUrl;
      if (body.signatureUrl && !existing.signedAt) {
        updateData.signedAt = new Date();
        if (existing.status === 'draft') {
          updateData.status = 'signed';
        }
      }
    }

    const updated = await db
      .update(worksheets)
      .set(updateData)
      .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
      .returning();

    const updatedRecord = updated[0];
    if (!updatedRecord) {
      return c.json({ error: 'Munkalap módosítása sikertelen.' }, 404);
    }
    const resolved = await resolveWorksheetUrls(updatedRecord);
    return c.json({ success: true, worksheet: resolved });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// ==========================================
// 5. Munkalap törlése
// ==========================================
worksheetsRouter.delete('/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const id = c.req.param('id');
  const [existing] = await db
    .select()
    .from(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
    .limit(1);

  if (!existing) {
    return c.json({ error: 'Munkalap nem található.' }, 404);
  }

  await db
    .delete(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)));

  return c.json({ success: true, message: 'Munkalap sikeresen törölve.' });
});

// ==========================================
// 6. Munkalap Kép / Aláírás feltöltése MinIO-ba
// ==========================================
worksheetsRouter.post('/:id/upload-asset', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const id = c.req.param('id');
  const [ws] = await db
    .select()
    .from(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
    .limit(1);

  if (!ws) {
    return c.json({ error: 'Munkalap nem található.' }, 404);
  }

  try {
    const { base64Data, type, field } = await c.req.json<{
      base64Data: string;
      type: 'photo' | 'signature';
      field?: 'before' | 'after';
    }>();

    if (!base64Data) {
      return c.json({ error: 'Hiányzó képadat (base64).' }, 400);
    }

    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    const mimeType = (matches && matches[1]) ? matches[1] : 'image/png';
    const rawBase64 = (matches && matches[2]) ? matches[2] : base64Data;
    const buffer = Buffer.from(rawBase64, 'base64');

    const s3Key = await uploadInvoiceBuffer(buffer, mimeType, user.id);
    const presignedUrl = await getInvoiceImageUrl(s3Key);

    // Automatikusan hozzákapcsoljuk a munkalaphoz
    if (type === 'signature') {
      await db
        .update(worksheets)
        .set({
          signatureUrl: s3Key,
          signedAt: new Date(),
          status: ws.status === 'draft' ? 'signed' : ws.status,
          updatedAt: new Date(),
        })
        .where(eq(worksheets.id, id));
    } else if (type === 'photo') {
      if (field === 'before') {
        const current = ws.beforePhotos || [];
        await db
          .update(worksheets)
          .set({ beforePhotos: [...current, s3Key], updatedAt: new Date() })
          .where(eq(worksheets.id, id));
      } else {
        const current = ws.afterPhotos || [];
        await db
          .update(worksheets)
          .set({ afterPhotos: [...current, s3Key], updatedAt: new Date() })
          .where(eq(worksheets.id, id));
      }
    }

    return c.json({
      success: true,
      s3Key,
      url: presignedUrl,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// 7. A HÍD: Munkalap konvertálása Számlázz.hu számlává
// ==========================================
worksheetsRouter.post('/:id/to-invoice', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const id = c.req.param('id');
  const [ws] = await db
    .select()
    .from(worksheets)
    .where(and(eq(worksheets.id, id), eq(worksheets.userId, user.id)))
    .limit(1);

  if (!ws) {
    return c.json({ error: 'Munkalap nem található.' }, 404);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const dueDefaultIso = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Munkalap tételeinek átalakítása számlatételekké (alapértelmezett 27% áfával vagy cégprofil szerint)
  const items = (ws.items || []).map((item) => {
    const netto = Number(item.totalPrice || item.unitPrice * (item.quantity || 1));
    const afaRate = 27; // magyar normál kulcs
    const afaErtek = Math.round((netto * afaRate) / 100);
    const brutto = netto + afaErtek;

    return {
      megnevezes: item.name,
      mennyiseg: Number(item.quantity || 1),
      mennyisegi_egyseg: item.unit || 'db',
      egysegar: Number(item.unitPrice || netto),
      afa_szazalek: afaRate,
      netto_ar: netto,
      afa_ertek: afaErtek,
      brutto_ar: brutto,
    };
  });

  const vegosszegNetto = items.reduce((sum, t) => sum + t.netto_ar, 0);
  const vegosszegAfa = items.reduce((sum, t) => sum + (t.afa_ertek || 0), 0);
  const vegosszegBrutto = items.reduce((sum, t) => sum + t.brutto_ar, 0);

  const invoiceData: InvoiceData = {
    kiallito_neve: user.companyName || null,
    kiallito_adoszam: user.companyTaxNumber || null,
    kiallito_orszag: 'Magyarország',
    vevo_neve: ws.clientName,
    vevo_adoszam: ws.clientTaxNumber || null,
    vevo_orszag: 'Magyarország',
    vevo_iranyitoszam: ws.clientZip || null,
    vevo_telepules: ws.clientCity || null,
    vevo_cim: ws.clientAddress || null,
    vevo_email: ws.clientEmail || null,
    kelt_datum: todayIso,
    teljesites_datum: todayIso,
    fizetesi_hatarido: dueDefaultIso,
    fizetesi_mod: 'Átutalás',
    penznem: 'HUF',
    megjegyzes: `Hivatkozott munkalap: ${ws.worksheetNumber}. ${ws.description || ''}`.trim(),
    direction: 'outgoing',
    tipus: 'outgoing',
    tetelek: items,
    vegosszeg_netto: vegosszegNetto,
    vegosszeg_afa: vegosszegAfa,
    vegosszeg_brutto: vegosszegBrutto,
  };

  // Beillesztjük az invoices táblába
  const [createdInvoice] = await db
    .insert(invoices)
    .values({
      userId: user.id,
      source: `Munkalap: ${ws.worksheetNumber}`,
      imageUrl: ws.signatureUrl,
      data: invoiceData,
      isValid: true,
      status: 'needs_review',
    })
    .returning();

  if (!createdInvoice) {
    return c.json({ error: 'Számla létrehozása sikertelen.' }, 500);
  }

  // Munkalap frissítése: státusz 'invoiced', invoiceId hozzárendelése
  await db
    .update(worksheets)
    .set({
      status: 'invoiced',
      invoiceId: createdInvoice.id,
      updatedAt: new Date(),
    })
    .where(eq(worksheets.id, id));

  return c.json({
    success: true,
    invoiceId: createdInvoice.id,
    worksheetNumber: ws.worksheetNumber,
    invoiceData,
    message: `A(z) ${ws.worksheetNumber} munkalap sikeresen átadva a számlázónak!`,
  });
});
