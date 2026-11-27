import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../dist/lib/bmcReceipts.js');

const bmc = (id, cc, name, cap, team = 'RPM') => ({ id, cc_code: cc, name, capacity: cap, team });

test('a normal day follows the sheet formulas (Vettukadu, 1 Oct)', async () => {
  const { buildReceiptDays, figureKey } = await load();
  const figures = new Map([[figureKey('1', '2026-10-01'), { am: 987, pm: 715, loaded: 1713, opening: 726 }]]);
  const [day] = buildReceiptDays([bmc('1', 12, 'VETTUKADU', 2000, 'NKL')], figures, '2026-10-01', '2026-10-01', '2026-10-01');
  const r = day.rows[0];
  assert.deepEqual(
    [r.ob, r.am, r.pm, r.total, r.to_send, r.cb, r.loaded, r.act_cb, r.diff, r.util, r.flag],
    [726, 987, 715, 1702, 1713, 715, 1713, 715, 0, 85, ''],
  );
});

test("next day opens with the previous day's actual closing balance", async () => {
  const { buildReceiptDays, figureKey } = await load();
  const figures = new Map([
    [figureKey('1', '2026-10-01'), { am: 987, pm: 715, loaded: 1713, opening: 726 }],
    [figureKey('1', '2026-10-02'), { am: 957, pm: 719, loaded: 1672 }],
  ]);
  const days = buildReceiptDays([bmc('1', 12, 'VETTUKADU', 2000)], figures, '2026-10-01', '2026-10-02', '2026-10-02');
  assert.equal(days.length, 1, 'only the requested days are returned');
  assert.equal(days[0].rows[0].ob, 715);
  assert.equal(days[0].rows[0].act_cb, 719);
});

test('milk left behind is flagged CB and carried to the next day (Thannerpandalpalayam, 2-3 Oct)', async () => {
  const { buildReceiptDays, figureKey } = await load();
  const figures = new Map([
    [figureKey('9', '2026-10-02'), { am: 2802, pm: 2306, loaded: 4825, opening: 2203 }],
    [figureKey('9', '2026-10-03'), { am: 2746, pm: 2366, loaded: 5232 }],
  ]);
  const days = buildReceiptDays([bmc('9', 89, 'THANNERPANDALPALAYAM', 5000, 'T.CODE')], figures, '2026-10-02', '2026-10-02', '2026-10-03');
  const d2 = days[0].rows[0];
  assert.deepEqual([d2.act_cb, d2.diff, d2.flag], [2486, -180, 'CB']);
  assert.equal(days[1].rows[0].ob, 2486);
});

test('TOTAL row sums the day and uses the summed capacity for utilisation', async () => {
  const { buildReceiptDays, figureKey } = await load();
  const figures = new Map([
    [figureKey('1', '2026-10-01'), { am: 987, pm: 715, loaded: 1713, opening: 726 }],
    [figureKey('2', '2026-10-01'), { am: 1748, pm: 705, loaded: 2502, opening: 754 }],
  ]);
  const [day] = buildReceiptDays([bmc('1', 12, 'A', 2000), bmc('2', 13, 'B', 3000)], figures, '2026-10-01', '2026-10-01', '2026-10-01');
  assert.equal(day.total.name, 'TOTAL');
  assert.deepEqual([day.total.capacity, day.total.ob, day.total.am, day.total.total, day.total.loaded], [5000, 1480, 2735, 4155, 4215]);
  assert.equal(day.total.util, Math.round((4155 / 5000) * 100));
});

test('days without data carry the balance forward', async () => {
  const { buildReceiptDays, figureKey } = await load();
  const figures = new Map([[figureKey('1', '2026-10-01'), { am: 100, pm: 50, loaded: 0, opening: 0 }]]);
  const days = buildReceiptDays([bmc('1', 12, 'A', 2000)], figures, '2026-10-01', '2026-10-03', '2026-10-03');
  assert.equal(days[0].rows[0].ob, 150);
  assert.equal(days[0].rows[0].act_cb, 150);
});

test('range validation', async () => {
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
  const { validateRange } = await import('../dist/lib/bmcReceiptsData.js');
  assert.match(validateRange('', '2026-10-01'), /Select/);
  assert.match(validateRange('2026-10-05', '2026-10-01'), /on or before/);
  assert.match(validateRange('2026-01-01', '2026-12-31'), /at most/);
  assert.equal(validateRange('2026-10-01', '2026-10-31'), null);
});
