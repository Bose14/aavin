import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../dist/lib/milkAck.js');

const base = { date: '2026-10-01', shift: 'MOR', kind: 'BMC', route: 'R.PUDUPATTY ROUTE', milk_type: 'RCM', team: 'RPM', dest: 'SNR', tanker: 'TN88Y9266' };
const near = (a, b, tol = 0.001) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('specific gravity follows the sheet (CLR = 4 x (SNF - 0.2 x Fat - 0.36))', async () => {
  const { specificGravity } = await load();
  assert.equal(specificGravity(4.2, 8.4), 1.0288);
  assert.equal(specificGravity(4.3, 8.3), 1.0283);
  assert.equal(specificGravity(4.2, 8.34), 1.0286);
});

test('Vellakalpatty 1 Oct matches the sheet row', async () => {
  const { computeAckRow } = await load();
  // Sheet: 446 L 4.2/8.4 sent, 443.8 L 4.20/8.34 acknowledged, tanker total 8,013 L
  const r = computeAckRow(
    { ...base, code: 73, name: 'VELLAKALPATTY', inv_no: '16909', qty: 446, fat: 4.2, snf: 8.4, ack: { qty: 443.8, fat: 4.2, snf: 8.34 } },
    8013,
  );
  near(r.lit_fat, 18.732); near(r.lit_snf, 37.464);
  assert.equal(Math.round(r.kg), 459); assert.equal(r.sg, 1.0288);
  near(r.kg_fat, 19.271); near(r.kg_snf, 38.543);
  assert.equal(Math.round(r.ack_kg), 456); assert.equal(r.ack_sg, 1.0286);
  near(r.ack_kg_fat, 19.176, 0.01); near(r.ack_kg_snf, 38.064, 0.02);
  near(r.qty_diff, -2.2, 0.05);
  near(r.diff_fat_kg, -0.1, 0.06); near(r.diff_snf_kg, -0.5, 0.06);
  near(r.kg30, 1.7, 0.05); near(r.kg30_lit, 1.6, 0.05);
  near(r.p032_fat, 0.1, 0.05);
  near(r.allowed_fat, 0.2, 0.05); near(r.allowed_snf, 0.3, 0.05);
  near(r.above_fat, 0.1, 0.05); near(r.above_snf, -0.2, 0.05);
  near(r.loss_fat, 0, 0.001); near(r.loss_snf, -0.2, 0.05);
});

test('a row that has not been acknowledged has no received or loss figures', async () => {
  const { computeAckRow } = await load();
  const r = computeAckRow({ ...base, code: 73, name: 'X', inv_no: '1', qty: 1000, fat: 4, snf: 8, ack: null }, 1000);
  assert.equal(r.acked, false);
  assert.equal(r.ack_qty, null); assert.equal(r.qty_diff, null); assert.equal(r.loss_fat, null);
  assert.equal(r.qty, 1000);
});

test('the 30 kg allowance is shared by litres across a tanker and the TOTAL row adds up', async () => {
  const { buildAckDays } = await load();
  const mk = (code, qty, aq) => ({ ...base, code, name: `B${code}`, inv_no: String(code), qty, fat: 4.2, snf: 8.1, ack: { qty: aq, fat: 4.2, snf: 8.1 } });
  const [day] = buildAckDays([mk(1, 3000, 2990), mk(2, 1000, 995)]);
  assert.equal(day.rows.length, 3);
  const [a, b, total] = day.rows;
  near(a.kg30, 22.5, 0.001); near(b.kg30, 7.5, 0.001);
  assert.equal(total.is_total, true); assert.equal(total.name, 'TOTAL');
  assert.equal(total.qty, 4000); near(total.kg30, 30, 0.001);
  near(total.ack_qty, 3985, 0.001); near(total.qty_diff, -15, 0.001);
  near(total.fat, 4.2, 0.0001);
});

test('CC rows with no route get no TOTAL line and days are sorted', async () => {
  const { buildAckDays } = await load();
  const cc = { ...base, date: '2026-10-02', route: '', kind: 'CC', code: 1, name: '', inv_no: '138', qty: 14970, fat: 0, snf: 8.6, ack: { qty: 14970, fat: 0, snf: 8.6 } };
  const bmc = { ...base, code: 73, name: 'B', inv_no: '1', qty: 500, fat: 4, snf: 8, ack: null };
  const days = buildAckDays([cc, bmc]);
  assert.deepEqual(days.map((d) => d.date), ['2026-10-01', '2026-10-02']);
  assert.equal(days[1].rows.length, 1);
  assert.equal(days[0].rows.length, 2);
});

test('month periods are 1-10, 11-20 and 21-end', async () => {
  const { monthPeriods } = await load();
  assert.deepEqual(monthPeriods('2026-10').map((p) => [p.from, p.to]), [['2026-10-01', '2026-10-10'], ['2026-10-11', '2026-10-20'], ['2026-10-21', '2026-10-31']]);
  assert.equal(monthPeriods('2026-02')[2].to, '2026-02-28');
  assert.equal(monthPeriods('2028-02')[2].to, '2028-02-29');
});
