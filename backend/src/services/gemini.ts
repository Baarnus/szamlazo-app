// backend/src/services/gemini.ts
// Gemini API hívás és kép feldolgozási logika izolálva.
import { InvoiceDataSchema } from '../schemas/invoice.js';
import { uploadInvoiceBuffer } from '../lib/s3.js';
import { db } from '../db/index.js';
import { invoices } from '../db/schema.js';
import type {
  InvoiceData,
  ImageInputItem,
  SingleInvoiceResult,
} from '../../../shared/types.js';

// ==========================================
// Gemini prompt — konfigurálható konstans
// ==========================================
export const GEMINI_INVOICE_PROMPT = `Elemezd a számlát (magyar vagy nemzetközi) és válaszolj KIZÁRÓLAG tiszta JSON formátumban!
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
// Kép beolvasás (base64 vagy URL)
// ==========================================
export async function resolveImageBuffer(item: ImageInputItem): Promise<{ buffer: Buffer; mimeType: string }> {
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

// ==========================================
// Egyetlen számla feldolgozása (kép → AI → DB)
// ==========================================
export async function processSingleInvoice(
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
          contents: [{ parts: [{ text: GEMINI_INVOICE_PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
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
