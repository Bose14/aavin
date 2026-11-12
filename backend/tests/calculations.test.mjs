import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateWeightedQuality,
  calculateRateFromChart,
  getEffectiveSellingRate,
  calculateEntryFinancials,
  formatDateDDMMYYYY,
  normalizeIndianPhone,
} = require('../dist/lib/calculations.js');
const { buildDefaultZoneSettings } = require('../dist/config/defaults.js');
const { buildDailyPdfReport } = require('../dist/utils/pdfReport.js');

test('calculateWeightedQuality computes sum(qty * value) / sum(qty), not simple mean', () => {
  // Simple average fat would be (3.60 + 5.60) / 2 = 4.60%,
  // but weighted by 100 L vs 300 L must be (100*3.6 + 300*5.6) / 400 = 5.10%.
  const rows = [
    { quantity_litres: 100, fat_pct: 3.6, snf_pct: 8.1 },
    { quantity_litres: 300, fat_pct: 5.6, snf_pct: 8.9 },
  ];
  const res = calculateWeightedQuality(rows);
  assert.equal(res.total_qty, 400);
  assert.equal(res.avg_fat, 5.1);
  assert.equal(res.avg_snf, 8.7);
});

test('calculateWeightedQuality handles empty and zero-quantity rows safely', () => {
  assert.deepEqual(calculateWeightedQuality([]), { avg_fat: 0, avg_snf: 0, total_qty: 0 });
  assert.deepEqual(
    calculateWeightedQuality([{ quantity_litres: 0, fat_pct: 4.5, snf_pct: 8.5 }]),
    { avg_fat: 0, avg_snf: 0, total_qty: 0 },
  );
});

test('calculateRateFromChart computes Fat/SNF procurement rate accurately', () => {
  const settings = buildDefaultZoneSettings('zone-1');
  // 4.2*3.5 + 8.5*1.8 = 14.7 + 15.3 = 30.00
  assert.equal(calculateRateFromChart(4.2, 8.5, settings), 30);

  const custom = { rate_base: 2.5, rate_fat_coeff: 4.0, rate_snf_coeff: 2.0 };
  // 2.5 + 4.5*4.0 + 8.4*2.0 = 2.5 + 18.0 + 16.8 = 37.30
  assert.equal(calculateRateFromChart(4.5, 8.4, custom), 37.3);
});

test('getEffectiveSellingRate resolves historical rate rules without rewriting past dates', () => {
  const history = [
    { effective_from: '2020-01-01', rate_per_litre: 52 },
    { effective_from: '2026-11-10', rate_per_litre: 55 },
    { effective_from: '2026-12-01', rate_per_litre: 58 },
  ];

  assert.equal(getEffectiveSellingRate('2026-11-09', history), 52);
  assert.equal(getEffectiveSellingRate('2026-11-10', history), 55);
  assert.equal(getEffectiveSellingRate('2026-11-25', history), 55);
  assert.equal(getEffectiveSellingRate('2026-12-05', history), 58);
});

test('calculateEntryFinancials distinguishes NET vs GROSS rejection payment rules', () => {
  const entry = {
    date: '2026-11-12',
    fat_pct: 4.5,
    snf_pct: 8.4,
    quantity_litres: 200,
    rejection_qty: 20,
    rate_per_litre: 30,
  };
  const history = [{ effective_from: '2020-01-01', rate_per_litre: 52 }];

  const netResult = calculateEntryFinancials(entry, { rejection_payment_rule: 'net' }, history);
  assert.equal(netResult.net_quantity, 180);
  assert.equal(netResult.cost, 5400); // 180 * 30
  assert.equal(netResult.rejection_loss, 0);
  assert.equal(netResult.revenue, 9360); // 180 * 52
  assert.equal(netResult.profit, 3960);

  const grossResult = calculateEntryFinancials(entry, { rejection_payment_rule: 'gross' }, history);
  assert.equal(grossResult.net_quantity, 180);
  assert.equal(grossResult.cost, 6000); // 200 * 30
  assert.equal(grossResult.rejection_loss, 600); // 20 * 30 tracked separately
  assert.equal(grossResult.revenue, 9360);
  assert.equal(grossResult.profit, 3360);
});

test('formatDateDDMMYYYY and normalizeIndianPhone format cleanly', () => {
  assert.equal(formatDateDDMMYYYY('2026-11-12'), '12-11-2026');
  assert.equal(formatDateDDMMYYYY('2026-01-05T10:20:00Z'), '05-01-2026');
  assert.equal(normalizeIndianPhone('9876543210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('+91 98765-43210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('12345'), null);
});

test('buildDailyPdfReport generates valid binary PDF document', () => {
  const pdfBuf = buildDailyPdfReport({
    title: 'AAVIN Dairy Daily Milk Report - Namakkal',
    subtitle: 'Period: 10-11-2026 to 12-11-2026',
    summaryLines: ['Entries: 1 | Net Accepted: 240.0 L'],
    rows: [
      {
        date: '12-11-2026',
        unit: 'RNK-001',
        shift: 'AM',
        fat: '4.50',
        snf: '8.40',
        qty: '250.0',
        rej: '10.0',
        net: '240.0',
        rate: '30.87',
        cost: '7,409',
        status: 'SUBMITTED',
      },
    ],
  });

  const text = pdfBuf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('RNK-001'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});

