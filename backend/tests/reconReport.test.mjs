import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';

const { buildReconciliation } = await import('../dist/lib/reconReport.js');
const { buildReconPdf } = await import('../dist/lib/reconPdf.js');

const names = new Map([['1', 'NATTAR AGRAHARAM BMC'], ['2', 'KAMAKAPALAYAM BMC'], ['3', 'V. PUTHUPALAYAM BMC'], ['4', 'VERIVUKAL']]);

const trip = {
  trip_id: '1', trip_date: '2026-11-23', vehicle_number: 'TN15U2098',
  loadings: [
    { id: 1, bmc_id: 4, dc_number: '031431', cell_key: 'FC', quantity_litres: 4024, fat_pct: 4.1, snf_pct: 8.1, dispatch_at: '2026-11-23T08:00:00Z' },
    { id: 2, bmc_id: 3, dc_number: '121853', cell_key: 'FC', quantity_litres: 3476, fat_pct: 4.6, snf_pct: 8.5, dispatch_at: '2026-11-23T08:10:00Z' },
    { id: 3, bmc_id: 3, dc_number: '121853', cell_key: 'BC', quantity_litres: 1242, fat_pct: 4.6, snf_pct: 8.5, dispatch_at: '2026-11-23T08:10:00Z' },
  ],
  acks: [
    { bmc_id: 4, dc_number: '031431', ack_litres: 3988, ack_fat_pct: 4.08, ack_snf_pct: 8.11 },
    { bmc_id: 3, dc_number: '121853', ack_litres: 4676, ack_fat_pct: 4.57, ack_snf_pct: 8.51 },
  ],
  received_quality: [{ cell: 'FC', fat: 4.32, snf: 8.3, temp: 6, mbrt: '01:40' }, { cell: 'BC', fat: 4.25, snf: 8.2, temp: 6, mbrt: '01:50' }],
};

test('reconciliation: cells, ack at union per cell, ack to BMC once per BMC', () => {
  const [t] = buildReconciliation([trip], names);
  assert.equal(t.vehicle_number, 'TN15U2098');
  assert.equal(t.dc_number, '031431');
  assert.deepEqual(t.lines.map((l) => l.cell), ['FC', 'FC', 'BC']);
  // ack at union is shown on the last line of each cell only
  assert.equal(t.lines[0].union, null);
  assert.equal(t.lines[1].union.fat, 4.32);
  assert.equal(t.lines[1].union.mbrt, '01:40');
  assert.equal(t.lines[2].union.fat, 4.25);
  // a BMC in two cells gets its ack numbers on its first line only
  assert.equal(t.lines[1].to_bmc.litres, 4676);
  assert.equal(t.lines[2].to_bmc, null);
  assert.equal(t.lines[2].bmc_name, 'V. PUTHUPALAYAM BMC');
  // cell ack litres: FC = verivukal 3988 + puthupalayam share of FC (4676 * 3476/4718)
  assert.equal(t.lines[1].union.litres, Math.round(3988 + (4676 * 3476) / 4718));
});

test('a tanker with no acknowledgement still lists what was sent', () => {
  const [t] = buildReconciliation([{ ...trip, acks: [] }], names);
  assert.equal(t.lines.length, 3);
  assert.ok(t.lines.every((l) => l.union === null && l.to_bmc === null));
});

test('PDF is produced', async () => {
  const buf = await buildReconPdf({ title: 'SALEM DISTRICT COOPERATIVE MILK PRODUCERS\' UNION LTD.', address: 'SITHANUR, SALEM', from: '23/11/2026', to: '24/11/2026', tankers: buildReconciliation([trip], names) });
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});
