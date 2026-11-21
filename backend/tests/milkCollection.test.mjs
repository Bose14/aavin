import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';

const { prepareCollectionLines, summarizeCollection } = await import('../dist/lib/milkCollection.js');

const settings = {
  fat_min: 2, fat_max: 8, snf_min: 6, snf_max: 10,
  rate_base: 10, rate_fat_coeff: 5, rate_snf_coeff: 2,
};

test('prepares lines with chart rate and amount', () => {
  const out = prepareCollectionLines(
    [{ society_id: '5', cans: 1, litres: 7, fat_pct: 4.6, snf_pct: 8.1 }],
    settings,
  );
  assert.ok(out.lines);
  assert.equal(out.lines[0].society_id, 5);
  assert.equal(out.lines[0].rate, +(10 + 4.6 * 5 + 8.1 * 2).toFixed(2));
  assert.equal(out.lines[0].amount, +(7 * out.lines[0].rate).toFixed(2));
});

test('rejects empty, duplicate and out-of-range lines', () => {
  assert.ok(prepareCollectionLines([], settings).error);
  const a = { society_id: 1, litres: 10, fat_pct: 4, snf_pct: 8 };
  assert.match(prepareCollectionLines([a, a], settings).error, /twice/);
  assert.match(prepareCollectionLines([{ ...a, litres: 0 }], settings).error, /Litres/);
  assert.match(prepareCollectionLines([{ ...a, fat_pct: 12 }], settings).error, /Fat/);
  assert.match(prepareCollectionLines([{ ...a, snf_pct: 3 }], settings).error, /SNF/);
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
