import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';

const { buildDispatchAckRows } = await import('../dist/lib/tripDetails.js');

test('dispatched vs acknowledged figures for one BMC', () => {
  const rows = buildDispatchAckRows(
    [{ bmc_id: 2, dc_number: 'DC1', cell_key: 'FC', quantity_litres: 726, fat_pct: 4.2, snf_pct: 8.4, milk_type: 'RCM' }],
    [{ bmc_id: 2, dc_number: 'DC1', ack_litres: 722, ack_fat_pct: 4.23, ack_snf_pct: 8.36 }],
    new Map([['2', { name: 'Kalipatti', code: 'BMC-002' }]]),
  );
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.bmc_name, 'Kalipatti');
  assert.equal(r.dispatched.sp_gr, 1.0288);
  assert.equal(r.dispatched.kg, 746.9);
  assert.equal(r.dispatched.fat_kg, 31.37);
  assert.equal(r.acknowledged.sp_gr, 1.0286);
  assert.equal(r.difference.litres, -4);
  assert.equal(r.difference.fat_pct, 0.03);
});

test('no acknowledgement yet, and several cells merge into one row', () => {
  const rows = buildDispatchAckRows(
    [
      { bmc_id: 3, dc_number: 'D', cell_key: 'FC', quantity_litres: 1000, fat_pct: 4, snf_pct: 8, milk_type: 'RCM' },
      { bmc_id: 3, dc_number: 'D', cell_key: 'BC', quantity_litres: 3000, fat_pct: 5, snf_pct: 9, milk_type: 'RCM' },
    ],
    [],
    new Map(),
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cells, ['BC', 'FC']);
  assert.equal(rows[0].dispatched.litres, 4000);
  assert.equal(rows[0].dispatched.fat_pct, 4.75);
  assert.equal(rows[0].acknowledged, null);
  assert.equal(rows[0].difference, null);
});

test('MBRT is read from the QC received quality of the BMC cells', () => {
  const q = [{ cell: 'FC', mbrt: '01:50' }, { cell: 'BC', mbrt: '01:10' }, { cell: 'MC', mbrt: '' }];
  const rows = buildDispatchAckRows(
    [{ bmc_id: 1, dc_number: 'D', cell_key: 'BC', quantity_litres: 100, fat_pct: 4, snf_pct: 8, milk_type: 'RCM' }],
    [],
    new Map(),
    q,
  );
  assert.equal(rows[0].mbrt, '01:10');
  assert.equal(buildDispatchAckRows([{ bmc_id: 1, dc_number: 'D', cell_key: 'MC', quantity_litres: 1, fat_pct: 4, snf_pct: 8 }], [], new Map(), q)[0].mbrt, null);
});
