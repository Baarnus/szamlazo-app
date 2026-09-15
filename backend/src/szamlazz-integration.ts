import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { invoices, users } from './db/schema.js';
import { getAuthUser } from './auth.js';
import { InvoiceDataSchema } from './index.js';

// @ts-ignore
import * as szamlazz from 'szamlazz.js';

export const szamlazzRouter = new Hono();

szamlazzRouter.post('/issue/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve' }, 401);

  if (!user.szamlazzHuApiKey) {
    return c.json({ error: 'Nincs beÃ¡llÃ­tva SzÃ¡mlÃ¡zz.hu API kulcs a beÃ¡llÃ­tÃ¡sokban.' }, 400);
  }

  const invoiceId = c.req.param('id');
  const existingInvoices = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoiceRecord = existingInvoices[0];

  if (!invoiceRecord) {
    return c.json({ error: 'SzÃ¡mla nem talÃ¡lhatÃ³ a rendszerben.' }, 404);
  }

  if (invoiceRecord.userId !== user.id) {
    return c.json({ error: 'Nincs jogosultsÃ¡god ehhez a szÃ¡mlÃ¡hoz.' }, 403);
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
      name: parsedData.vevo_neve || 'Ismeretlen VevÅ‘',
      zip: '1000', // Mock data, mivel a cetlin ritkÃ¡n van irÃ¡nyÃ­tÃ³szÃ¡m
      city: 'Budapest',
      address: 'Ismeretlen utca 1.',
      taxNumber: parsedData.vevo_adoszam || '',
      postAddress: {
        name: parsedData.vevo_neve || 'Ismeretlen VevÅ‘',
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
      emailSubject: 'E-szÃ¡mla elkÃ©szÃ¼lt',
      emailText: 'MellÃ©kelten kÃ¼ldjÃ¼k az automatikusan generÃ¡lt e-szÃ¡mlÃ¡t.'
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

    // TESZT MÃ“D:
    // A szamlazz.js 9.2 verziÃ³ja nem tÃ¡mogatja hivatalosan a "teszt" attribÃºtumot direkt a konstruktorbÃ³l.
    // De hackkelhetjÃ¼k a belsÅ‘ XML generÃ¡lÃ¡st vagy kiÃ­rhatjuk, hogy Sandbox kulcsot kell hasznÃ¡lni.
    // Ã‰lesben a SzÃ¡mlÃ¡zz.hu "teszt" fiÃ³kot hasznÃ¡ljÃ¡k a tesztelÃ©shez, ami ingyenes.

    const result = await szamlaAgent.issueInvoice(invoice);
    
    // Ha sikeres
    await db.update(invoices).set({ 
      status: 'invoiced', 
      updatedAt: new Date(),
      // @ts-ignore
      data: parsedData 
    }).where(eq(invoices.id, invoiceRecord.id));

    return c.json({ 
      success: true, 
      invoiceNumber: result.invoiceId || result.invoiceNumber,
      pdfBase64: result.pdf ? result.pdf.toString('base64') : null
    });

  } catch (err: any) {
    console.error('SzÃ¡mlÃ¡zz.hu hiba:', err);
    // Szamlazz.js hibaÃ¼zenetei objektumok szoktak lenni
    const errorMsg = err.message || (err.data && err.data.message) || JSON.stringify(err);
    return c.json({ success: false, error: 'Hiba a kiÃ¡llÃ­tÃ¡skor: ' + errorMsg }, 400);
  }
});


