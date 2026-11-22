import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';

const { prepareCollectionLines, summarizeCollection } = await import('../dist/lib/milkCollection.js');

// a small cow chart: fat 4.5-4.7 x snf 8.0-8.2
const chart = {
  milk_type: 'COW',
  fat_values: [4.5, 4.6, 4.7],
  snf_values: [8.0, 8.1, 8.2],
  rates: [
    [42.25, 42.6, 42.95],
    [42.6, 42.95, 43.4],
    [42.95, 43.31, 43.78],
  ],
};
const settings = chart;

test('prepares lines with chart rate and amount', () => {
  const out = prepareCollectionLines(
    [{ society_id: '5', cans: 1, litres: 7, fat_pct: 4.6, snf_pct: 8.1 }],
    settings,
  );
  assert.ok(out.lines);
  assert.equal(out.lines[0].society_id, 5);
  assert.equal(out.lines[0].rate, 42.95);
  assert.equal(out.lines[0].amount, +(7 * out.lines[0].rate).toFixed(2));
});

test('rejects empty, duplicate and out-of-range lines', () => {
  assert.ok(prepareCollectionLines([], settings).error);
  const a = { society_id: 1, litres: 10, fat_pct: 4.6, snf_pct: 8.1 };
  assert.match(prepareCollectionLines([a, a], settings).error, /twice/);
  assert.match(prepareCollectionLines([{ ...a, litres: 0 }], settings).error, /Litres/);
  assert.match(prepareCollectionLines([{ ...a, fat_pct: 12 }], settings).error, /No cow rate for Fat 12/);
  assert.match(prepareCollectionLines([{ ...a, snf_pct: 3 }], settings).error, /SNF 3/);
  assert.match(prepareCollectionLines([{ ...a, fat_pct: 0 }], settings).error, /Fat/);
  assert.match(prepareCollectionLines([{ ...a, cans: 1.5 }], settings).error, /Cans/);
});

test('summary matches the sample screen (kg fat/snf from litres x %)', () => {
  const rows = [
    { society_id: 1, cans: 1, litres: 7, fat_pct: 4.6, snf_pct: 8.1 },
    { society_id: 2, cans: 1, litres: 5, fat_pct: 4.5, snf_pct: 8.1 },
  ];
  const { lines } = prepareCollectionLines(rows, settings);
  const t = summarizeCollection(lines);
  assert.equal(t.cans, 2);
  assert.equal(t.litres, 12);
  assert.equal(t.lt_fat, +(7 * 4.6 / 100 + 5 * 4.5 / 100).toFixed(3));
  assert.equal(t.fat_pct, +(((7 * 4.6 + 5 * 4.5) / 12)).toFixed(2));
  assert.equal(t.rate_per_litre, +(t.amount / 12).toFixed(2));
});

test('fat and snf are priced at the nearest 0.1 row', () => {
  const out = prepareCollectionLines([{ society_id: 1, litres: 10, fat_pct: 4.64, snf_pct: 8.06 }], chart);
  assert.equal(out.lines[0].rate, 42.95); // 4.6 / 8.1
  assert.equal(out.lines[0].fat_pct, 4.64); // the reading itself is kept as entered
});
