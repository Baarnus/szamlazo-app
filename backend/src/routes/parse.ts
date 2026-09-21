// backend/src/routes/parse.ts
// Számla feldolgozási végpontok: batch kép feldolgozás (SSE), szöveges prompt feldolgozás.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices, users } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import { processSingleInvoice } from '../services/gemini.js';
import { InvoiceDataSchema } from '../schemas/invoice.js';
import type {
  InvoiceData,
  ImageInputItem,
} from '../../../shared/types.js';

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

// ==========================================
// Szöveges prompt feldolgozás (AI function calling)
// ==========================================
parseRouter.post('/invoices/parse-text', async (c) => {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return c.json({ success: false, error: 'GEMINI_API_KEY hiányzik a szerveren.' }, 500);

  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);

  if (user.monthlyCredits <= 0) {
    return c.json({ success: false, error: 'Nincs elég kredited.' }, 403);
  }

  try {
    const { textPrompt, isVoicePrompt } = await c.req.json();
    if (!textPrompt || typeof textPrompt !== 'string') {
      return c.json({ success: false, error: 'Szöveges utasítás hiányzik.' }, 400);
    }

    // 1 kredit levonás
    await db.update(users)
      .set({ monthlyCredits: sql`${users.monthlyCredits} - 1`, updatedAt: new Date() })
      .where(eq(users.id, user.id));

    const sourceLabel = isVoicePrompt
      ? 'Hangüzenet (diktálás): ' + textPrompt
      : 'Szöveges prompt: ' + textPrompt;

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
              text: `Te egy precíz magyar és nemzetközi számlázási asszisztens vagy. A feladatod számla adatok strukturált kinyerése a megadott utasításból.
Szabályok:
1. Pénznem alapértelmezetten "HUF", ha nincs más megadva.
2. Ha a felhasználó egy céget vagy személyt említ (pl. "Kovács Kft-nek", "Kovács Kft"), az általában a vevő (vevo_neve). Ha a kiállító nem ismert, hagyd nullán.
3. Dátumok formátuma: YYYY-MM-DD. Ha dátum szerepel a szövegben, töltsd ki a kelt_datum, teljesites_datum és fizetesi_hatarido mezőket.
4. TÉTELEK ÉS ÁFA: Minden tételhez KÖTELEZŐ kiszámolni az egysegar, afa_szazalek, netto_ar, afa_ertek és brutto_ar mezőket. Ha nincs külön ÁFA megadva, alapértelmezett magyar ÁFA kulcs: 27 (vagy 0, ha a szöveg áfamentességet említ).
5. VÉGÖSSZEGEK: A vegosszeg_netto a tételek nettó összege, a vegosszeg_afa az ÁFA értékek összege, a vegosszeg_brutto pedig vegosszeg_netto + vegosszeg_afa. Soha ne hagyj 0 Ft-os bruttót, ha van nettó összeg!
Ha a felhasználó több számlát is kér, mindet külön objektumként add vissza az invoices tömbben.`
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
                        kiallito_neve: { type: "STRING", description: "Számla kiállítója, vagy null ha ismeretlen" },
                        kiallito_adoszam: { type: "STRING" },
                        kiallito_orszag: { type: "STRING" },
                        vevo_neve: { type: "STRING", description: "Vevő vagy ügyfél neve, akinek a számla készül" },
                        vevo_adoszam: { type: "STRING" },
                        szamlaszam: { type: "STRING" },
                        kelt_datum: { type: "STRING", description: "YYYY-MM-DD" },
                        teljesites_datum: { type: "STRING", description: "YYYY-MM-DD" },
                        fizetesi_hatarido: { type: "STRING", description: "YYYY-MM-DD" },
                        penznem: { type: "STRING", description: "ISO devizakód, pl. HUF, EUR" },
                        tetelek: {
                          type: "ARRAY",
                          items: {
                            type: "OBJECT",
                            properties: {
                              megnevezes: { type: "STRING" },
                              mennyiseg: { type: "NUMBER" },
                              egysegar: { type: "NUMBER" },
                              afa_szazalek: { type: "NUMBER", description: "Áfa százalék számmal, pl. 27 vagy 0" },
                              netto_ar: { type: "NUMBER" },
                              afa_ertek: { type: "NUMBER" },
                              brutto_ar: { type: "NUMBER" }
                            },
                            required: ["megnevezes", "mennyiseg", "egysegar", "afa_szazalek", "netto_ar", "brutto_ar"]
                          }
                        },
                        vegosszeg_netto: { type: "NUMBER" },
                        vegosszeg_afa: { type: "NUMBER" },
                        vegosszeg_brutto: { type: "NUMBER" }
                      },
                      required: ["penznem", "tetelek", "vegosszeg_netto", "vegosszeg_brutto"]
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
    for (let invData of invoicesArray) {
      // Intelligens normalizáció & kalkuláció, ha a modell hiányosan adta volna vissza
      if (invData.tetelek && Array.isArray(invData.tetelek)) {
        invData.tetelek = invData.tetelek.map((t: any) => {
          const netto = Number(t.netto_ar ?? (Number(t.mennyiseg || 1) * Number(t.egysegar || 0)));
          const afaSzazalek = t.afa_szazalek !== undefined && t.afa_szazalek !== null ? Number(t.afa_szazalek) : 27;
          let afaErtek = t.afa_ertek !== undefined && t.afa_ertek !== null ? Number(t.afa_ertek) : Math.round((netto * afaSzazalek) / 100);
          let brutto = Number(t.brutto_ar || 0);

          if (!brutto || brutto === 0 || Math.abs(brutto - (netto + afaErtek)) > 1.0) {
            brutto = netto + afaErtek;
          }

          return {
            megnevezes: t.megnevezes || 'Megnevezetlen szolgáltatás',
            mennyiseg: Number(t.mennyiseg || 1),
            egysegar: Number(t.egysegar || netto),
            afa_szazalek: afaSzazalek,
            netto_ar: netto,
            afa_ertek: afaErtek,
            brutto_ar: brutto
          };
        });
      }

      const itemsNetto = (invData.tetelek || []).reduce((sum: number, t: any) => sum + Number(t.netto_ar || 0), 0);
      const itemsAfa = (invData.tetelek || []).reduce((sum: number, t: any) => sum + Number(t.afa_ertek || 0), 0);
      const itemsBrutto = (invData.tetelek || []).reduce((sum: number, t: any) => sum + Number(t.brutto_ar || 0), 0);

      invData.vegosszeg_netto = Number(invData.vegosszeg_netto || itemsNetto);
      invData.vegosszeg_afa = Number(invData.vegosszeg_afa !== undefined ? invData.vegosszeg_afa : itemsAfa);
      invData.vegosszeg_brutto = Number(invData.vegosszeg_brutto || itemsBrutto);

      // Ha a bruttó még mindig nem egyezik
      if (Math.abs((invData.vegosszeg_netto + invData.vegosszeg_afa) - invData.vegosszeg_brutto) > 1.0) {
        invData.vegosszeg_brutto = invData.vegosszeg_netto + invData.vegosszeg_afa;
      }

      // Ha a kiállító helyett a vevőnek kellett volna beállítani
      if (!invData.vevo_neve && invData.kiallito_neve && /kft|bt|zrt|nyrt|ev|egyéni/i.test(invData.kiallito_neve)) {
        // Szöveges promptnál a megnevezett partner 95%-ban a vevő
        invData.vevo_neve = invData.kiallito_neve;
        invData.kiallito_neve = null;
      }

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
      results: resultsToReturn
    });

  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
