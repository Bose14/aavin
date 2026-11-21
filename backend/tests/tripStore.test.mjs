import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abc';

const store = await import('../dist/lib/tripStore.js');
const { enrichTankerRow } = await import('../dist/routes/tanker.js');

const cells3 = [
  { cell_key: 'FC', capacity_litres: 5000 },
  { cell_key: 'MC', capacity_litres: 4000 },
  { cell_key: 'BC', capacity_litres: 5000 },
];

const tankerRow = {
  id: 7, id_token: 'TK00ABCD001', vehicle_number: 'TN34AK9999', contractor_name: 'C', supplier_name: 'S',
  vehicle_type: null, from_date: '2026-01-01', cells: cells3, dairy_unit_id: 6, is_active: true, created_at: '2026-01-01',
};

function loading(id, bmcId, name, cell, qty, dc, extra = {}) {
  return {
    id, bmc_id: bmcId, cell_key: cell, dc_number: dc, outlet_seal_no: 'OS1', cell_seal_no: 'CS' + id,
    shift: 'MOR', milk_type: 'RCM', quantity_litres: qty, fat_pct: 4.0, snf_pct: 8.5, temperature: 4,
    dispatch_time_text: '09:30 AM', dispatch_at: `2026-11-20T04:0${id}:00Z`, bmcs: { name, bmc_code: name.slice(0, 3).toUpperCase() },
    ...extra,
  };
}

const trip = (extra = {}) => ({
  id: 11, id_token: 'TR00ABCD001', tanker_id: 7, dairy_unit_id: 6, trip_date: '2026-11-20', status: 'on_the_way',
  cells: cells3, capacity_litres: 14000, loaded_litres: 0, driver_name: 'Raman', driver_phone: '9876543210',
  tankers: { vehicle_number: 'TN34AK9999' }, dairy_units: { name: 'Namakkal' }, created_at: '2026-11-20T04:00:00Z', ...extra,
});

test('registration cells: only filled cells are kept, count follows the form', () => {
  assert.deepEqual(store.cellsFromRegistration({ number_of_cells: 1, front_cell_capacity: 6500 }), [{ cell_key: 'FC', capacity_litres: 6500 }]);
  assert.deepEqual(
    store.cellsFromRegistration({ number_of_cells: 2, front_cell_capacity: 6000, back_cell_capacity: 6000 }).map((c) => c.cell_key),
    ['FC', 'BC'],
  );
  assert.equal(store.cellsFromRegistration({ number_of_cells: 3, front_cell_capacity: 5000, middle_cell_capacity: 4000, back_cell_capacity: 5000 }).length, 3);
});

test('shapeTanker returns the registration form shape', () => {
  const t = store.shapeTanker(tankerRow);
  assert.equal(t.id, '7');
  assert.equal(t.number_of_cells, 3);
  assert.equal(t.front_cell_capacity, 5000);
  assert.equal(t.middle_cell_capacity, 4000);
  assert.equal(t.back_cell_capacity, 5000);
});

test('helpers: milk type, shift, IST timestamp, vehicle normalisation', () => {
  assert.equal(store.milkTypeToCode('Raw Cow Milk'), 'RCM');
  assert.equal(store.milkTypeToLabel('RCM'), 'Raw Cow Milk');
  assert.equal(store.shiftFromTime('09:30 AM'), 'MOR');
  assert.equal(store.shiftFromTime('04:15 PM'), 'EVE');
  assert.equal(store.shiftFromTime('16:15'), null);
  assert.equal(store.istTimestamp('2026-11-20', '10:30 AM'), '2026-11-20T05:00:00.000Z');
  assert.equal(store.istTimestamp('2026-11-20', '12:05 AM'), '2026-11-19T18:35:00.000Z');
  assert.equal(store.normalizeVehicle(' tn34-ak 9999 '), 'TN34AK9999');
});

test('two BMCs on one tanker: compartments, DC numbers and totals are merged per cell', () => {
  const loadings = [
    loading(1, 101, 'Rasipuram', 'FC', 3000, 'DC-1'),
    loading(2, 202, 'Kalipatti', 'FC', 1500, 'DC-2', { fat_pct: 5.0 }),
    loading(3, 202, 'Kalipatti', 'MC', 4000, 'DC-2'),
  ];
  const row = store.shapeTrip(trip({ loaded_litres: 8500 }), loadings, []);
  assert.equal(row.quantity_dispatched, 8500);
  assert.equal(row.destination, 'Namakkal Dairy');
  assert.equal(row.dc_number, 'DC-1, DC-2');
  // one entry per BMC per cell, each with its own BMC / DC / quality
  assert.equal(row.compartments.length, 3);
  const fcs = row.compartments.filter((c) => c.cell_key === 'FC');
  assert.equal(fcs.length, 2);
  assert.deepEqual(fcs.map((c) => [c.bmc_name, c.dc_number, c.quantity_litres, c.fat_pct]), [
    ['Rasipuram [RAS]', 'DC-1', 3000, 4],
    ['Kalipatti [KAL]', 'DC-2', 1500, 5],
  ]);
  assert.equal(fcs[0].cell, 'FC');
  assert.equal(fcs[0].milk_type, 'Raw Cow Milk');
  assert.equal(row.stage_data.bmc_dispatches.length, 2);
  assert.deepEqual(row.stage_data.bmc_dispatches.map((d) => d.quantity_dispatched).sort(), [3000, 5500].sort());
});

test('availability: partial load keeps the tanker open for other BMCs; full tanker is not offered', () => {
  const tanker = store.shapeTanker(tankerRow);
  const empty = store.buildTankerAvailability(tanker, null);
  assert.equal(empty.available_capacity, 14000);
  assert.equal(empty.is_available_for_dispatch, true);
  assert.equal(empty.has_active_trip, false);

  const partial = store.shapeTrip(trip(), [loading(1, 101, 'Rasipuram', 'FC', 3000, 'DC-1')], []);
  const a = store.buildTankerAvailability(tanker, partial);
  assert.equal(a.filled_capacity, 3000);
  assert.equal(a.available_capacity, 11000);
  assert.equal(a.cells[0].available_litres, 2000);
  assert.equal(a.is_available_for_dispatch, true);
  assert.equal(a.active_trip_id, '11');

  const full = store.shapeTrip(
    trip(),
    [loading(1, 101, 'Rasipuram', 'FC', 5000, 'DC-1'), loading(2, 101, 'Rasipuram', 'MC', 4000, 'DC-1'), loading(3, 101, 'Rasipuram', 'BC', 5000, 'DC-1')],
    [],
  );
  const f = store.buildTankerAvailability(tanker, full);
  assert.equal(f.is_full, true);
  assert.equal(f.is_available_for_dispatch, false);
});

test('availability: a cell shared by two BMCs sums both loads', () => {
  const tanker = store.shapeTanker({ ...tankerRow, cells: [{ cell_key: 'FC', capacity_litres: 6500 }] });
  const row = store.shapeTrip(
    trip({ cells: [{ cell_key: 'FC', capacity_litres: 6500 }] }),
    [loading(1, 2, 'Kalipatti', 'FC', 3000, 'DC-1'), loading(2, 1, 'Rasipuram', 'FC', 3500, 'DC-2')],
    [],
  );
  assert.equal(row.compartments.length, 2);
  const a = store.buildTankerAvailability(tanker, row);
  assert.equal(a.filled_capacity, 6500);
  assert.equal(a.is_full, true);
});

test('availability: once the tanker has entered the gate it is no longer offered to BMCs', () => {
  const tanker = store.shapeTanker(tankerRow);
  const atGate = store.shapeTrip(trip({ status: 'vehicle_entered' }), [loading(1, 101, 'Rasipuram', 'FC', 3000, 'DC-1')], []);
  const a = store.buildTankerAvailability(tanker, atGate);
  assert.equal(a.is_at_plant, true);
  assert.equal(a.is_available_for_dispatch, false);
});

function stage(id, key, team, data = {}, status = 'done', at = `2026-11-20T0${id}:00:00Z`) {
  return { id, stage_key: key, team, status, done_by: '1', done_by_name: 'Op', done_at: at, data };
}

test('journey: a shaped trip reflects each plant stage and ends at exit', () => {
  const loadings = [loading(1, 101, 'Rasipuram', 'FC', 6000, 'DC-1')];
  const stages = [stage(1, 'vehicle_entered', 'gate', { vehicle_number: 'TN34AK9999' })];
  let row = store.shapeTrip(trip({ status: 'vehicle_entered', loaded_litres: 6000 }), loadings, stages);
  let e = enrichTankerRow(row, store.toStageRecordItems(stages), undefined);
  assert.equal(e.journey.currentStageKey, 'gross_weight');
  assert.equal(e.waiting_team, 'gate');

  stages.push(stage(2, 'gross_weight', 'gate', { gross_weight_kg: 20000 }));
  row = store.shapeTrip(trip({ status: 'gross_done', loaded_litres: 6000, gross_weight_kg: 20000 }), loadings, stages);
  e = enrichTankerRow(row, store.toStageRecordItems(stages), undefined);
  assert.equal(e.journey.currentStageKey, 'qc_completed');
  assert.equal(e.gross_weight_kg, 20000);
});

test('journey: QC rejection skips unloading', () => {
  const loadings = [loading(1, 101, 'Rasipuram', 'FC', 6000, 'DC-1')];
  const stages = [
    stage(1, 'vehicle_entered', 'gate'),
    stage(2, 'gross_weight', 'gate', { gross_weight_kg: 20000 }),
    stage(3, 'qc_completed', 'qc', { rejection_reason: 'Sour' }, 'rejected'),
    stage(4, 'unloaded', 'unloading', { note: 'Skipped' }, 'skipped'),
  ];
  const row = store.shapeTrip(trip({ status: 'qc_rejected', qc_status: 'rejected', gross_weight_kg: 20000 }), loadings, stages);
  const e = enrichTankerRow(row, store.toStageRecordItems(stages), undefined);
  assert.equal(e.journey.currentStageKey, 'tare_weight');
});

test('latestStages keeps the most recent record when CIP is repeated', () => {
  const stages = [
    stage(1, 'cip_completed', 'qc', {}, 'rejected', '2026-11-20T10:00:00Z'),
    stage(2, 'cip_completed', 'qc', {}, 'done', '2026-11-20T11:00:00Z'),
  ];
  const latest = store.latestStages(stages);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].status, 'done');
});

test('client response drops repeated copies but keeps what the screens read', async () => {
  const { slimTankerForClient } = await import('../dist/routes/tanker.js');
  const loadings = [loading(1, 101, 'Rasipuram', 'FC', 3000, 'DC-1'), loading(2, 202, 'Kalipatti', 'FC', 3000, 'DC-2')];
  const stages = [
    stage(1, 'vehicle_entered', 'gate', { tanker_number: 'TN34AK9999', seal_number: 'S1', driver_name: 'Raman' }),
    stage(2, 'gross_weight', 'gate', { gross_weight_kg: 20000, quality_breakdown: [{ cell: 'FC' }] }),
    stage(3, 'qc_completed', 'qc', { test_categories: { FC: { a: 1 } }, freshness_test: { FC: { a: 1 } }, special_test: { FC: { a: 1 } }, received_quality: [{ cell: 'FC', fat: '4', snf: '8' }] }),
  ];
  const row = store.shapeTrip(trip({ status: 'qc_done', loaded_litres: 6000, gross_weight_kg: 20000 }), loadings, stages);
  const full = enrichTankerRow(row, store.toStageRecordItems(stages), undefined);
  const slim = slimTankerForClient(full);

  assert.equal('stages' in slim, false);
  assert.equal('compartments' in slim.journey, false);
  assert.equal('compartments' in slim.stage_data, false);
  assert.equal(slim.stage_data.bmc_dispatches.every((d) => !('compartments' in d)), true);
  assert.equal('freshness_test' in slim.stage_data.qc_completed, false);
  assert.ok(slim.stage_data.qc_completed.test_categories);

  // what the screens use is still there
  assert.equal(slim.compartments.length, 2);
  assert.equal(slim.stage_data.gross_weight.quality_breakdown.length, 1);
  assert.equal(slim.stage_data.qc_completed.received_quality[0].fat, '4');
  assert.equal(slim.journey.timelineSteps[0].data.tanker_number, 'TN34AK9999');
  assert.ok(slim.journey.timelineSteps[0].keyDataSummary);
  assert.equal(slim.journey.calculated.gross_weight_kg, 20000);
  assert.ok(JSON.stringify(slim).length < JSON.stringify(full).length * 0.6);
  // the in-process version used by exports and analytics is untouched
  assert.ok(Array.isArray(full.stages) && full.journey.compartments);
});
