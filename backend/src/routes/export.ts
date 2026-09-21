// backend/src/routes/export.ts
// Könyvelőprogram export végpontok: CSV és RLB-60 formátum.
import { Hono } from 'hono';
import { desc, eq, and, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { invoices } from '../db/schema.js';
import { getAuthUser } from '../auth.js';
import { formatNumberForExcel, cleanFieldCSV, cleanFieldRLB, formatDateRLB } from '../services/export-formatter.js';
import type { InvoiceData } from '@szamlazo/shared';

export const exportRouter = new Hono();

/**
 * SQL szintű szűrés összeállítása az invoices táblára a JSONB adatok és createdAt alapján.
 * Ezzel elkerülhető, hogy több tízezer számla feleslegesen a Node.js memóriába töltődjön.
 */
function buildExportDateConditions(userId: string, fromDate?: string, toDate?: string): SQL[] {
  const conditions: SQL[] = [
    eq(invoices.userId, userId),
    eq(invoices.isDeleted, false)
  ];

  const effectiveDateSql = sql`COALESCE(NULLIF(${invoices.data}->>'kelt_datum', ''), NULLIF(${invoices.data}->>'teljesites_datum', ''), TO_CHAR(${invoices.createdAt}, 'YYYY-MM-DD'))`;

  if (fromDate) {
    conditions.push(sql`${effectiveDateSql} >= ${fromDate}`);
  }
  if (toDate) {
    conditions.push(sql`${effectiveDateSql} <= ${toDate}`);
  }

  return conditions;
}

// ==========================================
// KÖNYVELŐBARÁT CSV EXPORT
// ==========================================
exportRouter.get('/csv', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const fromDate = c.req.query('from'); // pl. 2026-01-01
    const toDate = c.req.query('to');     // pl. 2026-01-31

    const conditions = buildExportDateConditions(user.id, fromDate, toDate);

    let list = await db.select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt));

    if (fromDate || toDate) {
      list = list.filter((inv) => {
        const d = inv.data as InvoiceData;
        const dateToCheck = d?.kelt_datum || d?.teljesites_datum || (inv.createdAt ? inv.createdAt.toISOString().slice(0, 10) : '');
        if (fromDate && dateToCheck < fromDate) return false;
        if (toDate && dateToCheck > toDate) return false;
        return true;
      });
    }

    const headers = [
      'Számlaszám',
      'Kiállító',
      'Kiállító Adószám',
      'Ország',
      'Vevő',
      'Vevő Adószám',
      'Kelt',
      'Teljesítés Dátum',
      'Fizetési Határidő',
      'Pénznem',
      'Tétel Megnevezés',
      'Mennyiség',
      'Egységár',
      'Áfa %',
      'Tétel Nettó',
      'Tétel Áfa',
      'Tétel Bruttó',
      'Számla Végösszeg Nettó',
      'Számla Végösszeg Áfa',
      'Számla Végösszeg Bruttó',
      'Státusz',
      'Feltöltés Időpontja'
    ];

    const rows: string[] = [];
    rows.push(headers.join(';'));

    for (const inv of list) {
      const d = inv.data as InvoiceData;
      if (!d) continue;

      const baseInfo = [
        cleanFieldCSV(d.szamlaszam),
        cleanFieldCSV(d.kiallito_neve),
        cleanFieldCSV(d.kiallito_adoszam),
        cleanFieldCSV(d.kiallito_orszag),
        cleanFieldCSV(d.vevo_neve),
        cleanFieldCSV(d.vevo_adoszam),
        cleanFieldCSV(d.kelt_datum),
        cleanFieldCSV(d.teljesites_datum),
        cleanFieldCSV(d.fizetesi_hatarido),
        cleanFieldCSV(d.penznem)
      ];

      const totalsInfo = [
        formatNumberForExcel(d.vegosszeg_netto),
        formatNumberForExcel(d.vegosszeg_afa),
        formatNumberForExcel(d.vegosszeg_brutto),
        cleanFieldCSV(inv.status),
        cleanFieldCSV(inv.createdAt.toISOString())
      ];

      if (d.tetelek && Array.isArray(d.tetelek) && d.tetelek.length > 0) {
        for (const t of d.tetelek) {
          const itemInfo = [
            cleanFieldCSV(t.megnevezes),
            formatNumberForExcel(t.mennyiseg),
            formatNumberForExcel(t.egysegar),
            formatNumberForExcel(t.afa_szazalek),
            formatNumberForExcel(t.netto_ar),
            formatNumberForExcel(t.afa_ertek),
            formatNumberForExcel(t.brutto_ar)
          ];
          rows.push([...baseInfo, ...itemInfo, ...totalsInfo].join(';'));
        }
      } else {
        const itemInfo = ['""', '""', '""', '""', '""', '""', '""'];
        rows.push([...baseInfo, ...itemInfo, ...totalsInfo].join(';'));
      }
    }

    const csvContent = '\uFEFF' + rows.join('\n');
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="szamlak_osszesito.csv"'
      }
    });

  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ==========================================
// RLB-60 KÖNYVELŐPROGRAM EXPORT
// ==========================================
exportRouter.get('/rlb', async (c) => {
  const user = await getAuthUser(c.req.header('Authorization'));
  if (!user) {
    return c.json({ success: false, error: 'Nincs bejelentkezve.' }, 401);
  }

  try {
    const fromDate = c.req.query('from');
    const toDate = c.req.query('to');

    const conditions = buildExportDateConditions(user.id, fromDate, toDate);

    let list = await db.select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt));

    if (fromDate || toDate) {
      list = list.filter((inv) => {
        const d = inv.data as InvoiceData;
        const dateToCheck = d?.kelt_datum || d?.teljesites_datum || (inv.createdAt ? inv.createdAt.toISOString().slice(0, 10) : '');
        if (fromDate && dateToCheck < fromDate) return false;
        if (toDate && dateToCheck > toDate) return false;
        return true;
      });
    }

    const headers = [
      'Számlaszám',
      'Kelt',
      'Teljesítés',
      'Fizetési határidő',
      'Szállító neve',
      'Szállító adószáma',
      'Nettó',
      'ÁFA',
      'Bruttó',
      'Devizanem'
    ];

    const rows: string[] = [];
    rows.push(headers.join(';'));

    for (const inv of list) {
      const d = inv.data as InvoiceData;
      if (!d) continue;

      const row = [
        cleanFieldRLB(d.szamlaszam),
        formatDateRLB(d.kelt_datum),
        formatDateRLB(d.teljesites_datum),
        formatDateRLB(d.fizetesi_hatarido),
        cleanFieldRLB(d.kiallito_neve),
        cleanFieldRLB(d.kiallito_adoszam),
        Math.round(Number(d.vegosszeg_netto) || 0).toString(),
        Math.round(Number(d.vegosszeg_afa) || 0).toString(),
        Math.round(Number(d.vegosszeg_brutto) || 0).toString(),
        cleanFieldRLB(d.penznem || 'HUF')
      ];

      rows.push(row.join(';'));
    }

    const csvContent = '\uFEFF' + rows.join('\n');
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="rlb60_export.csv"'
      }
    });

  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});
