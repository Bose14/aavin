import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import * as sheet from '../dist/lib/spreadsheet.js';

test('xlsx round trip keeps headers, numbers and text', async () => {
  const wb = sheet.book_new();
  sheet.book_append_sheet(wb, sheet.json_to_sheet([
    { 'Unit Code': 'RNK-001', Date: '21-11-2026', Shift: 'AM', 'Fat %': 4.3, Qty: 1200 },
    { 'Unit Code': 'BMC-002', Date: '21-11-2026', Shift: 'PM', 'Fat %': 4.1, Qty: 800 },
  ]), 'Template');
  const rows = await sheet.readFirstSheetRows(await sheet.writeXlsx(wb));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Unit Code'], 'RNK-001');
  assert.equal(rows[1].Qty, 800);
  assert.equal(rows[0]['Fat %'], 4.3);
});

test('date cells are read back as yyyy-mm-dd', async () => {
  const w = new ExcelJS.Workbook();
  const ws = w.addWorksheet('S');
  ws.addRow(['Date', 'Shift']);
  ws.addRow([new Date(Date.UTC(2026, 10, 21)), 'AM']);
  const rows = await sheet.readFirstSheetRows(Buffer.from(await w.xlsx.writeBuffer()));
  assert.equal(rows[0].Date, '2026-11-21');
});

test('csv export escapes values and neutralises spreadsheet formulas', () => {
  const csv = sheet.sheet_to_csv(sheet.json_to_sheet([{ Name: '=HYPERLINK("x")', Note: 'a,b', Qty: -5 }]));
  assert.equal(csv.split('\n')[1], `"'=HYPERLINK(""x"")","a,b",-5`);
});

test('csv upload is read too', async () => {
  const rows = await sheet.readFirstSheetRows(Buffer.from('Unit Code,Shift\nRNK-001,AM\n'));
  assert.equal(rows[0]['Unit Code'], 'RNK-001');
  assert.equal(rows[0].Shift, 'AM');
});
