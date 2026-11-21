import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installFakeSupabase } from './helpers/fakeSupabase.mjs';

process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';

const require = createRequire(import.meta.url);
const { saveRegisteredTankerInDb, findRegisteredTankerInDb } = require('../dist/lib/settingsStore.js');

const tanker = {
  vehicle_number: 'tn28zz0001',
  contractor_name: 'Test Transport',
  from_date: '2026-11-21',
  vehicle_type: 'Registered',
  number_of_cells: 2,
  front_cell_capacity: 6000,
  back_cell_capacity: 5000,
  supplier_name: 'Test BMC',
};

test('a registered tanker is saved to the database and can be found again', async () => {
  const { rows } = installFakeSupabase();
  const saved = await saveRegisteredTankerInDb(tanker);
  assert.equal(saved.vehicle_number, 'TN28ZZ0001');
  assert.ok(rows.has('TN28ZZ0001'), 'row must reach the database');
  const found = await findRegisteredTankerInDb('TN28ZZ0001');
  assert.equal(found?.contractor_name, 'Test Transport');
});

test('a database failure is reported instead of pretending the tanker was saved', async () => {
  const { rows } = installFakeSupabase({ failRegisteredTankers: true });
  await assert.rejects(() => saveRegisteredTankerInDb(tanker), /Could not save tanker to database/);
  assert.equal(rows.size, 0);
});
