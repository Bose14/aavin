/**
 * Small spreadsheet helper on top of exceljs (replaces the unmaintained, vulnerable `xlsx` package).
 * Exposes just what the exports and the bulk upload need.
 */
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';

export type Row = Record<string, unknown>;
export interface Sheet {
  rows: Row[];
  columns: string[];
  /** Optional heading written as a merged, bold row above the column headers (xlsx only). */
  title?: string;
  /** Rows for which this returns true are written bold on a light background (xlsx only). */
  highlightRow?: (row: Row) => boolean;
}
export interface Book {
  sheets: Array<{ name: string; sheet: Sheet }>;
}

const MAX_UPLOAD_ROWS = 5000;

export const book_new = (): Book => ({ sheets: [] });

/** Rows (objects) -> sheet; columns are the keys in first-seen order. */
export function json_to_sheet(rows: Row[]): Sheet {
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { rows, columns };
}

export function book_append_sheet(wb: Book, sheet: Sheet, name: string): void {
  wb.sheets.push({ name: name.slice(0, 31), sheet });
}

/** Text that starts with = + - @ is read as a formula by Excel; prefix it so exported data stays data. */
function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
}

function cellValue(v: unknown): ExcelJS.CellValue {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  return safeText(String(v));
}

export function sheet_to_csv(sheet: Sheet): string {
  const esc = (v: unknown): string => {
    if (v == null) return '';
    const s = typeof v === 'string' ? safeText(v) : v instanceof Date ? v.toISOString() : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [sheet.columns.map(esc).join(',')];
  for (const r of sheet.rows) lines.push(sheet.columns.map((c) => esc(r[c])).join(','));
  return lines.join('\n');
}

export async function writeXlsx(wb: Book): Promise<Buffer> {
  const out = new ExcelJS.Workbook();
  for (const { name, sheet } of wb.sheets) {
    const ws = out.addWorksheet(name);
    let headerRow = 1;
    if (sheet.title) {
      ws.addRow([safeText(sheet.title)]);
      ws.mergeCells(1, 1, 1, Math.max(1, sheet.columns.length));
      ws.getRow(1).font = { bold: true, size: 14 };
      ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getRow(1).height = 24;
      headerRow = 2;
    }
    ws.addRow(sheet.columns);
    ws.getRow(headerRow).font = { bold: true };
    for (const r of sheet.rows) {
      const added = ws.addRow(sheet.columns.map((c) => cellValue(r[c])));
      if (sheet.highlightRow?.(r)) {
        for (let c = 1; c <= sheet.columns.length; c++) {
          const cell = added.getCell(c);
          cell.font = { bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } };
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
        }
      }
    }
    ws.columns.forEach((col, i) => {
      const longest = Math.max(sheet.columns[i]?.length ?? 8, ...sheet.rows.slice(0, 200).map((r) => String(r[sheet.columns[i]] ?? '').length));
      col.width = Math.min(60, Math.max(10, longest + 2));
    });
  }
  return Buffer.from(await out.xlsx.writeBuffer());
}

function plainValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return plainValue(o.result as ExcelJS.CellValue);
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
    if ('error' in o) return '';
  }
  return v;
}

/** First sheet of an .xlsx (or a CSV) as header-keyed rows. Dates come back as yyyy-mm-dd strings. */
export async function readFirstSheetRows(buf: Buffer): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  const isXlsx = buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK" zip header
  const ws = isXlsx
    ? (await wb.xlsx.load(buf as unknown as ExcelJS.Buffer), wb.worksheets[0])
    : await wb.csv.read(Readable.from(buf));
  if (!ws) return [];

  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    header[col] = String(plainValue(cell.value)).trim();
  });

  const rows: Row[] = [];
  const last = Math.min(ws.rowCount, MAX_UPLOAD_ROWS + 1);
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const out: Row = {};
    let any = false;
    header.forEach((name, col) => {
      if (!name) return;
      let v = plainValue(row.getCell(col).value);
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (v !== '') any = true;
      out[name] = v;
    });
    if (any) rows.push(out);
  }
  return rows;
}
