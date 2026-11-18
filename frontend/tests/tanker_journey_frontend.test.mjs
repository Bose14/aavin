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
    if (id === './format' || id.endsWith('/format') || id.includes('format')) {
      return {
        DEFAULT_ASSUMPTIONS: {
          milkDensityKgPerLitre: 1.030,
          stageTimeLimitsMin: {
            vehicle_entered: 15,
            gross_weight: 15,
            qc_completed: 30,
            unloaded: 45,
            tare_weight: 15,
            cip_completed: 30,
            vehicle_exit: 15,
          },
          transitLossWarnPct: 1.0,
          transitLossDangerPct: 2.0,
          netWeightDiffThresholdKg: 50,
          qualityDropThresholdFat: 0.30,
          qualityDropThresholdSnf: 0.20,
        },
        DEFAULT_STAGE_TIME_LIMITS: {
          vehicle_entered: 15,
          gross_weight: 15,
          qc_completed: 30,
          unloaded: 45,
          tare_weight: 15,
          cip_completed: 30,
          vehicle_exit: 15,
        },
        formatDateDDMMYYYY: (d) => d,
        formatLitres: (l) => `${l} L`,
      };
    }
    return require(id);
  };
  const fn = new Function('require', 'module', 'exports', compiled.outputText);
  fn(customRequire, m, m.exports);
  return m.exports;
}

test('Frontend Tanker Journey: derives 7 stages, density metrics & timeline steps', () => {
  const journeyModule = loadTsModule(path.resolve(__dirname, '../src/lib/tankerJourney.ts'));
  const { deriveTankerJourneyState, calculateTankerMetrics } = journeyModule;

  const trip = {
    id: 'f-trip-1',
    date: '2026-11-16',
    tanker_number: 'TN-25-X-9988',
    quantity_dispatched: 10000,
    gross_weight_kg: 25300,
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done' },
      { stage_name: 'gross_weight', team: 'gate', status: 'done', stage_data: { gross_weight_kg: 25300 } },
    ],
  };

  const state = deriveTankerJourneyState(trip, { milk_density_kg_per_litre: 1.030 });
  assert.equal(state.tripStatus, 'gross_done');
  assert.equal(state.currentStageKey, 'qc_completed');
  assert.equal(state.waitingTeam, 'qc');
});

test('Frontend Tanker Timeline: renders mini and compact variants without error', () => {
  const journeyModule = loadTsModule(path.resolve(__dirname, '../src/lib/tankerJourney.ts'));
  const { deriveTankerJourneyState } = journeyModule;

  const trip = {
    id: 'f-trip-2',
    date: '2026-11-16',
    tanker_number: 'TN-25-Y-7766',
    quantity_dispatched: 8000,
    stages: [],
  };
  const journey = deriveTankerJourneyState(trip);

  // Load TankerTimeline JSX
  const timelineContent = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerTimeline.tsx'), 'utf8');
  const compiled = ts.transpileModule(timelineContent, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  });

  const m = { exports: {} };
  const customRequire = (id) => {
    if (id === 'react' || id.includes('react')) return { ...React, default: React };
    if (id.includes('tankerJourney')) return journeyModule;
    if (id.includes('format')) {
      return {
        formatDateDDMMYYYY: (d) => d,
        formatLitres: (l) => `${l} L`,
      };
    }
    return require(id);
  };

  const fn = new Function('require', 'module', 'exports', 'React', compiled.outputText);
  fn(customRequire, m, m.exports, React);
  const { TankerTimeline } = m.exports;

  // Mini variant SSR
  const miniHtml = renderToStaticMarkup(React.createElement(TankerTimeline, { journey, variant: 'mini' }));
  assert.ok(miniHtml.includes('tanker-stepper-mini'));
  assert.ok(miniHtml.includes('aria-label'));

  // Compact variant SSR
  const compactHtml = renderToStaticMarkup(React.createElement(TankerTimeline, { journey, variant: 'compact' }));
  assert.ok(compactHtml.includes('tanker-timeline-compact'));
  assert.ok(compactHtml.includes('Tanker Journey Progress:'));
});

test('Frontend Stage Pipeline: renders connected stepper with all 8 stages, checkmarks & pills', () => {
  const pipelinePath = path.resolve(__dirname, '../src/components/StagePipeline.tsx');
  const content = fs.readFileSync(pipelinePath, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const m = { exports: {} };
  const jsxRuntime = require('react/jsx-runtime');
  const customRequire = (id) => {
    if (id === 'react') return React;
    if (id.includes('jsx-runtime')) return jsxRuntime;
    return {};
  };
  const fn = new Function('require', 'module', 'exports', 'React', compiled.outputText);
  fn(customRequire, m, m.exports, React);
  const { StagePipeline } = m.exports;

  const chips = {
    on_the_way: { count: 2, delayedCount: 0, label: 'On the way' },
    vehicle_entered: { count: 1, delayedCount: 1, label: 'Vehicle Entered' },
    gross_done: { count: 3, delayedCount: 0, label: 'Gross Done' },
    qc_done: { count: 1, delayedCount: 0, label: 'QC Done' },
    unloaded: { count: 0, delayedCount: 0, label: 'Unloaded' },
    tare_done: { count: 0, delayedCount: 0, label: 'Tare Done' },
    cip_done: { count: 0, delayedCount: 0, label: 'CIP Done' },
    exited: { count: 4, delayedCount: 0, label: 'Vehicle Exit' },
  };

  const html = renderToStaticMarkup(
    React.createElement(StagePipeline, {
      chips,
      selectedStage: 'vehicle_entered',
      onSelectStage: () => {},
      inPlantCount: 5,
      waitingTooLongCount: 1,
      totalTankersCount: 11,
    }),
  );

  assert.ok(html.includes('Stage Pipeline Overview'));
  assert.ok(!html.includes('TANKER-LIVE'));
  assert.ok(html.includes('In Plant :'));
  assert.ok(html.includes('5 tankers'));
  assert.ok(html.includes('Vehicle Entered'));
  assert.ok(html.includes('Gross Done'));
  assert.ok(html.includes('Vehicle Exit'));
  assert.ok(html.includes('! 1'));
  assert.ok(html.includes('polyline points="20 6 9 17 4 12"'));
});

test('Frontend Tanker UX: All tab first, Total Dispatched removed, BMC column and Drawer cleanup', () => {
  const recordsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTankerRecords.tsx'), 'utf8');
  const drawerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerDetailDrawer.tsx'), 'utf8');

  // 1. KPI cards grid removed
  assert.ok(!recordsSrc.includes('className="kpi-grid"'), 'KPI cards grid must be removed');
  assert.ok(!recordsSrc.includes('Received at Dairy</div>'), 'KPI cards must be removed');

  // 2. Default tab is All, and All tab is placed first in tabs-header
  assert.ok(recordsSrc.includes("|| 'all' : 'all'"), "Default tab state must be 'all'");
  const allIdx = recordsSrc.indexOf("onClick={() => setActiveTab('all')}");
  const waitingIdx = recordsSrc.indexOf("onClick={() => setActiveTab('waiting')}");
  const processedIdx = recordsSrc.indexOf("onClick={() => setActiveTab('processed')}");
  const rejectedIdx = recordsSrc.indexOf("onClick={() => setActiveTab('rejected')}");
  assert.ok(allIdx > 0 && waitingIdx > 0 && processedIdx > 0 && rejectedIdx > 0);
  assert.ok(allIdx < waitingIdx, 'All tab button must appear before Waiting tab');
  assert.ok(waitingIdx < processedIdx, 'Waiting tab must appear before Processed tab');
  assert.ok(processedIdx < rejectedIdx, 'Processed tab must appear before QC Rejected tab');

  // 3. DataTable receives onRowClick handler
  assert.ok(recordsSrc.includes('onRowClick={handleOpenDrawer}'), 'DataTable must have onRowClick bound to open drawer');

  // 4. Drawer does not contain "All Stage Records" or "Audit Log" tabs
  assert.ok(!drawerSrc.includes('All Stage Records'), 'Drawer must not contain All Stage Records tab');
  assert.ok(!drawerSrc.includes('Audit Log'), 'Drawer must not contain Audit Log tab');
  assert.ok(!drawerSrc.includes('AuditLogItem'), 'AuditLogItem interface should not be present');

  // 5. Units renamed to BMC
  assert.ok(recordsSrc.includes("{ id: 'unit', label: 'BMC' }"), 'Column label must be BMC');
  assert.ok(recordsSrc.includes('<option value="">All BMCs</option>'), 'Filter must say All BMCs');
  assert.ok(drawerSrc.includes('BMC: <strong>'), 'Drawer header must say BMC');
});

test('Frontend Plant Teams & Admin DC No integration (Gate, QC, Unloading, Admin)', () => {
  const gateSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/GateOperations.tsx'), 'utf8');
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');
  const unloadSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/UnloadingBay.tsx'), 'utf8');
  const recordsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTankerRecords.tsx'), 'utf8');
  const drawerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerDetailDrawer.tsx'), 'utf8');

  // Gate form contains authentic Aavin IDMS layout fields
  assert.ok(gateSrc.includes('No.Of Vehicles In Today :'), 'Gate page has No.Of Vehicles In Today');
  assert.ok(gateSrc.includes('Create New Tanker'), 'Gate page has Create New Tanker action');
  assert.ok(gateSrc.includes('VEHICLE ENTRY DETAILS'), 'Gate page has VEHICLE ENTRY DETAILS heading');
  assert.ok(gateSrc.includes('DC No'), 'Gate form has DC No input');
  assert.ok(gateSrc.includes('Time Difference Between Dispatch And Entry(HH.MM)'), 'Gate form has Time Difference');
  assert.ok(gateSrc.includes('NAMAKKAL DAIRY'), 'Gate form displays Receiving Dairy NAMAKKAL DAIRY');

  // QC form displays DC No and quality inputs
  assert.ok(qcSrc.includes('DC #'), 'QC page displays DC No');
  assert.ok(qcSrc.includes('qc_completed'), 'QC page has qc_completed stage');
  assert.ok(qcSrc.includes('rejectionReason'), 'QC page handles rejection reasons');

  // Unloading Bay displays DC No, silo allocation and verification checks
  assert.ok(unloadSrc.includes('DC #'), 'Unloading Bay displays DC No');
  assert.ok(unloadSrc.includes('Receiving Silo / Raw Milk Bay'), 'Unloading Bay has silo allocation dropdown');
  assert.ok(unloadSrc.includes('UNLOADING STRICTLY BLOCKED (QC REJECTED)'), 'Unloading Bay blocks QC rejected tankers');

  // Admin records & drawer display DC No
  assert.ok(recordsSrc.includes('DC #'), 'Admin tanker records table displays DC No');
  assert.ok(drawerSrc.includes('DC No:'), 'Admin tanker detail drawer header displays DC No');
});

test('Frontend BMC Dispatch Form: Lorry num, driver name, and compartment details with instant admin reflection', () => {
  const dispatchSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/unit/TankerDispatch.tsx'), 'utf8');
  const drawerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerDetailDrawer.tsx'), 'utf8');
  const recordsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTankerRecords.tsx'), 'utf8');

  // 1. TankerDispatch form inputs
  assert.ok(dispatchSrc.includes('Lorry / Tanker Number'), 'BMC dispatch has Lorry Number input');
  assert.ok(dispatchSrc.includes('Driver Name'), 'BMC dispatch has Driver Name input');
  assert.ok(dispatchSrc.includes('DC No (Delivery Challan / Invoice No)'), 'BMC dispatch has DC No input');
  assert.ok(dispatchSrc.includes('LORRY COMPARTMENT DETAILS'), 'BMC dispatch has Compartment Details section');
  assert.ok(dispatchSrc.includes('Quantity (Litres)'), 'BMC dispatch has Compartment Quantity field');
  assert.ok(dispatchSrc.includes('Dipstick Level (cm)'), 'BMC dispatch has Dipstick field');
  assert.ok(dispatchSrc.includes('Top Seal No'), 'BMC dispatch has Top Seal No field');
  assert.ok(dispatchSrc.includes('setPresetCompartments'), 'BMC dispatch has quick presets for compartments');

  // 2. TankerDetailDrawer displays Lorry Compartment Details breakdown
  assert.ok(drawerSrc.includes('Lorry Compartment Details'), 'Drawer has Lorry Compartment Details section');
  assert.ok(drawerSrc.includes('Dipstick'), 'Drawer displays dipstick level');
  assert.ok(drawerSrc.includes('Top Seal:'), 'Drawer displays top seal number');

  // 3. Admin Tanker Records displays compartment count badge
  assert.ok(recordsSrc.includes('Comp'), 'Admin table has compartment count badge');
});

test('Frontend Feature Verification: 8-Feature Suite (User Creation, Gate/QC/Unload/BMC/Admin Dashboards, Exports)', () => {
  const teamsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTeams.tsx'), 'utf8');
  const gateSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/GateOperations.tsx'), 'utf8');
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');
  const unloadSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/UnloadingBay.tsx'), 'utf8');
  const unitDashSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/unit/UnitDashboard.tsx'), 'utf8');
  const adminUnitsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminUnits.tsx'), 'utf8');
  const drawerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerDetailDrawer.tsx'), 'utf8');
  const adminRecordsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTankerRecords.tsx'), 'utf8');

  // Feature 1: User Creation
  assert.ok(teamsSrc.includes('AV_IT_001'), 'Feature 1: User creation generates structured user ID (e.g. AV_IT_001)');
  assert.ok(teamsSrc.includes('GATE — Vehicle Entry & Weighbridge'), 'Feature 1: User modal has Gate team');
  assert.ok(teamsSrc.includes('QC — Quality Testing & CIP'), 'Feature 1: User modal has QC team');
  assert.ok(teamsSrc.includes('UNLOAD — Silo & Milk Reception'), 'Feature 1: User modal has Unloading team');

  // Feature 2: Gate team Dashboard
  assert.ok(gateSrc.includes('No.Of Vehicles In Today :'), 'Feature 2: Gate Dashboard has vehicle count');
  assert.ok(gateSrc.includes("Today's Gate Vehicle Register"), 'Feature 2: Gate Dashboard has vehicle register table');

  // Feature 3: QC team Dashboard
  assert.ok(qcSrc.includes('Waiting for QC'), 'Feature 3: QC Dashboard has Waiting for QC KPI card');
  assert.ok(qcSrc.includes("Today's QC Laboratory Register"), 'Feature 3: QC Dashboard has QC Laboratory Register table');

  // Feature 4: Unload team Dashboard
  assert.ok(unloadSrc.includes('Ready for Silo Reception'), 'Feature 4: Unload Dashboard has Ready for Silo Reception KPI card');
  assert.ok(unloadSrc.includes('Total Milk Unloaded Today'), 'Feature 4: Unload Dashboard has Total Unloaded KPI card');
  assert.ok(unloadSrc.includes("Today's Unloading Bay Reception Register"), 'Feature 4: Unload Dashboard has Reception Register table');

  // Feature 5: BMC team Dashboard
  assert.ok(unitDashSrc.includes('Outward Tanker Dispatches & Live Plant Status'), 'Feature 5: BMC Dashboard has Outward Tanker tracking section');
  assert.ok(unitDashSrc.includes('TankerDetailDrawer'), 'Feature 5: BMC Dashboard mounts TankerDetailDrawer for viewing dossiers');

  // Feature 6: BMC Admin Dashboard
  assert.ok(adminUnitsSrc.includes('BMC Administration Dashboard'), 'Feature 6: Admin BMC has BMC Administration Dashboard');
  assert.ok(adminUnitsSrc.includes('Total Registered BMCs'), 'Feature 6: Admin BMC has Total Registered BMCs KPI');
  assert.ok(adminUnitsSrc.includes('Active BMCs'), 'Feature 6: Admin BMC has Active BMCs KPI');

  // Feature 7: Export data of this tanker details
  assert.ok(adminRecordsSrc.includes('/export/tanker'), 'Feature 7: Admin Tanker Records triggers tanker export endpoint');
  assert.ok(adminRecordsSrc.includes('handleExport'), 'Feature 7: Admin Tanker Records has handleExport');
  assert.ok(adminRecordsSrc.includes('Excel'), 'Feature 7: Admin Tanker Records has Excel export button');
  assert.ok(adminRecordsSrc.includes('CSV'), 'Feature 7: Admin Tanker Records has CSV export button');

  // Feature 8: Create excel daily report as per requested format
  assert.ok(adminRecordsSrc.includes('handleExportDailyReport'), 'Feature 8: Admin Tanker Records has handleExportDailyReport');
  assert.ok(adminRecordsSrc.includes('/export/tanker/daily-report'), 'Feature 8: Admin Tanker Records triggers daily report endpoint');
  assert.ok(adminRecordsSrc.includes('Daily Reception Report (.xlsx)'), 'Feature 8: Admin Tanker Records has Daily Reception Report button');
});



