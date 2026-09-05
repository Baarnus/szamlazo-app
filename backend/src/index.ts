import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import { z } from 'zod';
import type {
  InvoiceData,
  ImageInputItem,
  SingleInvoiceResult,
  BatchParseInvoiceResponse
} from '../../shared/types.js';

dotenv.config();

const app = new Hono();
app.use('/*', cors());

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

  // 1. Fejléc szintű egyenlet: Nettó + ÁFA = Bruttó
  const headerCalculatedGross = Number(data.vegosszeg_netto || 0) + Number(data.vegosszeg_afa || 0);
  if (Math.abs(headerCalculatedGross - Number(data.vegosszeg_brutto || 0)) > 1.0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Fejléc ÁFA hiba: Nettó (${data.vegosszeg_netto}) + ÁFA (${data.vegosszeg_afa}) nem egyezik a Bruttó végösszeggel (${data.vegosszeg_brutto} ${currency}).`,
      path: ['vegosszeg_brutto'],
    });
  }

  // 2. Tételek összege vs. Fejléc végösszeg
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
// 2. KÉP FELDOLGOZÁS ÉS BASE64 FELOLDÁS
// ==========================================

async function resolveImageToBase64(item: ImageInputItem): Promise<{ pureBase64: string; mimeType: string }> {
  if (item.type === 'base64') {
    const pureBase64 = (item.data.includes('base64,') ? item.data.split('base64,')[1] : item.data) || '';
    return { pureBase64, mimeType: item.mimeType || 'image/jpeg' };
  }

  try {
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

    return { pureBase64: buffer.toString('base64'), mimeType };
  } catch (err: any) {
    throw new Error(`Nem sikerült elérni a megadott kép URL-t: ${err.message}`);
  }
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

// ==========================================
// 3. API VÉGPONT
// ==========================================

app.post('/api/parse-batch', async (c) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: 0, results: [], error: 'GEMINI_API_KEY hiányzik a szerveren.' }, 500);
  }

  const body = await c.req.json<{ items: ImageInputItem[] }>();
  const items = body?.items || [];

  if (items.length === 0) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: 0, results: [], error: 'Nincs megadva feldolgozandó kép.' }, 400);
  }

  if (items.length > 10) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: items.length, results: [], error: 'Egyszerre maximum 10 kép dolgozható fel.' }, 400);
  }

  const tasks = items.map(async (item, index): Promise<SingleInvoiceResult> => {
    const sourceLabel = item.type === 'url' ? item.data : `Feltöltött fájl #${index + 1}`;
    try {
      const { pureBase64, mimeType } = await resolveImageToBase64(item);

      const geminiRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey.trim()
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: pureBase64 } }] }],
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

      // Zod sémával validáljuk és kényszerítjük a típusokat/matematikai szabályokat
      const zodResult = InvoiceDataSchema.safeParse(parsedJson);

      if (!zodResult.success) {
        const errorMessages = zodResult.error.issues.map((issue) => issue.message);
        return {
          index,
          source: sourceLabel,
          success: true,
          isValid: false,
          errors: errorMessages,
          data: parsedJson as InvoiceData, // A hibás vagy pontatlan adatot is visszaadjuk a felhasználónak szerkesztésre
        };
      }

      return {
        index,
        source: sourceLabel,
        success: true,
        isValid: true,
        errors: [],
        data: zodResult.data as InvoiceData,
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
  });

  const results = await Promise.all(tasks);

  return c.json<BatchParseInvoiceResponse>({
    success: true,
    total: results.length,
    results,
  });
});

const port = Number(process.env.PORT) || 3000;
console.log(`Backend fut a porton: ${port}`);
serve({ fetch: app.fetch, port });