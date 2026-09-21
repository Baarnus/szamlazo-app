// backend/src/services/export-formatter.ts
// CSV és RLB export formázó segédfüggvények.

/**
 * Számot Excel-kompatibilis formátumra alakít (pont → vessző).
 */
export function formatNumberForExcel(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(Number(num))) return '0';
  return String(num).replace('.', ',');
}

/**
 * Szövegmezőt CSV-biztos formátumra alakít (idézőjelezés, escape).
 */
export function cleanFieldCSV(val: string | undefined | null): string {
  if (!val) return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

/**
 * Szövegmezőt RLB-kompatibilis formátumra alakít (pontosvessző és idézőjel eltávolítás).
 */
export function cleanFieldRLB(val: any): string {
  if (!val) return '';
  return String(val).replace(/;/g, ',').replace(/"/g, '').trim();
}

/**
 * Dátumot RLB-60 formátumra alakít (YYYY.MM.DD.)
 */
export function formatDateRLB(dateStr: any): string {
  if (!dateStr) return '';
  const clean = String(dateStr).replace(/-/g, '.').replace(/\//g, '.');
  return clean.endsWith('.') ? clean : clean + '.';
}
