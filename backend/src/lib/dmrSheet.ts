/**
 * Monthly DMR statement ("DMR-OCT26-S"): per BMC, the DMR figures next to the invoice / spot
 * acknowledgement figures and their difference.
 *
 * - Invoice block = what the Milk Ack statement holds as sent (litres, fat %, SNF %).
 * - DMR block = the BMC's own fat and SNF applied to the litres sent. Its fat/SNF % comes from the
 *   imported period sheets (dmr_history) or, for live dates, from the BMC's milk entries.
 * - SP.G = 1 + 4 x (SNF - 0.2 x Fat - 0.36) / 1000; kg = litres x SP.G.
 * - Diff = invoice - DMR.
 * Pure functions: no database access.
 */
import ExcelJS from 'exceljs';
import type { AckDay } from './milkAck';
import { specificGravity } from './milkAck';
import { periodSheetName } from './sheetName';

export interface PctSource {
  /** Fat and SNF % the BMC recorded for this code on this date, or null when not known. */
  (code: number | null, date: string): { fat: number; snf: number } | null;
}

export interface DmrSheetRow {
  team: string; code: number | null; name: string;
  qty: number; lit_fat: number; lit_snf: number; fat_pct: number; snf_pct: number; sg: number;
  kg: number; kg_fat: number; kg_snf: number;
  inv_qty: number; inv_lit_fat: number; inv_lit_snf: number; inv_fat_pct: number; inv_snf_pct: number;
  diff_qty: number; diff_fat: number; diff_snf: number;
  /** Litres for which no BMC fat/SNF was known, so the invoice figures were used. */
  estimated_qty: number;
}
export interface DmrSheet { rows: DmrSheetRow[]; total: DmrSheetRow }

const NUM = [
  'qty', 'lit_fat', 'lit_snf', 'kg', 'kg_fat', 'kg_snf', 'inv_qty', 'inv_lit_fat', 'inv_lit_snf',
  'diff_qty', 'diff_fat', 'diff_snf', 'estimated_qty',
] as const;

const blank = (team: string, code: number | null, name: string): DmrSheetRow => {
  const r = { team, code, name, fat_pct: 0, snf_pct: 0, sg: 0, inv_fat_pct: 0, inv_snf_pct: 0 } as DmrSheetRow;
  for (const k of NUM) r[k] = 0;
  return r;
};

const finish = (r: DmrSheetRow) => {
  r.fat_pct = r.qty ? (r.lit_fat / r.qty) * 100 : 0;
  r.snf_pct = r.qty ? (r.lit_snf / r.qty) * 100 : 0;
  r.sg = r.qty ? Math.round((r.kg / r.qty) * 1e4) / 1e4 : 0;
  r.inv_fat_pct = r.inv_qty ? (r.inv_lit_fat / r.inv_qty) * 100 : 0;
  r.inv_snf_pct = r.inv_qty ? (r.inv_lit_snf / r.inv_qty) * 100 : 0;
  r.diff_qty = r.inv_qty - r.qty;
  r.diff_fat = r.inv_lit_fat - r.lit_fat;
  r.diff_snf = r.inv_lit_snf - r.lit_snf;
};

/** Rolls the Milk Ack rows up per BMC (CCs are not part of this statement). */
export function buildDmrSheet(days: AckDay[], pct: PctSource): DmrSheet {
  const byCode = new Map<string, DmrSheetRow>();
  for (const day of days) {
    for (const r of day.rows) {
      if (r.is_total || r.kind !== 'BMC') continue;
      const key = r.code != null ? String(r.code) : r.name;
      let d = byCode.get(key);
      if (!d) byCode.set(key, (d = blank(r.team, r.code, r.name)));
      const p = pct(r.code, r.date);
      const fat = p ? p.fat : r.qty ? (r.lit_fat / r.qty) * 100 : 0;
      const snf = p ? p.snf : r.qty ? (r.lit_snf / r.qty) * 100 : 0;
      if (!p) d.estimated_qty += r.qty;
      const sg = specificGravity(fat, snf);
      const litFat = (r.qty * fat) / 100;
      const litSnf = (r.qty * snf) / 100;
      d.qty += r.qty;
      d.lit_fat += litFat;
      d.lit_snf += litSnf;
      d.kg += r.qty * sg;
      d.kg_fat += litFat * sg;
      d.kg_snf += litSnf * sg;
      d.inv_qty += r.qty;
      d.inv_lit_fat += r.lit_fat;
      d.inv_lit_snf += r.lit_snf;
    }
  }
  const rows = [...byCode.values()].sort((a, b) => (a.code ?? 1e9) - (b.code ?? 1e9) || a.name.localeCompare(b.name));
  const total = blank('', null, 'TOTAL');
  for (const r of rows) {
    finish(r);
    for (const k of NUM) total[k] += r[k];
  }
  finish(total);
  return { rows, total };
}

/** Builds the fat/SNF lookup from imported period figures and live milk entries. */
export function makePctSource(
  history: Array<{ period_from: string; period_to: string; bmc_code: number; qty: number; fat_lit: number; snf_lit: number }>,
  entries: Array<{ code: number | null; qty: number; fat_pct: number; snf_pct: number }>,
): PctSource {
  const hist = new Map<number, Array<{ from: string; to: string; fat: number; snf: number }>>();
  for (const h of history) {
    if (!h.qty) continue;
    const list = hist.get(h.bmc_code) ?? [];
    list.push({ from: h.period_from, to: h.period_to, fat: (h.fat_lit / h.qty) * 100, snf: (h.snf_lit / h.qty) * 100 });
    hist.set(h.bmc_code, list);
  }
  const live = new Map<number, { q: number; f: number; s: number }>();
  for (const e of entries) {
    if (e.code == null || !(e.qty > 0)) continue;
    const a = live.get(e.code) ?? { q: 0, f: 0, s: 0 };
    a.q += e.qty;
    a.f += e.qty * e.fat_pct;
    a.s += e.qty * e.snf_pct;
    live.set(e.code, a);
  }
  return (code, date) => {
    if (code == null) return null;
    const p = hist.get(code)?.find((x) => date >= x.from && date <= x.to);
    if (p) return { fat: p.fat, snf: p.snf };
    const l = live.get(code);
    return l && l.q ? { fat: l.f / l.q, snf: l.s / l.q } : null;
  };
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const thin = { style: 'thin' as const };
const box = { top: thin, bottom: thin, left: thin, right: thin };

const COLS: Array<{ key: keyof DmrSheetRow; head: string; fmt: string }> = [
  { key: 'qty', head: 'QTY LIT', fmt: '#,##0' },
  { key: 'lit_fat', head: 'FAT LIT', fmt: '#,##0.000' },
  { key: 'lit_snf', head: 'SNF LIT', fmt: '#,##0.000' },
  { key: 'fat_pct', head: 'FAT%', fmt: '0.00' },
  { key: 'snf_pct', head: 'SNF%', fmt: '0.00' },
  { key: 'sg', head: 'SP.G', fmt: '0.0000' },
  { key: 'kg', head: 'QTY KG', fmt: '#,##0.000' },
  { key: 'kg_fat', head: 'FATKG', fmt: '#,##0.000' },
  { key: 'kg_snf', head: 'SNFKG', fmt: '#,##0.000' },
  { key: 'inv_qty', head: 'QTY LIT', fmt: '#,##0' },
  { key: 'inv_lit_fat', head: 'FAT LIT', fmt: '#,##0.000' },
  { key: 'inv_lit_snf', head: 'SNF LIT', fmt: '#,##0.000' },
  { key: 'inv_fat_pct', head: 'FAT%', fmt: '0.00' },
  { key: 'inv_snf_pct', head: 'SNF%', fmt: '0.00' },
  { key: 'diff_qty', head: 'QTY LIT', fmt: '#,##0' },
  { key: 'diff_fat', head: 'FAT LIT', fmt: '#,##0.00' },
  { key: 'diff_snf', head: 'SNF LIT', fmt: '#,##0.00' },
];

/** Excel file in the layout of the DMR sheet. */
export async function buildDmrSheetWorkbook(report: DmrSheet, from: string, to: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(periodSheetName(from, to));
  const lastCol = 4 + COLS.length;

  const title = ws.addRow([`DMR  ${ddmmyyyy(from)} to ${ddmmyyyy(to)}`]);
  title.font = { bold: true, size: 13 };
  const groups: Array<[string, number, number]> = [['DMR', 5, 13], ['INVOICE/Spt.Ack', 14, 18], ['DIFF', 19, 21]];
  const g = ws.addRow([]);
  for (const [label, a] of groups) g.getCell(a).value = label;
  const h = ws.addRow(['S.NO', 'NAME OF THE TEAM', 'CC_CODE', 'NAME OF THE BMCS', ...COLS.map((c) => c.head)]);
  for (const [, a, b] of groups) ws.mergeCells(g.number, a, g.number, b);
  for (const r of [g, h]) {
    r.font = { bold: true };
    r.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    r.eachCell({ includeEmpty: true }, (c) => { c.border = box; });
  }

  report.rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, r.team, r.code, r.name, ...COLS.map((c) => r[c.key])]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = box;
      if (col > 4) cell.numFmt = COLS[col - 5].fmt;
    });
  });
  const t = ws.addRow(['', '', '', report.total.name, ...COLS.map((c) => report.total[c.key])]);
  t.font = { bold: true };
  t.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.border = box;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FC' } };
    if (col > 4) cell.numFmt = COLS[col - 5].fmt;
  });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 10;
  ws.getColumn(3).width = 9;
  ws.getColumn(4).width = 32;
  for (let c = 5; c <= lastCol; c++) ws.getColumn(c).width = 12;
  ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
