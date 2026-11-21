import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { installFakeSupabase } from './helpers/fakeSupabase.mjs';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const require = createRequire(import.meta.url);
installFakeSupabase();
const {
  deriveTankerJourneyState,
  calculateTankerMetrics,
  TANKER_STAGES,
  STAGE_COLORS,
} = require('../dist/lib/tankerJourney.js');
const {
  saveTankerDispatchMetadata,
  getTankerDispatchMetadata,
  recordTankerStageInDb,
  getTankerStagesForTrips,
  saveRegisteredTankerInDb,
  getRegisteredTankersInDb,
  findRegisteredTankerInDb,
  readFallback,
} = require('../dist/lib/settingsStore.js');
const {
  enrichTankerRow,
  runResilientTankerQuery,
  computeAvailableStock,
  enrichRegisteredTankersWithCapacity,
} = require('../dist/routes/tanker.js');
const {
  calculateWeightedQuality,
  formatDateDDMMYYYY,
} = require('../dist/lib/calculations.js');

test('INSTANCE TESTING SUITE: AAVIN Tanker Lifecycle, Multi-BMC, Plant Pipeline & Database Resilience', async (t) => {

  // =========================================================================
  // GROUP 1: Tanker Registration & Cell Capacity Models
  // =========================================================================
  await t.test('1. Tanker Registration: 1, 2, and 3-cell vehicles with custom capacities', async () => {
    // 1A. Register 2-cell tanker (e.g. TN28AB1001)
    const tanker2Cell = await saveRegisteredTankerInDb({
      vehicle_number: 'TN28AB1001',
      contractor_name: 'Aavin Logistics Corp',
      from_date: '2026-11-01',
      vehicle_type: 'Registered',
      number_of_cells: 2,
      front_cell_capacity: 6500,
      back_cell_capacity: 5500,
      supplier_name: 'Aavin Namakkal Dairy',
    });
    assert.equal(tanker2Cell.vehicle_number, 'TN28AB1001');
    assert.equal(tanker2Cell.number_of_cells, 2);
    assert.equal(tanker2Cell.front_cell_capacity, 6500);
    assert.equal(tanker2Cell.back_cell_capacity, 5500);

    // 1B. Register 3-cell tanker (e.g. TN34AK9999)
    const tanker3Cell = await saveRegisteredTankerInDb({
      vehicle_number: 'TN34AK9999',
      contractor_name: 'Salem Transporters',
      from_date: '2026-11-01',
      vehicle_type: 'Registered',
      number_of_cells: 3,
      front_cell_capacity: 5000,
      middle_cell_capacity: 4000,
      back_cell_capacity: 5000,
      supplier_name: 'Aavin Dairy',
    });
    assert.equal(tanker3Cell.vehicle_number, 'TN34AK9999');
    assert.equal(tanker3Cell.number_of_cells, 3);
    assert.equal(tanker3Cell.middle_cell_capacity, 4000);

    // 1C. Verify Capacity Enrichment when empty
    const enriched = await enrichRegisteredTankersWithCapacity('zone-test-01', [tanker2Cell, tanker3Cell]);
    assert.equal(enriched.length, 2);

    const t2 = enriched.find((x) => x.vehicle_number === 'TN28AB1001');
    assert.ok(t2);
    assert.equal(t2.total_capacity, 12000);
    assert.equal(t2.filled_capacity, 0);
    assert.equal(t2.available_capacity, 12000);
    assert.equal(t2.is_full, false);
    assert.equal(t2.is_available_for_dispatch, true);
    assert.equal(t2.cells.length, 2);
    assert.equal(t2.cells[0].cell_key, 'FC');
    assert.equal(t2.cells[0].capacity, 6500);
    assert.equal(t2.cells[0].available_litres, 6500);
    assert.equal(t2.cells[1].cell_key, 'BC');
    assert.equal(t2.cells[1].capacity, 5500);

    const t3 = enriched.find((x) => x.vehicle_number === 'TN34AK9999');
    assert.ok(t3);
    assert.equal(t3.total_capacity, 14000);
    assert.equal(t3.cells.length, 3);
    assert.equal(t3.cells[1].cell_key, 'MC');
    assert.equal(t3.cells[1].capacity, 4000);
  });

  // =========================================================================
  // GROUP 2: BMC Dispatch Form - Input Variations & Validations
  // =========================================================================
  await t.test('2. BMC Dispatch Form Validations ("What happens if I enter invalid data?")', () => {
    // 2A: Missing Tanker Number
    const validateDispatch = (payload) => {
      if (!payload.tanker_number || !payload.tanker_number.trim()) return 'Lorry / Tanker number is required';
      if (!payload.driver_name || !payload.driver_name.trim()) return 'Driver name is mandatory';
      if (!payload.dc_number || !payload.dc_number.trim()) return 'DC No (BMC Delivery Challan / Invoice No) is mandatory';
      if (!payload.seal_number || !payload.seal_number.trim()) return 'Outlet Seal No is mandatory for tanker dispatch security';
      const active = (payload.compartments || []).filter((c) => Number(c.quantity_litres) > 0);
      if (active.length === 0) return 'Please enter positive milk volume for at least one compartment';
      for (const c of active) {
        const q = Number(c.quantity_litres);
        const maxAvail = c.available_litres != null ? c.available_litres : (c.capacity_litres ? Number(c.capacity_litres) : Infinity);
        if (q > maxAvail) return `Quantity for ${c.compartment_name} (${q} L) exceeds available space (${maxAvail} L)`;
      }
      return null;
    };

    assert.equal(validateDispatch({ tanker_number: '' }), 'Lorry / Tanker number is required');
    assert.equal(validateDispatch({ tanker_number: 'TN28AB1001', driver_name: '' }), 'Driver name is mandatory');
    assert.equal(validateDispatch({ tanker_number: 'TN28AB1001', driver_name: 'Muthu', dc_number: '' }), 'DC No (BMC Delivery Challan / Invoice No) is mandatory');
    assert.equal(validateDispatch({ tanker_number: 'TN28AB1001', driver_name: 'Muthu', dc_number: 'DC-01', seal_number: '' }), 'Outlet Seal No is mandatory for tanker dispatch security');
    assert.equal(validateDispatch({
      tanker_number: 'TN28AB1001',
      driver_name: 'Muthu',
      dc_number: 'DC-01',
      seal_number: 'SL-01',
      compartments: [{ compartment_name: 'FC', quantity_litres: 0 }],
    }), 'Please enter positive milk volume for at least one compartment');

    // 2B: Overfilling Cell: FC capacity is 6500, user attempts 7000 L
    assert.equal(validateDispatch({
      tanker_number: 'TN28AB1001',
      driver_name: 'Muthu',
      dc_number: 'DC-01',
      seal_number: 'SL-01',
      compartments: [{ compartment_name: 'Front Cell (FC)', quantity_litres: 7000, available_litres: 6500 }],
    }), 'Quantity for Front Cell (FC) (7000 L) exceeds available space (6500 L)');
  });

  // =========================================================================
  // GROUP 3: Multi-BMC Dispatch Workflow (BMC 1 + BMC 2 -> Dairy Centre)
  // =========================================================================
  const testTripId = `trip-inst-${Date.now()}`;
  const testVehNum = `TN38IN${Math.floor(Math.random() * 8999 + 1000)}`;

  await t.test('3. Multi-BMC Route: BMC 1 dispatches Cell 1, BMC 2 dispatches Cell 2 into same tanker', async () => {
    // Register the tanker first: 2 cells (FC: 6000L, BC: 6000L = 12000L total)
    const registered = await saveRegisteredTankerInDb({
      vehicle_number: testVehNum,
      contractor_name: 'State Express Transport',
      from_date: '2026-11-01',
      vehicle_type: 'Registered',
      number_of_cells: 2,
      front_cell_capacity: 6000,
      back_cell_capacity: 6000,
      supplier_name: 'Aavin Dairy',
    });

    // 3A. BMC 1 Milk Dispatch: Fills FC with 5,500 L, leaving BC empty (0 L)
    saveTankerDispatchMetadata({
      id: testTripId,
      tanker_number: testVehNum,
      bmc_id: 'bmc-unit-01',
      zone_id: 'zone-test-01',
      date: '2026-11-21',
      driver_name: 'S. Ramanathan',
      driver_phone: '9842100001',
      dc_number: 'DC-BMC1-8891',
      seal_number: 'SL-OUT-101',
      dispatch_time: '07:30 AM',
      quantity_dispatched: 5500,
      dispatch_fat_pct: 4.30,
      dispatch_snf_pct: 8.50,
      destination: 'Namakkal Dairy',
      trip_status: 'on_the_way',
      compartments: [
        {
          compartment_no: 1,
          cell_key: 'FC',
          compartment_name: 'Front Compartment (Comp 1)',
          quantity_litres: 5500,
          capacity_litres: 6000,
          fat_pct: 4.30,
          snf_pct: 8.50,
          seal_number: 'SL-TOP-1',
          milk_type: 'Raw Cow Milk',
          bmc_id: 'bmc-unit-01',
          bmc_name: 'Rasipuram BMC [RNK-001]',
          dc_number: 'DC-BMC1-8891',
        },
        {
          compartment_no: 2,
          cell_key: 'BC',
          compartment_name: 'Rear Compartment (Comp 2)',
          quantity_litres: 0,
          capacity_litres: 6000,
          fat_pct: 0,
          snf_pct: 0,
        },
      ],
      stage_data: {
        bmc_dispatches: [
          {
            bmc_id: 'bmc-unit-01',
            unit_name: 'Rasipuram BMC [RNK-001]',
            dc_number: 'DC-BMC1-8891',
            quantity_dispatched: 5500,
            dispatch_time: '07:30 AM',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    // 3B. Verify BMC 2 sees the partially loaded tanker with available space!
    const enrichedAfterBmc1 = await enrichRegisteredTankersWithCapacity('zone-test-01', [registered]);
    const tankerStateBmc2 = enrichedAfterBmc1.find((t) => t.vehicle_number === testVehNum);

    assert.ok(tankerStateBmc2, 'Tanker must appear in registered list');
    assert.equal(tankerStateBmc2.filled_capacity, 5500, 'Must record 5500L filled from BMC 1');
    assert.equal(tankerStateBmc2.available_capacity, 6500, 'Must show remaining 6500L space');
    assert.equal(tankerStateBmc2.is_available_for_dispatch, true, 'Partially filled tanker must be selectable for BMC 2');

    // Check individual cell states
    const cellFC = tankerStateBmc2.cells.find((c) => c.cell_key === 'FC');
    const cellBC = tankerStateBmc2.cells.find((c) => c.cell_key === 'BC');
    assert.equal(cellFC.filled_litres, 5500);
    assert.equal(cellFC.loaded_by_bmc_name, 'Rasipuram BMC [RNK-001]');
    assert.equal(cellFC.dc_number, 'DC-BMC1-8891');
    assert.equal(cellBC.filled_litres, 0);
    assert.equal(cellBC.available_litres, 6000);

    // 3C. BMC 2 Milk Dispatch: Fills BC with 6,000 L with own DC number DC-BMC2-4412
    const bmc2DispatchLitres = 6000;
    const existingMeta = getTankerDispatchMetadata(testTripId);
    const updatedCompartments = [
      existingMeta.compartments[0], // FC remains BMC 1
      {
        compartment_no: 2,
        cell_key: 'BC',
        compartment_name: 'Rear Compartment (Comp 2)',
        quantity_litres: bmc2DispatchLitres,
        capacity_litres: 6000,
        fat_pct: 4.20,
        snf_pct: 8.40,
        seal_number: 'SL-TOP-2',
        milk_type: 'Raw Cow Milk',
        bmc_id: 'bmc-unit-02',
        bmc_name: 'Kalipatti BMC [BMC-002]',
        dc_number: 'DC-BMC2-4412',
      },
    ];

    const mergedQty = 5500 + 6000; // 11,500 L
    const weightedFat = calculateWeightedQuality(updatedCompartments.map((c) => ({ quantity: c.quantity_litres, value: c.fat_pct })));
    const weightedSnf = calculateWeightedQuality(updatedCompartments.map((c) => ({ quantity: c.quantity_litres, value: c.snf_pct })));

    saveTankerDispatchMetadata({
      ...existingMeta,
      quantity_dispatched: mergedQty,
      dispatch_fat_pct: weightedFat,
      dispatch_snf_pct: weightedSnf,
      dc_number: 'DC-BMC1-8891, DC-BMC2-4412',
      compartments: updatedCompartments,
      stage_data: {
        ...existingMeta.stage_data,
        bmc_dispatches: [
          ...existingMeta.stage_data.bmc_dispatches,
          {
            bmc_id: 'bmc-unit-02',
            unit_name: 'Kalipatti BMC [BMC-002]',
            dc_number: 'DC-BMC2-4412',
            quantity_dispatched: 6000,
            dispatch_time: '08:45 AM',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    const metaAfterBmc2 = getTankerDispatchMetadata(testTripId);
    assert.equal(metaAfterBmc2.quantity_dispatched, 11500);
    assert.equal(metaAfterBmc2.dc_number, 'DC-BMC1-8891, DC-BMC2-4412');
    assert.equal(metaAfterBmc2.compartments.length, 2);
    assert.equal(metaAfterBmc2.stage_data.bmc_dispatches.length, 2);
  });

  // =========================================================================
  // GROUP 3B: Exact User Scenario - 6,500 L Tanker, BMC 1 fills 3,000 L, BMC 2 visibility check
  // =========================================================================
  await t.test('3B. Exact User Scenario: 6,500 L tanker, BMC 1 fills 3,000 L, BMC 2 sees 3,500 L available capacity', async () => {
    const userTankerNum = `TN30USER${Math.floor(Math.random() * 8999 + 1000)}`;
    const userTripId = `trip-user-${Date.now()}`;

    // 1. User registers tanker with 6,500 L capacity (1 cell)
    const userTanker = await saveRegisteredTankerInDb({
      vehicle_number: userTankerNum,
      contractor_name: 'Salem Express Logistics',
      from_date: '2026-11-21',
      vehicle_type: 'Registered',
      number_of_cells: 1,
      front_cell_capacity: 6500,
      middle_cell_capacity: 0,
      back_cell_capacity: 0,
      supplier_name: 'Namakkal Dairy',
    });

    // Verify it is in registered tankers list
    const registeredList = await getRegisteredTankersInDb();
    const foundInList = registeredList.find((t) => t.vehicle_number === userTankerNum);
    assert.ok(foundInList, 'Registered tanker must be returned in getRegisteredTankersInDb()');

    // 2. BMC 1 logs in and fills 3,000 L
    saveTankerDispatchMetadata({
      id: userTripId,
      tanker_number: userTankerNum,
      unit_id: 'bmc-unit-01',
      zone_id: 'zone-test-01',
      date: '2026-11-21',
      trip_status: 'on_the_way',
      driver_name: 'K. Rajendran',
      driver_phone: '9842199887',
      dc_number: 'DC-BMC1-001',
      seal_number: 'SL-OUT-001',
      dispatch_time: '10:00 AM',
      quantity_dispatched: 3000,
      dispatch_fat_pct: 4.30,
      dispatch_snf_pct: 8.50,
      destination: 'Namakkal Dairy',
      compartments: [
        {
          compartment_no: 1,
          cell_key: 'FC',
          compartment_name: 'Front Compartment (Comp 1)',
          quantity_litres: 3000,
          capacity_litres: 6500,
          fat_pct: 4.30,
          snf_pct: 8.50,
          seal_number: 'SL-CMP-001',
          milk_type: 'Raw Cow Milk',
          bmc_id: 'bmc-unit-01',
          bmc_name: 'Rasipuram BMC [RNK-001]',
          dc_number: 'DC-BMC1-001',
        },
      ],
      stage_data: {
        bmc_dispatches: [
          {
            unit_id: 'bmc-unit-01',
            unit_name: 'Rasipuram BMC [RNK-001]',
            dc_number: 'DC-BMC1-001',
            quantity_dispatched: 3000,
            dispatch_time: '10:00 AM',
            created_at: new Date().toISOString(),
          },
        ],
      },
    });

    // 3. BMC 2 logs in (could be zone-test-01 or another zone) and fetches registered tankers!
    const allRegistered = await getRegisteredTankersInDb();
    const enrichedForBmc2 = await enrichRegisteredTankersWithCapacity('zone-test-01', allRegistered);
    const tankerAtBmc2 = enrichedForBmc2.find((t) => t.vehicle_number === userTankerNum);

    // Assertions matching user's exact requirements:
    assert.ok(tankerAtBmc2, 'Tanker MUST be visible to BMC 2');
    assert.equal(tankerAtBmc2.total_capacity, 6500, 'Total capacity must be 6500 L');
    assert.equal(tankerAtBmc2.filled_capacity, 3000, 'Filled capacity must be 3000 L from BMC 1');
    assert.equal(tankerAtBmc2.available_capacity, 3500, 'Available capacity must be 3500 L');
    assert.equal(tankerAtBmc2.is_full, false, 'Tanker must NOT be marked full');
    assert.equal(tankerAtBmc2.is_at_plant, false, 'Tanker must NOT be marked at plant');
    assert.equal(tankerAtBmc2.is_available_for_dispatch, true, 'Tanker MUST be available for BMC 2 dispatch selection');

    // 4. Check cells breakdown for BMC 2
    assert.equal(tankerAtBmc2.cells.length, 1);
    const fc = tankerAtBmc2.cells[0];
    assert.equal(fc.cell_key, 'FC');
    assert.equal(fc.capacity, 6500);
    assert.equal(fc.filled_litres, 3000);
    assert.equal(fc.available_litres, 3500);
    assert.equal(fc.is_cell_full, false);
    assert.equal(fc.loaded_by_bmc_name, 'Rasipuram BMC [RNK-001]');
    assert.equal(fc.dc_number, 'DC-BMC1-001');
  });

  // =========================================================================
  // GROUP 4: Full Capacity Lockout Check
  // =========================================================================
  await t.test('4. Full Capacity Lockout: Tanker at full capacity is blocked from selection', async () => {
    const reg = await findRegisteredTankerInDb(testVehNum);
    // Let's test what happens when available capacity reaches 0 (total capacity is 12,000, filled is 11,500 + 500 = 12,000)
    const existing = getTankerDispatchMetadata(testTripId);
    saveTankerDispatchMetadata({
      ...existing,
      quantity_dispatched: 12000,
      compartments: [
        { ...existing.compartments[0], quantity_litres: 6000 },
        { ...existing.compartments[1], quantity_litres: 6000 },
      ],
    });

    const enriched = await enrichRegisteredTankersWithCapacity('zone-test-01', [reg]);
    const tFull = enriched.find((t) => t.vehicle_number === testVehNum);

    assert.ok(tFull);
    assert.equal(tFull.filled_capacity, 12000);
    assert.equal(tFull.available_capacity, 0);
    assert.equal(tFull.is_full, true, 'Tanker must be marked full');
    assert.equal(tFull.is_available_for_dispatch, false, 'Full tanker must NOT be available for dispatch');
  });

  // =========================================================================
  // GROUP 5: Dairy Processing Plant - Gate Vehicle Entry & Plant Lockout
  // =========================================================================
  await t.test('5. Gate Vehicle Entry & Plant Lockout ("What happens when tanker arrives at plant?")', async () => {
    // 5A. Gate records vehicle entry
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'vehicle_entered',
      team: 'gate',
      status: 'done',
      stage_data: {
        vehicle_number: testVehNum,
        driver_name: 'S. Ramanathan',
        dc_number: 'DC-BMC1-8891, DC-BMC2-4412',
        outlet_seal_no: 'SL-OUT-101',
        entry_time: '09:30 AM',
        dispatch_time: '07:30 AM',
        receiving_dairy: 'Namakkal Dairy',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      stages,
    });

    assert.equal(journey.tripStatus, 'vehicle_entered');
    assert.equal(journey.currentStageKey, 'gross_weight');
    assert.equal(journey.waitingTeam, 'gate', 'Waiting for Gross Weighbridge');

    // 5B. Plant Lockout: Even if tanker capacity had space, inside plant means NOT available for BMC!
    const reg = await findRegisteredTankerInDb(testVehNum);
    const enriched = await enrichRegisteredTankersWithCapacity('zone-test-01', [reg]);
    const tInPlant = enriched.find((t) => t.vehicle_number === testVehNum);

    assert.equal(tInPlant.is_at_plant, true, 'Tanker is inside plant');
    assert.equal(tInPlant.is_available_for_dispatch, false, 'Inside plant tanker must NEVER be available for BMC dispatch');
  });

  // =========================================================================
  // GROUP 6: Weighbridge Gross Weight
  // =========================================================================
  await t.test('6. Gross Weight Details: Weighbridge gross measurement', async () => {
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'gross_weight',
      team: 'gate',
      status: 'done',
      stage_data: {
        gross_weight_kg: 25400,
        ticket_no: 'WBG-2026-8801',
        weight_time: '09:45 AM',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      stages,
    });

    assert.equal(journey.tripStatus, 'gross_done');
    assert.equal(journey.currentStageKey, 'qc_completed');
    assert.equal(journey.waitingTeam, 'qc', 'Waiting for QC Lab chemical tests');
  });

  // =========================================================================
  // GROUP 7: QC Lab Testing - Branching Test (Rejection vs Acceptance)
  // =========================================================================
  await t.test('7A. QC Branch: Rejection stops pipeline and routes to exit', async () => {
    const rejTripId = `trip-rej-${Date.now()}`;
    await recordTankerStageInDb({
      trip_id: rejTripId,
      stage_name: 'vehicle_entered',
      team: 'gate',
      status: 'done',
    });
    await recordTankerStageInDb({
      trip_id: rejTripId,
      stage_name: 'gross_weight',
      team: 'gate',
      status: 'done',
      stage_data: { gross_weight_kg: 25000 },
    });
    // QC Reject
    await recordTankerStageInDb({
      trip_id: rejTripId,
      stage_name: 'qc_completed',
      team: 'qc',
      status: 'rejected',
      stage_data: {
        qc_status: 'rejected',
        rejection_reason: 'High Acidity (0.21%) and Urea Adulteration Detected',
      },
    });

    const stages = await getTankerStagesForTrips([rejTripId]).then((m) => m[rejTripId] || []);
    const journey = deriveTankerJourneyState({
      id: rejTripId,
      date: '2026-11-21',
      tanker_number: 'TN28REJECT',
      quantity_dispatched: 10000,
      stages,
    });

    assert.equal(journey.tripStatus, 'qc_rejected');
    assert.equal(journey.isQcRejected, true);
    assert.equal(journey.qcRejectionReason, 'High Acidity (0.21%) and Urea Adulteration Detected');
    assert.equal(journey.waitingTeam, 'gate', 'Rejected tanker moves directly to Gate Exit');
  });

  await t.test('7B. QC Branch: Acceptance passes milk to Unloading Bay', async () => {
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'qc_completed',
      team: 'qc',
      status: 'done',
      stage_data: {
        qc_status: 'accepted',
        fat_pct: 4.25,
        snf_pct: 8.45,
        chemist_name: 'M. Sangeetha',
        test_time: '10:15 AM',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      stages,
    });

    assert.equal(journey.tripStatus, 'qc_done');
    assert.equal(journey.isQcRejected, false);
    assert.equal(journey.currentStageKey, 'unloaded');
    assert.equal(journey.waitingTeam, 'unloading', 'Waiting for Unloading Bay Silo Reception');
  });

  // =========================================================================
  // GROUP 8: Unloading Bay & Silo Reception
  // =========================================================================
  await t.test('8. Unloading Bay Reception: Silo selection and volume receipt', async () => {
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'unloaded',
      team: 'unloading',
      status: 'done',
      stage_data: {
        unloaded_litres: 11950,
        unloading_bay: 'Bay 2',
        silo_number: 'Silo 3',
        operator_name: 'P. Balan',
        start_time: '10:30 AM',
        finish_time: '11:15 AM',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      unloaded_litres: 11950,
      stages,
    });

    assert.equal(journey.tripStatus, 'unloaded');
    assert.equal(journey.currentStageKey, 'tare_weight');
    assert.equal(journey.waitingTeam, 'gate', 'Waiting for Weighbridge Tare Weight');
  });

  // =========================================================================
  // GROUP 9: Tare Weight & Transit Loss Evaluation
  // =========================================================================
  await t.test('9. Tare Weight & Transit Loss Calculation', async () => {
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'tare_weight',
      team: 'gate',
      status: 'done',
      stage_data: {
        tare_weight_kg: 13080,
        ticket_no: 'WBT-2026-9902',
        weight_time: '11:30 AM',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      tare_weight_kg: 13080,
      unloaded_litres: 11950,
      stages,
    });

    assert.equal(journey.tripStatus, 'tare_done');
    assert.equal(journey.currentStageKey, 'cip_completed');
    assert.equal(journey.waitingTeam, 'qc', 'Waiting for CIP wash inspection');

    // Verify mathematical metrics
    // Net kg = 25400 - 13080 = 12320 kg
    // Net litres = 12320 / 1.030 = 11961.17 L
    // Silo Received = 11950 L
    // Transit loss (Dispatched - Received) = 12000 - 11950 = 50.00 L (0.42%)
    assert.equal(journey.calculated.net_weight_kg, 12320);
    assert.equal(journey.calculated.net_litres, 11961.17);
    assert.equal(journey.calculated.received_litres, 11950);
    assert.equal(journey.calculated.transit_loss_litres, 50.0);
    assert.ok(Math.abs(journey.calculated.transit_loss_pct - 0.42) < 0.05);
  });

  // =========================================================================
  // GROUP 10: CIP Washing & Unsatisfied Re-cleaning Loop
  // =========================================================================
  await t.test('10A. CIP Unsatisfied Loop ("What happens if CIP fails inspection?")', async () => {
    // Inspector enters UNSATISFIED
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'cip_completed',
      team: 'qc',
      status: 'rejected',
      stage_data: {
        cip_status: 'unsatisfied',
        cleaning_type: 'Caustic wash incomplete',
        operator_name: 'K. Vignesh',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      tare_weight_kg: 13080,
      cip_status: 'unsatisfied',
      stages,
    });

    // Vehicle exit MUST NOT be allowed!
    assert.ok(journey.currentStageKey !== 'vehicle_exit', 'Vehicle exit must be blocked on unsatisfied CIP');
    assert.equal(journey.isCipUnsatisfied, true);
    assert.equal(journey.tripStatus, 'cip_unsatisfied');
  });

  await t.test('10B. CIP Re-wash Passed & Vehicle Exit Unlocked', async () => {
    // Re-cleaning completed & inspector marks satisfied
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'cip_completed',
      team: 'qc',
      status: 'done',
      stage_data: {
        cip_status: 'pass',
        cleaning_type: 'Four Step Clean (Rinse, Caustic, Acid, Hot Sanitizer)',
        operator_name: 'K. Vignesh',
        inspection_result: 'SATISFIED',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      tare_weight_kg: 13080,
      cip_status: 'pass',
      stages,
    });

    assert.equal(journey.tripStatus, 'cip_done');
    assert.equal(journey.currentStageKey, 'vehicle_exit');
    assert.equal(journey.waitingTeam, 'gate', 'Waiting for Gate Pass & Vehicle Exit');
  });

  // =========================================================================
  // GROUP 11: Vehicle Exit & Full Lifecycle Reset
  // =========================================================================
  await t.test('11. Vehicle Exit: Journey completes and tanker unlocks for new BMC trips', async () => {
    await recordTankerStageInDb({
      trip_id: testTripId,
      stage_name: 'vehicle_exit',
      team: 'gate',
      status: 'done',
      stage_data: {
        exit_gate_pass_no: 'GP-NAM-2026-441',
        exit_time: '12:15 PM',
        gate_officer: 'V. Sundaram',
      },
    });

    const stages = await getTankerStagesForTrips([testTripId]).then((m) => m[testTripId] || []);
    const journey = deriveTankerJourneyState({
      id: testTripId,
      date: '2026-11-21',
      tanker_number: testVehNum,
      quantity_dispatched: 12000,
      gross_weight_kg: 25400,
      tare_weight_kg: 13080,
      cip_status: 'pass',
      exit_gate_pass_no: 'GP-NAM-2026-441',
      stages,
    });

    assert.equal(journey.tripStatus, 'exited');
    assert.equal(journey.completedStepsCount, 7, 'All 7 stages complete');

    // Update dispatch metadata with exit status
    const existing = getTankerDispatchMetadata(testTripId);
    saveTankerDispatchMetadata({
      ...existing,
      trip_status: 'exited',
      stage_data: {
        ...existing.stage_data,
        vehicle_exit: { gate_pass_number: 'GP-NAM-2026-441' },
      },
    });

    // VERIFY RE-ACTIVATION FOR BMC:
    // Once vehicle exits, it must reset to 0 filled, 100% available, and is_available_for_dispatch: true!
    const reg = await findRegisteredTankerInDb(testVehNum);
    const enriched = await enrichRegisteredTankersWithCapacity('zone-test-01', [reg]);
    const tExited = enriched.find((t) => t.vehicle_number === testVehNum);

    assert.ok(tExited);
    assert.equal(tExited.is_at_plant, false, 'Tanker has departed the plant');
    assert.equal(tExited.filled_capacity, 0, 'Filled capacity resets to 0 upon exit');
    assert.equal(tExited.available_capacity, 12000, 'Full capacity available again');
    assert.equal(tExited.is_available_for_dispatch, true, 'Tanker is instantly available for next BMC milk dispatch');
  });

  // =========================================================================
  // GROUP 12: Database Resilience & Schema Fault-Tolerance
  // =========================================================================
  await t.test('12. Database Schema Resilience: Missing stage_data column gracefully handled', async () => {
    // Test that runResilientTankerQuery handles missing columns without throwing unhandled exceptions
    const fakeMissingColQuery = (selectStr) => {
      // If selectStr contains stage_data, simulate PostgreSQL error PGRST204
      if (selectStr.includes('stage_data') || selectStr.includes('*')) {
        return Promise.resolve({
          data: null,
          error: { message: 'column tanker_dispatches.stage_data does not exist', code: '42703' },
        });
      }
      // BARE_TANKER_SELECT succeeds!
      return Promise.resolve({
        data: [{ id: '1', tanker_number: 'TN28AB1001', quantity_dispatched: 5000 }],
        error: null,
      });
    };

    const res = await runResilientTankerQuery(fakeMissingColQuery);
    assert.ok(!res.error, 'Resilient query must catch missing column error and succeed on bare tier');
    assert.ok(Array.isArray(res.data));
    assert.equal(res.data[0].tanker_number, 'TN28AB1001');

    // Test computeAvailableStock resilience
    const stock = await computeAvailableStock('zone-test-01', null);
    assert.ok(typeof stock.available_stock_qty === 'number');
    assert.ok(typeof stock.collected_net_qty === 'number');
    assert.ok(typeof stock.dispatched_qty === 'number');
    assert.ok(stock.available_stock_qty >= 0);
  });
});
