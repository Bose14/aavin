import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('every successful write clears the shared query cache', () => {
  const api = read('lib/api.ts');
  assert.match(api, /method !== 'get'\) queryClient\.clear\(\)/);
});

test('the cache is cleared when the user signs out', () => {
  const app = read('App.tsx');
  assert.match(app, /SIGNED_OUT/);
  assert.match(app, /queryClient\.clear\(\)/);
  assert.match(app, /<QueryClientProvider client=\{queryClient\}>/);
});

test('live operational screens are not cached', () => {
  // Gate, QC and unloading poll for fresh trip state; they must keep calling the API directly.
  for (const f of ['pages/plant/GateOperations.tsx', 'pages/plant/QCLab.tsx', 'pages/plant/UnloadingBay.tsx']) {
    assert.doesNotMatch(read(f), /cachedGet/, `${f} must not use the cache`);
  }
});

test('BMC list and dashboards read through the cache', () => {
  assert.match(read('pages/admin/AdminBmcs.tsx'), /cachedGet<Unit\[\]>\('\/bmcs'/);
  assert.match(read('pages/admin/AdminDashboard.tsx'), /cachedGet<ProcessAnalyticsResponse>/);
  assert.match(read('pages/unit/UnitDashboard.tsx'), /cachedGet<ProcessAnalyticsResponse>/);
});
