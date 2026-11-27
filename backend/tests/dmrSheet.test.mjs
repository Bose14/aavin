import test from 'node:test';
import assert from 'node:assert/strict';

const base = { shift: 'MOR', route: 'R1', milk_type: 'RCM', team: 'RPM', dest: '', tanker: 'TN1', kind: 'BMC' };
const near = (a, b, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('DMR sheet: BMC fat/SNF from the period sheet next to the invoice figures', async () => {
  const { buildAckDays } = await import('../dist/lib/milkAck.js');
  const { buildDmrSheet, makePctSource, buildDmrSheetWorkbook } = await import('../dist/lib/dmrSheet.js');
  const days = buildAckDays([
    { ...base, date: '2026-10-01', code: 12, name: 'VETTUKADU', inv_no: '1', qty: 10000, fat: 4.3, snf: 8.2, ack: null },
    { ...base, date: '2026-10-02', code: 12, name: 'VETTUKADU', inv_no: '2', qty: 7244, fat: 4.3, snf: 8.2, ack: null },
    { ...base, date: '2026-10-02', code: 99, name: 'CCX', kind: 'CC', inv_no: '3', qty: 500, fat: 4, snf: 8, ack: null },
  ]);
  const pct = makePctSource(
    [{ period_from: '2026-10-01', period_to: '2026-10-10', bmc_code: 12, qty: 17244, fat_lit: 741.782, snf_lit: 1414.133 }],
    [],
  );
  const r = buildDmrSheet(days, pct);
  assert.equal(r.rows.length, 1); // CC left out
  const v = r.rows[0];
  assert.equal(v.qty, 17244);
  near(v.lit_fat, 741.782);
  near(v.lit_snf, 1414.133);
  near(v.inv_lit_fat, 741.492); // 17244 x 4.30%
  near(v.diff_fat, 741.492 - 741.782);
  near(v.diff_snf, 1414.008 - 1414.133);
  assert.equal(v.diff_qty, 0);
  assert.equal(v.sg, 1.0279);
  near(v.kg, 17244 * 1.0279, 1); // sheet shows 17725
  assert.equal(v.estimated_qty, 0);
  const file = await buildDmrSheetWorkbook(r, '2026-10-01', '2026-10-10');
  assert.ok(file.length > 1000);
});

test('DMR sheet: live entries give the BMC fat/SNF; unknown BMCs fall back to the invoice', async () => {
  const { buildAckDays } = await import('../dist/lib/milkAck.js');
  const { buildDmrSheet, makePctSource } = await import('../dist/lib/dmrSheet.js');
  const days = buildAckDays([
    { ...base, date: '2026-11-02', code: 5, name: 'A', inv_no: '1', qty: 1000, fat: 4, snf: 8, ack: null },
    { ...base, date: '2026-11-02', code: 6, name: 'B', inv_no: '2', qty: 1000, fat: 4, snf: 8, ack: null },
  ]);
  const pct = makePctSource([], [
    { code: 5, qty: 100, fat_pct: 4.2, snf_pct: 8.1 },
    { code: 5, qty: 300, fat_pct: 4.0, snf_pct: 8.1 },
  ]);
  const r = buildDmrSheet(days, pct);
  near(r.rows[0].fat_pct, 4.05); // weighted by litres
  assert.equal(r.rows[1].estimated_qty, 1000);
  near(r.rows[1].diff_fat, 0);
  near(r.total.qty, 2000);
});
