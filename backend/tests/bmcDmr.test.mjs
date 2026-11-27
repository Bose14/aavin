import test from 'node:test';
import assert from 'node:assert/strict';

const base = { shift: 'EVE/MOR', route: 'R1', milk_type: 'RCM', team: 'T', dest: '', tanker: 'TN1' };
const near = (a, b, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('DMR rolls the Milk Ack rows up per BMC and applies the sheet rules', async () => {
  const { buildAckDays } = await import('../dist/lib/milkAck.js');
  const { buildDmr } = await import('../dist/lib/bmcDmr.js');
  const inputs = [
    { ...base, date: '2026-10-01', kind: 'BMC', code: 1, name: 'B', inv_no: '1', qty: 1000, fat: 4, snf: 8, ack: { qty: 990, fat: 4, snf: 8 } },
    { ...base, date: '2026-10-01', kind: 'BMC', code: 2, name: 'A', inv_no: '2', qty: 1000, fat: 4, snf: 8, ack: { qty: 1000, fat: 4.1, snf: 8 } },
    { ...base, date: '2026-10-02', kind: 'BMC', code: 1, name: 'B', inv_no: '3', qty: 500, fat: 4, snf: 8, ack: null },
    { ...base, date: '2026-10-02', kind: 'CC', route: '', tanker: 'TN2', code: 9, name: 'CCX', inv_no: '4', qty: 300, fat: 4, snf: 8, ack: { qty: 300, fat: 4, snf: 8 } },
  ];
  const r = buildDmr(buildAckDays(inputs));
  assert.deepEqual(r.rows.map((x) => x.name), ['A', 'B']); // CC left out, sorted by name
  const b = r.rows[1];
  assert.equal(b.qty, 1500); // all sent litres
  assert.equal(b.pending_qty, 500); // not yet acknowledged
  assert.equal(b.ack_qty, 990);
  near(b.diff_qty, -10);
  near(b.diff_fat, -0.4); // 990*4% - 1000*4%
  // 0.032% of the litres sent on acknowledged rows only
  near(b.p032_fat, 0.32);
  // excess = actual diff + total norms
  near(b.excess_fat, b.diff_fat + b.total_fat);
  near(b.excess_snf, b.diff_snf + b.total_snf);
  near(r.total.qty, 2500);
  near(r.total.excess_fat, r.rows[0].excess_fat + b.excess_fat);
});

test('DMR workbook is built with a title and one line per BMC', async () => {
  const { buildDmr, buildDmrWorkbook } = await import('../dist/lib/bmcDmr.js');
  const { default: ExcelJS } = await import('exceljs');
  const report = buildDmr([]);
  const buf = await buildDmrWorkbook(report, 'Namakkal', '2026-10-01', '2026-10-10');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('01-10');
  assert.ok(ws);
  assert.match(String(ws.getCell(1, 1).value), /NAMAKKAL/);
  assert.equal(ws.getCell(5, 2).value, 'Grand Total');
});

test('sheet name is dd-dd within a month and the full dates across months', async () => {
  const { periodSheetName } = await import('../dist/lib/sheetName.js');
  assert.equal(periodSheetName('2026-10-01', '2026-10-10'), '01-10');
  assert.equal(periodSheetName('2026-10-01', '2026-10-31'), '01-31');
  assert.equal(periodSheetName('2026-01-01', '2026-12-31'), '2026-01-01 to 2026-12-31');
});
