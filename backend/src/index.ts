import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import type { 
  InvoiceData, 
  ImageInputItem, 
  SingleInvoiceResult, 
  BatchParseInvoiceResponse 
} from '../../shared/types.js';

dotenv.config();

const app = new Hono();
app.use('/*', cors());

function validateInvoiceMath(data: InvoiceData) {
  const errors: string[] = [];
  let calculatedBrutto = 0;

  if (Array.isArray(data.tetelek)) {
    for (const item of data.tetelek) {
      calculatedBrutto += Number(item.brutto_ar || 0);
    }
  }

  if (Math.abs(calculatedBrutto - Number(data.vegosszeg_brutto || 0)) > 1) {
    errors.push(
      `Összegzési eltérés: a tételek összege (${calculatedBrutto} Ft) nem egyezik a fejléc végösszegével (${data.vegosszeg_brutto} Ft).`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

async function resolveImageToBase64(item: ImageInputItem): Promise<{ pureBase64: string; mimeType: string }> {
  if (item.type === 'base64') {
    const pureBase64 = (item.data.includes('base64,') ? item.data.split('base64,')[1] : item.data) || '';
    return { pureBase64, mimeType: item.mimeType || 'image/jpeg' };
  }

  // URL letöltése
  const response = await fetch(item.data);
  if (!response.ok) {
    throw new Error(`Nem sikerült letölteni a képet az URL-ről (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get('content-type') || item.mimeType || 'image/jpeg';
  return { pureBase64: buffer.toString('base64'), mimeType };
}

const prompt = `Elemezd a számlát és add vissza kizárólag JSON formátumban:
{
  "kiallito_neve": "string",
  "kiallito_adoszam": "string",
  "vevo_neve": "string",
  "vevo_adoszam": "string",
  "szamlaszam": "string",
  "kelt_datum": "YYYY-MM-DD",
  "fizetesi_hatarido": "YYYY-MM-DD",
  "tetelek": [
    {
      "megnevezes": "string",
      "mennyiseg": number,
      "egysegar": number,
      "afa_szazalek": number,
      "netto_ar": number,
      "brutto_ar": number
    }
  ],
  "vegosszeg_netto": number,
  "vegosszeg_afa": number,
  "vegosszeg_brutto": number
}`;

app.post('/api/parse-batch', async (c) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: 0, results: [], error: 'GEMINI_API_KEY hiányzik.' }, 500);
  }

  const body = await c.req.json<{ items: ImageInputItem[] }>();
  const items = body?.items || [];

  if (items.length === 0) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: 0, results: [], error: 'Nincs megadva feldolgozandó kép.' }, 400);
  }

  if (items.length > 10) {
    return c.json<BatchParseInvoiceResponse>({ success: false, total: items.length, results: [], error: 'Egyszerre maximum 10 kép dolgozható fel.' }, 400);
  }

  // Párhuzamos feldolgozás
  const tasks = items.map(async (item, index): Promise<SingleInvoiceResult> => {
    const sourceLabel = item.type === 'url' ? item.data : `Feltöltött fájl #${index + 1}`;
    try {
      const { pureBase64, mimeType } = await resolveImageToBase64(item);

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: pureBase64 } }] }],
            generationConfig: { response_mime_type: 'application/json', temperature: 0.1 },
          }),
        }
      );

      if (!geminiRes.ok) {
        throw new Error(`Gemini hiba: ${await geminiRes.text()}`);
      }

      const resultJson: any = await geminiRes.json();
      const rawText = resultJson.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Nem érkezett kinyerhető szöveg a képről.');

      const parsedData: InvoiceData = JSON.parse(rawText);
      const validation = validateInvoiceMath(parsedData);

      return {
        index,
        source: sourceLabel,
        success: true,
        isValid: validation.isValid,
        errors: validation.errors,
        data: parsedData,
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