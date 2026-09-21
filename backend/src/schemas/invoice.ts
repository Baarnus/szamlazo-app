// backend/src/schemas/invoice.ts
// Zod sémák kiemelve az index.ts-ből — a szamlazz-integration.ts is innen importál.
import { z } from 'zod';

export const InvoiceItemSchema = z.object({
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

    const headerCalculatedGross = Number(data.vegosszeg_netto || 0) + Number(data.vegosszeg_afa || 0);
    if (Math.abs(headerCalculatedGross - Number(data.vegosszeg_brutto || 0)) > 1.0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Fejléc ÁFA hiba: Nettó (${data.vegosszeg_netto}) + ÁFA (${data.vegosszeg_afa}) nem egyezik a Bruttó végösszeggel (${data.vegosszeg_brutto} ${currency}).`,
        path: ['vegosszeg_brutto'],
      });
    }

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
