import { describe, it, expect } from 'vitest';
import { InvoiceDataSchema } from '../src/schemas/invoice.js';

describe('InvoiceDataSchema Validáció', () => {
  it('El kell fogadnia a helyes és hiánytalan számlaadatokat', () => {
    const validData = {
      kiallito_neve: 'Teszt Kft.',
      vevo_neve: 'Vásárló Kft.',
      penznem: 'HUF',
      tetelek: [
        {
          megnevezes: 'Fejlesztési tanácsadás',
          mennyiseg: 1,
          egysegar: 50000,
          afa_szazalek: 27,
          netto_ar: 50000,
          afa_ertek: 13500,
          brutto_ar: 63500,
        },
      ],
      vegosszeg_netto: 50000,
      vegosszeg_afa: 13500,
      vegosszeg_brutto: 63500,
    };

    const result = InvoiceDataSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('El kell utasítania, ha a fejlécek matematikailag nem stimmelnek (Netto + Afa != Brutto)', () => {
    const invalidMathData = {
      penznem: 'HUF',
      tetelek: [],
      vegosszeg_netto: 1000,
      vegosszeg_afa: 270,
      vegosszeg_brutto: 2000, // Hibás
    };

    const result = InvoiceDataSchema.safeParse(invalidMathData);
    expect(result.success).toBe(false);
    
    if (!result.success) {
      const hasMathError = result.error.issues.some(
        (issue: any) => issue.message.includes('nem egyezik')
      );
      expect(hasMathError).toBe(true);
    }
  });

  it('El kell utasítania, ha a tételek összege nem adja ki a fejlécet', () => {
    const invalidItemsData = {
      penznem: 'HUF',
      tetelek: [
        {
          megnevezes: 'Teszt tétel 1',
          netto_ar: 1000,
          afa_ertek: 270,
          brutto_ar: 1270
        },
        {
          megnevezes: 'Teszt tétel 2',
          netto_ar: 1000,
          afa_ertek: 270,
          brutto_ar: 1270
        }
      ], // A tételek nettó összege 2000
      vegosszeg_netto: 1000, 
      vegosszeg_afa: 270,
      vegosszeg_brutto: 1270,
    };

    const result = InvoiceDataSchema.safeParse(invalidItemsData);
    expect(result.success).toBe(false);

    if (!result.success) {
      const hasItemsError = result.error.issues.some(
        (issue: any) => issue.message.includes('nem egyezik')
      );
      expect(hasItemsError).toBe(true);
    }
  });
});
