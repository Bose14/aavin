import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deriveTankerJourneyState } = require('../dist/lib/tankerJourney.js');
const {
  saveTankerDispatchMetadata,
  getTankerDispatchMetadata,
  recordTankerStageInDb,
  getTankerStagesForTrips,
} = require('../dist/lib/settingsStore.js');

test('End-to-End Multi-Team Reflection: BMC -> Gate -> Weighbridge -> QC -> Unloading -> CIP -> Exit -> Admin', async () => {
  const tripId = `test-trip-${Date.now()}`;
  const tankerNum = `TN88TEST${Math.floor(Math.random() * 8999 + 1000)}`;
  const dcNo = `DC-E2E-${Date.now().toString().slice(-4)}`;

  // 1. BMC Tanker Dispatch
  saveTankerDispatchMetadata({
    id: tripId,
    tanker_number: tankerNum,
    dc_number: dcNo,
    driver_name: 'Muthu Kumar',
    driver_phone: '9876543210',
    seal_number: 'SL-99881',
    dispatch_time: '08:30 AM',
    quantity_dispatched: 12000,
    dispatch_fat_pct: 4.2,
    dispatch_snf_pct: 8.5,
    compartments: [
      { compartment_no: 1, compartment_name: 'Front Cell (FC)', quantity_litres: 6500, fat_pct: 4.2, snf_pct: 8.5 },
      { compartment_no: 2, compartment_name: 'Back Cell (BC)', quantity_litres: 5500, fat_pct: 4.2, snf_pct: 8.5 },
    ],
  });

  const bmcSaved = getTankerDispatchMetadata(tripId);
  assert.ok(bmcSaved, 'BMC dispatch metadata must be stored');
  assert.equal(bmcSaved.tanker_number, tankerNum);
  assert.equal(bmcSaved.dc_number, dcNo);

  // Initial journey state
  let stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  let journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...bmcSaved,
    stages,
  });
  assert.equal(journey.tripStatus, 'on_the_way');
  assert.equal(journey.waitingTeam, 'gate');
  assert.ok(!journey.completedStageKeys.includes('vehicle_entered'));

  // 2. Stage 1: Gate Milk Receipt Entry (vehicle_entered)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'vehicle_entered',
    team: 'gate',
    status: 'done',
    stage_data: {
      vehicle_number: tankerNum,
      driver_name: 'Muthu Kumar',
      dc_number: dcNo,
      outlet_seal_no: 'SL-99881',
      entry_time: '09:15 AM',
      dispatch_time: '08:30 AM',
      receiving_dairy: 'Namakkal Dairy',
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('vehicle_entered'), 'Vehicle entered must be completed');
  assert.equal(journey.waitingTeam, 'gate', 'Next waiting team is Gate for Gross Weight');
  assert.equal(journey.currentStageKey, 'gross_weight');

  // 3. Stage 2: Gate Gross Weight Entry (gross_weight)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'gross_weight',
    team: 'gate',
    status: 'done',
    stage_data: {
      gross_weight_kg: 24500,
      gross_slip_no: 'GW-8801',
      weighbridge_operator: 'Murugan',
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('gross_weight'), 'Gross weight must be completed');
  assert.equal(journey.waitingTeam, 'qc', 'Queue condition: Vehicles for which Gross Weight completed wait for QC');
  assert.equal(journey.currentStageKey, 'qc_completed');

  // 4. Stage 3: QC Lab Quality Inspection (qc_completed)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'qc_completed',
    team: 'qc',
    status: 'done',
    stage_data: {
      qc_status: 'accepted',
      chemist_name: 'Dr. Anand',
      tests_completed: 'All 4 Test Categories Passed (Freshness, SNF, Special, FAT)',
      received_fat_pct: 4.25,
      received_snf_pct: 8.52,
      tests: {
        freshness: { fc: { organoleptic: 'Satisfied' }, bc: { organoleptic: 'Satisfied' } },
        snf_adulteration: { fc: { urea: 'Negative', starch: 'Negative' }, bc: { urea: 'Negative', starch: 'Negative' } },
        special_test: { fc: { antibiotic: 'Negative' }, bc: { antibiotic: 'Negative' } },
        fat_adulteration: { fc: { mot: 'Negative' }, bc: { mot: 'Negative' } },
      },
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('qc_completed'), 'QC must be completed');
  assert.equal(journey.waitingTeam, 'unloading', 'Queue condition: Vehicles for which QC completed wait for Unloading');
  assert.equal(journey.currentStageKey, 'unloaded');

  // 5. Stage 4: Unloading Bay Reception (unloaded)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'unloaded',
    team: 'unloading',
    status: 'done',
    stage_data: {
      unloaded_to_silo: 'Silo 2',
      line_number: 'Line 1',
      unload_operator: 'Selvam',
      unloaded_litres: 11980,
      gross_weight_kg: 24500,
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('unloaded'), 'Unloading must be completed');
  assert.equal(journey.waitingTeam, 'gate', 'Queue condition: After unloading, vehicle waits for Tare Weight');
  assert.equal(journey.currentStageKey, 'tare_weight');

  // 6. Stage 5: Gate Tare Weight Entry (tare_weight)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'tare_weight',
    team: 'gate',
    status: 'done',
    stage_data: {
      tare_weight_kg: 12200,
      tare_slip_no: 'TW-8801',
      net_weight_kg: 12300,
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('tare_weight'), 'Tare weight must be completed');
  assert.equal(journey.waitingTeam, 'qc', 'Queue condition: After Tare Weight, vehicle waits for CIP');
  assert.equal(journey.currentStageKey, 'cip_completed');

  // 7. Stage 6: QC CIP Sanitization (cip_completed)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'cip_completed',
    team: 'qc',
    status: 'done',
    stage_data: {
      cip_operator: 'Dr. Anand',
      qc_inspection: 'Satisfied',
      cip_clean_type: 'Automatic Test',
      is_cip_checked: true,
      remarks: 'Tanker clean and fully sanitized',
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.ok(journey.completedStageKeys.includes('cip_completed'), 'CIP completed');
  assert.equal(journey.waitingTeam, 'gate', 'Queue condition: After CIP, vehicle waits for Gate Tanker Out');
  assert.equal(journey.currentStageKey, 'vehicle_exit');

  // 8. Stage 7: Gate Tanker Out (vehicle_exit)
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'vehicle_exit',
    team: 'gate',
    status: 'done',
    stage_data: {
      gate_pass_number: 'GP-999888',
      exit_time: new Date().toISOString(),
    },
  });

  stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 12000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });
  assert.equal(journey.tripStatus, 'exited', 'Tanker trip must be fully exited');
  assert.equal(journey.waitingTeam, null, 'No waiting team once exited');
  assert.equal(journey.completedStepsCount, 7, 'All 7 stages complete');

  // 9. Admin Reflection Verification
  const finalMeta = getTankerDispatchMetadata(tripId);
  assert.ok(finalMeta, 'Admin has full fallback metadata');
  assert.ok(finalMeta.stage_data?.vehicle_entered, 'Admin sees vehicle_entered data');
  assert.ok(finalMeta.stage_data?.gross_weight, 'Admin sees gross_weight data');
  assert.ok(finalMeta.stage_data?.qc_completed, 'Admin sees qc_completed data');
  assert.ok(finalMeta.stage_data?.unloaded, 'Admin sees unloaded data');
  assert.ok(finalMeta.stage_data?.tare_weight, 'Admin sees tare_weight data');
  assert.ok(finalMeta.stage_data?.cip_completed, 'Admin sees cip_completed data');
  assert.ok(finalMeta.stage_data?.vehicle_exit, 'Admin sees vehicle_exit data');
});

test('QC Rejection Bypass: Rejected tanker skips Unloading and routes directly to Tare Weight', async () => {
  const tripId = `test-reject-${Date.now()}`;
  const tankerNum = `TN88REJ${Math.floor(Math.random() * 8999 + 1000)}`;

  saveTankerDispatchMetadata({
    id: tripId,
    tanker_number: tankerNum,
    dc_number: 'DC-REJ-01',
    quantity_dispatched: 10000,
  });

  // Entry & Gross Weight done
  await recordTankerStageInDb({ trip_id: tripId, stage_name: 'vehicle_entered', team: 'gate', status: 'done', stage_data: {} });
  await recordTankerStageInDb({ trip_id: tripId, stage_name: 'gross_weight', team: 'gate', status: 'done', stage_data: { gross_weight_kg: 22000 } });

  // QC rejects milk
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'qc_completed',
    team: 'qc',
    status: 'rejected',
    stage_data: {
      qc_status: 'rejected',
      rejection_reason: 'Antibiotic Positive in Front Cell',
    },
  });
  // Record skipped for unloaded
  await recordTankerStageInDb({
    trip_id: tripId,
    stage_name: 'unloaded',
    team: 'unloading',
    status: 'skipped',
    stage_data: { note: 'Skipped (QC rejected)' },
  });

  const stages = await getTankerStagesForTrips([tripId]).then((m) => m[tripId] || []);
  const journey = deriveTankerJourneyState({
    id: tripId,
    date: '2026-11-20',
    tanker_number: tankerNum,
    quantity_dispatched: 10000,
    ...getTankerDispatchMetadata(tripId),
    stages,
  });

  assert.equal(journey.isQcRejected, true, 'Journey flags QC rejected');
  assert.equal(journey.waitingTeam, 'gate', 'Bypasses Unloading and waits for Gate Tare Weight');
  assert.equal(journey.currentStageKey, 'tare_weight');

  const unloadedStep = journey.timelineSteps.find((s) => s.key === 'unloaded');
  assert.equal(unloadedStep?.status, 'skipped', 'Unloaded stage marked skipped');
});
