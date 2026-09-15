// backend/src/index.ts
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import dotenv from 'dotenv';
import { z } from 'zod';
import { desc, eq, and, sql } from 'drizzle-orm';
import { db, initDatabase } from './db/index.js';
import { invoices, users, auditLogs } from './db/schema.js';
import { authRouter, getAuthUser } from './auth.js';
import { uploadInvoiceBuffer, getInvoiceImageUrl } from './lib/s3.js';
import { billingRouter } from './billing.js';
import { settingsRouter } from './settings.js';
import { szamlazzRouter } from './szamlazz-integration.js';
import type {
  InvoiceData,
  ImageInputItem,
  SingleInvoiceResult,
  BatchParseInvoiceResponse
} from '../../shared/types.js';

dotenv.config();

const app = new Hono();
app.use('/*', cors());

// Auth Router bekötése
app.route('/api/auth', authRouter);

// Stripe billing
app.route('/api/billing', billingRouter);

// Settings API
app.route('/api/settings', settingsRouter);

// Számlázz.hu API
app.route('/api/szamlazz', szamlazzRouter);

// ==========================================
// 1. ZOD SÉMÁK ÉS MATEMATIKAI VALIDÁCIÓ
// ==========================================

const InvoiceItemSchema = z.object({
  megnevezes: z.string().default('Ismeretlen tétel'),
  mennyiseg: z.coerce.number().default(1),
  egysegar: z.coerce.number().default(0),
  afa_szazalek: z.coerce.number().default(27),
  netto_ar: z.coerce.number().default(0),
  afa_ertek: z.coerce.number().optional().default(0),
  brutto_ar: z.coerce.number().default(0),
});

export const InvoiceDataSchema = z.object({
  kiallito_neve: z.string().nullable().optional(),
  kiallito_adoszam: z.string().nullable().optional(),
  kiallito_orszag: z.string().nullable().optional(),
  vevo_neve: z.string().nullable().optional(),
  vevo_adoszam: z.string().nullable().optional(),
  szamlaszam: z.string().nullable().optional(),
  kelt_datum: z.string().nullable().optional(),
  teljesites_datum: z.string().nullable().optional(),
  fizetesi_hatarido: z.string().nullable().optional(),
  penznem: z.string().default('HUF'),
  tetelek: z.array(InvoiceItemSchema).default([]),
  vegosszeg_netto: z.coerce.number().default(0),
  vegosszeg_afa: z.coerce.number().default(0),
  vegosszeg_brutto: z.coerce.number().default(0),
})
  .superRefine((data, ctx) => {
    const currency = data.penznem || 'HUF';

    const headerCalculatedGross = Number(data.vegosszeg_netto || 0) + Number(data.vegosszeg_afa || 0);
    if (Math.abs(headerCalculatedGross - Number(data.vegosszeg_brutto || 0)) > 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Fejléc ÁFA hiba: Nettó (${data.vegosszeg_netto}) + ÁFA (${data.vegosszeg_afa}) nem egyezik a Bruttó végösszeggel (${data.vegosszeg_brutto} ${currency}).`,
        path: ['vegosszeg_brutto'],
      });
    }

    if (data.tetelek && data.tetelek.length > 0) {
      const itemsGrossSum = data.tetelek.reduce((sum, item) => sum + Number(item.brutto_ar || 0), 0);
      if (Math.abs(itemsGrossSum - Number(data.vegosszeg_brutto || 0)) > 1.0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Összegzési eltérés: a tételek összege (${itemsGrossSum.toFixed(2)} ${currency}) nem egyezik a fejléc bruttójával (${data.vegosszeg_brutto} ${currency}).`,
          path: ['tetelek'],
        });
      }
    }
  });

// ==========================================
// 2. KÉP FELDOLGOZÁS & MINIO S3 TÁROLÁS
// ==========================================

async function resolveImageBuffer(item: ImageInputItem): Promise<{ buffer: Buffer; mimeType: string }> {
  if (item.type === 'base64') {
    const pureBase64 = (item.data.includes('base64,') ? item.data.split('base64,')[1] : item.data) || '';
    const buffer = Buffer.from(pureBase64, 'base64');
    return { buffer, mimeType: item.mimeType || 'image/jpeg' };
  }

  const response = await fetch(item.data, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Kép letöltési hiba: HTTP ${response.status} (${response.statusText}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const rawHeaderType = response.headers.get('content-type');
  let mimeType = rawHeaderType || item.mimeType || 'image/jpeg';
  if (mimeType.includes(';')) {
    mimeType = mimeType.split(';')[0]?.trim() || 'image/jpeg';
  }

  return { buffer, mimeType };
}

const prompt = `Elemezd a számlát (magyar vagy nemzetközi) és válaszolj KIZÁRÓLAG tiszta JSON formátumban!
Minden számérték tiszta lebegőpontos szám legyen (number, pl: 1250.50), devizajelek és ezres tagolás nélkül!
A pénznemet az ISO 4217 szabvány szerint add meg (pl: HUF, EUR, USD, GBP, CHF).

JSON struktúra:
{
  "kiallito_neve": "string vagy null",
  "kiallito_adoszam": "string vagy null",
  "kiallito_orszag": "ISO 2 betűs kód (pl. HU, DE, AT) vagy null",
  "vevo_neve": "string vagy null",
  "vevo_adoszam": "string vagy null",
  "szamlaszam": "string vagy null",
  "kelt_datum": "YYYY-MM-DD vagy null",
  "teljesites_datum": "YYYY-MM-DD vagy null",
  "fizetesi_hatarido": "YYYY-MM-DD vagy null",
  "penznem": "HUF | EUR | USD | GBP | CHF",
  "tetelek": [
    {
      "megnevezes": "string",
      "mennyiseg": number,
      "egysegar": number,
      "afa_szazalek": number,
      "netto_ar": number,
      "afa_ertek": number,
      "brutto_ar": number
    }
  ],
  "vegosszeg_netto": number,
  "vegosszeg_afa": number,
  "vegosszeg_brutto": number
}`;

async function processSingleInvoice(
  item: ImageInputItem, 
  index: number, 
  apiKey: string,
  userId?: string
): Promise<SingleInvoiceResult & { dbId?: string | undefined }> {
  const sourceLabel = item.type === 'url' ? item.data : `Feltöltött fájl #${index + 1}`;
  try {
    const { buffer, mimeType } = await resolveImageBuffer(item);
    const base64Data = buffer.toString('base64');

    // 1. Kép azonnali mentése a MinIO tárolóba
    let storedImageUrl = item.data;
    try {
      const s3Key = await uploadInvoiceBuffer(buffer, mimeType, userId);
      storedImageUrl = s3Key;
    } catch (s3Err: any) {
      console.warn('⚠️ MinIO mentési hiba, fallback helyi azonosítóra:', s3Err.message);
    }

    // 2. AI feldolgozás (Gemini)
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
          generationConfig: { response_mime_type: 'application/json', temperature: 0.1 },
        }),
      }
    );

    if (!geminiRes.ok) {
      throw new Error(`Gemini API hiba: ${await geminiRes.text()}`);
    }

    const resultJson: any = await geminiRes.json();
    const rawText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Nem érkezett kinyerhető szöveg a képről.');

    const parsedJson = JSON.parse(rawText);
    const zodResult = InvoiceDataSchema.safeParse(parsedJson);

    const isValid = zodResult.success;
    const finalData = (isValid ? zodResult.data : parsedJson) as InvoiceData;
    const errorMessages = !isValid ? zodResult.error.issues.map((issue) => issue.message) : [];

    // 3. PostgreSQL mentés
    let dbId: string | undefined;
    try {
      const inserted = await db.insert(invoices).values({
        userId: userId || null,
        source: sourceLabel,
        imageUrl: storedImageUrl,
        data: finalData,
        isValid: isValid,
        status: isValid ? 'processed' : 'needs_review',
      }).returning({ id: invoices.id });

      dbId = inserted[0]?.id;
    } catch (dbErr: any) {
      console.error('Adatbázis mentési hiba:', dbErr.message);
    }

    return {
      index,
      source: sourceLabel,
      success: true,
      isValid,
      errors: errorMessages,
      data: finalData,
      dbId,
    };
  } catch (err: any) {
    return {
      index,
      source: sourceLabel,
      success: false,
      isValid: false,
      errors: [err.message || 'Hiba a feldolgozás során.'],
    };
  }
}

// ==========================================
// 3. API VÉGPONTOK
// ==========================================

app.post('/api/parse-batch-stream', async (c) => {
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
    return c.json({ error: 'Nincs megadva feldolgozandó kép.' }, 400);
  }

  if (items.length > 10) {
    return c.json({ error: 'Egyszerre maximum 10 kép dolgozható fel.' }, 400);
  }

  // 2. Kredit egyenleg ellenőrzése
  if (user.monthlyCredits < items.length) {
    return c.json({
      error: `Nincs elegendő kredited! Szükséges: ${items.length}, Rendelkezésre áll: ${user.monthlyCredits}.`
    }, 402);
  }

  console.log(`\n🚀 [SSE BATCH INDÍTVA] Felhasználó: ${user.email} | ${items.length} db számla feldolgozása...`);
  const startTime = Date.now();
  let finishedOrder = 0;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'start',
      data: JSON.stringify({ total: items.length, currentCredits: user.monthlyCredits }),
    });

    const tasks = items.map(async (item, index) => {
      const itemStart = Date.now();
      const result = await processSingleInvoice(item, index, apiKey, user.id);

      finishedOrder++;
      const duration = ((Date.now() - itemStart) / 1000).toFixed(2);
      const invoiceName = result.data?.kiallito_neve || result.source;
      const statusIcon = result.success ? (result.isValid ? '✅' : '⚠️') : '❌';

      console.log(`[#${finishedOrder}. elkészült] ${statusIcon} DB ID: ${result.dbId || 'N/A'} | Partner: "${invoiceName}" | Idő: ${duration}s`);

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

    // 3. ATOMI KREDITLEVONÁS A VÉGÉN: Csak a sikeres feldolgozásokért vonunk le kreditet
    const successCount = results.filter((r) => r.success).length;
    let remainingCredits = user.monthlyCredits;

    if (successCount > 0) {
      const [updatedUser] = await db.update(users)
        .set({
          monthlyCredits: sql`${users.monthlyCredits} - ${successCount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning({ monthlyCredits: users.monthlyCredits });

      remainingCredits = updatedUser?.monthlyCredits ?? (user.monthlyCredits - successCount);
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

app.post('/api/invoices/parse-text', async (c) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return c.json({ success: false, error: 'GEMINI_API_KEY hiányzik a szerveren.' }, 500);

  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);

  if (user.monthlyCredits <= 0) {
    return c.json({ success: false, error: 'Nincs elég kredited.' }, 403);
  }

  try {
    const { textPrompt } = await c.req.json();
    if (!textPrompt || typeof textPrompt !== 'string') {
      return c.json({ success: false, error: 'Szöveges utasítás hiányzik.' }, 400);
    }

    // 1 kredit levonás
    await db.update(users)
      .set({ monthlyCredits: sql`${users.monthlyCredits} - 1`, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY.trim()
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Te egy szigorú számlázási asszisztens vagy. A feladatod KIZÁRÓLAG számla adatok strukturált kinyerése. Ha a felhasználó több számlát is kér, mindet külön objektumként add vissza az array-ben. Ha a felhasználó bármi mást (pl. verset, kódolást) kér, tagadd meg és írj egy hibaüzenetet."
            }]
          },
          contents: [{ parts: [{ text: textPrompt }] }],
          tools: [{
            functionDeclarations: [{
              name: "create_invoices_data",
              description: "Kinyeri és előkészíti a számla vagy SZÁMLÁK kibocsátásához szükséges adatokat a felhasználó szövegéből.",
              parameters: {
                type: "OBJECT",
                properties: {
                  invoices: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        kiallito_neve: { type: "STRING" },
                        kiallito_adoszam: { type: "STRING" },
                        kiallito_orszag: { type: "STRING" },
                        vevo_neve: { type: "STRING" },
                        vevo_adoszam: { type: "STRING" },
                        szamlaszam: { type: "STRING" },
                        kelt_datum: { type: "STRING" },
                        teljesites_datum: { type: "STRING" },
                        fizetesi_hatarido: { type: "STRING" },
                        penznem: { type: "STRING" },
                        tetelek: {
                          type: "ARRAY",
                          items: {
                            type: "OBJECT",
                            properties: {
                              megnevezes: { type: "STRING" },
                              mennyiseg: { type: "NUMBER" },
                              egysegar: { type: "NUMBER" },
                              afa_szazalek: { type: "NUMBER" },
                              netto_ar: { type: "NUMBER" },
                              afa_ertek: { type: "NUMBER" },
                              brutto_ar: { type: "NUMBER" }
                            }
                          }
                        },
                        vegosszeg_netto: { type: "NUMBER" },
                        vegosszeg_afa: { type: "NUMBER" },
                        vegosszeg_brutto: { type: "NUMBER" }
                      }
                    }
                  }
                },
                required: ["invoices"]
              }
            }]
          }],
          toolConfig: {
            functionCallingConfig: {
              mode: "AUTO"
            }
          },
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    if (!geminiRes.ok) throw new Error(`Gemini API hiba: ${await geminiRes.text()}`);
    
    const resultJson: any = await geminiRes.json();
    
    const call = resultJson.candidates?.[0]?.content?.parts?.[0]?.functionCall;
    if (!call || call.name !== 'create_invoices_data') {
       throw new Error('Az AI megtagadta a kérést. Kérlek, csak számlázással kapcsolatos utasításokat adj meg!');
    }

    const invoicesArray = call.args.invoices || [];
    const resultsToReturn = [];
    
    let idx = 0;
    for (const invData of invoicesArray) {
      const zodResult = InvoiceDataSchema.safeParse(invData);
      const isValid = zodResult.success;
      const finalData = (isValid ? zodResult.data : invData) as InvoiceData;
      const errorMessages = !isValid ? zodResult.error.issues.map((issue) => issue.message) : [];

      const inserted = await db.insert(invoices).values({
        userId: user.id,
        source: 'Szöveges prompt: ' + textPrompt,
        imageUrl: null,
        data: finalData,
        isValid: isValid,
        status: isValid ? 'processed' : 'needs_review',
      }).returning();

      resultsToReturn.push({
        index: idx++,
        dbId: inserted[0]?.id,
        source: 'Szöveges Asszisztens',
        success: true,
        isValid,
        errors: errorMessages,
        data: finalData
      });
    }

    return c.json({
      success: true,
      results: resultsToReturn
    });

  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// A számlák lekérdezése (a MinIO s3Key-ekből ideiglenes aláírt URL generálásával)
app.get('/api/invoices', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const list = await db.select()
      .from(invoices)
      .where(and(eq(invoices.userId, user.id), eq(invoices.isDeleted, false)))
      .orderBy(desc(invoices.createdAt))
      .limit(50);

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

    return c.json({ success: true, count: invoicesWithUrls.length, invoices: invoicesWithUrls });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// SZÁMLA TÖRLÉSE (SOFT DELETE)
// ==========================================
app.delete('/api/invoices/:id', async (c) => {
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

// ==========================================
// KÖNYVELŐBARÁT CSV EXPORT VÉGPONT
// ==========================================
app.get('/api/invoices/export/csv', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const list = await db.select()
      .from(invoices)
      .where(eq(invoices.userId, user.id))
      .orderBy(desc(invoices.createdAt));

    const formatNumberForExcel = (num: number | undefined | null): string => {
      if (num === undefined || num === null || isNaN(Number(num))) return '0';
      return String(num).replace('.', ',');
    };

    const cleanField = (val: string | undefined | null): string => {
      if (!val) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    const headers = [
      'Számlaszám',
      'Kiállító',
      'Kiállító Adószám',
      'Ország',
      'Vevő',
      'Vevő Adószám',
      'Kelt',
      'Teljesítés Dátum',
      'Fizetési Határidő',
      'Pénznem',
      'Tétel Megnevezés',
      'Mennyiség',
      'Egységár',
      'Áfa %',
      'Tétel Nettó',
      'Tétel Áfa',
      'Tétel Bruttó',
      'Számla Végösszeg Nettó',
      'Számla Végösszeg Áfa',
      'Számla Végösszeg Bruttó',
      'Státusz',
      'Feltöltés Időpontja'
    ];

    const rows: string[] = [];

    for (const inv of list) {
      const d = inv.data as InvoiceData;
      if (!d) continue;

      const currency = d.penznem || 'HUF';
      const statusLabel = inv.isValid ? 'Érvényes' : 'Összegzési eltérés';
      const createdAtFormatted = inv.createdAt ? new Date(inv.createdAt).toISOString().slice(0, 10) : '';

      const baseCols = [
        cleanField(d.szamlaszam),
        cleanField(d.kiallito_neve),
        cleanField(d.kiallito_adoszam),
        cleanField(d.kiallito_orszag || 'HU'),
        cleanField(d.vevo_neve),
        cleanField(d.vevo_adoszam),
        cleanField(d.kelt_datum),
        cleanField(d.teljesites_datum),
        cleanField(d.fizetesi_hatarido),
        cleanField(currency)
      ];

      const totalsCols = [
        formatNumberForExcel(d.vegosszeg_netto),
        formatNumberForExcel(d.vegosszeg_afa),
        formatNumberForExcel(d.vegosszeg_brutto),
        cleanField(statusLabel),
        cleanField(createdAtFormatted)
      ];

      if (d.tetelek && d.tetelek.length > 0) {
        for (const item of d.tetelek) {
          const itemNetto = item.netto_ar !== undefined && item.netto_ar !== null
            ? item.netto_ar
            : (Number(item.mennyiseg || 1) * Number(item.egysegar || 0));

          const itemAfa = item.afa_ertek !== undefined && item.afa_ertek !== null
            ? item.afa_ertek
            : (Number(item.brutto_ar || 0) - Number(itemNetto || 0));

          const itemCols = [
            cleanField(item.megnevezes),
            formatNumberForExcel(item.mennyiseg || 1),
            formatNumberForExcel(item.egysegar || 0),
            formatNumberForExcel(item.afa_szazalek !== undefined ? item.afa_szazalek : 27),
            formatNumberForExcel(itemNetto),
            formatNumberForExcel(itemAfa),
            formatNumberForExcel(item.brutto_ar || 0)
          ];

          rows.push([...baseCols, ...itemCols, ...totalsCols].join(';'));
        }
      } else {
        const fallbackItemCols = [
          cleanField('Számla végösszeg'),
          '1',
          formatNumberForExcel(d.vegosszeg_netto),
          formatNumberForExcel(27),
          formatNumberForExcel(d.vegosszeg_netto),
          formatNumberForExcel(d.vegosszeg_afa),
          formatNumberForExcel(d.vegosszeg_brutto)
        ];

        rows.push([...baseCols, ...fallbackItemCols, ...totalsCols].join(';'));
      }
    }

    // UTF-8 BOM (\uFEFF) az Excel ékezetkompatibilitáshoz
    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const today = new Date().toISOString().slice(0, 10);

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="szamlak_export_${today}.csv"`,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Számla javítása a Split View-ból
app.patch('/api/invoices/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ data: InvoiceData; isValid?: boolean }>();

    if (!body.data) {
      return c.json({ success: false, error: 'Hiányzó számlaadatok.' }, 400);
    }

    await db.update(invoices)
      .set({
        data: body.data,
        isValid: body.isValid !== undefined ? body.isValid : true,
        status: 'reviewed',
        updatedAt: new Date(),
      })
      .where(and(eq(invoices.id, id), eq(invoices.userId, user.id)));

    return c.json({ success: true, message: 'Számla sikeresen frissítve az adatbázisban.' });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

const port = Number(process.env.PORT) || 3000;
initDatabase().then(() => {
  console.log(`Backend fut a porton: ${port}`);
  serve({ fetch: app.fetch, port });
});