import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ts = require('../../backend/node_modules/typescript');

function loadTsModule(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const m = { exports: {} };
  const customRequire = (id) => {
    if (id === 'react/jsx-runtime') {
      return require('react/jsx-runtime');
    }
    if (id === './format' || id.endsWith('/format') || id.includes('format')) {
      return {
        formatDateDDMMYYYY: (d) => d,
        formatLitres: (l) => `${l} L`,
        formatFatSnf: (v, withPct) => (withPct ? `${v}%` : `${v}`),
        normalizeIndianPhone: (p) => (p && p.length === 10 ? `+91 ${p}` : null),
      };
    }
    if (id.includes('LanguageContext')) {
      return {
        useTranslation: () => ({
          lang: 'en',
          t: (k) => k,
        }),
      };
    }
    if (id.includes('AuthContext')) {
      return {
        useAuth: () => ({
          profile: { role: 'admin', zone_id: 'zone-1' },
          signOut: () => {},
        }),
      };
    }
    return require(id);
  };
  const fn = new Function('require', 'module', 'exports', compiled.outputText);
  fn(customRequire, m, m.exports);
  return m.exports;
}

test('1. Role-based redirect routing in frontend ProtectedRoute', () => {
  const protectedRoutePath = path.resolve(__dirname, '../src/components/ProtectedRoute.tsx');
  const { roleHome } = loadTsModule(protectedRoutePath);

  assert.equal(roleHome('superadmin'), '/superadmin');
  assert.equal(roleHome('admin'), '/admin');
  assert.equal(roleHome('gate'), '/gate');
  assert.equal(roleHome('GATE'), '/gate');
  assert.equal(roleHome('qc'), '/qc');
  assert.equal(roleHome('QC'), '/qc');
  assert.equal(roleHome('unloading'), '/unloading');
  assert.equal(roleHome('UNLOADING'), '/unloading');
  assert.equal(roleHome('unit'), '/unit');
});

test('2. StagePipeline renders team names & active user counts in stage chip tooltips', () => {
  const stagePipelinePath = path.resolve(__dirname, '../src/components/StagePipeline.tsx');
  const { StagePipeline } = loadTsModule(stagePipelinePath);

  const chips = {
    on_the_way: { count: 3, delayedCount: 0, label: 'On the way' },
    vehicle_entered: { count: 2, delayedCount: 1, label: 'Vehicle Entered' },
    gross_done: { count: 1, delayedCount: 0, label: 'Gross Done' },
    qc_done: { count: 1, delayedCount: 0, label: 'QC Done' },
    unloaded: { count: 4, delayedCount: 0, label: 'Unloaded' },
    tare_done: { count: 0, delayedCount: 0, label: 'Tare Done' },
    cip_done: { count: 0, delayedCount: 0, label: 'CIP Done' },
    exited: { count: 5, delayedCount: 0, label: 'Vehicle Exit' },
  };

  const teamUserCounts = {
    GATE: 3,
    QC: 2,
    UNLOADING: 4,
  };

  const html = renderToStaticMarkup(
    React.createElement(StagePipeline, {
      chips,
      selectedStage: '',
      onSelectStage: () => {},
      inPlantCount: 8,
      waitingTooLongCount: 1,
      qcRejectedCount: 0,
      totalTankersCount: 16,
      teamUserCounts,
    })
  );

  // Verify Gate stages mention Gate Team and active operator count in title/tooltip
  assert.ok(html.includes('Gate Team (3 active operators)'), 'Tooltips must contain Gate Team and active operator count');
  assert.ok(html.includes('QC Team (2 active operators)'), 'Tooltips must contain QC Team and active operator count');
  assert.ok(html.includes('Unloading Team (4 active operators)'), 'Tooltips must contain Unloading Team and active operator count');
});

test('3. English and Tamil translations symmetry for plant teams and navigation', () => {
  const transPath = path.resolve(__dirname, '../src/i18n/translations.ts');
  const { TRANSLATIONS } = loadTsModule(transPath);

  assert.ok(TRANSLATIONS.en.navTeams);
  assert.ok(TRANSLATIONS.ta.navTeams);
  assert.equal(TRANSLATIONS.en.navTeams, 'Teams');
  assert.equal(TRANSLATIONS.ta.navTeams, 'குழுக்கள்');

  assert.ok(TRANSLATIONS.en.navGateQueue);
  assert.ok(TRANSLATIONS.ta.navGateQueue);
  assert.ok(TRANSLATIONS.en.navQCQueue);
  assert.ok(TRANSLATIONS.ta.navQCQueue);
  assert.ok(TRANSLATIONS.en.navUnloadingQueue);
  assert.ok(TRANSLATIONS.ta.navUnloadingQueue);

  assert.ok(TRANSLATIONS.en.teamGate);
  assert.ok(TRANSLATIONS.ta.teamGate);
  assert.ok(TRANSLATIONS.en.teamQC);
  assert.ok(TRANSLATIONS.ta.teamQC);
  assert.ok(TRANSLATIONS.en.teamUnloading);
  assert.ok(TRANSLATIONS.ta.teamUnloading);
});
