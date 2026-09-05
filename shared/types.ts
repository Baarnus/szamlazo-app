export const SUPPORTED_CURRENCIES = [
  { code: 'HUF', symbol: 'Ft' },
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
  { code: 'GBP', symbol: '£' },
  { code: 'CHF', symbol: 'Fr.' }
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]['code'] | string;

export interface InvoiceItem {
  megnevezes: string;
  mennyiseg: number;
  egysegar: number;
  afa_szazalek: number;
  netto_ar: number;
  afa_ertek?: number;
  brutto_ar: number;
}

export interface InvoiceData {
  kiallito_neve?: string;
  kiallito_adoszam?: string;
  kiallito_orszag?: string;
  vevo_neve?: string;
  vevo_adoszam?: string;
  szamlaszam?: string;
  kelt_datum?: string;
  teljesites_datum?: string;
  fizetesi_hatarido?: string;
  penznem: CurrencyCode;
  tetelek: InvoiceItem[];
  vegosszeg_netto: number;
  vegosszeg_afa: number;
  vegosszeg_brutto: number;
}

export interface ImageInputItem {
  type: 'base64' | 'url';
  data: string;
  mimeType?: string;
}

export interface SingleInvoiceResult {
  index: number;
  source: string;
  success: boolean;
  isValid: boolean;
  errors: string[];
  data?: InvoiceData;
}

export interface BatchParseInvoiceResponse {
  success: boolean;
  total: number;
  results: SingleInvoiceResult[];
  error?: string;
}