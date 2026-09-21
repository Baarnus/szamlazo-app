import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { invoices } from './db/schema.js';
import { getAuthUser } from './auth.js';
import { InvoiceDataSchema } from '@szamlazo/shared';
import { decrypt } from './lib/crypto.js';

// @ts-ignore
import * as szamlazz from 'szamlazz.js';

export const szamlazzRouter = new Hono();

/**
 * Pénznem kód leképezése a szamlazz.js Currency osztályára
 */
function resolveCurrency(penznem?: string | null) {
  const code = (penznem || 'HUF').toUpperCase().trim();
  if (code === 'HUF' || code === 'FT') return szamlazz.Currencies.Ft;
  if (code === 'EUR') return szamlazz.Currencies.EUR;
  if (code === 'USD') return szamlazz.Currencies.USD;
  if (code === 'CHF') return szamlazz.Currencies.CHF;
  if (code === 'GBP') return szamlazz.Currencies.GBP;
  return (szamlazz.Currencies as any)[code] || new szamlazz.Currency(code, 2, code);
}

/**
 * Fizetési mód leképezése a szamlazz.js PaymentMethod osztályára
 */
function resolvePaymentMethod(fizmod?: string | null) {
  const norm = (fizmod || '').toLowerCase().trim();
  if (norm.includes('készpénz') || norm.includes('keszpenz') || norm === 'cash') {
    return szamlazz.PaymentMethods.Cash;
  }
  if (norm.includes('kártya') || norm.includes('kartya') || norm.includes('card')) {
    return szamlazz.PaymentMethods.CreditCard;
  }
  if (norm.includes('paypal')) {
    return szamlazz.PaymentMethods.PayPal;
  }
  if (norm.includes('utalás') || norm.includes('utalas') || norm.includes('transfer')) {
    return szamlazz.PaymentMethods.BankTransfer;
  }
  if (fizmod && fizmod.trim()) {
    return new szamlazz.PaymentMethod(fizmod.trim(), fizmod.trim());
  }
  return szamlazz.PaymentMethods.BankTransfer;
}

szamlazzRouter.post('/issue/:id', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) return c.json({ error: 'Nincs bejelentkezve.' }, 401);

  const apiKey = decrypt(user.szamlazzHuApiKey);
  if (!apiKey) {
    return c.json({ error: 'Nincs beállítva Számlázz.hu Számla Agent API kulcs a Beállítások menüben.' }, 400);
  }

  const invoiceId = c.req.param('id');
  const existingInvoices = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
  const invoiceRecord = existingInvoices[0];

  if (!invoiceRecord) {
    return c.json({ error: 'A számla nem található a rendszerben.' }, 404);
  }

  if (invoiceRecord.userId !== user.id) {
    return c.json({ error: 'Nincs jogosultságod ehhez a számlához.' }, 403);
  }

  try {
    const body = await c.req.json();
    const dataToIssue = body.data || invoiceRecord.data; 
    const parsedData = InvoiceDataSchema.parse(dataToIssue);

    // =========================================================================
    // SZÁMLÁZZ.HU & ÁFA TV. KÖTELEZŐ MEZŐK VALIDÁCIÓJA
    // =========================================================================
    // A Számlázz.hu AgentXML és a hatályos Áfa tv. szerint kötelező:
    // vevő neve, országa, irányítószáma, települése és címe (utca, házszám).
    // Fiktív adat használata szabálytalan, ezért hiány esetén 400 hibát adunk.
    const missingBuyerFields: string[] = [];
    if (!parsedData.vevo_neve?.trim()) missingBuyerFields.push('Vevő neve');
    if (!parsedData.vevo_iranyitoszam?.trim()) missingBuyerFields.push('Vevő irányítószáma');
    if (!parsedData.vevo_telepules?.trim()) missingBuyerFields.push('Vevő települése');
    if (!parsedData.vevo_cim?.trim()) missingBuyerFields.push('Vevő címe (utca, házszám)');

    if (missingBuyerFields.length > 0) {
      return c.json({
        success: false,
        error: `A számla kiállításához a Számlázz.hu és az Áfa tv. szerint kötelező megadni a vevő pontos adatait! Hiányzó mezők: ${missingBuyerFields.join(', ')}. Kérjük, töltsd ki ezeket a szerkesztőben a kiállítás előtt.`
      }, 400);
    }

    if (!parsedData.tetelek || parsedData.tetelek.length === 0) {
      return c.json({
        success: false,
        error: 'A számlának legalább egy tételt tartalmaznia kell a kiállításhoz!'
      }, 400);
    }

    // Adóalany jogállás meghatározása az AgentXML szerint
    let taxSubject = szamlazz.TaxSubjects.NoTaxID; // -1: nincs magyar adószáma (magánszemély / nem adóalany)
    if (parsedData.vevo_adoszam && parsedData.vevo_adoszam.trim().length > 0) {
      taxSubject = szamlazz.TaxSubjects.HungarianTaxID; // 1: van magyar adószáma
    } else if (parsedData.vevo_adoszamEU && parsedData.vevo_adoszamEU.trim().length > 0) {
      taxSubject = szamlazz.TaxSubjects.EUCompany; // 6: EU közösségi adószámmal rendelkező cég
    }

    const szamlaAgent = new szamlazz.Client({
      authToken: apiKey,
      eInvoice: true,
      requestInvoiceDownload: true,
      downloadedInvoiceCount: 1,
      responseVersion: 2
    });

    const buyer = new szamlazz.Buyer({
      name: parsedData.vevo_neve!.trim(),
      country: parsedData.vevo_orszag?.trim() || 'Magyarország',
      zip: parsedData.vevo_iranyitoszam!.trim(),
      city: parsedData.vevo_telepules!.trim(),
      address: parsedData.vevo_cim!.trim(),
      taxNumber: parsedData.vevo_adoszam?.trim() || '',
      taxNumberEU: parsedData.vevo_adoszamEU?.trim() || '',
      taxSubject: taxSubject,
      email: parsedData.vevo_email?.trim() || '',
      sendEmail: Boolean(parsedData.vevo_email && parsedData.vevo_email.includes('@')),
      comment: parsedData.megjegyzes?.trim() || ''
    });

    const seller = new szamlazz.Seller({
      bank: { name: '', accountNumber: '' },
      email: {
        replyToAddress: user.email,
        subject: 'E-számla elkészült',
        message: 'Mellékelten küldjük a számlát.'
      }
    });

    const currency = resolveCurrency(parsedData.penznem);
    const paymentMethod = resolvePaymentMethod(parsedData.fizetesi_mod);

    const items = parsedData.tetelek.map((t: any) => {
      const isSpecialVat = typeof t.afa_szazalek === 'string' &&
        ['TAM', 'AAM', 'EU', 'EUFAD37', 'EUFADE', 'EUK', 'MAA', 'ÁKK', 'TEHK', 'HO', 'KBAET'].includes(t.afa_szazalek.toUpperCase());
      
      const vatParam = isSpecialVat ? t.afa_szazalek.toUpperCase() : Number(t.afa_szazalek ?? 27);
      const qty = Number(t.mennyiseg) || 1;
      const netUnitPrice = Number(t.egysegar) || 0;
      const netValue = Number(t.netto_ar) || (qty * netUnitPrice);
      const vatAmount = isSpecialVat ? 0 : (Number(t.afa_ertek) || Math.round(netValue * (Number(vatParam) / 100)));
      const grossValue = Number(t.brutto_ar) || (netValue + vatAmount);

      return new szamlazz.Item({
        label: t.megnevezes || 'Szolgáltatás / Termék',
        quantity: qty,
        unit: t.mennyisegi_egyseg || 'db',
        vat: vatParam,
        netUnitPrice: netUnitPrice,
        netValue: Math.round(netValue),
        vatValue: Math.round(vatAmount),
        grossValue: Math.round(grossValue),
        comment: t.megjegyzes || ''
      });
    });

    const issueDate = parsedData.kelt_datum ? new Date(parsedData.kelt_datum) : new Date();
    const fulfillmentDate = parsedData.teljesites_datum ? new Date(parsedData.teljesites_datum) : new Date();
    const dueDate = parsedData.fizetesi_hatarido ? new Date(parsedData.fizetesi_hatarido) : new Date();

    const isPaid = paymentMethod === szamlazz.PaymentMethods.Cash || paymentMethod === szamlazz.PaymentMethods.CreditCard;

    const invoice = new szamlazz.Invoice({
      paymentMethod: paymentMethod,
      currency: currency,
      language: szamlazz.Languages.Hungarian,
      seller: seller,
      buyer: buyer,
      items: items,
      issueDate: issueDate,
      fulfillmentDate: fulfillmentDate,
      dueDate: dueDate,
      comment: parsedData.megjegyzes || undefined,
      orderNumber: parsedData.rendeles_szam || undefined,
      paid: isPaid
    });

    const result = await szamlaAgent.issueInvoice(invoice);
    
    // A sikeresen kiállított számlaszám visszamentése a számla adatai közé
    const issuedInvoiceNumber = result.invoiceId || result.invoiceNumber;
    if (issuedInvoiceNumber) {
      parsedData.szamlaszam = issuedInvoiceNumber;
    }

    await db.update(invoices).set({ 
      status: 'invoiced', 
      updatedAt: new Date(),
      data: parsedData 
    }).where(eq(invoices.id, invoiceRecord.id));

    return c.json({ 
      success: true, 
      invoiceNumber: issuedInvoiceNumber,
      pdfBase64: result.pdf ? result.pdf.toString('base64') : null
    });

  } catch (err: any) {
    console.error('Számlázz.hu hiba:', err);
    const errorMsg = err.message || (err.data && err.data.message) || JSON.stringify(err);
    return c.json({ success: false, error: 'Hiba a kiállításkor: ' + errorMsg }, 400);
  }
});
