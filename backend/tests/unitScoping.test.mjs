process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
import test from 'node:test';
import assert from 'node:assert/strict';

const paging = () => import('../dist/lib/paging.js');
const tripStore = () => import('../dist/lib/tripStore.js');
const client = () => import('../dist/supabase.js');

/**
 * Replace supabase.from() with a recorder. Every chain is logged as
 * { table, op, filters } and resolves with whatever `respond` returns.
 */
async function installFake(respond) {
  const { supabase } = await client();
  const log = [];
  const original = supabase.from;
  supabase.from = (table) => {
    const call = { table, op: 'select', filters: {}, range: null, payload: null };
    log.push(call);
    const b = {};
    for (const m of ['select', 'order', 'neq', 'gte', 'lte', 'is', 'or', 'limit', 'in']) b[m] = () => b;
    b.eq = (col, val) => { call.filters[col] = val; return b; };
    b.range = (a, z) => { call.range = [a, z]; return b; };
    b.update = (p) => { call.op = 'update'; call.payload = p; return b; };
    b.delete = () => { call.op = 'delete'; return b; };
    b.insert = (p) => { call.op = 'insert'; call.payload = p; return b; };
    const result = () => Promise.resolve(respond(call) ?? { data: [], error: null });
    b.maybeSingle = result;
    b.single = result;
    b.then = (ok, bad) => result().then(ok, bad);
    return b;
  };
  return { log, restore: () => { supabase.from = original; } };
}

test('fetchAllPages walks past the 1,000-row PostgREST cap', async () => {
  const { fetchAllPages } = await paging();
  const total = 2505;
  const seen = [];
  const res = await fetchAllPages(async (from, to) => {
    seen.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ id: i });
    return { data: rows, error: null };
  });
  assert.equal(res.error, null);
  assert.equal(res.data.length, total);
  assert.deepEqual(seen, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(new Set(res.data.map((r) => r.id)).size, total);
});

test('fetchAllPages stops on the first error and returns no partial data', async () => {
  const { fetchAllPages } = await paging();
  let calls = 0;
  const res = await fetchAllPages(async () => {
    calls++;
    return calls === 1
      ? { data: new Array(1000).fill({ id: 1 }), error: null }
      : { data: null, error: { message: 'boom' } };
  });
  assert.equal(res.data, null);
  assert.equal(res.error.message, 'boom');
  assert.equal(calls, 2);
});

test('fetchAllByIds chunks long id lists and merges pages', async () => {
  const { fetchAllByIds, chunk } = await paging();
  assert.equal(chunk(Array.from({ length: 401 }, (_, i) => String(i))).length, 3);
  const sizes = [];
  const res = await fetchAllByIds(Array.from({ length: 400 }, (_, i) => String(i)), async (ids) => {
    sizes.push(ids.length);
    return { data: ids.map((id) => ({ id })), error: null };
  });
  assert.equal(res.data.length, 400);
  assert.ok(sizes.every((n) => n <= 150));
});

test('updateTrip only touches a trip inside the caller\'s dairy unit', async () => {
  const { updateTrip } = await tripStore();
  const fake = await installFake(() => ({ data: null, error: null }));
  try {
    await updateTrip('trip-1', { status: 'exited', not_a_column: 1 }, 'unit-A');
  } finally { fake.restore(); }
  const upd = fake.log.find((c) => c.op === 'update');
  assert.equal(upd.table, 'tanker_trips');
  assert.equal(upd.filters.id, 'trip-1');
  assert.equal(upd.filters.dairy_unit_id, 'unit-A');
  assert.deepEqual(upd.payload, { status: 'exited' });
});

test('updateStageData refuses a trip that belongs to another dairy unit', async () => {
  const { updateStageData } = await tripStore();
  // The ownership lookup finds nothing for unit-B, so no stage may be read or written.
  const fake = await installFake((c) => (c.table === 'tanker_trips' ? { data: null, error: null } : { data: [{ id: 's1' }], error: null }));
  let out;
  try {
    out = await updateStageData('trip-of-unit-A', 'unloaded', { data: { unloaded_litres: 1 } }, 'unit-B');
  } finally { fake.restore(); }
  assert.equal(out, null);
  assert.equal(fake.log.filter((c) => c.table === 'trip_stages').length, 0);
  const lookup = fake.log.find((c) => c.table === 'tanker_trips');
  assert.equal(lookup.filters.dairy_unit_id, 'unit-B');
});

test('deleteTrip scopes the delete itself by dairy unit, not just the lookup', async () => {
  const { deleteTrip } = await tripStore();
  const fake = await installFake((c) => (c.op === 'select' ? { data: { id: 'T1', status: 'on_the_way' }, error: null } : { data: null, error: null }));
  let out;
  try {
    out = await deleteTrip('unit-A', '42', null);
  } finally { fake.restore(); }
  assert.equal(out, 'deleted');
  const del = fake.log.find((c) => c.op === 'delete');
  assert.equal(del.table, 'tanker_trips');
  assert.equal(del.filters.id, 'T1');
  assert.equal(del.filters.dairy_unit_id, 'unit-A');
});

test('fetchTrips returns every trip when more than 1,000 match', async () => {
  const { fetchTrips } = await tripStore();
  const fake = await installFake((c) => {
    if (c.table !== 'tanker_trips') return { data: [], error: null };
    const [from, to] = c.range;
    const rows = [];
    for (let i = from; i <= Math.min(to, 1499); i++) rows.push({ id: `t${i}`, trip_date: '2026-11-01', tanker_id: 'k', status: 'exited' });
    return { data: rows, error: null };
  });
  let out;
  try {
    out = await fetchTrips({ dairyUnitId: 'unit-A' });
  } finally { fake.restore(); }
  const tripCalls = fake.log.filter((c) => c.table === 'tanker_trips');
  assert.equal(tripCalls.length, 2, 'two pages requested');
  assert.ok(tripCalls.every((c) => c.filters.dairy_unit_id === 'unit-A'));
  assert.equal(out.rows.length, 1500);
});
