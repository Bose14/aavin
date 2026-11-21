import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';

const require = createRequire(import.meta.url);
const { supabase } = require('../dist/supabase.js');
const { saveTanker } = require('../dist/lib/tripStore.js');

const input = {
  vehicle_number: 'tn28zz0001',
  contractor_name: 'Test Transport',
  from_date: '2026-11-21',
  vehicle_type: 'Registered',
  number_of_cells: 2,
  front_cell_capacity: 6000,
  back_cell_capacity: 5000,
  supplier_name: 'Test BMC',
};

/** Minimal chainable stand-in for the `tankers` table. */
function fakeTankers({ fail = false } = {}) {
  const rows = [];
  const chain = (result) => {
    const c = {
      select: () => c, eq: () => c, order: () => c, neq: () => c, is: () => c,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (res, rej) => Promise.resolve(result()).then(res, rej),
    };
    return c;
  };
  supabase.from = () => ({
    select: () => chain(() => ({ data: rows, error: null })),
    insert: (row) => {
      const saved = { id: rows.length + 1, id_token: 'TK00TEST001', is_active: true, created_at: 'now', ...row };
      return chain(() => {
        if (fail) return { data: null, error: { message: 'db down' } };
        rows.push(saved);
        return { data: saved, error: null };
      });
    },
  });
  return rows;
}

test('a registered tanker is saved to the tankers table with its cells', async () => {
  const rows = fakeTankers();
  const saved = await saveTanker('6', input);
  assert.equal(saved.vehicle_number, 'TN28ZZ0001');
  assert.equal(saved.number_of_cells, 2);
  assert.equal(saved.front_cell_capacity, 6000);
  assert.equal(saved.back_cell_capacity, 5000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_capacity_litres, 11000);
  assert.equal(rows[0].dairy_unit_id, '6');
});

test('a database failure is reported instead of pretending the tanker was saved', async () => {
  const rows = fakeTankers({ fail: true });
  await assert.rejects(() => saveTanker('6', input), /db down/);
  assert.equal(rows.length, 0);
});

test('a tanker needs at least one cell with a capacity', async () => {
  fakeTankers();
  await assert.rejects(() => saveTanker('6', { ...input, front_cell_capacity: 0, back_cell_capacity: 0 }), /cell/i);
});
