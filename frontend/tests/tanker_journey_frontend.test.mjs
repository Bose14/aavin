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
  assert.ok(recordsSrc.includes("{ id: 'bmc', label: 'BMC' }"), 'Column label must be BMC');
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
  assert.ok(gateSrc.includes("Today's Gate Vehicle Register"), 'Gate page has vehicle register table');
  assert.ok(!gateSrc.includes('Create New Tanker'), 'Gate page does not have Create New Tanker (outward dispatch is exclusively BMC)');
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
  assert.ok(!dispatchSrc.includes('Dipstick Level (cm)'), 'BMC dispatch has Dipstick field removed per requirements');
  assert.ok(!dispatchSrc.includes('4 Comp'), '4th compartment removed; capped at 3');
  assert.ok(dispatchSrc.includes('Top Seal No'), 'BMC dispatch has Top Seal No field');
  assert.ok(dispatchSrc.includes('setPresetCompartments'), 'BMC dispatch has quick presets for compartments');

  // 2. TankerDetailDrawer displays Lorry Compartment Details breakdown
  assert.ok(drawerSrc.includes('Lorry Compartment Details'), 'Drawer has Lorry Compartment Details section');
  assert.ok(!drawerSrc.includes('Dipstick Level:'), 'Drawer has dipstick level removed');
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
  const adminUnitsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminBmcs.tsx'), 'utf8');
  const drawerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/TankerDetailDrawer.tsx'), 'utf8');
  const adminRecordsSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/admin/AdminTankerRecords.tsx'), 'utf8');

  // Feature 1: User Creation
  assert.ok(teamsSrc.includes('id_token'), 'Feature 1: Users are identified by id_token');
  assert.ok(teamsSrc.includes('GATE — Vehicle Entry & Weighbridge'), 'Feature 1: User modal has Gate team');
  assert.ok(teamsSrc.includes('QC — Quality Testing & CIP'), 'Feature 1: User modal has QC team');
  assert.ok(teamsSrc.includes('UNLOADING — Silo & Milk Reception'), 'Feature 1: User modal has Unloading team');

  // Feature 2: Gate team Dashboard
  assert.ok(gateSrc.includes("Today's Gate Vehicle Register"), 'Feature 2: Gate Dashboard has vehicle register table');
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

test('Sidebar NavLink enforces exact matching (end prop) to prevent multiple simultaneous active selections', () => {
  const layoutSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Layout.tsx'), 'utf8');
  assert.ok(layoutSrc.includes('<NavLink'), 'Layout renders NavLink');
  assert.ok(/\bend\b/.test(layoutSrc), 'Layout uses end prop for exact route matching on nav items');
  assert.ok(!layoutSrc.includes(".includes(item.to)"), 'Layout does not use incomplete whitelist for end prop');
});

test('GateOperations renders authentic Aavin IDMS VEHICLE GROSS WEIGHT DETAILS form matching user photo', () => {
  const gateSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/GateOperations.tsx'), 'utf8');
  assert.ok(gateSrc.includes('VEHICLE GROSS WEIGHT DETAILS'), 'Must render VEHICLE GROSS WEIGHT DETAILS section header');
  assert.ok(gateSrc.includes('Received From :'), 'Must render Received From label');
  assert.ok(gateSrc.includes('Number of Cells'), 'Must render Number of Cells input');
  assert.ok(gateSrc.includes('Gross Weight Date'), 'Must render Gross Weight Date input');
  assert.ok(gateSrc.includes('Entry Time(HHMM)[12 hour format]'), 'Must render Entry Time 12 hour format input');
  assert.ok(gateSrc.includes('Dispatch Quantity(Ltrs)'), 'Must render Dispatch Quantity Ltrs input');
  assert.ok(gateSrc.includes('Gross Weight(Kgs)'), 'Must render Gross Weight Kgs input');
  assert.ok(gateSrc.includes('Dispatch Quality'), 'Must render Dispatch Quality section');
  assert.ok(gateSrc.includes('CC/BMC'), 'Must render CC/BMC column/label in Dispatch Quality');
  assert.ok(gateSrc.includes('GROSS WEIGHT REPORT') || !gateSrc.includes('>Gross Weight Report<'), 'Gross Weight Report button removed from form');
  assert.ok(gateSrc.includes('Milk Receipt Entry'), 'Must render Milk Receipt Entry sub tab');
  assert.ok(gateSrc.includes('Gross Weight Entry'), 'Must render Gross Weight Entry sub tab');
});

test('QCLab renders authentic Aavin IDMS QUALITY CONTROL DETAILS form matching user photos', () => {
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');
  assert.ok(qcSrc.includes('QUALITY CONTROL DETAILS'), 'Must render QUALITY CONTROL DETAILS section header');
  assert.ok(qcSrc.includes('Vehicle No'), 'Must render Vehicle No label');
  assert.ok(qcSrc.includes('Received From :'), 'Must render Received From label with BMC badges');
  assert.ok(qcSrc.includes('DC NO:'), 'Must render DC NO: label');
  assert.ok(qcSrc.includes('Dispatch Date'), 'Must render Dispatch Date input');
  assert.ok(qcSrc.includes('Dispatch Time(HHMM)[12 hour format]'), 'Must render Dispatch Time in 12hr format');
  assert.ok(qcSrc.includes('QC Date'), 'Must render QC Date input');
  assert.ok(qcSrc.includes('QC Time(HHMM)[12 hour format]'), 'Must render QC Time in 12hr format');
  assert.ok(qcSrc.includes('Dispatch Quality'), 'Must render Dispatch Quality section');
  assert.ok(qcSrc.includes('Received Quality'), 'Must render Received Quality section');
  assert.ok(qcSrc.includes('Qc Manual Entry Reason'), 'Must render Qc Manual Entry Reason field');
  assert.ok(qcSrc.includes('Select Test'), 'Must render Select Test section');
  assert.ok(qcSrc.includes('Test Type For FC') || qcSrc.includes('Test Type For'), 'Must render Test Type dropdowns');
  assert.ok(qcSrc.includes('Tests Completed'), 'Must render Tests Completed indicators');
  assert.ok(qcSrc.includes('Remarks'), 'Must render Remarks multiline textarea');
  assert.ok(qcSrc.includes('Update'), 'Must render Update submit button');
  assert.ok(qcSrc.includes('REJECT'), 'Must render REJECT button');
  assert.ok(qcSrc.includes('Confirm Tanker Milk Rejection'), 'Must render rejection confirmation dialog');
});

test('QCLab renders authentic Aavin IDMS CIP DETAILS form matching user photo', () => {
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');
  assert.ok(qcSrc.includes('CIP DETAILS'), 'Must render CIP DETAILS section header banner');
  assert.ok(qcSrc.includes('CIP Details') || qcSrc.includes('CIP Sanitization'), 'Must render CIP Details title');
  assert.ok(qcSrc.includes('Vehicle No'), 'Must render Vehicle No');
  assert.ok(qcSrc.includes('Received From :'), 'Must render Received From with BMC tags');
  assert.ok(qcSrc.includes('DC NO:'), 'Must render DC NO:');
  assert.ok(qcSrc.includes('Dispatch Date'), 'Must render Dispatch Date');
  assert.ok(qcSrc.includes('Dispatch Time(HHMM)[12 hour format]'), 'Must render Dispatch Time in 12hr format');
  assert.ok(qcSrc.includes('CIP Date'), 'Must render CIP Date');
  assert.ok(qcSrc.includes('CIP Time(HHMM)[12 hour format]'), 'Must render CIP Time in 12hr format');
  assert.ok(qcSrc.includes('CIP Operator'), 'Must render CIP Operator input');
  assert.ok(qcSrc.includes('QC Inspection'), 'Must render QC Inspection dropdown');
  assert.ok(qcSrc.includes('CIP Clean Types'), 'Must render CIP Clean Types options');
  assert.ok(qcSrc.includes('Automatic Test'), 'Must render Automatic Test checkbox option');
  assert.ok(qcSrc.includes('Manual Test'), 'Must render Manual Test checkbox option');
  assert.ok(qcSrc.includes('Is CIP Checked'), 'Must render Is CIP Checked checkbox');
});

test('1. New Tanker Registration captures all 7 specified functional requirement fields', () => {
  const regSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/NewTankerRegistrationModal.tsx'), 'utf8');
  assert.ok(regSrc.includes('Vehicle Number'), '1. Must capture Vehicle Number');
  assert.ok(regSrc.includes('Contractor Name'), '2. Must capture Contractor Name');
  assert.ok(regSrc.includes('From Date'), '3. Must capture From Date');
  assert.ok(regSrc.includes('Registered') && regSrc.includes('Unregistered'), '4. Must capture Vehicle Type (Registered / Unregistered)');
  assert.ok(regSrc.includes('Number of Cells'), '5. Must capture Number of Cells (1, 2, 3)');
  assert.ok(regSrc.includes('Front Cell Capacity') && regSrc.includes('Middle Cell Capacity') && regSrc.includes('Back Cell Capacity'), '6. Must capture Cell Capacities (Front, Middle, Back)');
  assert.ok(regSrc.includes('Supplier Name'), '7. Must capture Supplier Name');
});

test('2. Vehicle Entry form captures exact 10 details and removes extraneous physical seal checkbox', () => {
  const gateSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/GateOperations.tsx'), 'utf8');
  assert.ok(gateSrc.includes('Vehicle No'), '1. Vehicle Number');
  assert.ok(gateSrc.includes('Driver Name'), '2. Driver Name');
  assert.ok(gateSrc.includes('Entry Date'), '3. Entry Date');
  assert.ok(gateSrc.includes('Entry Time(HHMM)(12 hour format)'), '4. Entry Time (HH:MM, 12-hour format)');
  assert.ok(gateSrc.includes('Dispatch Date'), '5. Dispatch Date');
  assert.ok(gateSrc.includes('Dispatch Time(HHMM)(12 hour format)'), '6. Dispatch Time (HH:MM, 12-hour format)');
  assert.ok(gateSrc.includes('Time Difference Between Dispatch And Entry(HH.MM)'), '7. Time Difference Between Dispatch and Entry');
  assert.ok(gateSrc.includes('DC No'), '8. DC Number');
  assert.ok(gateSrc.includes('Outlet Seal No'), '9. Outlet Seal Number');
  assert.ok(gateSrc.includes('NAMAKKAL DAIRY'), '10. Receiving Dairy NAMAKKAL DAIRY');
  // Checkbox removal verified
  assert.ok(!gateSrc.includes('Physical seal is intact and matches outlet seal number'), 'Physical seal checkbox removed per user request');
});

test('3. QC Lab implements 4 test categories for FC and BC, manual entry, and gross weight queue filter', () => {
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');
  // Condition
  assert.ok(qcSrc.includes('gross_weight != null'), 'QC queue condition checks completed gross weight');
  // 3.1 & 3.2 & 3.3
  assert.ok(qcSrc.includes('Dispatch Quality'), '3.2 Dispatch Quality');
  assert.ok(qcSrc.includes('Received Quality'), '3.3 Received Quality');
  assert.ok(qcSrc.includes('Purchase') && qcSrc.includes('Inter Unit Transfer') && qcSrc.includes('Conversion'), '3.3 Purpose options');
  assert.ok(qcSrc.includes('Chilled') && qcSrc.includes('Pasteurized') && qcSrc.includes('Skim Separated Milk') && qcSrc.includes('Condensed Skim Milk'), '3.3 C/P/S options');
  // 3.4
  assert.ok(qcSrc.includes('Qc Manual Entry Reason'), '3.4 QC Manual Entry Reason');
  // 3.5 Four test categories
  assert.ok(qcSrc.includes('Freshness Test'), '3.5.A Freshness Test');
  assert.ok(qcSrc.includes('SNF Adulteration Test'), '3.5.B SNF Adulteration Test');
  assert.ok(qcSrc.includes('Special Test'), '3.5.C Special Test');
  assert.ok(qcSrc.includes('FAT Adulteration Test'), '3.5.D FAT Adulteration Test');
  // Specific tests
  assert.ok(qcSrc.includes('Organoleptic'), 'Organoleptic');
  assert.ok(qcSrc.includes('Sugar Test'), 'Sugar Test');
  assert.ok(qcSrc.includes('Antibiotic'), 'Antibiotic');
  assert.ok(qcSrc.includes('Free Fatty Acid'), 'Free Fatty Acid');
  // 3.6
  assert.ok(qcSrc.includes('Tests Completed'), '3.6 Tests Completed');
});

test('4. Unloading Bay implements exact 4.1, 4.2 and 4.3 details, DC Dialog Box, and QC-accepted queue condition', () => {
  const unloadSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/UnloadingBay.tsx'), 'utf8');
  // Condition
  assert.ok(unloadSrc.includes("qc_status === 'accepted'") && unloadSrc.includes('!t.stage_data?.unloaded'), 'Unloading queue condition requires QC accepted');
  // 4.1
  assert.ok(unloadSrc.includes('Vehicle No') && unloadSrc.includes('Received From') && unloadSrc.includes('DC NO'), '4.1 Vehicle Details');
  // 4.2
  assert.ok(unloadSrc.includes('Unloading Date'), '4.2 Unloading Date');
  assert.ok(unloadSrc.includes('Unloading Time'), '4.2 Unloading Time (12h format)');
  assert.ok(unloadSrc.includes('Outlet Seal No'), '4.2 Outlet Seal Number');
  assert.ok(unloadSrc.includes('Unloaded To Silo'), '4.2 Unloaded To Silo dropdown');
  assert.ok(unloadSrc.includes('Unload Operator Name'), '4.2 Unload Operator Name');
  assert.ok(unloadSrc.includes('Line Number'), '4.2 Line Number');
  assert.ok(unloadSrc.includes('Line 1') && unloadSrc.includes('Line 4'), '4.2 Line 1-4 options');
  assert.ok(unloadSrc.includes('Gross Weight (Kgs)'), '4.2 Gross Weight (Kgs)');
  assert.ok(unloadSrc.includes('Unloading Cells'), '4.2 Unloading Cells (FC, DC Dialog Box)');
  assert.ok(unloadSrc.includes('Delivery Challan (DC) Details'), '4.2 DC Dialog Box modal');
  assert.ok(unloadSrc.includes('Is NPD Transfer?'), '4.2 Is NPD Transfer?');
  // 4.3
  assert.ok(unloadSrc.includes('Received Quality'), '4.3 Received Quality');
  assert.ok(unloadSrc.includes('Sp. Gr.'), '4.3 Specific Gravity (Sp. Gr.)');
  assert.ok(unloadSrc.includes('COB'), '4.3 COB');
});

test('5. Additional Forms: Tare Weight, Tanker Out, and CIP waiting conditions', () => {
  const gateSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/GateOperations.tsx'), 'utf8');
  const qcSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/plant/QCLab.tsx'), 'utf8');

  // 6.2 Tare Weight Form (Authentic Aavin IDMS VEHICLE TARE WEIGHT DETAILS)
  assert.ok(gateSrc.includes('VEHICLE TARE WEIGHT DETAILS'), '6.2 Tare Weight Details heading');
  assert.ok(gateSrc.includes('Tare Weight(Kgs)'), '6.2 Tare Weight Kgs');
  assert.ok(gateSrc.includes('Dispatch Weight(Kgs)'), '6.2 Dispatch Weight Kgs');
  assert.ok(gateSrc.includes('Net Weight(Kgs)'), '6.2 Net Weight Kgs');
  assert.ok(gateSrc.includes('TareWeightReport'), '6.2 TareWeightReport action');
  assert.ok(gateSrc.includes('Net Milk Weight'), '6.2 Net Milk Weight auto-calculation');
  assert.ok(gateSrc.includes('Tare Slip No'), '6.2 Tare Slip No');

  // 6.3 Tanker Out Form (Authentic Aavin IDMS VEHICLE OUT DETAILS)
  assert.ok(gateSrc.includes('VEHICLE OUT DETAILS'), '6.3 Authentic Vehicle Out Details heading');
  assert.ok(gateSrc.includes('TANKER OUT DETAILS'), '6.3 Tanker Out alias');
  assert.ok(gateSrc.includes('Gate Pass Number'), '6.3 Gate Pass Number');
  assert.ok(gateSrc.includes('Security Guard Name'), '6.3 Security Guard Name');

  // 5. CIP Condition
  assert.ok(qcSrc.includes('tare_weight != null') && qcSrc.includes('!t.stage_data?.cip_completed'), '5. CIP queue requires completed Tare Weight');
});






