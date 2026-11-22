import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';

const { round1, lookupRate, parseChartInput, outOfChartMessage } = await import('../dist/lib/rateChart.js');

const chart = {
  milk_type: 'BUFFALO',
  fat_values: [6, 6.1],
  snf_values: [8.3, 8.4],
  rates: [[43.53, 43.56], [44.29, 44.32]],
};

test('round1 rounds half up to one decimal', () => {
  assert.equal(round1(4.55), 4.6);
  assert.equal(round1(4.64), 4.6);
  assert.equal(round1(8.05), 8.1);
  assert.equal(round1(6), 6);
});

test('lookupRate finds the cell, or null outside the chart', () => {
  assert.equal(lookupRate(chart, 6.1, 8.4), 44.32);
  assert.equal(lookupRate(chart, 6.04, 8.26), 43.53); // 6.0 / 8.3
  assert.equal(lookupRate(chart, 5.9, 8.3), null);
  assert.equal(lookupRate(chart, 6, 9), null);
  assert.equal(lookupRate(chart, NaN, 8.3), null);
});

test('out-of-chart message names the supported ranges', () => {
  assert.match(outOfChartMessage(chart, 5, 8.3), /buffalo rate for Fat 5 \/ SNF 8.3.*Fat 6.0–6.1.*SNF 8.3–8.4/);
});

const good = {
  milk_type: 'cow',
  effective_from: '2026-12-01',
  name: ' Dec chart ',
  fat_values: [4.5, 4.6],
  snf_values: [8, 8.1],
  rates: [[42.25, 42.6], [42.6, 42.95]],
};

test('parseChartInput accepts a well-formed chart', () => {
  const out = parseChartInput(good);
  assert.equal(out.chart.milk_type, 'COW');
  assert.equal(out.chart.name, 'Dec chart');
  assert.deepEqual(out.chart.rates, good.rates);
});

test('parseChartInput rejects bad shapes with a clear message', () => {
  assert.match(parseChartInput({ ...good, milk_type: 'goat' }).error, /cow or buffalo/);
  assert.match(parseChartInput({ ...good, effective_from: '2026-13-45' }).error, /date/);
  assert.match(parseChartInput({ ...good, fat_values: [4.6, 4.5] }).error, /increasing/);
  assert.match(parseChartInput({ ...good, fat_values: [4.5, 4.5] }).error, /increasing/);
  assert.match(parseChartInput({ ...good, snf_values: [] }).error, /SNF/);
  assert.match(parseChartInput({ ...good, rates: [[1, 2]] }).error, /every fat row|rate for each/);
  assert.match(parseChartInput({ ...good, rates: [[42, 43], [44]] }).error, /every SNF/);
  assert.match(parseChartInput({ ...good, rates: [[42, ''], [44, 45]] }).error, /missing or invalid/);
  assert.match(parseChartInput({ ...good, rates: [[42, -1], [44, 45]] }).error, /missing or invalid/);
  assert.match(parseChartInput({ ...good, rates: [[42, 43.123], [44, 45]] }).error, /2 decimals/);
});
