import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';

const { allocateAcknowledgements, cellQualityFromQc } = await import('../dist/lib/ack.js');
const { buildMilkAckRows, ackTitle, ACK_COLUMNS } = await import('../dist/lib/milkAckReport.js');

const q = { fat: 4.2, snf: 8.4 };

test('received litres are shared in proportion to what each BMC sent (A 4000, B 3000, C 3000 -> 9900)', () => {
  const rows = [
    { bmc_id: '1', dc_number: 'A', cell_litres: { FC: 4000 } },
    { bmc_id: '2', dc_number: 'B', cell_litres: { FC: 3000 } },
    { bmc_id: '3', dc_number: 'C', cell_litres: { FC: 3000 } },
  ];
  const out = allocateAcknowledgements(rows, 9900, { FC: q }, q);
  assert.deepEqual(out.map((r) => r.ack_litres), [3960, 2970, 2970]);
  assert.equal(out.reduce((s, r) => s + r.ack_litres, 0), 9900);
});

test('rounding leftover goes to the last BMC so the total is exact', () => {
  const rows = [
    { bmc_id: '1', dc_number: 'A', cell_litres: { FC: 1000 } },
    { bmc_id: '2', dc_number: 'B', cell_litres: { FC: 1000 } },
    { bmc_id: '3', dc_number: 'C', cell_litres: { FC: 1000 } },
  ];
  const out = allocateAcknowledgements(rows, 2999.99, { FC: q }, q);
  assert.equal(Math.round(out.reduce((s, r) => s + r.ack_litres, 0) * 100) / 100, 2999.99);
});

test('fat/SNF follow the cell each BMC loaded; a BMC across two cells gets the litre-weighted result', () => {
  const rows = [
    { bmc_id: '1', dc_number: 'A', cell_litres: { FC: 3000, BC: 1000 } },
    { bmc_id: '2', dc_number: 'B', cell_litres: { BC: 2000 } },
  ];
  const quality = { FC: { fat: 4.0, snf: 8.0 }, BC: { fat: 5.0, snf: 9.0 } };
  const out = allocateAcknowledgements(rows, 6000, quality, q);
  assert.equal(out[0].ack_fat_pct, 4.25); // (3000*4 + 1000*5) / 4000
  assert.equal(out[0].ack_snf_pct, 8.25);
  assert.equal(out[1].ack_fat_pct, 5);
});

test('BMCs sharing a cell share its result; missing cell test falls back to the tanker value', () => {
  const rows = [
    { bmc_id: '1', dc_number: 'A', cell_litres: { FC: 3000 } },
    { bmc_id: '2', dc_number: 'B', cell_litres: { FC: 3500 } },
  ];
  const shared = allocateAcknowledgements(rows, 6500, { FC: { fat: 4.3, snf: 8.45 } }, q);
  assert.deepEqual(shared.map((r) => r.ack_fat_pct), [4.3, 4.3]);
  const fb = allocateAcknowledgements(rows, 6500, {}, q);
  assert.deepEqual(fb.map((r) => r.ack_snf_pct), [8.4, 8.4]);
});

test('QC received_quality list becomes per-cell results (several entries per cell are averaged)', () => {
  const m = cellQualityFromQc([
    { cell: 'fc', fat: '4.0', snf: '8.0', qty: '1000' },
    { cell: 'FC', fat: '5.0', snf: '9.0', qty: '1000' },
    { cell: 'BC', fat: '0', snf: '8', qty: '500' },
  ]);
  assert.deepEqual(m, { FC: { fat: 4.5, snf: 8.5 } });
});

const view = (trip, bmc, dc, extra) => ({
  trip_id: trip, trip_date: '2026-11-21', dispatch_at: `2026-11-21T0${trip}:00:00Z`, shift: 'MOR', kind: 'BMC',
  route_name: null, milk_type: 'RCM', team_name: null, code_no: null, bmc_code: bmc, bmc_name: bmc, dest: 'Namakkal',
  vehicle_number: 'TN1', dc_number: dc, inv_l: 4000, inv_fat: 4.2, inv_snf: 8.4, inv_lit_fat: 168, inv_lit_snf: 336,
  inv_kg: 4115.2, inv_sp: 1.0288, inv_kg_fat: 172.838, inv_kg_snf: 345.677, ack_litres: 3960, ack_fat: 4.2, ack_snf: 8.4,
  ack_lit_fat: 166.32, ack_lit_snf: 332.64, ack_kg: 4074, ack_sp: 1.0288, ack_kg_fat: 171.11, ack_kg_snf: 342.22,
  qty_diff_lit: -40, diff_fat_kg: -1.7, diff_snf_kg: -3.4, fat_lit_diff: -1.68, snf_lit_diff: -3.36, milk30_kg: 12,
  milk30_lit: 11.66, milk30_lit_fat: 0.49, milk30_lit_snf: 0.98, norm_fat_032: 1.28, norm_snf_032: 1.28,
  allowed_fat: 1.77, allowed_snf: 2.26, above_fat: 0.09, above_snf: -1.1, net_loss_fat: 0, net_loss_snf: -1.1, ...extra,
});

test('statement: one row per BMC then a TOTAL row per tanker, in the statement column order', () => {
  const rows = buildMilkAckRows([view(1, 'A', 'D1'), view(1, 'B', 'D2'), view(2, 'C', 'D3')], (d) => d);
  assert.equal(rows.length, 5);
  assert.deepEqual(Object.keys(rows[0]), [...ACK_COLUMNS]);
  assert.equal(rows[2]['NAME OF THE BMC/CC'], 'TOTAL');
  assert.equal(rows[2]['Dmr/Inv.Qty (In Lts.)'], 8000);
  assert.equal(rows[2]['Ack. Qty ( In Lts.)'], 7920);
  assert.equal(rows[2]['Inv. Fat%'], 4.2); // litre-weighted from the totals
  assert.equal(rows[2]['Net Loss Snf'], -2.2);
  assert.equal(rows[4]['NAME OF THE BMC/CC'], 'TOTAL');
  assert.equal(rows[3]['NAME OF THE BMC/CC'], 'C');
});

test('ackTitle: month, single day and period headings', () => {
  assert.equal(ackTitle('Namakkal Dairy', '2026-09-01', '2026-09-30'), 'NAMAKKAL UNION-MILK DISPOSAL AND ACKNOWLEDGEMENT- STATEMENT FOR THE MONTH OF SEP-2026');
  assert.match(ackTitle('Namakkal Dairy', '2026-11-23', '2026-11-23'), /FOR THE DATE 23-11-2026$/);
  assert.match(ackTitle('Namakkal Dairy', '2026-11-01', '2026-11-23'), /FOR THE PERIOD 01-11-2026 TO 23-11-2026$/);
});
