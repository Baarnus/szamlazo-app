// backend/src/services/export-formatter.ts
// CSV és RLB export formázó segédfüggvények.

/**
 * Számot Excel-kompatibilis formátumra alakít (pont → vessző).
 */
export function formatNumberForExcel(num: number | string | undefined | null): string {
  if (num === undefined || num === null || num === '') return '0';
  if (typeof num === 'string' && isNaN(Number(num))) {
    return cleanFieldCSV(num);
  }
  if (isNaN(Number(num))) return '0';
  return String(num).replace('.', ',');
}

/**
 * Szövegmezőt CSV-biztos formátumra alakít (idézőjelezés, escape és Formula Injection védelem).
 * Ha a mező `=`, `+`, `-`, `@`, `\t` vagy `\r` karakterrel kezdődik, elé egy `'` jelet szúr be,
 * megakadályozva a kártékony Excel képlet/DDE végrehajtást (CWE-1236).
 */
export function cleanFieldCSV(val: string | undefined | null): string {
  if (!val) return '""';
  let str = String(val).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'` + str;
  }
  return `"${str}"`;
}

/**
 * Szövegmezőt RLB-kompatibilis formátumra alakít.
 * Eltávolítja az újsorokat (amelyek elrontanák az 1 sor = 1 rekord struktúrát),
 * a pontosvesszőket vesszőre cseréli és törli az idézőjeleket.
 */
export function cleanFieldRLB(val: any): string {
  if (!val) return '';
  return String(val)
    .replace(/[\r\n]+/g, ' ')
    .replace(/;/g, ',')
    .replace(/"/g, '')
    .trim();
}

/**
 * Dátumot RLB-60 formátumra alakít (YYYY.MM.DD.)
 */
export function formatDateRLB(dateStr: any): string {
  if (!dateStr) return '';
  const clean = String(dateStr).replace(/-/g, '.').replace(/\//g, '.');
  return clean.endsWith('.') ? clean : clean + '.';
}
