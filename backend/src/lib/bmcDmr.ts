/**
 * BMC DMR loss statement ("RMT tender norms applied BMC wise - solid balancing statement").
 *
 * It is the Milk Ack statement rolled up per BMC for a period: what each BMC sent (DMR), what the
 * union acknowledged, the difference, the allowed norms (30 kg per tanker + 0.032%) and the
 * excess / short against those norms. Pure functions: no database access.
 */
import ExcelJS from 'exceljs';
import type { AckDay } from './milkAck';

export interface DmrRow {
  name: string;
  /** Litres sent on dispatches the union has not acknowledged yet (not part of the difference or norms). */
  pending_qty: number;
  // DMR (sent)
  qty: number; lit_fat: number; lit_snf: number;
  // Acknowledged
  ack_qty: number; ack_lit_fat: number; ack_lit_snf: number;
  // Actual difference = acknowledged - sent
  diff_qty: number; diff_fat: number; diff_snf: number;
  // Tanker tender norms
  kg30: number; kg30_lit: number; kg30_lit_fat: number; kg30_lit_snf: number;
  p032_fat: number; p032_snf: number;
  total_fat: number; total_snf: number;
  // Excess (+) / short (-) = actual difference + norms
  excess_fat: number; excess_snf: number;
}

export interface DmrReport { rows: DmrRow[]; total: DmrRow }

const NUM_KEYS = [
  'pending_qty', 'qty', 'lit_fat', 'lit_snf', 'ack_qty', 'ack_lit_fat', 'ack_lit_snf',
  'diff_qty', 'diff_fat', 'diff_snf', 'kg30', 'kg30_lit', 'kg30_lit_fat', 'kg30_lit_snf',
  'p032_fat', 'p032_snf', 'total_fat', 'total_snf', 'excess_fat', 'excess_snf',
] as const;

const blank = (name: string): DmrRow => {
  const r = { name } as DmrRow;
  for (const k of NUM_KEYS) r[k] = 0;
  return r;
};

/** Rolls the day-by-day Milk Ack statement up to one line per BMC (CCs are not part of this statement). */
export function buildDmr(days: AckDay[]): DmrReport {
  const byBmc = new Map<string, DmrRow>();
  for (const day of days) {
    for (const r of day.rows) {
      if (r.is_total || r.kind !== 'BMC') continue;
      let d = byBmc.get(r.name);
      if (!d) byBmc.set(r.name, (d = blank(r.name)));
      d.qty += r.qty;
      d.lit_fat += r.lit_fat;
      d.lit_snf += r.lit_snf;
      if (!r.acked) {
        d.pending_qty += r.qty;
        continue;
      }
      d.ack_qty += r.ack_qty ?? 0;
      d.ack_lit_fat += r.ack_lit_fat ?? 0;
      d.ack_lit_snf += r.ack_lit_snf ?? 0;
      d.diff_qty += r.qty_diff ?? 0;
      d.diff_fat += r.fat_lit_diff ?? 0;
      d.diff_snf += r.snf_lit_diff ?? 0;
      d.kg30 += r.kg30 ?? 0;
      d.kg30_lit += r.kg30_lit ?? 0;
      d.kg30_lit_fat += r.kg30_lit_fat ?? 0;
      d.kg30_lit_snf += r.kg30_lit_snf ?? 0;
      d.p032_fat += r.p032_fat ?? 0;
      d.p032_snf += r.p032_snf ?? 0;
      d.total_fat += r.allowed_fat ?? 0;
      d.total_snf += r.allowed_snf ?? 0;
      d.excess_fat += r.above_fat ?? 0;
      d.excess_snf += r.above_snf ?? 0;
    }
  }
  const rows = [...byBmc.values()].sort((a, b) => a.name.localeCompare(b.name));
  const total = blank('Grand Total');
  for (const r of rows) for (const k of NUM_KEYS) total[k] += r[k];
  return { rows, total };
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const thin = { style: 'thin' as const };
const box = { top: thin, bottom: thin, left: thin, right: thin };

const COLS: Array<{ key: (typeof NUM_KEYS)[number]; head: string; fmt: string }> = [
  { key: 'qty', head: 'QTY (LIT)', fmt: '#,##0' },
  { key: 'lit_fat', head: 'LIT FAT', fmt: '#,##0.00' },
  { key: 'lit_snf', head: 'LIT SNF', fmt: '#,##0.00' },
  { key: 'ack_qty', head: 'QTY (LIT)', fmt: '#,##0.0' },
  { key: 'ack_lit_fat', head: 'LIT FAT', fmt: '#,##0.00' },
  { key: 'ack_lit_snf', head: 'LIT SNF', fmt: '#,##0.00' },
  { key: 'diff_qty', head: 'QTY (LIT)', fmt: '#,##0.00' },
  { key: 'diff_fat', head: 'LIT FAT', fmt: '#,##0.00' },
  { key: 'diff_snf', head: 'LIT SNF', fmt: '#,##0.00' },
  { key: 'kg30', head: 'MILK KG-30+/-', fmt: '#,##0.00' },
  { key: 'kg30_lit', head: 'MILK LIT', fmt: '#,##0.00' },
  { key: 'kg30_lit_fat', head: 'LIT FAT', fmt: '#,##0.00' },
  { key: 'kg30_lit_snf', head: 'LIT SNF', fmt: '#,##0.00' },
  { key: 'p032_fat', head: '0.032 LIT FAT', fmt: '#,##0.00' },
  { key: 'p032_snf', head: '0.032 LIT SNF', fmt: '#,##0.00' },
  { key: 'total_fat', head: 'TOTAL LIT FAT', fmt: '#,##0.00' },
  { key: 'total_snf', head: 'TOTAL LIT SNF', fmt: '#,##0.00' },
  { key: 'excess_fat', head: 'LIT FAT', fmt: '#,##0.00' },
  { key: 'excess_snf', head: 'LIT SNF', fmt: '#,##0.00' },
];

/** Excel file in the layout of the BMC DMR loss sheet. */
export async function buildDmrWorkbook(report: DmrReport, unitName: string, from: string, to: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`${from.slice(8, 10)}-${to.slice(8, 10)}`);
  const lastCol = 2 + COLS.length;

  ws.addRow([`${unitName.toUpperCase()} UNION`]).font = { bold: true, size: 13 };
  const sub = ws.addRow(['RMT TENDER NORMS APPLIED BMC WISE - SOLID BALANCING STATEMENT']);
  sub.font = { bold: true };
  ws.getCell(2, lastCol - 3).value = `${ddmmyyyy(from)} to ${ddmmyyyy(to)}`;
  ws.getCell(2, lastCol - 3).font = { bold: true };

  const groups: Array<[string, number, number]> = [
    ['DMR', 3, 5], ['Acknowledgement', 6, 8], ['Actual Diff', 9, 11], ['Tanker Tender Norms', 12, 19], ['Excess/Short', 20, 21],
  ];
  const g = ws.addRow(['S.NO', 'NAME OF THE BMC/CC']);
  for (const [label, a] of groups) g.getCell(a).value = label;
  const h = ws.addRow(['', '', ...COLS.map((c) => c.head)]);
  for (const [, a, b] of groups) ws.mergeCells(g.number, a, g.number, b);
  ws.mergeCells(g.number, 1, h.number, 1);
  ws.mergeCells(g.number, 2, h.number, 2);
  for (const r of [g, h]) {
    r.font = { bold: true };
    r.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    r.eachCell({ includeEmpty: true }, (c) => { c.border = box; });
  }
  h.height = 32;

  report.rows.forEach((r, i) => {
    const row = ws.addRow([i + 1, r.name, ...COLS.map((c) => r[c.key])]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = box;
      if (col > 2) cell.numFmt = COLS[col - 3].fmt;
    });
  });
  const t = ws.addRow(['', report.total.name, ...COLS.map((c) => report.total[c.key])]);
  t.font = { bold: true };
  t.eachCell({ includeEmpty: true }, (cell, col) => {
    cell.border = box;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4FC' } };
    if (col > 2) cell.numFmt = COLS[col - 3].fmt;
  });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 28;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 12;
  ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
