import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { invoices, users } from './db/schema.js';
import { getAuthUser } from './auth.js';
import { InvoiceDataSchema } from './index.js';

import * as szamlazz from 'szamlazz.js';

export const szamlazzRouter = new Hono();

szamlazzRouter.post('/issue/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  if (!user.szamlazzHuApiKey) {
    return c.json({ error: 'Nincs beállítva Számlázz.hu API kulcs a beállításokban.' }, 400);
  }

  const invoiceId = c.req.param('id');
  const existingInvoices = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoiceRecord = existingInvoices[0];

  if (!invoiceRecord) {
    return c.json({ error: 'Számla nem található a rendszerben.' }, 404);
  }

  if (invoiceRecord.userId !== user.id) {
    return c.json({ error: 'Nincs jogosultságod ehhez a számlához.' }, 403);
  }

  try {
    const body = await c.req.json();
    const dataToIssue = body.data || invoiceRecord.data; 
    const parsedData = InvoiceDataSchema.parse(dataToIssue);

    const szamlaAgent = new szamlazz.Client({
      authToken: user.szamlazzHuApiKey,
      eInvoice: true,
      requestInvoiceDownload: true,
      downloadedInvoiceCount: 1,
      responseVersion: 2
    });

    const buyer = new szamlazz.Buyer({
      name: parsedData.vevo_neve || 'Ismeretlen Vevő',
      zip: '1000', // Mock data, mivel a cetlin ritkán van irányítószám
      city: 'Budapest',
      address: 'Ismeretlen utca 1.',
      taxNumber: parsedData.vevo_adoszam || '',
      postAddress: {
        name: parsedData.vevo_neve || 'Ismeretlen Vevő',
        zip: '1000',
        city: 'Budapest',
        address: 'Ismeretlen utca 1.'
      },
      identifier: 1,
      phone: '',
      comment: ''
    });

    const seller = new szamlazz.Seller({
      bank: '',
      emailReplyto: user.email,
      emailSubject: 'E-számla elkészült',
      emailText: 'Mellékelten küldjük az automatikusan generált e-számlát.'
    });

    const items = parsedData.tetelek.map((t: any) => {
      return new szamlazz.Item({
        label: t.megnevezes,
        quantity: Number(t.mennyiseg) || 1,
        unit: 'db',
        vat: t.afa_szazalek ? String(t.afa_szazalek) : '27',
        netUnitPrice: Number(t.egysegar),
        netValue: Number(t.netto_ar),
        vatValue: Number(t.afa_ertek),
        grossValue: Number(t.brutto_ar)
      });
    });

    const invoice = new szamlazz.Invoice({
      paymentMethod: szamlazz.PaymentMethod.Cash,
      currency: parsedData.penznem || szamlazz.Currency.Ft,
      language: szamlazz.Language.Hungarian,
      seller: seller,
      buyer: buyer,
      items: items,
      issueDate: parsedData.kelt_datum ? new Date(parsedData.kelt_datum) : new Date(),
      fulfillmentDate: parsedData.teljesites_datum ? new Date(parsedData.teljesites_datum) : new Date(),
      dueDate: parsedData.fizetesi_hatarido ? new Date(parsedData.fizetesi_hatarido) : new Date(),
    });

    // TESZT MÓD:
    // A szamlazz.js 9.2 verziója nem támogatja hivatalosan a "teszt" attribútumot direkt a konstruktorból.
    // De hackkelhetjük a belső XML generálást vagy kiírhatjuk, hogy Sandbox kulcsot kell használni.
    // Élesben a Számlázz.hu "teszt" fiókot használják a teszteléshez, ami ingyenes.

    const result = await szamlaAgent.issueInvoice(invoice);
    
    // Ha sikeres
    await db.update(invoices).set({ 
      status: 'invoiced', 
      updatedAt: new Date(),
      data: parsedData 
    }).where(eq(invoices.id, invoiceRecord.id));

    return c.json({ 
      success: true, 
      invoiceNumber: result.invoiceId || result.invoiceNumber,
      pdfBase64: result.pdf ? result.pdf.toString('base64') : null
    });

  } catch (err: any) {
    console.error('Számlázz.hu hiba:', err);
    // Szamlazz.js hibaüzenetei objektumok szoktak lenni
    const errorMsg = err.message || (err.data && err.data.message) || JSON.stringify(err);
    return c.json({ success: false, error: 'Hiba a kiállításkor: ' + errorMsg }, 400);
  }
});

