// backend/src/routes/parse.ts
// Számla feldolgozási végpontok: batch kép feldolgozás (SSE), szöveges prompt feldolgozás.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices, users } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import { processSingleInvoice, parseTextInvoiceWithGemini } from '../services/gemini.js';
import {
  InvoiceDataSchema,
  type InvoiceData,
  type ImageInputItem,
} from '@szamlazo/shared';

export const parseRouter = new Hono();

// ==========================================
// Batch kép feldolgozás SSE streameléssel
// ==========================================
parseRouter.post('/parse-batch-stream', async (c) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY hiányzik a szerveren.' }, 500);
  }

  // 1. Felhasználó azonosítása
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ error: 'A számlafeldolgozáshoz kérjük, jelentkezz be!' }, 401);
  }

  const body = await c.req.json<{ items: ImageInputItem[] }>();
  const items = body?.items || [];

  if (items.length === 0) {
    return c.json({ error: 'Nincs megadva feldolgozandó számla vagy dokumentum.' }, 400);
  }

  if (items.length > 10) {
    return c.json({ error: 'Egyszerre maximum 10 számla vagy dokumentum dolgozható fel.' }, 400);
  }

  // 2. ATOMI KREDITFOGLALÁS (Race condition védelem párhuzamos kérések esetén)
  const [reservedUser] = await db.update(users)
    .set({
      monthlyCredits: sql`${users.monthlyCredits} - ${items.length}`,
      updatedAt: new Date(),
    })
    .where(and(eq(users.id, user.id), gte(users.monthlyCredits, items.length)))
    .returning({ monthlyCredits: users.monthlyCredits });

  if (!reservedUser) {
    return c.json({
      error: `Nincs elegendő kredited! Szükséges: ${items.length}, Rendelkezésre áll: ${user.monthlyCredits}.`
    }, 402);
  }

  console.log(`\n🚀 [SSE BATCH INDÍTVA] Felhasználó: ${user.email} | ${items.length} db számla feldolgozása (kredit zárolva)...`);
  const startTime = Date.now();
  let finishedOrder = 0;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'start',
      data: JSON.stringify({
        total: items.length,
        currentCredits: reservedUser.monthlyCredits,
        remainingCredits: reservedUser.monthlyCredits,
      }),
    });

    const tasks = items.map(async (item, index) => {
      const itemStart = Date.now();
      const result = await processSingleInvoice(item, index, apiKey, user.id);

      finishedOrder++;
      const duration = ((Date.now() - itemStart) / 1000).toFixed(2);
      const invoiceName = result.success ? (result.data.kiallito_neve || result.source) : result.source;
      const statusIcon = result.success ? (result.isValid ? '✅' : '⚠️') : '❌';
      const dbIdStr = result.success && result.dbId ? result.dbId : 'N/A';

      console.log(`[#${finishedOrder}. elkészült] ${statusIcon} DB ID: ${dbIdStr} | Partner: "${invoiceName}" | Idő: ${duration}s`);

      await stream.writeSSE({
        event: 'invoice-parsed',
        data: JSON.stringify({
          ...result,
          finishedOrder,
          durationSeconds: duration
        }),
      });
      return result;
    });

    const results = await Promise.all(tasks);

    // 3. KREDIT VISSZATÉRÍTÉS a sikertelen feldolgozások után
    const successCount = results.filter((r) => r.success).length;
    const refundCount = items.length - successCount;
    let remainingCredits = reservedUser.monthlyCredits;

    if (refundCount > 0) {
      const [refundedUser] = await db.update(users)
        .set({
          monthlyCredits: sql`${users.monthlyCredits} + ${refundCount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning({ monthlyCredits: users.monthlyCredits });

      remainingCredits = refundedUser?.monthlyCredits ?? (reservedUser.monthlyCredits + refundCount);
      console.log(`ℹ️ [KREDIT VISSZATÉRÍTVE] ${refundCount} db sikertelen feldolgozás miatti visszatérítés megtörtént.`);
    }

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🏁 [SSE BATCH KÉSZ] Feldolgozva: ${successCount}/${items.length} sikeres. Levont kredit: ${successCount}. Idő: ${totalDuration}s\n`);

    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({
        success: true,
        totalDuration,
        consumedCredits: successCount,
        remainingCredits
      }),
    });
  });
});

// ==========================================
// Szöveges prompt feldolgozás (AI function calling)
// ==========================================
parseRouter.post('/invoices/parse-text', async (c) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return c.json({ success: false, error: 'GEMINI_API_KEY hiányzik a szerveren.' }, 500);

  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);

  const { textPrompt, isVoicePrompt } = await c.req.json();
  if (!textPrompt || typeof textPrompt !== 'string') {
    return c.json({ success: false, error: 'Szöveges utasítás hiányzik.' }, 400);
  }

  // ATOMI KREDITLEVONÁS (csak ha van legalább 1 kreditje)
  const [deductedUser] = await db.update(users)
    .set({ monthlyCredits: sql`${users.monthlyCredits} - 1`, updatedAt: new Date() })
    .where(and(eq(users.id, user.id), gte(users.monthlyCredits, 1)))
    .returning({ monthlyCredits: users.monthlyCredits });

  if (!deductedUser) {
    return c.json({ success: false, error: 'Nincs elegendő kredited a feldolgozáshoz.' }, 402);
  }

  let totalDeducted = 1;

  try {
    const sourceLabel = isVoicePrompt
      ? 'Hangüzenet (diktálás): ' + textPrompt
      : 'Szöveges prompt: ' + textPrompt;

    const invoicesArray = await parseTextInvoiceWithGemini(textPrompt, GEMINI_API_KEY.trim());

    // 1. Ha nem sikerült számlát kinyerni, visszatérítjük az 1 levont kreditet
    if (!invoicesArray || invoicesArray.length === 0) {
      await db.update(users)
        .set({ monthlyCredits: sql`${users.monthlyCredits} + 1`, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      return c.json({
        success: false,
        error: 'A megadott szövegből nem sikerült érvényes számlaadatokat kinyerni. A levont 1 kredit visszatérítésre került.'
      }, 422);
    }

    // 2. Ha több számlát kért a felhasználó (N > 1), a többlet kredit levonása
    let allowedInvoices = invoicesArray;
    const extraNeeded = invoicesArray.length - 1;
    if (extraNeeded > 0) {
      const [extraUser] = await db.update(users)
        .set({ monthlyCredits: sql`${users.monthlyCredits} - ${extraNeeded}`, updatedAt: new Date() })
        .where(and(eq(users.id, user.id), gte(users.monthlyCredits, extraNeeded)))
        .returning({ monthlyCredits: users.monthlyCredits });

      if (extraUser) {
        totalDeducted += extraNeeded;
      } else {
        // Nincs elég kredit az összes számlához: csak az 1. számlát készítjük el, amire volt kredit
        allowedInvoices = [invoicesArray[0]];
      }
    }

    const resultsToReturn = [];
    let idx = 0;
    for (const invData of allowedInvoices) {
      const zodResult = InvoiceDataSchema.safeParse(invData);
      const isValid = zodResult.success;
      const finalData = (isValid ? zodResult.data : invData) as InvoiceData;
      const errorMessages = !isValid ? zodResult.error.issues.map((issue) => issue.message) : [];

      const inserted = await db.insert(invoices).values({
        userId: user.id,
        source: sourceLabel,
        imageUrl: null,
        data: finalData,
        isValid: isValid,
        status: isValid ? 'processed' : 'needs_review',
      }).returning();

      resultsToReturn.push({
        index: idx++,
        dbId: inserted[0]?.id,
        source: sourceLabel,
        success: true,
        isValid,
        errors: errorMessages,
        data: finalData
      });
    }

    return c.json({
      success: true,
      consumedCredits: totalDeducted,
      results: resultsToReturn,
      result: resultsToReturn[0],
      warning: allowedInvoices.length < invoicesArray.length
        ? `Csak az első ${allowedInvoices.length} számla készült el kreditkeret hiányában.`
        : undefined
    });

  } catch (err: any) {
    // Hiba esetén visszaadjuk az összes felhasznált kreditet
    try {
      await db.update(users)
        .set({ monthlyCredits: sql`${users.monthlyCredits} + ${totalDeducted}`, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    } catch (refundErr) {
      console.error('Kredit visszatérítési hiba:', refundErr);
    }
    return c.json({ success: false, error: err.message }, 500);
  }
});
