import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');
const require = createRequire(import.meta.url);
const ts = require('../../backend/node_modules/typescript');

// Transpile & execute local TS/TSX modules in-memory using frontend's installed TypeScript compiler
function createTsLoader() {
  const cache = new Map();
  const mockApi = {
    get: async () => ({ data: {}, headers: {} }),
    post: async () => ({ data: {}, headers: {} }),
    patch: async () => ({ data: {}, headers: {} }),
    put: async () => ({ data: {}, headers: {} }),
    delete: async () => ({ data: {}, headers: {} }),
  };

  function resolveFile(baseDir, spec) {
    const raw = path.resolve(baseDir, spec);
    const candidates = [
      raw,
      `${raw}.ts`,
      `${raw}.tsx`,
      path.join(raw, 'index.ts'),
      path.join(raw, 'index.tsx'),
    ];
    return candidates.find(c => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
  }

  function loadFile(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports;

    // Stub axios client / supabase to avoid import.meta.env during pure unit & SSR tests
    if (absPath.endsWith(`${path.sep}lib${path.sep}api.ts`)) {
      return { default: mockApi, __esModule: true };
    }
    if (absPath.endsWith(`${path.sep}supabase.ts`)) {
      const mockChain = () => ({
        select: () => mockChain(),
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => mockChain(),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
      });
      return {
        supabase: {
          from: () => mockChain(),
          auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
        },
        __esModule: true,
      };
    }

    const source = fs.readFileSync(absPath, 'utf8').replaceAll('import.meta.env', '({})');
    const transpiled = ts.transpileModule(source, {
      fileName: absPath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;

    const mod = new Module(absPath);
    cache.set(absPath, mod);

    const localRequire = (spec) => {
      if (spec.startsWith('.')) {
        const target = resolveFile(path.dirname(absPath), spec);
        if (target) return loadFile(target);
      }
      return require(spec);
    };

    const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled);
    fn(mod.exports, localRequire, mod, absPath, path.dirname(absPath));
    return mod.exports;
  }

  return (relPath) => loadFile(path.join(srcDir, relPath));
}

const loadTsModule = createTsLoader();

test('frontend formatters enforce dd-mm-yyyy, 2-dec fat/snf, Indian ₹ grouping & phone validation', () => {
  const fmt = loadTsModule('lib/format.ts');
  assert.equal(fmt.formatDateDDMMYYYY('2026-11-12'), '12-11-2026');
  assert.equal(fmt.formatFatSnf(4.5), '4.50');
  assert.equal(fmt.formatFatSnf(8, true), '8.00%');
  assert.equal(fmt.formatINR(125000), '₹1,25,000');
  assert.equal(fmt.formatINR(-1930), '-₹1,930');
  assert.equal(fmt.formatCompactINR(2000), '₹2k');
  assert.equal(fmt.formatLitres(250, 1), '250.0 L');
  assert.equal(fmt.normalizeIndianPhone('9876543210'), '+91 98765 43210');
  assert.equal(fmt.calcRateFromChart(4.2, 8.5), 30);
});

test('frontend procurement computes NET/GROSS rules & quantity-weighted summary averages', () => {
  const proc = loadTsModule('lib/procurement.ts');
  const net = proc.computeEntryValuation({
    quantityLitres: 100,
    rejectionQty: 10,
    ratePerLitre: 30,
    sellingRate: 52,
    rejectionPaymentRule: 'net',
  });
  assert.equal(net.netQty, 90);
  assert.equal(net.procurementCost, 2700);
  assert.equal(net.rejectionLoss, 0);

  const gross = proc.computeEntryValuation({
    quantityLitres: 100,
    rejectionQty: 10,
    ratePerLitre: 30,
    sellingRate: 52,
    rejectionPaymentRule: 'gross',
  });
  assert.equal(gross.procurementCost, 3000);
  assert.equal(gross.rejectionLoss, 300);

  const summary = proc.summarizeMilkEntries([
    { quantity_litres: 100, rejection_qty: 0, rate_per_litre: 30, fat_pct: 4.0, snf_pct: 8.0 },
    { quantity_litres: 300, rejection_qty: 0, rate_per_litre: 32, fat_pct: 5.2, snf_pct: 8.8 },
  ]);
  assert.equal(summary.avgFat, 4.9); // (100*4 + 300*5.2)/400
  assert.equal(summary.avgSnf, 8.6); // (100*8 + 300*8.8)/400
});

test('English and Tamil translation dictionaries share identical keys and non-empty strings', () => {
  const tr = loadTsModule('i18n/translations.ts');
  const enKeys = Object.keys(tr.TRANSLATIONS.en);
  const taKeys = Object.keys(tr.TRANSLATIONS.ta);
  assert.deepEqual(enKeys, taKeys);
  for (const k of enKeys) {
    assert.ok(tr.TRANSLATIONS.en[k].length > 0, `Missing EN text for ${k}`);
    assert.ok(tr.TRANSLATIONS.ta[k].length > 0, `Missing TA text for ${k}`);
  }
});

test('offlineQueue persists, lists, and removes queued entries in storage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };

  const oq = loadTsModule('lib/offlineQueue.ts');
  assert.equal(oq.listOfflineMilkEntries().length, 0);
  const item = oq.enqueueOfflineMilkEntry({
    date: '2026-11-12',
    shift: 'AM',
    fat_pct: 4.5,
    snf_pct: 8.4,
    quantity_litres: 200,
    rejection_qty: 0,
  });
  assert.equal(oq.listOfflineMilkEntries().length, 1);
  oq.removeOfflineMilkEntry(item.localId);
  assert.equal(oq.listOfflineMilkEntries().length, 0);
});

test('UI primitives & DataTable render empty state CTA, sticky table & totals row via SSR', () => {
  const { StatCard } = loadTsModule('components/StatCard.tsx');
  const { ConfirmDialog, InfoTooltip, StatusBadge } = loadTsModule('components/UiPrimitives.tsx');
  const { DataTable } = loadTsModule('components/DataTable.tsx');
  const { DailyProfitLossChart, UnitProfitLossChart, computeCleanCurrencyTicks } = loadTsModule('components/ProfitLossChart.tsx');
  const { MilkCollectionTrendChart, QualityTrendChart } = loadTsModule('components/CollectionCharts.tsx');

  const cardHtml = renderToStaticMarkup(
    React.createElement(StatCard, {
      label: 'Net Profit',
      value: '₹12,500',
      valueTone: 'positive',
      tooltip: 'Revenue minus cost',
      onClick: () => {},
    }),
  );
  assert.ok(cardHtml.includes('₹12,500'));
  assert.ok(cardHtml.includes('stat-card-clickable'));

  const modalHtml = renderToStaticMarkup(
    React.createElement(ConfirmDialog, {
      open: true,
      title: 'Deactivate Rasipuram?',
      message: 'Deactivate Rasipuram? Its 2 users will not be able to log in.',
      danger: true,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );
  assert.ok(modalHtml.includes('Deactivate Rasipuram?'));

  const tableHtml = renderToStaticMarkup(
    React.createElement(DataTable, {
      rows: [],
      columns: [{ key: 'date', header: 'Date', render: r => r.date }],
      getRowKey: r => r.id,
      emptyMessage: 'No data for this period. Add first entry',
      emptyActionLabel: 'Add First Entry',
      onEmptyAction: () => {},
    }),
  );
  assert.ok(tableHtml.includes('No data for this period. Add first entry'));
  assert.ok(tableHtml.includes('Add First Entry'));
  assert.ok(tableHtml.includes('desktop-table-wrap'));
  assert.ok(tableHtml.includes('mobile-cards-list'));

  const populatedTableHtml = renderToStaticMarkup(
    React.createElement(DataTable, {
      rows: [{ id: 'row-1', date: '12-11-2026', qty: '100.0 L' }],
      columns: [
        { key: 'date', header: 'Date', render: r => r.date, footerCell: React.createElement('strong', null, 'Totals (1)') },
        { key: 'qty', header: 'Qty', render: r => r.qty, footerCell: React.createElement('strong', null, '100.0 L') },
        { key: 'actions', header: 'Actions', render: () => React.createElement('button', { type: 'button' }, 'Edit') },
      ],
      getRowKey: r => r.id,
      showTotalsRow: true,
    }),
  );
  assert.ok(populatedTableHtml.includes('mobile-record-card'));
  assert.ok(populatedTableHtml.includes('mobile-totals-card'));
  assert.ok(populatedTableHtml.includes('mobile-record-actions'));

  const tooltipHtml = renderToStaticMarkup(
    React.createElement(InfoTooltip, { text: 'Net Quantity equals Gross minus Rejection', label: 'Net Qty' }),
  );
  assert.ok(tooltipHtml.includes('info-tooltip-btn'));

  const badgeHtml = renderToStaticMarkup(
    React.createElement(StatusBadge, { tone: 'green' }, 'Verified'),
  );
  assert.ok(badgeHtml.includes('status-pill green'));

  const profitChartHtml = renderToStaticMarkup(
    React.createElement(DailyProfitLossChart, {
      data: [{ date: '2026-11-12', revenue: 10000, cost: 6500, profit: 3500 }],
      sellingRate: 52,
    }),
  );
  assert.ok(profitChartHtml.includes('Net Profit / Loss'));
  assert.ok(profitChartHtml.includes('Revenue vs Cost'));

  const emptyCollHtml = renderToStaticMarkup(
    React.createElement(MilkCollectionTrendChart, {
      data: [],
      emptyActionLabel: 'Add First Entry',
      onEmptyAction: () => {},
    }),
  );
  assert.ok(emptyCollHtml.includes('Add First Entry'));

  const qualChartHtml = renderToStaticMarkup(
    React.createElement(QualityTrendChart, {
      data: [{ date: '2026-11-12', quantity: 200, net_quantity: 195, avg_fat: 4.5, avg_snf: 8.4 }],
      fatBenchmark: 4.0,
      snfBenchmark: 8.2,
    }),
  );
  assert.ok(qualChartHtml.includes('4.50%'));
  assert.ok(qualChartHtml.includes('8.40%'));

  // Test UnitProfitLossChart with negative profit (handles negative losses without axis tick repetition)
  const ticksResult = computeCleanCurrencyTicks([-1385]);
  assert.ok(ticksResult.domain[0] <= -1385, 'Domain min must encompass negative loss');
  assert.ok(ticksResult.domain[1] >= 0, 'Domain max must encompass zero');
  assert.ok(ticksResult.ticks.includes(0), 'Ticks must include 0 reference point');
  assert.ok(ticksResult.ticks.length >= 3, 'Must have at least 3 distinct ticks');
  const uniqueTicks = new Set(ticksResult.ticks);
  assert.equal(uniqueTicks.size, ticksResult.ticks.length, 'Ticks must be strictly unique');

  const unitChartHtml = renderToStaticMarkup(
    React.createElement(UnitProfitLossChart, {
      data: [{ unit_id: 'u1', name: 'Rasipuram', unit_code: 'RNK-001', revenue: 13026, cost: 14411, profit: -1385 }],
      sellingRate: 52,
    }),
  );
  assert.ok(unitChartHtml.includes('Unit-wise Net Profit / Loss'));
  assert.ok(unitChartHtml.includes('Zone Revenue'));
  assert.ok(unitChartHtml.includes('Zone Cost'));

  // Test SuperAdminDashboard SSR with responsive DataTable
  const SuperAdminDashboard = loadTsModule('pages/superadmin/SuperAdminDashboard.tsx').default;
  const superAdminHtml = renderToStaticMarkup(React.createElement(SuperAdminDashboard));
  assert.ok(superAdminHtml.includes('Super Admin'));
  assert.ok(superAdminHtml.includes('Create New Zone Admin'));
  assert.ok(superAdminHtml.includes('desktop-table-wrap'));
});

test('Admin and Unit UI components render without SSR errors and expose responsive buttons', () => {
  const { LanguageProvider } = loadTsModule('context/LanguageContext.tsx');
  const { ConfirmDialog } = loadTsModule('components/UiPrimitives.tsx');

  const confirmHtml = renderToStaticMarkup(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(ConfirmDialog, {
        open: true,
        title: 'Deactivate Rasipuram?',
        message: 'Deactivate Rasipuram? Its 2 users will not be able to log in.',
        confirmLabel: 'Deactivate Unit',
        danger: true,
        onConfirm: () => {},
        onCancel: () => {},
      })
    )
  );
  assert.ok(confirmHtml.includes('modal-actions'));
  assert.ok(confirmHtml.includes('Deactivate Unit'));
  assert.ok(confirmHtml.includes('btn-danger'));
});
