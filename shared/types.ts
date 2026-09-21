import { z } from 'zod';

export const SUPPORTED_CURRENCIES = [
  { code: 'HUF', symbol: 'Ft' },
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' },
  { code: 'CHF', symbol: 'Fr.' }
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'] | string;

export const InvoiceItemSchema = z.object({
  megnevezes: z.string().default('Ismeretlen tétel'),
  mennyiseg: z.coerce.number().default(1),
  mennyisegi_egyseg: z.string().nullable().optional().default('db'),
  egysegar: z.coerce.number().default(0),
  afa_szazalek: z.union([z.coerce.number(), z.string()]).default(27),
  netto_ar: z.coerce.number().default(0),
  afa_ertek: z.coerce.number().nullable().optional().default(0),
  brutto_ar: z.coerce.number().default(0),
  megjegyzes: z.string().nullable().optional(),
});

export type InvoiceItem = z.infer<typeof InvoiceItemSchema>;

export const InvoiceDataSchema = z.object({
  kiallito_neve: z.string().nullable().optional(),
  kiallito_adoszam: z.string().nullable().optional(),
  kiallito_orszag: z.string().nullable().optional(),
  vevo_neve: z.string().nullable().optional(),
  vevo_adoszam: z.string().nullable().optional(),
  vevo_adoszamEU: z.string().nullable().optional(),
  vevo_orszag: z.string().nullable().optional().default('Magyarország'),
  vevo_iranyitoszam: z.string().nullable().optional(),
  vevo_telepules: z.string().nullable().optional(),
  vevo_cim: z.string().nullable().optional(),
  vevo_email: z.string().nullable().optional(),
  szamlaszam: z.string().nullable().optional(),
  rendeles_szam: z.string().nullable().optional(),
  kelt_datum: z.string().nullable().optional(),
  teljesites_datum: z.string().nullable().optional(),
  fizetesi_hatarido: z.string().nullable().optional(),
  fizetesi_mod: z.string().nullable().optional().default('Átutalás'),
  penznem: z.string().default('HUF'),
  megjegyzes: z.string().nullable().optional(),
  direction: z.enum(['incoming', 'outgoing']).nullable().optional(),
  tipus: z.string().nullable().optional(),
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

export type InvoiceData = z.infer<typeof InvoiceDataSchema>;

export interface ImageInputItem {
  type: 'base64' | 'url';
  data: string;
  mimeType?: string;
}

export type SingleInvoiceResult = SingleInvoiceSuccess | SingleInvoiceFailure;

export interface SingleInvoiceSuccess {
  index: number;
  source: string;
  success: true;
  isValid: boolean;
  errors: string[];
  data: InvoiceData;
  dbId?: string;
  imageUrl?: string;
}

export interface SingleInvoiceFailure {
  index: number;
  source: string;
  success: false;
  isValid: false;
  errors: string[];
}

export interface BatchParseInvoiceResponse {
  success: boolean;
  total: number;
  results: SingleInvoiceResult[];
  error?: string;
}