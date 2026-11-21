import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Replaces the Supabase client's `from()` with an in-memory fake so tests run offline.
 *  - registered_tankers behaves like a real table (upsert / select / eq / order / maybeSingle).
 *  - every other table answers "relation does not exist", which is how the code treats a missing
 *    table (it then uses its local fallback store).
 * Pass `{ failRegisteredTankers: true }` to make registered_tankers return a database error.
 */
export function installFakeSupabase({ failRegisteredTankers = false } = {}) {
  const { supabase } = require('../../dist/supabase.js');
  const rows = new Map();
  const state = { failRegisteredTankers };

  const missing = { data: null, error: { code: '42P01', message: 'relation does not exist' } };

  function run(q) {
    if (q.table !== 'registered_tankers') return missing;
    if (state.failRegisteredTankers) {
      return { data: null, error: { code: '08006', message: 'connection failure' } };
    }
    if (q.op === 'upsert') {
      const row = { ...q.payload };
      rows.set(row.vehicle_number, row);
      return { data: q.single ? row : [row], error: null };
    }
    let list = [...rows.values()];
    for (const [col, val] of q.filters) list = list.filter((r) => r[col] === val);
    return { data: q.single ? (list[0] ?? null) : list, error: null };
  }

  supabase.from = (table) => {
    const q = { table, op: 'select', payload: null, filters: [], single: false };
    const builder = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return (resolve, reject) => Promise.resolve(run(q)).then(resolve, reject);
          return (...args) => {
            if (prop === 'upsert' || prop === 'insert') {
              q.op = 'upsert';
              q.payload = args[0];
            } else if (prop === 'eq') {
              q.filters.push([args[0], args[1]]);
            } else if (prop === 'maybeSingle' || prop === 'single') {
              q.single = true;
            }
            return builder;
          };
        },
      },
    );
    return builder;
  };

  return { rows, state };
}
