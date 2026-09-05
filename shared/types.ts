export type CurrencyCode = 'HUF' | 'EUR' | 'USD' | 'GBP' | 'CHF' | string;

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
  data: string; // Base64 string VAGY URL
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