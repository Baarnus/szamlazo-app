// backend/src/services/gemini.ts
// Gemini API hívás, kép és szöveges prompt feldolgozási logika izolálva.
import { uploadInvoiceBuffer } from '../lib/s3.js';
import { db } from '../db/index.js';
import { invoices } from '../db/schema.js';
import {
  InvoiceDataSchema,
  type InvoiceData,
  type ImageInputItem,
  type SingleInvoiceResult,
} from '@szamlazo/shared';

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
  "vevo_adoszamEU": "string vagy null",
  "vevo_orszag": "string vagy null",
  "vevo_iranyitoszam": "string vagy null",
  "vevo_telepules": "string vagy null",
  "vevo_cim": "utca, házszám string vagy null",
  "vevo_email": "string vagy null",
  "fizetesi_mod": "Átutalás | Készpénz | Bankkártya | PayPal | null",
  "szamlaszam": "string vagy null",
  "rendeles_szam": "string vagy null",
  "kelt_datum": "YYYY-MM-DD vagy null",
  "teljesites_datum": "YYYY-MM-DD vagy null",
  "fizetesi_hatarido": "YYYY-MM-DD vagy null",
  "penznem": "HUF | EUR | USD | GBP | CHF",
  "megjegyzes": "string vagy null",
  "tetelek": [
    {
      "megnevezes": "string",
      "mennyiseg": number,
      "mennyisegi_egyseg": "db | óra | hó | nap | kg | m | l",
      "egysegar": number,
      "afa_szazalek": number,
      "netto_ar": number,
      "afa_ertek": number,
      "brutto_ar": number,
      "megjegyzes": "string vagy null"
    }
  ],
  "vegosszeg_netto": number,
  "vegosszeg_afa": number,
  "vegosszeg_brutto": number
}`;

export const GEMINI_TEXT_SYSTEM_INSTRUCTION = `Te egy precíz magyar és nemzetközi számlázási asszisztens vagy. A feladatod számla adatok strukturált kinyerése a megadott utasításból.
SZIGORÚ ÉS KÖTELEZŐ SZABÁLYOK:
1. TÖBB VEVŐ = TÖBB KÜLÖNÁLLÓ SZÁMLA (KRITIKUS!):
   - A magyar és nemzetközi számviteli törvények szerint egy számlának KIZÁRÓLAG EGYETLEN vevője lehet!
   - SOHA, SEMMILYEN KÖRÜLMÉNYEK KÖZÖTT NE VONJ ÖSSZE TÖBB CÉGET VAGY SZEMÉLYT EGYETLEN 'vevo_neve' MEZŐBE!
   - SZIGORÚAN TILOS az ilyen összevonás: "Kis Kft. és Kovács Kft.", "Cég A és Cég B", "Kovács Béla és Nagy Anna".
   - Ha a felhasználó szövegében több vevő szerepel (pl. "... a Kis Kft-nek és a Kovács Kft-nek...", "Kovács úrnak és Kiss Kft-nek"), akkor az 'invoices' tömbben KÖTELEZŐ MINDEN VEVŐNEK EGY-EGY KÜLÖNÁLLÓ SZÁMLA OBJEKTUMOT létrehozni!
   - Ha a tétel és az összeg közösen van megadva (pl. "Számlát szeretnék készíteni a Kis Kft-nek és a Kovács Kft-nek a mai napra 50 000 Ft nettó áfamentes programozásról"):
     * 1. számla az invoices tömbben: vevo_neve: "Kis Kft.", tételek: [{ megnevezes: "Programozás", mennyiseg: 1, egysegar: 50000, afa_szazalek: 0, netto_ar: 50000, brutto_ar: 50000 }]
     * 2. számla az invoices tömbben: vevo_neve: "Kovács Kft.", tételek: [{ megnevezes: "Programozás", mennyiseg: 1, egysegar: 50000, afa_szazalek: 0, netto_ar: 50000, brutto_ar: 50000 }]
2. Pénznem: Alapértelmezetten "HUF", ha nincs más pénznem megadva.
3. Vevő és Kiállító:
   - Ha a felhasználó egy céget vagy személyt említ címzettként (pl. "Kovács Kft-nek", "Kovács Kft részére"), az a vevo_neve (pontos cégnévvel, ragozás nélkül: pl. "Kovács Kft-nek" -> "Kovács Kft.").
   - Ha a kiállító cég nem ismert a szövegből, kiallito_neve legyen null.
4. Dátumok formátuma: YYYY-MM-DD. Töltsd ki a kelt_datum, teljesites_datum és fizetesi_hatarido mezőket. Ha a szöveg "mai napra" vagy "ma" hivatkozik, használd az aktuális napot!
5. TÉTELEK ÉS ÁFA: Minden tételhez KÖTELEZŐ kiszámolni az egysegar, afa_szazalek, netto_ar, afa_ertek és brutto_ar mezőket.
   - Ha a szöveg áfamentességet ("áfamentes", "AAM", "0%") említ, afa_szazalek: 0, afa_ertek: 0, brutto_ar = netto_ar.
   - Ha nincs ÁFA említve, alapértelmezett magyar ÁFA kulcs: 27.
6. VÉGÖSSZEGEK: A vegosszeg_netto a tételek nettó összege, a vegosszeg_afa az ÁFA értékek összege, a vegosszeg_brutto pedig vegosszeg_netto + vegosszeg_afa. Soha ne hagyj 0 Ft-os bruttót, ha van nettó összeg!
Minden számla különálló, teljes értékű elem legyen az invoices tömbben!`;

export const GEMINI_CREATE_INVOICES_TOOL = {
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
              vevo_neve: { type: "STRING", description: "Egyetlen vevő pontos neve ragozás nélkül (cég vagy személy). SOHA ne vonj össze több céget 'és' szóval (pl. TILOS: 'Kis Kft. és Kovács Kft.')! Ha több cég van, külön számla objektumot hozz létre az invoices tömbben!" },
              vevo_adoszam: { type: "STRING" },
              vevo_adoszamEU: { type: "STRING" },
              vevo_orszag: { type: "STRING", description: "Vevő országa, pl. Magyarország" },
              vevo_iranyitoszam: { type: "STRING", description: "Vevő irányítószáma, pl. 1111 vagy null" },
              vevo_telepules: { type: "STRING", description: "Vevő települése vagy városa, pl. Budapest vagy null" },
              vevo_cim: { type: "STRING", description: "Vevő utcája és házszáma, pl. Fő utca 1. vagy null" },
              vevo_email: { type: "STRING", description: "Vevő email címe" },
              fizetesi_mod: { type: "STRING", description: "Fizetési mód, pl. Átutalás, Készpénz, Bankkártya, PayPal" },
              szamlaszam: { type: "STRING" },
              rendeles_szam: { type: "STRING", description: "Webshop rendelésszám vagy azonosító" },
              kelt_datum: { type: "STRING", description: "YYYY-MM-DD" },
              teljesites_datum: { type: "STRING", description: "YYYY-MM-DD" },
              fizetesi_hatarido: { type: "STRING", description: "YYYY-MM-DD" },
              penznem: { type: "STRING", description: "ISO devizakód, pl. HUF, EUR" },
              megjegyzes: { type: "STRING", description: "Számla megjegyzés / közlemény" },
              tetelek: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    megnevezes: { type: "STRING" },
                    mennyiseg: { type: "NUMBER" },
                    mennyisegi_egyseg: { type: "STRING" },
                    egysegar: { type: "NUMBER" },
                    afa_szazalek: { type: "NUMBER", description: "Áfa százalék számmal, pl. 27 vagy 0" },
                    netto_ar: { type: "NUMBER" },
                    afa_ertek: { type: "NUMBER" },
                    brutto_ar: { type: "NUMBER" },
                    megjegyzes: { type: "STRING" }
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
};

// ==========================================
// Kép beolvasás (base64 vagy URL)
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
export const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'low';

/**
 * Ellenőrzi, hogy a megadott hosztnév vagy IP-cím belső / privát hálózathoz tartozik-e.
 */
export function isPrivateOrBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  if (
    ['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal'].includes(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 privát és fenntartott tartományok ellenőrzése
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) return true;
    const [o1, o2] = octets as [number, number, number, number];
    // 0.0.0.0/8, 127.0.0.0/8 (Loopback)
    if (o1 === 0 || o1 === 127) return true;
    // 10.0.0.0/8 (Private Class A)
    if (o1 === 10) return true;
    // 172.16.0.0/12 (Private Class B)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    // 192.168.0.0/16 (Private Class C)
    if (o1 === 192 && o2 === 168) return true;
    // 169.254.0.0/16 (Link-local / Cloud metadata pl. AWS, GCP, Azure)
    if (o1 === 169 && o2 === 254) return true;
    // 224.0.0.0+ (Multicast / Reserved)
    if (o1 >= 224) return true;
  }

  // IPv6 privát és link-local címek
  if (
    host.startsWith('fe80:') ||
    host.startsWith('fc00:') ||
    host.startsWith('fd00:') ||
    host === '::1'
  ) {
    return true;
  }

  return false;
}

/**
 * Validálja a kép URL-t SSRF támadások ellen.
 */
export function validateUrlForSSRF(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Érvénytelen kép URL formátum.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Nem támogatott protokoll: ${parsed.protocol}. Kizárólag HTTP és HTTPS engedélyezett.`);
  }

  if (isPrivateOrBlockedHost(parsed.hostname)) {
    throw new Error(`Biztonsági hiba: A megadott cím (${parsed.hostname}) elérése tiltott (SSRF védelem).`);
  }

  return parsed;
}

/**
 * Biztonságos HTTP kérés SSRF és Open Redirect ellenőrzéssel.
 * Minden egyes átirányítás (redirect hop) célállomását szigorúan leellenőrzi a privát IP-k ellen.
 */
export async function fetchWithSsrfProtection(initialUrl: string, maxRedirects = 3): Promise<Response> {
  let currentUrl = initialUrl;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const validatedUrl = validateUrlForSSRF(currentUrl);

    const response = await fetch(validatedUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,application/pdf,*/*;q=0.8'
      },
      redirect: 'manual', // Nem bízzuk a belső mechanizmusra az ellenőrizetlen átirányítást!
      signal: AbortSignal.timeout(8000), // 8 mp timeout védelem
    });

    // Átirányítás kezelése (301, 302, 303, 307, 308)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Átirányítási hiba: hiányzik a Location fejléc (HTTP ${response.status}).`);
      }
      currentUrl = new URL(location, validatedUrl).toString();
      redirects++;
      continue;
    }

    return response;
  }

  throw new Error('Túl sok átirányítás a kép letöltésekor (maximum 3 engedélyezett).');
}

// ==========================================
// Kép beolvasás (base64 vagy URL)
// ==========================================
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB limit

export async function resolveImageBuffer(item: ImageInputItem): Promise<{ buffer: Buffer; mimeType: string }> {
  if (item.type === 'base64') {
    const pureBase64 = (item.data.includes('base64,') ? item.data.split('base64,')[1] : item.data) || '';
    const buffer = Buffer.from(pureBase64, 'base64');
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`A feltöltött kép mérete meghaladja a megengedett 10 MB-os határt (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`);
    }
    const mime = (item.mimeType || 'image/jpeg').toLowerCase();
    if (mime === 'image/svg+xml') {
      throw new Error('Biztonsági hiba: SVG formátum feldolgozása nem engedélyezett (XSS védelem).');
    }
    if (!mime.startsWith('image/') && mime !== 'application/pdf' && mime !== 'application/octet-stream') {
      throw new Error(`Nem támogatott vagy veszélyes fájlformátum (${mime}). Kizárólag valódi képfájlok (JPEG, PNG, WEBP) vagy PDF dokumentumok dolgozhatók fel.`);
    }
    return { buffer, mimeType: mime };
  }

  // SSRF és Open Redirect védelemmel ellátott kép vagy PDF letöltés
  const response = await fetchWithSsrfProtection(item.data);

  if (!response.ok) {
    throw new Error(`Dokumentum letöltési hiba: HTTP ${response.status} (${response.statusText}).`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`A letöltendő fájl mérete meghaladja a megengedett 10 MB-ot.`);
  }

  const rawHeaderType = response.headers.get('content-type') || '';
  let mimeType = rawHeaderType.split(';')[0]?.trim().toLowerCase() || item.mimeType || 'image/jpeg';
  if (mimeType === 'image/svg+xml' || (!mimeType.startsWith('image/') && mimeType !== 'application/pdf' && mimeType !== 'application/octet-stream')) {
    throw new Error(`Nem támogatott vagy veszélyes fájlformátum (${mimeType}). Kizárólag valódi képfájlok (JPEG, PNG, WEBP) vagy PDF dokumentumok dolgozhatók fel.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`A letöltött fájl mérete meghaladja a megengedett 10 MB-ot.`);
  }

  const buffer = Buffer.from(arrayBuffer);

  return { buffer, mimeType: mimeType === 'application/octet-stream' ? (item.mimeType || 'image/jpeg') : mimeType };
}

// ==========================================
// Egyetlen számla feldolgozása (kép → AI → DB)
// ==========================================
export async function processSingleInvoice(
  item: ImageInputItem,
  index: number,
  apiKey: string,
  userId?: string
): Promise<SingleInvoiceResult> {
  const sourceLabel = item.type === 'url' ? item.data : `Feltöltött fájl #${index + 1}`;
  try {
    const { buffer, mimeType } = await resolveImageBuffer(item);
    const base64Data = buffer.toString('base64');

    // 1. Kép mentése a MinIO tárolóba és AI feldolgozás párhuzamosan (a minimális késleltetésért)
    const uploadPromise = (async (): Promise<string | null> => {
      if (item.type === 'url') return item.data;
      try {
        return await uploadInvoiceBuffer(buffer, mimeType, userId);
      } catch (s3Err: any) {
        console.warn('⚠️ MinIO mentési hiba, fallback képnélküli rekordra:', s3Err.message);
        return null;
      }
    })();

    const geminiPromise = fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: GEMINI_INVOICE_PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL }
          },
        }),
      }
    );

    const [storedImageUrl, geminiRes] = await Promise.all([uploadPromise, geminiPromise]);

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
      ...(dbId ? { dbId } : {}),
      ...(storedImageUrl ? { imageUrl: storedImageUrl } : {}),
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
// Szöveges prompt számlafeldolgozás Gemini AI-val
// ==========================================
export async function parseTextInvoiceWithGemini(
  textPrompt: string,
  apiKey: string
): Promise<any[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueDefaultIso = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim()
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: `${GEMINI_TEXT_SYSTEM_INSTRUCTION}\nAktuális mai naptári dátum: ${todayIso}. Ha a szövegben "mai napra", "ma", vagy dátum megadása nélkül szerepel számlakérés, használd a ${todayIso} értéket a kelt_datum és teljesites_datum mezőkhöz!` }]
        },
        contents: [{ parts: [{ text: textPrompt }] }],
        tools: [GEMINI_CREATE_INVOICES_TOOL],
        toolConfig: {
          functionCallingConfig: { mode: "AUTO" }
        },
        generationConfig: {
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL }
        },
      }),
    }
  );

  if (!geminiRes.ok) {
    throw new Error(`Gemini API hiba: ${await geminiRes.text()}`);
  }

  const resultJson: any = await geminiRes.json();
  const call = resultJson.candidates?.[0]?.content?.parts?.[0]?.functionCall;
  if (!call || call.name !== 'create_invoices_data') {
    throw new Error('Az AI megtagadta a kérést. Kérlek, csak számlázással kapcsolatos utasításokat adj meg!');
  }

  const rawInvoices = call.args.invoices || [];

  // Biztonsági szétválasztás: Ha az AI mégis egyetlen számlába vont volna össze több vevőt
  // pl. "Kis Kft. és Kovács Kft." vagy "Nagy János és Kovács Béla"
  const splitRegex = /\s+(?:és|valamint|,)\s+/i;
  const expandedInvoices: any[] = [];
  for (const inv of rawInvoices) {
    const buyerName = (inv.vevo_neve || '').trim();
    const companyFormCount = (buyerName.match(/\b(kft|zrt|bt|kkt|nyrt|ev|e\.v\.)\.?\b/gi) || []).length;
    const isPartnershipFirm = /\s+és\s+(?:társa|fiai|partnerei)\b/i.test(buyerName) || /&\s*(?:co|partner)/i.test(buyerName);

    const hasMultipleEntities = splitRegex.test(buyerName) && !isPartnershipFirm && (
      companyFormCount > 1 || companyFormCount === 0
    );

    if (hasMultipleEntities) {
      const parts = buyerName.split(splitRegex).map((p: string) => p.trim()).filter(Boolean);
      for (const part of parts) {
        expandedInvoices.push({
          ...inv,
          vevo_neve: part,
        });
      }
    } else {
      expandedInvoices.push(inv);
    }
  }

  return expandedInvoices.map((invData: any) => {
    // Dátumok feltöltése, ha nem adott meg konkrét dátumot
    if (!invData.kelt_datum) {
      invData.kelt_datum = todayIso;
    }
    if (!invData.teljesites_datum) {
      invData.teljesites_datum = invData.kelt_datum || todayIso;
    }
    if (!invData.fizetesi_hatarido) {
      invData.fizetesi_hatarido = dueDefaultIso;
    }

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

    if (Math.abs((invData.vegosszeg_netto + invData.vegosszeg_afa) - invData.vegosszeg_brutto) > 1.0) {
      invData.vegosszeg_brutto = invData.vegosszeg_netto + invData.vegosszeg_afa;
    }

    if (!invData.vevo_neve && invData.kiallito_neve && /kft|bt|zrt|nyrt|ev|egyéni/i.test(invData.kiallito_neve)) {
      invData.vevo_neve = invData.kiallito_neve;
      invData.kiallito_neve = null;
    }

    return invData;
  });
}

