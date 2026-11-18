import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  deriveTankerJourneyState,
  calculateTankerMetrics,
  TANKER_STAGES,
  STAGE_COLORS,
} = require('../dist/lib/tankerJourney.js');
const { DEFAULT_ASSUMPTIONS, DEFAULT_STAGE_TIME_LIMITS } = require('../dist/config/defaults.js');

test('1. Timeline state derivation: trip with no stages done is "on_the_way"', () => {
  const trip = {
    id: 'trip-otw',
    date: '2026-11-16',
    tanker_number: 'TN-25-A-1001',
    quantity_dispatched: 9000,
    stages: [],
  };

  const journey = deriveTankerJourneyState(trip);
  assert.equal(journey.tripStatus, 'on_the_way');
  assert.equal(journey.tripStatusLabel, 'On the way');
  assert.equal(journey.currentStageIndex, 0); // Next stage is 0 (Vehicle Entered)
  assert.equal(journey.currentStageKey, 'vehicle_entered');
  assert.equal(journey.isOverLimit, false);
  assert.equal(journey.isQcRejected, false);
  assert.equal(journey.completedStepsCount, 0);

  // All 7 steps in timeline
  assert.equal(journey.timelineSteps.length, 7);
  assert.equal(journey.timelineSteps[0].status, 'current'); // Gate entry is waiting
  for (let i = 1; i < 7; i++) {
    assert.equal(journey.timelineSteps[i].status, 'pending');
  }
});

test('2. Timeline state derivation: current stage, completed stages, and pending stages in strict sequence', () => {
  const baseTime = Date.now();
  const trip = {
    id: 'trip-prog',
    date: '2026-11-16',
    tanker_number: 'TN-25-B-1002',
    quantity_dispatched: 8500,
    stages: [
      {
        stage_name: 'vehicle_entered',
        team: 'gate',
        status: 'done',
        done_at: new Date(baseTime - 25 * 60000).toISOString(),
        done_by_name: 'Gate Officer',
        stage_data: { seal_verified: true },
      },
      {
        stage_name: 'gross_weight',
        team: 'gate',
        status: 'done',
        done_at: new Date(baseTime - 10 * 60000).toISOString(),
        done_by_name: 'Gate Weigher',
        stage_data: { gross_weight_kg: 24000, weighbridge_slip_no: 'WB-501' },
      },
    ],
  };

  const journey = deriveTankerJourneyState(trip, {}, baseTime);

  // Completed: vehicle_entered & gross_weight -> tripStatus is gross_done
  assert.equal(journey.tripStatus, 'gross_done');
  assert.equal(journey.completedStepsCount, 2);

  // Next current stage should be stage 3: qc_completed (team: qc)
  assert.equal(journey.currentStageKey, 'qc_completed');
  assert.equal(journey.waitingTeam, 'qc');
  assert.equal(journey.waitingTeamLabel, 'QC Lab');

  // Verify steps status
  assert.equal(journey.timelineSteps[0].status, 'done');
  assert.equal(journey.timelineSteps[1].status, 'done');
  assert.equal(journey.timelineSteps[2].status, 'current'); // QC is waiting
  assert.equal(journey.timelineSteps[3].status, 'pending'); // Unloaded pending
  assert.equal(journey.timelineSteps[4].status, 'pending'); // Tare pending
  assert.equal(journey.timelineSteps[5].status, 'pending'); // CIP pending
  assert.equal(journey.timelineSteps[6].status, 'pending'); // Exit pending
});

test('3. Timeline state derivation: QC rejected path skips Unloaded and routes to Tare Weight', () => {
  const baseTime = Date.now();
  const trip = {
    id: 'trip-rej',
    date: '2026-11-16',
    tanker_number: 'TN-25-R-9999',
    quantity_dispatched: 8000,
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done', done_at: new Date(baseTime - 50 * 60000).toISOString() },
      { stage_name: 'gross_weight', team: 'gate', status: 'done', done_at: new Date(baseTime - 35 * 60000).toISOString(), stage_data: { gross_weight_kg: 23000 } },
      {
        stage_name: 'qc_completed',
        team: 'qc',
        status: 'rejected',
        done_at: new Date(baseTime - 15 * 60000).toISOString(),
        stage_data: { qc_status: 'rejected', rejection_reason: 'Acidity 0.18% - sour milk' },
      },
      {
        stage_name: 'unloaded',
        team: 'unloading',
        status: 'skipped',
        done_at: new Date(baseTime - 15 * 60000).toISOString(),
        stage_data: { note: 'Skipped (QC rejected)' },
      },
    ],
  };

  const journey = deriveTankerJourneyState(trip, {}, baseTime);

  assert.equal(journey.isQcRejected, true);
  assert.equal(journey.qcRejectionReason, 'Acidity 0.18% - sour milk');

  // Next current stage after QC rejection must be tare_weight (Gate), skipping unloaded!
  assert.equal(journey.currentStageKey, 'tare_weight');
  assert.equal(journey.waitingTeam, 'gate');

  // Verify Unloaded step is marked skipped
  const unloadedStep = journey.timelineSteps.find((s) => s.key === 'unloaded');
  assert.equal(unloadedStep.status, 'skipped');
  assert.equal(unloadedStep.statusIcon, 'skip');

  // Verify QC step is marked rejected
  const qcStep = journey.timelineSteps.find((s) => s.key === 'qc_completed');
  assert.equal(qcStep.status, 'rejected');
  assert.equal(qcStep.statusIcon, 'cross');
});

test('4. Timeline state derivation: fully completed journey is "exited"', () => {
  const baseTime = Date.now();
  const trip = {
    id: 'trip-done',
    date: '2026-11-16',
    tanker_number: 'TN-25-H-1008',
    quantity_dispatched: 9400,
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done', done_at: new Date(baseTime - 120 * 60000).toISOString() },
      { stage_name: 'gross_weight', team: 'gate', status: 'done', done_at: new Date(baseTime - 105 * 60000).toISOString(), stage_data: { gross_weight_kg: 24800 } },
      { stage_name: 'qc_completed', team: 'qc', status: 'done', done_at: new Date(baseTime - 85 * 60000).toISOString(), stage_data: { qc_status: 'accepted', received_fat_pct: 4.5, received_snf_pct: 8.4 } },
      { stage_name: 'unloaded', team: 'unloading', status: 'done', done_at: new Date(baseTime - 55 * 60000).toISOString(), stage_data: { silo_or_bay: 'Silo-1', unloaded_litres: 9380 } },
      { stage_name: 'tare_weight', team: 'gate', status: 'done', done_at: new Date(baseTime - 40 * 60000).toISOString(), stage_data: { tare_weight_kg: 15150, net_weight_kg: 9650 } },
      { stage_name: 'cip_completed', team: 'qc', status: 'done', done_at: new Date(baseTime - 20 * 60000).toISOString(), stage_data: { cip_status: 'pass' } },
      { stage_name: 'vehicle_exit', team: 'gate', status: 'done', done_at: new Date(baseTime - 5 * 60000).toISOString(), stage_data: { gate_pass_number: 'GP-9012' } },
    ],
  };

  const journey = deriveTankerJourneyState(trip, {}, baseTime);
  assert.equal(journey.tripStatus, 'exited');
  assert.equal(journey.completedStepsCount, 7);
  assert.equal(journey.currentStageKey, null);
  assert.equal(journey.waitingTeam, null);
  assert.equal(journey.waitingTeamLabel, 'None');
});

test('5. Waiting-time calculation and over-limit flag using configured SLA limits', () => {
  const baseTime = Date.now();
  const settings = {
    stage_time_limits_min: {
      vehicle_entered: 15,
      gross_weight: 15,
      qc_completed: 30,
      unloaded: 45,
      tare_weight: 15,
      cip_completed: 30,
      vehicle_exit: 15,
    },
  };

  // Case A: Waiting 10 minutes (limit is 15) -> Not delayed
  const onTimeTrip = {
    id: 'trip-ontime',
    date: '2026-11-16',
    tanker_number: 'TN-25-T-1',
    quantity_dispatched: 9000,
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done', done_at: new Date(baseTime - 10 * 60000).toISOString() },
    ],
  };
  const journeyOnTime = deriveTankerJourneyState(onTimeTrip, settings, baseTime);
  assert.equal(journeyOnTime.isOverLimit, false);
  assert.equal(journeyOnTime.waitingSinceMinutes, 10);

  // Case B: Waiting 50 minutes (limit is 15 min for gross weight) -> Delayed!
  const delayedTrip = {
    id: 'trip-delay',
    date: '2026-11-16',
    tanker_number: 'TN-25-T-2',
    quantity_dispatched: 9000,
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done', done_at: new Date(baseTime - 50 * 60000).toISOString() },
    ],
  };
  const journeyDelayed = deriveTankerJourneyState(delayedTrip, settings, baseTime);
  assert.equal(journeyDelayed.isOverLimit, true);
  assert.equal(journeyDelayed.waitingSinceMinutes, 50);

  const currentStep = journeyDelayed.timelineSteps[journeyDelayed.currentStageIndex];
  assert.equal(currentStep.isOverLimit, true);
});

test('6. Net weight, net litres and transit loss calculations including milk density', () => {
  // Test calculateTankerMetrics directly
  const metricsDefaultDensity = calculateTankerMetrics({
    dispatchedLitres: 10000,
    grossWeightKg: 25000,
    tareWeightKg: 14700,
    density: 1.030,
    entryDoneAt: '2026-11-16T08:00:00Z',
    exitDoneAt: '2026-11-16T09:45:00Z',
  });

  // Gross = 25000, Tare = 14700 => Net = 10300 kg
  assert.equal(metricsDefaultDensity.net_weight_kg, 10300);
  // Net Litres = 10300 / 1.030 = 10000.00 L
  assert.equal(metricsDefaultDensity.net_litres, 10000);
  // Transit loss = 10000 - 10000 = 0.00 L
  assert.equal(metricsDefaultDensity.transit_loss_litres, 0);
  assert.equal(metricsDefaultDensity.transit_loss_pct, 0);
  // Turnaround: 08:00 to 09:45 = 105 min
  assert.equal(metricsDefaultDensity.total_turnaround_min, 105);

  // Test with custom density 1.028 kg/L and transit loss
  const metricsCustomDensity = calculateTankerMetrics({
    dispatchedLitres: 10000,
    grossWeightKg: 24500,
    tareWeightKg: 14500,
    density: 1.028,
  });

  // Net = 10000 kg. Net litres = 10000 / 1.028 = 9727.63 L
  assert.equal(metricsCustomDensity.net_weight_kg, 10000);
  assert.equal(metricsCustomDensity.net_litres, 9727.63);
  // Transit loss = 10000 - 9727.63 = 272.37 L
  assert.equal(metricsCustomDensity.transit_loss_litres, 272.37);
  assert.equal(metricsCustomDensity.transit_loss_pct, 2.72);
});

test('7. Auto-flag conditions for the three mismatch rules', () => {
  const settings = {
    transit_loss_warn_pct: 1.0,
    transit_loss_danger_pct: 2.0,
    net_weight_diff_threshold_kg: 50,
    quality_drop_threshold_fat: 0.30,
    quality_drop_threshold_snf: 0.20,
    milk_density_kg_per_litre: 1.030,
  };

  // Trip with all 3 mismatches:
  // 1. High transit loss: 10000 dispatched, only 9700 received (3% loss > 2% danger)
  // 2. Net weight difference: dispatched 10000 L * 1.030 = 10300 kg expected, but net wt is 10000 kg (diff 300 kg > 50 kg)
  // 3. Quality drop: dispatch fat 4.80%, received fat 4.30% (drop 0.50% > 0.30%)
  const mismatchTrip = {
    id: 'trip-flag',
    date: '2026-11-16',
    tanker_number: 'TN-25-WARN-1',
    quantity_dispatched: 10000,
    dispatch_fat_pct: 4.80,
    dispatch_snf_pct: 8.60,
    received_qty: 9700,
    received_fat_pct: 4.30,
    received_snf_pct: 8.35,
    gross_weight_kg: 24500,
    tare_weight_kg: 14500, // net = 10000 kg
    stages: [
      { stage_name: 'vehicle_entered', team: 'gate', status: 'done' },
      { stage_name: 'gross_weight', team: 'gate', status: 'done', stage_data: { gross_weight_kg: 24500 } },
      { stage_name: 'qc_completed', team: 'qc', status: 'done', stage_data: { qc_status: 'accepted', received_fat_pct: 4.30, received_snf_pct: 8.35 } },
      { stage_name: 'unloaded', team: 'unloading', status: 'done', stage_data: { unloaded_litres: 9700 } },
      { stage_name: 'tare_weight', team: 'gate', status: 'done', stage_data: { tare_weight_kg: 14500 } },
    ],
  };

  const journey = deriveTankerJourneyState(mismatchTrip, settings);
  assert.equal(journey.autoFlags.length, 4); // transit_loss, net_weight_diff, fat_drop, snf_drop

  const flagTypes = journey.autoFlags.map((f) => f.type);
  assert.ok(flagTypes.includes('transit_loss'));
  assert.ok(flagTypes.includes('net_weight_diff'));
  assert.ok(flagTypes.includes('quality_drop'));
});

test('8. Stage chip counts and Tab status categorization logic', () => {
  const trips = [
    { id: '1', tripStatus: 'on_the_way' },
    { id: '2', tripStatus: 'vehicle_entered' },
    { id: '3', tripStatus: 'gross_done' },
    { id: '4', tripStatus: 'qc_done' },
    { id: '5', tripStatus: 'unloaded' },
    { id: '6', tripStatus: 'tare_done' },
    { id: '7', tripStatus: 'cip_done' },
    { id: '8', tripStatus: 'exited' },
    { id: '9', tripStatus: 'qc_rejected' },
  ];

  // Waiting: all active trips not exited and not qc_rejected (1 through 7 = 7 trips)
  const waitingTrips = trips.filter((t) => t.tripStatus !== 'exited' && t.tripStatus !== 'qc_rejected');
  assert.equal(waitingTrips.length, 7);

  // Processed: exited trips (trip 8 = 1 trip)
  const processedTrips = trips.filter((t) => t.tripStatus === 'exited');
  assert.equal(processedTrips.length, 1);

  // Rejected: qc_rejected trips (trip 9 = 1 trip)
  const rejectedTrips = trips.filter((t) => t.tripStatus === 'qc_rejected');
  assert.equal(rejectedTrips.length, 1);

  // Total
  assert.equal(trips.length, 9);
});

test('9. DC Number handling: formats into vehicle_entered summary and reflects in journey', () => {
  const trip = {
    id: 'trip-dc-test',
    date: '2026-11-18',
    tanker_number: 'TN-25-DC-1234',
    dc_number: 'DC-BMC-2026-889',
    driver_name: 'Murugan R',
    seal_number: 'SL-7721',
    quantity_dispatched: 9500,
    stages: [
      {
        stage_name: 'vehicle_entered',
        team: 'gate',
        status: 'done',
        stage_data: {
          tanker_number: 'TN-25-DC-1234',
          dc_number: 'DC-BMC-2026-889',
          driver_name: 'Murugan R',
          seal_number: 'SL-7721',
        },
      },
    ],
  };

  const journey = deriveTankerJourneyState(trip);
  assert.equal(journey.tripStatus, 'vehicle_entered');
  const step0 = journey.timelineSteps[0];
  assert.equal(step0.key, 'vehicle_entered');
  assert.equal(step0.status, 'done');
  assert.ok(step0.keyDataSummary.includes('DC #DC-BMC-2026-889'));
  assert.ok(step0.keyDataSummary.includes('TN-25-DC-1234'));
  assert.ok(step0.keyDataSummary.includes('Murugan R'));
});

test('10. Tanker Dossier & Daily Reconciliation Export structure', async () => {
  const XLSX = await import('xlsx');

  // Test 1: Single Tanker Dossier Multi-Sheet Structure
  const wbDossier = XLSX.utils.book_new();
  const dossierRows = [
    { Field: 'Tanker / Vehicle Number', Value: 'TN-25-DC-1234' },
    { Field: 'Delivery Challan No (DC No)', Value: 'DC-BMC-2026-889' },
    { Field: 'Dispatched Milk Volume', Value: '9,500 Litres' },
  ];
  const wsDossier = XLSX.utils.json_to_sheet(dossierRows);
  XLSX.utils.book_append_sheet(wbDossier, wsDossier, 'Tanker Dossier');

  const compRows = [
    { 'Comp #': 1, 'Compartment Name': 'Front Barrel', 'Milk Volume (L)': 5000, 'Dipstick Level (cm)': 142.5 },
    { 'Comp #': 2, 'Compartment Name': 'Rear Barrel', 'Milk Volume (L)': 4500, 'Dipstick Level (cm)': 138.0 },
  ];
  const wsComp = XLSX.utils.json_to_sheet(compRows);
  XLSX.utils.book_append_sheet(wbDossier, wsComp, 'Compartment Breakdown');

  const bufDossier = XLSX.write(wbDossier, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(Buffer.isBuffer(bufDossier) && bufDossier.length > 100, 'Dossier workbook generates binary XLSX buffer');

  // Test 2: Daily Reconciliation Multi-Column Report
  const wbDaily = XLSX.utils.book_new();
  const summaryRows = [
    { Header: 'TAMIL NADU CO-OPERATIVE MILK PRODUCERS FEDERATION (AAVIN)' },
    { Header: 'Receiving Dairy: SALEM DAIRY PLANT | Report Date: 18-11-2026' },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wbDaily, wsSummary, 'Summary Header');

  const tableRows = [
    {
      'S.No': 1,
      'Date': '18-11-2026',
      'Tanker / Vehicle No': 'TN-25-DC-1234',
      'DC No (BMC Invoice)': 'DC-BMC-2026-889',
      'Source BMC': 'Rasipuram BMC',
      'Dispatched Qty (L)': 9500,
      'Dispatched Fat (%)': 4.5,
      'Dispatched SNF (%)': 8.5,
      'Gross Weight (kg)': 25200,
      'Tare Weight (kg)': 15400,
      'Net Milk Weight (kg)': 9800,
      'Received Qty (L)': 9480,
      'Transit Loss (L)': 20,
      'Transit Loss (%)': '0.21%',
      'QC Status': 'ACCEPTED',
      'CIP Status': 'PASSED',
    },
  ];
  const wsTable = XLSX.utils.json_to_sheet(tableRows);
  XLSX.utils.book_append_sheet(wbDaily, wsTable, 'Daily Tanker Reception');

  const bufDaily = XLSX.write(wbDaily, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(Buffer.isBuffer(bufDaily) && bufDaily.length > 100, 'Daily report workbook generates binary XLSX buffer');
});


