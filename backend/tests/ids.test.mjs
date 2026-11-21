import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ID_TOKEN_RE, isIdToken, idLookup } = require('../dist/lib/ids.js');

// supabase.ts needs env vars at import time
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
const { stringifyIds } = require('../dist/supabase.js');

test('id_token format: 2 letters + 00 + 4 capitals + 3 digits (11 characters)', () => {
  for (const token of ['US00ASCF123', 'TM00KQWB417', 'BM00LPDR902', 'ZN00ABCD000']) {
    assert.equal(token.length, 11);
    assert.ok(ID_TOKEN_RE.test(token), token);
    assert.ok(isIdToken(token));
  }
  for (const bad of ['', 'US01ASCF123', 'us00ASCF123x', 'US00ASC1123', 'US00ASCF12', 'US00ASCFABC', 'USASCF123', 42, null]) {
    assert.equal(isIdToken(bad), false, String(bad));
  }
});

test('idLookup accepts a numeric id or an id_token and rejects anything else', () => {
  assert.deepEqual(idLookup('12'), { column: 'id', value: '12' });
  assert.deepEqual(idLookup(12), { column: 'id', value: '12' });
  assert.deepEqual(idLookup('us00ascf123'), { column: 'id_token', value: 'US00ASCF123' });
  assert.deepEqual(idLookup(' US00ASCF123 '), { column: 'id_token', value: 'US00ASCF123' });
  assert.equal(idLookup('abc'), null);
  assert.equal(idLookup("1; drop table users"), null);
  assert.equal(idLookup(undefined), null);
});

test('stringifyIds turns numeric id and *_id values into strings and leaves other numbers alone', () => {
  const input = [
    {
      id: 5,
      id_token: 'US00ASCF123',
      bmc_id: 2,
      zone_id: 1,
      quantity_litres: 120.5,
      bmcs: { id: 2, bmc_code: 'RNK-001' },
      compartments: [{ cell_index: 0, quantity_litres: 500 }],
      team_id: null,
    },
  ];
  const [row] = stringifyIds(input);
  assert.equal(row.id, '5');
  assert.equal(row.bmc_id, '2');
  assert.equal(row.zone_id, '1');
  assert.equal(row.bmcs.id, '2');
  assert.equal(row.team_id, null);
  assert.equal(row.quantity_litres, 120.5);
  assert.equal(row.compartments[0].cell_index, 0);
  assert.equal(row.compartments[0].quantity_litres, 500);
  assert.equal(stringifyIds(null), null);
  assert.equal(stringifyIds('x'), 'x');
});
