import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../src/index.js';
import { db } from '../src/db/index.js';
import { users, worksheets, invoices } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { sign } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || 'L8HgFCjWJ9Ww4HodCBr8dlkvSYamLTo4NfNQ75tmEfI=';

describe('MesterMunkalap PWA API Tesztek (/api/worksheets)', () => {
  let testUserId: string;
  let authToken: string;

  beforeEach(async () => {
    const email = `ws_test_${Date.now()}_${Math.random().toString(36).substring(7)}@example.com`;
    const [u] = await db
      .insert(users)
      .values({
        email,
        passwordHash: 'dummy_hash',
        companyName: 'Mester Villanyszerelő Kft.',
        companyTaxNumber: '12345678-2-42',
      })
      .returning();
    testUserId = u!.id;
    const token = await sign(
      { id: testUserId, email, exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET,
      'HS256'
    );
    authToken = 'Bearer ' + token;
  });

  afterEach(async () => {
    await db.delete(worksheets).where(eq(worksheets.userId, testUserId));
    await db.delete(invoices).where(eq(invoices.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it('GET /api/worksheets - 401 hibát ad token nélkül', async () => {
    const res = await app.request(new Request('http://localhost/api/worksheets'));
    expect(res.status).toBe(401);
  });

  it('POST /api/worksheets - Létrehoz egy munkalapot egyedi sorszámmal (ML-YYYY-XXXX)', async () => {
    const currentYear = new Date().getFullYear();
    const req = new Request('http://localhost/api/worksheets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authToken,
      },
      body: JSON.stringify({
        clientName: 'Kovács Család',
        clientCity: 'Budapest',
        clientAddress: 'Kossuth Lajos u. 12.',
        clientPhone: '+36 30 123 4567',
        deviceType: 'Daikin 3.5 kW Split Klíma',
        description: 'Éves karbantartás, fertőtlenítés és gáztöltés.',
        items: [
          { name: 'Klímatisztítás', quantity: 1, unit: 'db', unitPrice: 15000, totalPrice: 15000 },
          { name: 'R32 hűtőközeg', quantity: 0.5, unit: 'kg', unitPrice: 12000, totalPrice: 6000 },
        ],
      }),
    });

    const res = await app.request(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.worksheet).toBeDefined();
    expect(body.worksheet.worksheetNumber).toMatch(new RegExp(`^ML-${currentYear}-\\d{4}$`));
    expect(body.worksheet.clientName).toBe('Kovács Család');
    expect(body.worksheet.status).toBe('draft');
    expect(body.worksheet.items.length).toBe(2);
  });

  it('PATCH /api/worksheets/:id - Rögzíti az aláírást és státuszt signed-ra állítja', async () => {
    // 1. Munkalap létrehozása
    const createRes = await app.request(
      new Request('http://localhost/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken },
        body: JSON.stringify({
          clientName: 'Nagy Kft.',
          description: 'Biztosítéktábla csere',
          items: [{ name: 'Munkadíj', quantity: 3, unit: 'óra', unitPrice: 10000, totalPrice: 30000 }],
        }),
      })
    );
    const created = (await createRes.json()).worksheet;

    // 2. Aláírás beküldése
    const patchRes = await app.request(
      new Request(`http://localhost/api/worksheets/${created.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: authToken },
        body: JSON.stringify({
          signatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        }),
      })
    );

    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()).worksheet;
    expect(updated.status).toBe('signed');
    expect(updated.signedAt).toBeDefined();
  });

  it('POST /api/worksheets/:id/to-invoice - A Híd: Számlává konvertálja a munkalapot', async () => {
    // 1. Munkalap létrehozása
    const createRes = await app.request(
      new Request('http://localhost/api/worksheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authToken },
        body: JSON.stringify({
          clientName: 'Kis János',
          clientZip: '1111',
          clientCity: 'Budapest',
          clientAddress: 'Fő utca 1.',
          description: 'Villanyóra áthelyezés',
          items: [
            { name: 'Kábelezés', quantity: 10, unit: 'm', unitPrice: 2000, totalPrice: 20000 },
            { name: 'Szerelési díj', quantity: 1, unit: 'alkalom', unitPrice: 25000, totalPrice: 25000 },
          ],
        }),
      })
    );
    const created = (await createRes.json()).worksheet;

    // 2. Konvertálás számlává
    const bridgeRes = await app.request(
      new Request(`http://localhost/api/worksheets/${created.id}/to-invoice`, {
        method: 'POST',
        headers: { Authorization: authToken },
      })
    );

    expect(bridgeRes.status).toBe(200);
    const bridgeBody = await bridgeRes.json();
    expect(bridgeBody.success).toBe(true);
    expect(bridgeBody.invoiceId).toBeDefined();

    // Ellenőrizzük, hogy a számla tételei és összegei helyesen jöttek-e létre
    expect(bridgeBody.invoiceData.vevo_neve).toBe('Kis János');
    expect(bridgeBody.invoiceData.direction).toBe('outgoing');
    expect(bridgeBody.invoiceData.tetelek.length).toBe(2);
    expect(bridgeBody.invoiceData.vegosszeg_netto).toBe(45000);
    expect(bridgeBody.invoiceData.vegosszeg_brutto).toBe(45000 + Math.round(45000 * 0.27));

    // Ellenőrizzük, hogy a munkalap státusza 'invoiced'-ra váltott
    const getRes = await app.request(
      new Request(`http://localhost/api/worksheets/${created.id}`, {
        headers: { Authorization: authToken },
      })
    );
    const ws = (await getRes.json()).worksheet;
    expect(ws.status).toBe('invoiced');
    expect(ws.invoiceId).toBe(bridgeBody.invoiceId);
  });
});
