import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InvoiceDataSchema } from '@szamlazo/shared';
import { app } from '../src/index.js';
import { db } from '../src/db/index.js';
import { users, invoices } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { sign } from 'hono/jwt';

const JWT_SECRET = process.env.JWT_SECRET || 'L8HgFCjWJ9Ww4HodCBr8dlkvSYamLTo4NfNQ75tmEfI=';

describe('2. FÁZIS TESZTEK: Számlázz.hu AgentXML & Üzleti Logika', () => {
  let testUserId: string;
  let authToken: string;

  beforeEach(async () => {
    // Tesztfelhasználó létrehozása
    const email = `phase2_test_${Date.now()}@example.com`;
    const [u] = await db.insert(users).values({
      email,
      passwordHash: 'dummy_hash',
      monthlyCredits: 10,
      szamlazzHuApiKey: 'dummy_szamla_agent_key_xyz',
    }).returning();
    testUserId = u!.id;
    const token = await sign({ id: testUserId, email, exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET, 'HS256');
    authToken = 'Bearer ' + token;
  });

  afterEach(async () => {
    await db.delete(invoices).where(eq(invoices.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe('Számlázz.hu & Áfa tv. Kötelező Vevőcím Validáció', () => {
    it('Meg kell tagadnia a kiállítást (400), ha a vevő neve vagy címe hiányzik (fiktív cím tilalma)', async () => {
      // Számla létrehozása hiányos vevőcímmel (nincs irányítószám, település, cím)
      const incompleteData = {
        kiallito_neve: 'Eladó Kft.',
        vevo_neve: 'Vevő Cég',
        // vevo_iranyitoszam, vevo_telepules, vevo_cim hiányzik!
        penznem: 'HUF',
        fizetesi_mod: 'Átutalás',
        tetelek: [
          {
            megnevezes: 'Tanácsadás',
            mennyiseg: 1,
            mennyisegi_egyseg: 'db',
            egysegar: 10000,
            afa_szazalek: 27,
            netto_ar: 10000,
            afa_ertek: 2700,
            brutto_ar: 12700,
          }
        ],
        vegosszeg_netto: 10000,
        vegosszeg_afa: 2700,
        vegosszeg_brutto: 12700,
      };

      const [inv] = await db.insert(invoices).values({
        userId: testUserId,
        source: 'Teszt számla',
        data: incompleteData as any,
        isValid: true,
        status: 'processed'
      }).returning();

      const req = new Request(`http://localhost/api/szamlazz/issue/${inv!.id}`, {
        method: 'POST',
        headers: {
          'Authorization': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data: incompleteData })
      });

      const res = await app.request(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Vevő irányítószáma');
      expect(body.error).toContain('Vevő települése');
      expect(body.error).toContain('Vevő címe');
    });

    it('El kell fogadnia az InvoiceDataSchema-nak az AAM (alanyi adómentes) és speciális ÁFA kulcsokat is', () => {
      const aamData = {
        vevo_neve: 'Magánszemély Ügyfél',
        vevo_iranyitoszam: '1011',
        vevo_telepules: 'Budapest',
        vevo_cim: 'Fő utca 1.',
        penznem: 'HUF',
        tetelek: [
          {
            megnevezes: 'Webfejlesztés',
            mennyiseg: 1,
            mennyisegi_egyseg: 'óra',
            egysegar: 25000,
            afa_szazalek: 'AAM', // Speciális alanyi adómentes
            netto_ar: 25000,
            afa_ertek: 0,
            brutto_ar: 25000,
          }
        ],
        vegosszeg_netto: 25000,
        vegosszeg_afa: 0,
        vegosszeg_brutto: 25000,
      };

      const result = InvoiceDataSchema.safeParse(aamData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tetelek[0]?.afa_szazalek).toBe('AAM');
      }
    });
  });

  describe('Invoices PATCH & DELETE Biztonsági Ellenőrzések', () => {
    it('PATCH /api/invoices/:id - 404-et kell visszaadnia, ha a számla nem létezik', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const req = new Request(`http://localhost/api/invoices/${nonExistentId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            vevo_neve: 'Teszt',
            penznem: 'HUF',
            tetelek: [],
            vegosszeg_netto: 0,
            vegosszeg_afa: 0,
            vegosszeg_brutto: 0
          }
        })
      });

      const res = await app.request(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain('nem található');
    });

    it('DELETE /api/invoices/:id - Nem törölheti más felhasználó számláját', async () => {
      // Másik felhasználó számlája
      const otherUserEmail = `other_user_${Date.now()}@example.com`;
      const [otherUser] = await db.insert(users).values({
        email: otherUserEmail,
        passwordHash: 'dummy'
      }).returning();

      const [otherInvoice] = await db.insert(invoices).values({
        userId: otherUser!.id,
        source: 'Másik felhasználó számlája',
        data: {
          vevo_neve: 'Idegen',
          penznem: 'HUF',
          tetelek: [],
          vegosszeg_netto: 0,
          vegosszeg_afa: 0,
          vegosszeg_brutto: 0
        } as any,
        isValid: true
      }).returning();

      // Próbáljuk meg a mi authToken-ünkkel törölni
      const req = new Request(`http://localhost/api/invoices/${otherInvoice!.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': authToken
        }
      });

      const res = await app.request(req);
      expect(res.status).toBe(404);

      // Takarítás
      await db.delete(invoices).where(eq(invoices.id, otherInvoice!.id));
      await db.delete(users).where(eq(users.id, otherUser!.id));
    });
  });

  describe('Atomi Kreditlevonás és Visszatérítés', () => {
    it('POST /api/invoices/parse-text - 402 hibát kell adnia, ha a felhasználónak 0 kreditje van', async () => {
      // Állítsuk 0-ra a kreditet
      await db.update(users).set({ monthlyCredits: 0 }).where(eq(users.id, testUserId));

      const req = new Request('http://localhost/api/invoices/parse-text', {
        method: 'POST',
        headers: {
          'Authorization': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          textPrompt: 'Készíts egy számlát 1000 Ft-ról.'
        })
      });

      const res = await app.request(req);
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.error).toContain('kredited');
    });
  });

  describe('Számla Agent XML & szamlazz.js Belső Konstruktorok', () => {
    // @ts-ignore
    it('A Buyer osztálynak kivételt kell dobnia, ha a kötelező mezők (name, city, address) hiányoznak', async () => {
      // @ts-ignore
      const szamlazz = await import('szamlazz.js');
      expect(() => {
        new szamlazz.Buyer({
          name: '',
          zip: '1111',
          city: 'Budapest',
          address: 'Fő u. 1.'
        });
      }).toThrow('Valid Name field missing');

      expect(() => {
        new szamlazz.Buyer({
          name: 'Vevő',
          zip: '1111',
          city: '',
          address: 'Fő u. 1.'
        });
      }).toThrow('Valid City field missing');

      expect(() => {
        new szamlazz.Buyer({
          name: 'Vevő',
          zip: '1111',
          city: 'Budapest',
          address: ''
        });
      }).toThrow('Valid Address field missing');
    });

    it('A Buyer helyes adatokkal és TaxSubject-tel sikeresen példányosítható', async () => {
      // @ts-ignore
      const szamlazz = await import('szamlazz.js');
      const buyer = new szamlazz.Buyer({
        name: 'Minta Vevő Kft.',
        country: 'Magyarország',
        zip: '1051',
        city: 'Budapest',
        address: 'Október 6. utca 7.',
        taxNumber: '12345678-2-41',
        taxSubject: szamlazz.TaxSubjects.HungarianTaxID
      });
      expect(buyer).toBeDefined();
    });

    it('Az Invoice osztály sima string currency-re elszáll, Currency objektumra sikeresen lefut', async () => {
      // @ts-ignore
      const szamlazz = await import('szamlazz.js');
      const buyer = new szamlazz.Buyer({
        name: 'Minta Vevő Kft.',
        country: 'Magyarország',
        zip: '1051',
        city: 'Budapest',
        address: 'Október 6. utca 7.',
      });

      const item = new szamlazz.Item({
        label: 'Fejlesztés',
        quantity: 1,
        netUnitPrice: 10000,
        vat: 27
      });

      // String currency -> Invoice._generateXML elszáll
      const badInvoice = new szamlazz.Invoice({
        currency: 'HUF' as any, // Nem Currency példány
        buyer,
        items: [item]
      });
      expect(() => badInvoice._generateXML(1)).toThrow('Valid Currency field missing');

      // Megfelelő Currency példánnyal lefut
      const goodInvoice = new szamlazz.Invoice({
        currency: szamlazz.Currencies.Ft,
        paymentMethod: szamlazz.PaymentMethods.BankTransfer,
        buyer,
        items: [item]
      });
      const xml = goodInvoice._generateXML(1);
      expect(xml).toContain('<fejlec>');
      expect(xml).toContain('<penznem>Ft</penznem>');
      expect(xml).toContain('<fizmod>Átutalás</fizmod>');
      expect(xml).toContain('<vevo>');
      expect(xml).toContain('<nev>Minta Vevő Kft.</nev>');
      expect(xml).toContain('<irsz>1051</irsz>');
      expect(xml).toContain('<telepules>Budapest</telepules>');
      expect(xml).toContain('<cim>Október 6. utca 7.</cim>');
      expect(xml).toContain('<tetelek>');
    });
  });

  describe('2. Fázis: RLB-60 Újsor Tisztítás', () => {
    it('cleanFieldRLB eltávolítja az újsorokat (\r\n és \n) és szóközre cseréli', async () => {
      const { cleanFieldRLB } = await import('../src/services/export-formatter.js');
      const multiline = 'Első sor\r\nMásodik sor\nHarmadik sor; teszt';
      const cleaned = cleanFieldRLB(multiline);
      expect(cleaned).not.toContain('\r');
      expect(cleaned).not.toContain('\n');
      expect(cleaned).not.toContain(';');
      expect(cleaned).toBe('Első sor Második sor Harmadik sor, teszt');
    });
  });

  describe('2. Fázis: Beállítások Érzékeny Kulcs Maszkolás', () => {
    it('GET /api/settings maszkolt formában adja vissza az API kulcsokat', async () => {
      const res = await app.request(new Request('http://localhost/api/settings', {
        headers: { 'Authorization': authToken }
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.settings.hasSzamlazzHuApiKey).toBe(true);
      // Maszkolt formátum: nem tartalmazhatja a teljes nyers kulcsot, de van benne ••••
      expect(body.settings.szamlazzHuApiKey).toContain('••••');
      expect(body.settings.szamlazzHuApiKey).not.toBe('dummy_szamla_agent_key_xyz');
    });

    it('POST /api/settings a maszkolt értéket nem írja felül, megtartja az eredetit', async () => {
      const res = await app.request(new Request('http://localhost/api/settings', {
        method: 'POST',
        headers: {
          'Authorization': authToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          szamlazzHuApiKey: 'dumm••••••••_xyz' // Visszaküldött maszkolt érték
        })
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Ellenőrizzük az adatbázisban, hogy az eredeti kulcs maradt meg
      const [u] = await db.select().from(users).where(eq(users.id, testUserId));
      const { decrypt } = await import('../src/lib/crypto.js');
      expect(decrypt(u!.szamlazzHuApiKey)).toBe('dummy_szamla_agent_key_xyz');
    });
  });

  describe('2. Fázis: Rate Limiter Kulcsgenerátor', () => {
    it('A hitelesített felhasználót user:ID formátumban kulcsolja', async () => {
      const { defaultRateLimitKeyGenerator } = await import('../src/middlewares/rate-limiter.js');
      const fakeContext = {
        req: {
          header: (name: string) => {
            if (name.toLowerCase() === 'authorization') return authToken;
            return null;
          }
        }
      } as any;

      const key = defaultRateLimitKeyGenerator(fakeContext);
      expect(key).toBe(`user:${testUserId}`);
    });
  });
});

