import { Router } from 'express';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';
import { requireRole } from '../middleware/requireRole';
import { authMiddleware } from '../middleware/auth';
import {
  getZoneSettings,
  isMissingSchemaError,
  listAuditLogs,
  recordTankerStageInDb,
  getTankerStagesForTrip,
  getTankerStagesForTrips,
  writeAuditLog,
  saveTankerDispatchMetadata,
  getTankerDispatchMetadata,
  getRegisteredTankersInDb,
  saveRegisteredTankerInDb,
  findRegisteredTankerInDb,
  readFallback,
} from '../lib/settingsStore';
import {
  deriveTankerJourneyState,
  calculateTankerMetrics,
  TANKER_STAGES,
  STAGE_COLORS,
} from '../lib/tankerJourney';
import type {
  TankerStageKey,
  PlantTeam,
  TripStatus,
  TankerTripInput,
  StageRecordItem,
} from '../lib/tankerJourney';
import { formatDateDDMMYYYY } from '../lib/calculations';

const router = Router();
router.use(authMiddleware);

const DYNAMIC_JOIN_TANKER_SELECT = `*, bmcs(name, bmc_code)`;

const DYNAMIC_BARE_TANKER_SELECT = `*`;

const FULL_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, driver_name, driver_phone, dc_number, seal_number, dispatch_time, dispatch_ampm,
  quantity_dispatched, destination, dispatch_fat_pct, dispatch_snf_pct, compartments,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, current_stage, waiting_team, stage_data,
  bmcs(name, bmc_code)
`;

const EXTENDED_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, driver_name, seal_number, dc_number, dispatch_time,
  quantity_dispatched, destination, dispatch_fat_pct, dispatch_snf_pct,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, stage_data,
  bmcs(name, bmc_code)
`;

const OPERATIONAL_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, driver_name, seal_number, dc_number, dispatch_time,
  quantity_dispatched, destination,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, stage_data,
  bmcs(name, bmc_code)
`;

const V2_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, driver_name, seal_number, dc_number,
  quantity_dispatched, destination, stage_data, created_at,
  bmcs(name, bmc_code)
`;

const MINIMAL_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, quantity_dispatched, destination, stage_data, created_at,
  bmcs(name, bmc_code)
`;

const BARE_TANKER_SELECT = `
  id, bmc_id, zone_id, date, tanker_number, quantity_dispatched, destination, created_at
`;

export async function runResilientTankerQuery(
  buildQuery: (selectStr: string) => any,
): Promise<{ data: any[]; error: any }> {
  const tiers = [
    DYNAMIC_JOIN_TANKER_SELECT,
    DYNAMIC_BARE_TANKER_SELECT,
    FULL_TANKER_SELECT,
    EXTENDED_TANKER_SELECT,
    OPERATIONAL_TANKER_SELECT,
    V2_TANKER_SELECT,
    MINIMAL_TANKER_SELECT,
    BARE_TANKER_SELECT,
  ];

  let lastError: any = null;
  for (const selectStr of tiers) {
    try {
      const q = buildQuery(selectStr);
      const res = await q;
      if (!res.error) {
        return { data: res.data ?? [], error: null };
      }
      lastError = res.error;
      const msg = String(res.error.message || '').toLowerCase();
      const code = String(res.error.code || '').toUpperCase();
      if (
        isMissingSchemaError(res.error) ||
        msg.includes('column') ||
        msg.includes('relation') ||
        msg.includes('does not exist') ||
        code.startsWith('PGRST')
      ) {
        continue;
      }
      break;
    } catch (err: any) {
      lastError = err;
    }
  }
  return { data: [], error: lastError };
}

export interface EnrichedTankerRow {
  [key: string]: any;
  stages: any[];
  journey: any;
  transit_loss_qty: number | null;
  transit_loss_pct: number | null;
  fat_diff: number | null;
  snf_diff: number | null;
  receipt_status: string;
  trip_status: TripStatus;
  stage_color: any;
  waiting_team: any;
  waiting_since_minutes: number;
  is_over_limit: boolean;
  auto_flags: any[];
  calculated: any;
}

export function enrichTankerRow(row: Record<string, unknown>, stages?: StageRecordItem[], settings?: any): EnrichedTankerRow {
  // 1. Safely parse stage_data if returned as JSON string
  let rowStageData: Record<string, any> = {};
  if (typeof row.stage_data === 'string') {
    try {
      rowStageData = JSON.parse(row.stage_data);
    } catch {
      rowStageData = {};
    }
  } else if (row.stage_data && typeof row.stage_data === 'object') {
    rowStageData = row.stage_data as Record<string, any>;
  }

  // 2. Safely parse compartments if returned as JSON string
  let rowCompartments: any[] = [];
  if (typeof row.compartments === 'string') {
    try {
      const parsed = JSON.parse(row.compartments);
      if (Array.isArray(parsed)) rowCompartments = parsed;
    } catch {
      rowCompartments = [];
    }
  } else if (Array.isArray(row.compartments)) {
    rowCompartments = row.compartments;
  }

  // 3. Fallback metadata store lookup (by ID and Tanker Number)
  const tripId = String(row.id || '');
  const tankerNum = String(row.tanker_number || '').toUpperCase().trim();
  const fbMeta = getTankerDispatchMetadata(tripId) || (tankerNum ? getTankerDispatchMetadata(tankerNum) : null);

  const stageDispatched = stages?.find((s) => (s.stage_name as string) === 'dispatched' || (s.stage_name as string) === 'tanker_dispatched')?.stage_data as any;
  const stageVehicleEntered = stages?.find((s) => s.stage_name === 'vehicle_entered')?.stage_data as any;

  const dcNumber =
    (row.dc_number as string) ||
    rowStageData?.dc_number ||
    rowStageData?.dc_no ||
    rowStageData?.vehicle_entered?.dc_number ||
    fbMeta?.dc_number ||
    stageVehicleEntered?.dc_number ||
    stageDispatched?.dc_number ||
    null;

  let compartments =
    rowCompartments.length > 0
      ? rowCompartments
      : Array.isArray(rowStageData?.compartments) && rowStageData.compartments.length > 0
      ? rowStageData.compartments
      : Array.isArray(rowStageData?.vehicle_entered?.compartments) && rowStageData.vehicle_entered.compartments.length > 0
      ? rowStageData.vehicle_entered.compartments
      : Array.isArray(fbMeta?.compartments) && fbMeta.compartments.length > 0
      ? fbMeta.compartments
      : Array.isArray(stageVehicleEntered?.compartments) && stageVehicleEntered.compartments.length > 0
      ? stageVehicleEntered.compartments
      : Array.isArray(stageDispatched?.compartments) && stageDispatched.compartments.length > 0
      ? stageDispatched.compartments
      : [];

  const driverName =
    (row.driver_name as string) ||
    rowStageData?.driver_name ||
    rowStageData?.vehicle_entered?.driver_name ||
    fbMeta?.driver_name ||
    stageVehicleEntered?.driver_name ||
    stageDispatched?.driver_name ||
    null;

  const driverPhone =
    (row.driver_phone as string) ||
    rowStageData?.driver_phone ||
    rowStageData?.vehicle_entered?.driver_phone ||
    fbMeta?.driver_phone ||
    stageVehicleEntered?.driver_phone ||
    stageDispatched?.driver_phone ||
    null;

  const sealNumber =
    (row.seal_number as string) ||
    rowStageData?.seal_number ||
    rowStageData?.outlet_seal_no ||
    rowStageData?.vehicle_entered?.seal_number ||
    fbMeta?.seal_number ||
    stageVehicleEntered?.seal_number ||
    stageDispatched?.seal_number ||
    null;

  const dispatchTime =
    (row.dispatch_time as string) ||
    rowStageData?.dispatch_time ||
    fbMeta?.dispatch_time ||
    stageVehicleEntered?.dispatch_time ||
    stageDispatched?.dispatch_time ||
    null;

  const dispatchAmPm =
    (row.dispatch_ampm as string) ||
    rowStageData?.dispatch_ampm ||
    fbMeta?.dispatch_ampm ||
    stageVehicleEntered?.dispatch_ampm ||
    null;

  const destination =
    (row.destination as string) ||
    rowStageData?.destination ||
    fbMeta?.destination ||
    'Namakkal Dairy';

  const dispatchFat =
    row.dispatch_fat_pct != null
      ? Number(row.dispatch_fat_pct)
      : rowStageData?.dispatch_fat_pct != null
      ? Number(rowStageData.dispatch_fat_pct)
      : fbMeta?.dispatch_fat_pct != null
      ? Number(fbMeta.dispatch_fat_pct)
      : null;

  const dispatchSnf =
    row.dispatch_snf_pct != null
      ? Number(row.dispatch_snf_pct)
      : rowStageData?.dispatch_snf_pct != null
      ? Number(rowStageData.dispatch_snf_pct)
      : fbMeta?.dispatch_snf_pct != null
      ? Number(fbMeta.dispatch_snf_pct)
      : null;

  const grossWeightKg =
    row.gross_weight_kg != null
      ? Number(row.gross_weight_kg)
      : fbMeta?.gross_weight_kg != null
      ? Number(fbMeta.gross_weight_kg)
      : null;

  const tareWeightKg =
    row.tare_weight_kg != null
      ? Number(row.tare_weight_kg)
      : fbMeta?.tare_weight_kg != null
      ? Number(fbMeta.tare_weight_kg)
      : null;

  const netWeightKg =
    row.net_weight_kg != null
      ? Number(row.net_weight_kg)
      : fbMeta?.net_weight_kg != null
      ? Number(fbMeta.net_weight_kg)
      : null;

  const receivedQty =
    row.received_qty != null
      ? Number(row.received_qty)
      : fbMeta?.received_qty != null
      ? Number(fbMeta.received_qty)
      : null;

  const stagesMap: Record<string, any> = {};
  if (Array.isArray(stages)) {
    for (const s of stages) {
      if (s.stage_name && s.stage_data && typeof s.stage_data === 'object') {
        stagesMap[s.stage_name] = s.stage_data;
      }
    }
  }

  const tripInput: TankerTripInput = {
    id: String(row.id),
    date: String(row.date),
    tanker_number: String(row.tanker_number ?? ''),
    driver_name: driverName,
    seal_number: sealNumber,
    dispatch_time: dispatchTime,
    quantity_dispatched: Number(row.quantity_dispatched ?? 0),
    destination,
    dispatch_fat_pct: dispatchFat,
    dispatch_snf_pct: dispatchSnf,
    received_qty: receivedQty,
    receipt_time: (row.receipt_time as string) || null,
    received_fat_pct: row.received_fat_pct != null ? Number(row.received_fat_pct) : null,
    received_snf_pct: row.received_snf_pct != null ? Number(row.received_snf_pct) : null,
    gross_weight_kg: grossWeightKg,
    tare_weight_kg: tareWeightKg,
    net_weight_kg: netWeightKg,
    qc_status: (row.qc_status as string) || fbMeta?.qc_status || null,
    trip_status: (row.trip_status as TripStatus) || (fbMeta?.trip_status as TripStatus) || undefined,
    stage_data: {
      ...rowStageData,
      ...(fbMeta?.stage_data || {}),
      ...stagesMap,
      ...(driverName ? { driver_name: driverName } : {}),
      ...(sealNumber ? { seal_number: sealNumber } : {}),
      ...(dcNumber ? { dc_number: dcNumber } : {}),
      ...(dispatchTime ? { dispatch_time: dispatchTime } : {}),
      ...(compartments.length > 0 ? { compartments } : {}),
    },
    stages: stages || [],
    created_at: (row.created_at as string) || undefined,
    dc_number: dcNumber,
    compartments,
  };

  const journey = deriveTankerJourneyState(tripInput, settings);

  const dispatched = Number(row.quantity_dispatched ?? 0);
  const received = journey.calculated.received_litres;
  const transitLoss = journey.calculated.transit_loss_litres;
  const transitLossPct = journey.calculated.transit_loss_pct;
  const receivedFat = journey.calculated.received_litres != null && row.received_fat_pct != null
    ? Number(row.received_fat_pct)
    : null;
  const receivedSnf = journey.calculated.received_litres != null && row.received_snf_pct != null
    ? Number(row.received_snf_pct)
    : null;

  return {
    ...row,
    driver_name: driverName,
    driver_phone: driverPhone,
    seal_number: sealNumber,
    dispatch_time: dispatchTime,
    dispatch_ampm: dispatchAmPm,
    destination,
    dispatch_fat_pct: dispatchFat,
    dispatch_snf_pct: dispatchSnf,
    dc_number: dcNumber,
    compartments,
    gross_weight_kg: grossWeightKg,
    tare_weight_kg: tareWeightKg,
    net_weight_kg: netWeightKg,
    received_qty: receivedQty,
    stage_data: tripInput.stage_data,
    stages: journey.timelineSteps,
    journey,
    transit_loss_qty: transitLoss,
    transit_loss_pct: transitLossPct,
    fat_diff: dispatchFat != null && receivedFat != null ? +(receivedFat - dispatchFat).toFixed(2) : null,
    snf_diff: dispatchSnf != null && receivedSnf != null ? +(receivedSnf - dispatchSnf).toFixed(2) : null,
    receipt_status: journey.tripStatus === 'exited' ? 'received' : 'dispatched',
    trip_status: journey.tripStatus,
    stage_color: journey.stageColor,
    waiting_team: journey.waitingTeam,
    waiting_since_minutes: journey.waitingSinceMinutes,
    is_over_limit: journey.isOverLimit,
    auto_flags: journey.autoFlags,
    calculated: journey.calculated,
  };
}

export async function computeAvailableStock(zoneId: string, unitId?: string | null) {
  let totalCollectedNet = 0;
  try {
    let milkQ = supabase.from('milk_entries').select('quantity_litres, rejection_qty').eq('zone_id', zoneId);
    if (unitId) {
      milkQ = milkQ.eq('bmc_id', unitId);
    }
    const mRes = await milkQ;
    if (!mRes.error && mRes.data) {
      totalCollectedNet = mRes.data.reduce(
        (sum, r) => sum + Math.max(0, Number(r.quantity_litres ?? 0) - Number(r.rejection_qty ?? 0)),
        0,
      );
    }
  } catch (mErr) {
    console.warn('[tanker/stock] milk_entries query warning:', (mErr as Error).message);
  }

  let tankerRows: any[] = [];
  try {
    const tankerQueryResult = await runResilientTankerQuery((selectStr) => {
      let q = supabase.from('tanker_dispatches').select(selectStr);
      if (zoneId) q = q.eq('zone_id', zoneId);
      return q;
    });
    tankerRows = tankerQueryResult.data ?? [];
  } catch (tErr) {
    console.warn('[tanker/stock] tanker_dispatches query warning:', (tErr as Error).message);
  }

  // Read fallback store for any multi-BMC dispatches or fallback stage_data
  let fallbackMap: Record<string, any> = {};
  try {
    const store = readFallback();
    if (store.tankerDispatches) {
      fallbackMap = store.tankerDispatches as Record<string, any>;
    }
  } catch {
    // non-fatal
  }

  let totalDispatched = 0;
  for (const r of tankerRows) {
    const id = String((r as any).id);
    const fb = fallbackMap[id];
    const stageData = (r as any).stage_data || fb?.stage_data;
    const bmcList = stageData?.bmc_dispatches;

    if (!unitId) {
      totalDispatched += Number((r as any).quantity_dispatched ?? 0);
    } else {
      if (Array.isArray(bmcList) && bmcList.length > 0) {
        const myEntries = bmcList.filter((b: any) => b.bmc_id === unitId);
        if (myEntries.length > 0) {
          totalDispatched += myEntries.reduce((s: number, b: any) => s + Number(b.quantity_dispatched || b.quantity || 0), 0);
        } else if ((r as any).bmc_id === unitId) {
          totalDispatched += Number((r as any).quantity_dispatched ?? 0);
        }
      } else if ((r as any).bmc_id === unitId) {
        totalDispatched += Number((r as any).quantity_dispatched ?? 0);
      }
    }
  }

  const availableStock = Math.max(0, +(totalCollectedNet - totalDispatched).toFixed(2));

  return {
    collected_net_qty: +totalCollectedNet.toFixed(2),
    dispatched_qty: +totalDispatched.toFixed(2),
    available_stock_qty: availableStock,
    raw_balance_qty: +(totalCollectedNet - totalDispatched).toFixed(2),
  };
}

// Helper to enrich registered tankers with live cell capacity, filled volume, and multi-BMC dispatch status
export async function enrichRegisteredTankersWithCapacity(zoneId: string, registered: any[]) {
  let tripList: any[] = [];
  try {
    const { data } = await runResilientTankerQuery((selectStr) => {
      return supabase
        .from('tanker_dispatches')
        .select(selectStr)
        .neq('trip_status', 'exited')
        .order('created_at', { ascending: false });
    });
    if (data) tripList = data;
  } catch (err) {
    console.warn('Error fetching active trips for capacity calculation:', err);
  }

  // Also merge and include active trips from fallback store with rich metadata
  try {
    const store = readFallback();
    tripList = tripList.map((t) => {
      const fb = (t.id ? store.tankerDispatches?.[t.id] : null) ||
                 (t.tanker_number ? store.tankerDispatchesByNumber?.[t.tanker_number.trim().toUpperCase()] : null);
      if (fb) {
        return {
          ...fb,
          ...t,
          trip_status: t.trip_status || fb.trip_status || 'on_the_way',
          compartments: t.compartments || fb.compartments || t.stage_data?.compartments || fb.stage_data?.compartments,
          stage_data: { ...(fb.stage_data || {}), ...(t.stage_data || {}) },
          dc_number: t.dc_number || fb.dc_number,
          driver_name: t.driver_name || fb.driver_name,
          driver_phone: t.driver_phone || fb.driver_phone,
        };
      }
      return {
        ...t,
        trip_status: t.trip_status || 'on_the_way',
      };
    });

    if (store.tankerDispatches) {
      for (const [id, meta] of Object.entries(store.tankerDispatches as Record<string, any>)) {
        if (!tripList.some((t) => String(t.id) === String(id)) && meta.trip_status !== 'exited') {
          tripList.push({
            ...meta,
            trip_status: meta.trip_status || 'on_the_way',
          });
        }
      }
    }
  } catch {
    // non-fatal
  }

  const plantStatuses = new Set([
    'vehicle_entered', 'gross_done', 'gross_weight', 'qc_done', 'qc_completed',
    'qc_rejected', 'unloaded', 'tare_done', 'tare_weight', 'cip_done',
    'cip_completed', 'cip_unsatisfied',
  ]);

  return (registered || []).filter(Boolean).map((reg) => {
    const normReg = (reg.vehicle_number || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const activeTrip = tripList.find((t) => {
      const normTrip = (t.tanker_number || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const isExited = t.trip_status === 'exited' || t.stage_data?.vehicle_exit != null;
      return normTrip === normReg && !isExited;
    });

    const numCells = Number(reg.number_of_cells) || (reg.back_cell_capacity ? 2 : 1);
    const fcCap = Number(reg.front_cell_capacity) || 5000;
    const mcCap = numCells === 3 ? (Number(reg.middle_cell_capacity) || 4000) : 0;
    const bcCap = numCells >= 2 ? (Number(reg.back_cell_capacity) || 5000) : 0;
    const totalCap = fcCap + mcCap + bcCap;

    const cellDefs = [
      { cell_index: 0, cell_key: 'FC', cell_name: 'Front Compartment (Comp 1)', capacity: fcCap },
      ...(numCells === 3 ? [{ cell_index: 1, cell_key: 'MC', cell_name: 'Middle Compartment (Comp 2)', capacity: mcCap }] : []),
      ...(numCells >= 2 ? [{ cell_index: numCells === 3 ? 2 : 1, cell_key: 'BC', cell_name: numCells === 3 ? 'Rear Compartment (Comp 3)' : 'Rear Compartment (Comp 2)', capacity: bcCap }] : []),
    ];

    const isAtPlant = Boolean(
      activeTrip?.stage_data?.vehicle_entered != null ||
      activeTrip?.stage_data?.gross_weight != null ||
      (activeTrip?.trip_status && plantStatuses.has(activeTrip.trip_status))
    );

    const cells = cellDefs.map((cd, idx) => {
      let filled = 0;
      let bmcName: string | null = null;
      let dcNo: string | null = null;
      let fatPct: number | null = null;
      let snfPct: number | null = null;
      let sealNo: string | null = null;
      let milkType: string = 'Raw Cow Milk';
      let temp: string = '4.0';

      if (activeTrip) {
        const comps = activeTrip.compartments || activeTrip.stage_data?.compartments;
        if (Array.isArray(comps) && comps.length > 0) {
          const matched = comps.find((c: any) => c.cell_key === cd.cell_key || c.compartment_no === idx + 1) || comps[idx];
          if (matched && (matched.quantity_litres != null || matched.quantity != null)) {
            filled = Number(matched.quantity_litres ?? matched.quantity) || 0;
            bmcName = matched.bmc_name || activeTrip.bmcs?.name || 'Prior BMC';
            dcNo = matched.dc_number || activeTrip.dc_number || null;
            fatPct = matched.fat_pct != null ? Number(matched.fat_pct) : null;
            snfPct = matched.snf_pct != null ? Number(matched.snf_pct) : null;
            sealNo = matched.seal_number || null;
            milkType = matched.milk_type || 'Raw Cow Milk';
            temp = matched.temperature != null ? String(matched.temperature) : '4.0';
          }
        } else if (idx === 0 && Number(activeTrip.quantity_dispatched) > 0) {
          filled = Math.min(cd.capacity, Number(activeTrip.quantity_dispatched));
          bmcName = activeTrip.bmcs?.name || 'Prior BMC';
          dcNo = activeTrip.dc_number || null;
          fatPct = activeTrip.dispatch_fat_pct != null ? Number(activeTrip.dispatch_fat_pct) : null;
          snfPct = activeTrip.dispatch_snf_pct != null ? Number(activeTrip.dispatch_snf_pct) : null;
          sealNo = activeTrip.seal_number || null;
        }
      }

      const avail = Math.max(0, cd.capacity - filled);

      return {
        ...cd,
        filled_litres: filled,
        available_litres: avail,
        is_cell_full: avail <= 0,
        loaded_by_bmc_name: bmcName,
        dc_number: dcNo,
        fat_pct: fatPct,
        snf_pct: snfPct,
        seal_number: sealNo,
        milk_type: milkType,
        temperature: temp,
      };
    });

    const sumCellsFilled = cells.reduce((sum, c) => sum + (c.filled_litres || 0), 0);
    const totalFilled = sumCellsFilled > 0 ? sumCellsFilled : (activeTrip ? Math.min(totalCap, Number(activeTrip.quantity_dispatched || 0)) : 0);
    const availTotal = Math.max(0, totalCap - totalFilled);
    const isFull = availTotal <= 0;
    // Tanker is not available for selection if it is full OR if it is already at the plant, until it exits
    const isAvailableForDispatch = !isAtPlant && !isFull;

    return {
      ...reg,
      number_of_cells: numCells,
      front_cell_capacity: fcCap,
      middle_cell_capacity: mcCap,
      back_cell_capacity: bcCap,
      total_capacity: totalCap,
      filled_capacity: totalFilled,
      available_capacity: availTotal,
      is_full: isFull,
      is_at_plant: isAtPlant,
      is_available_for_dispatch: isAvailableForDispatch,
      has_active_trip: Boolean(activeTrip),
      active_trip_id: activeTrip ? String(activeTrip.id) : null,
      active_driver_name: activeTrip?.driver_name || null,
      active_driver_phone: activeTrip?.driver_phone || activeTrip?.stage_data?.driver_phone || null,
      active_dc_number: activeTrip?.dc_number || null,
      cells,
    };
  });
}

// GET /tanker/stock — available milk stock
router.get('/stock', async (req, res) => {
  try {
    const unitId = req.profile.role === 'bmc' ? req.profile.bmc_id : (req.query.bmc_id as string | undefined);
    const stock = await computeAvailableStock(req.profile.zone_id, unitId);
    res.json(stock);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/registered — List all registered tankers with live capacity & availability
router.get('/registered', async (req, res) => {
  try {
    const list = await getRegisteredTankersInDb();
    const zoneId = req.profile?.zone_id || '';
    const enriched = await enrichRegisteredTankersWithCapacity(zoneId, list);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/registered/:vehicleNumber — Get registered tanker by vehicle number
router.get('/registered/:vehicleNumber', async (req, res) => {
  try {
    const found = await findRegisteredTankerInDb(req.params.vehicleNumber);
    if (!found) {
      res.status(404).json({ error: 'Tanker registration not found' });
      return;
    }
    const zoneId = req.profile?.zone_id || '';
    const enriched = await enrichRegisteredTankersWithCapacity(zoneId, [found]);
    res.json(enriched[0] || found);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /tanker/registration — Register or update a tanker
router.post('/registration', async (req, res) => {
  try {
    const {
      vehicle_number,
      contractor_name,
      from_date,
      vehicle_type,
      number_of_cells,
      front_cell_capacity,
      middle_cell_capacity,
      back_cell_capacity,
      supplier_name,
    } = req.body;

    if (!vehicle_number || !contractor_name || !supplier_name) {
      res.status(400).json({ error: 'Vehicle number, contractor name, and supplier name are required' });
      return;
    }

    const saved = await saveRegisteredTankerInDb({
      vehicle_number,
      contractor_name,
      from_date,
      vehicle_type,
      number_of_cells,
      front_cell_capacity,
      middle_cell_capacity,
      back_cell_capacity,
      supplier_name,
    });

    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/stats — Chip counts, waiting-too-long badges, and KPI summary
router.get('/stats', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase
        .from('tanker_dispatches')
        .select(selectStr)
        .eq('zone_id', zoneId);

      if (req.profile.role === 'bmc') {
        query = query.eq('bmc_id', req.profile.bmc_id!);
      } else if (bmc_id) {
        query = query.eq('bmc_id', bmc_id);
      }
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query;
    });

    if (error) {
      console.warn('[tanker/stats] Database query error:', error.message);
      // Return empty stats structure rather than crashing with 500
      res.json({
        chips: {
          on_the_way: { count: 0, delayedCount: 0, label: 'On the way', color: STAGE_COLORS.on_the_way.dot },
          vehicle_entered: { count: 0, delayedCount: 0, label: 'Vehicle Entered', color: STAGE_COLORS.vehicle_entered.dot },
          gross_done: { count: 0, delayedCount: 0, label: 'Gross Done', color: STAGE_COLORS.gross_done.dot },
          qc_done: { count: 0, delayedCount: 0, label: 'QC Done', color: STAGE_COLORS.qc_done.dot },
          unloaded: { count: 0, delayedCount: 0, label: 'Unloaded', color: STAGE_COLORS.unloaded.dot },
          tare_done: { count: 0, delayedCount: 0, label: 'Tare Done', color: STAGE_COLORS.tare_done.dot },
          cip_done: { count: 0, delayedCount: 0, label: 'CIP Done', color: STAGE_COLORS.cip_done.dot },
          exited: { count: 0, delayedCount: 0, label: 'Exited', color: STAGE_COLORS.exited.dot },
          qc_rejected: { count: 0, delayedCount: 0, label: 'QC Rejected', color: STAGE_COLORS.qc_rejected.dot },
        },
        tabs: { waiting: 0, processed: 0, rejected: 0, all: 0 },
        kpis: {
          total_dispatched_count: 0,
          total_dispatched_litres: 0,
          received_at_dairy_count: 0,
          received_at_dairy_label: '0 of 0 tankers',
          in_plant_count: 0,
          waiting_too_long_count: 0,
          qc_rejected_count: 0,
          qc_rejected_litres: 0,
          transit_loss_litres: 0,
          transit_loss_pct: 0,
          transit_loss_tone: 'green',
          avg_turnaround_min: null,
        },
        time_limits: settings.stage_time_limits_min,
      });
      return;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const tripIds = rows.map((r) => String(r.id));
    const stageMap = await getTankerStagesForTrips(tripIds);

    const enriched = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      return enrichTankerRow(r, stages, settings);
    });

    // Stage chip counts
    const chips: Record<string, { count: number; delayedCount: number; label: string; color: string }> = {
      on_the_way: { count: 0, delayedCount: 0, label: 'On the way', color: STAGE_COLORS.on_the_way.dot },
      vehicle_entered: { count: 0, delayedCount: 0, label: 'Vehicle Entered', color: STAGE_COLORS.vehicle_entered.dot },
      gross_done: { count: 0, delayedCount: 0, label: 'Gross Done', color: STAGE_COLORS.gross_done.dot },
      qc_done: { count: 0, delayedCount: 0, label: 'QC Done', color: STAGE_COLORS.qc_done.dot },
      unloaded: { count: 0, delayedCount: 0, label: 'Unloaded', color: STAGE_COLORS.unloaded.dot },
      tare_done: { count: 0, delayedCount: 0, label: 'Tare Done', color: STAGE_COLORS.tare_done.dot },
      cip_done: { count: 0, delayedCount: 0, label: 'CIP Done', color: STAGE_COLORS.cip_done.dot },
      exited: { count: 0, delayedCount: 0, label: 'Exited', color: STAGE_COLORS.exited.dot },
      qc_rejected: { count: 0, delayedCount: 0, label: 'QC Rejected', color: STAGE_COLORS.qc_rejected.dot },
    };

    let waitingCount = 0;
    let processedCount = 0;
    let rejectedCount = 0;
    let inPlantCount = 0;
    let waitingTooLongCount = 0;
    let totalDispatchedLitres = 0;
    let totalReceivedLitres = 0;
    let qcRejectedLitres = 0;
    let turnaroundMinutesSum = 0;
    let turnaroundMinutesCount = 0;

    for (const item of enriched) {
      const status = item.journey.tripStatus;
      if (chips[status]) {
        chips[status].count++;
        if (item.journey.isOverLimit) {
          chips[status].delayedCount++;
        }
      }

      totalDispatchedLitres += Number(item.quantity_dispatched || 0);

      if (status === 'qc_rejected') {
        rejectedCount++;
        qcRejectedLitres += Number(item.quantity_dispatched || 0);
      } else if (status === 'exited') {
        processedCount++;
        if (item.calculated.received_litres != null) {
          totalReceivedLitres += item.calculated.received_litres;
        }
        if (item.calculated.total_turnaround_min != null) {
          turnaroundMinutesSum += item.calculated.total_turnaround_min;
          turnaroundMinutesCount++;
        }
      } else {
        waitingCount++;
      }

      if (status !== 'on_the_way' && status !== 'exited' && status !== 'qc_rejected') {
        inPlantCount++;
      }

      if (item.journey.isOverLimit) {
        waitingTooLongCount++;
      }
    }

    const totalDispatchedCount = enriched.length;
    const receivedAtDairyCount = totalDispatchedCount - chips.on_the_way.count;
    const totalTransitLossLitres = processedCount > 0 ? +(totalDispatchedLitres - totalReceivedLitres).toFixed(2) : 0;
    const totalTransitLossPct = totalDispatchedLitres > 0 ? +((totalTransitLossLitres / totalDispatchedLitres) * 100).toFixed(2) : 0;

    const warnPct = settings.transit_loss_warn_pct ?? 1.0;
    const dangerPct = settings.transit_loss_danger_pct ?? 2.0;
    let transitLossTone: 'green' | 'amber' | 'red' = 'green';
    if (totalTransitLossPct >= dangerPct) transitLossTone = 'red';
    else if (totalTransitLossPct >= warnPct) transitLossTone = 'amber';

    const avgTurnaroundMin = turnaroundMinutesCount > 0 ? Math.round(turnaroundMinutesSum / turnaroundMinutesCount) : null;

    res.json({
      chips,
      tabs: {
        waiting: waitingCount,
        processed: processedCount,
        rejected: rejectedCount,
        all: totalDispatchedCount,
      },
      kpis: {
        total_dispatched_count: totalDispatchedCount,
        total_dispatched_litres: +totalDispatchedLitres.toFixed(2),
        received_at_dairy_count: receivedAtDairyCount,
        received_at_dairy_label: `${receivedAtDairyCount} of ${totalDispatchedCount} tankers`,
        in_plant_count: inPlantCount,
        waiting_too_long_count: waitingTooLongCount,
        qc_rejected_count: rejectedCount,
        qc_rejected_litres: +qcRejectedLitres.toFixed(2),
        transit_loss_litres: totalTransitLossLitres,
        transit_loss_pct: totalTransitLossPct,
        transit_loss_tone: transitLossTone,
        avg_turnaround_min: avgTurnaroundMin,
      },
      time_limits: settings.stage_time_limits_min,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker — List with filters, search, and journey derivation
router.get('/', async (req, res) => {
  try {
    const {
      from,
      to,
      bmc_id,
      stage,
      waiting_team,
      status, // 'waiting' | 'processed' | 'rejected' | 'all'
      delayed_only,
      search,
      sort_by,
      sort_order,
    } = req.query as Record<string, string>;

    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase
        .from('tanker_dispatches')
        .select(selectStr)
        .eq('zone_id', zoneId)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });

      if (req.profile.role === 'bmc') {
        // Query dispatches for this zone; filtered below by primary bmc_id or multi-BMC entry
      } else if (bmc_id) {
        query = query.eq('bmc_id', bmc_id);
      }

      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query;
    });

    if (error) {
      console.warn('[tanker] Database query error:', error.message);
      res.json([]);
      return;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const tripIds = rows.map((r) => String(r.id));
    const stageMap = await getTankerStagesForTrips(tripIds);

    let enriched = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      return enrichTankerRow(r, stages, settings);
    });

    // For BMC unit role, show trips initiated by this unit OR multi-BMC contributions
    if (req.profile.role === 'bmc') {
      const myUnit = req.profile.bmc_id!;
      enriched = enriched.filter((r) => {
        if (r.bmc_id === myUnit) return true;
        const bmcList = r.stage_data?.bmc_dispatches;
        if (Array.isArray(bmcList) && bmcList.some((b: any) => b.bmc_id === myUnit)) {
          return true;
        }
        return false;
      });
    }

    // 1. Stage filter (chip click)
    if (stage) {
      enriched = enriched.filter((r) => r.journey.tripStatus === stage);
    }

    // 2. Waiting team filter
    if (waiting_team) {
      const wt = waiting_team.toLowerCase();
      enriched = enriched.filter((r) => (r.journey.waitingTeam || '').toLowerCase() === wt);
    }

    // 3. Tab Status filter: waiting (default), processed, rejected, all
    if (status === 'waiting') {
      enriched = enriched.filter(
        (r) => r.journey.tripStatus !== 'exited' && r.journey.tripStatus !== 'qc_rejected',
      );
    } else if (status === 'processed') {
      enriched = enriched.filter((r) => r.journey.tripStatus === 'exited');
    } else if (status === 'rejected') {
      enriched = enriched.filter((r) => r.journey.tripStatus === 'qc_rejected');
    }

    // 4. Delayed only
    if (delayed_only === 'true') {
      enriched = enriched.filter((r) => r.journey.isOverLimit);
    }

    // 5. Search
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      enriched = enriched.filter((r) => {
        const tankerNo = String(r.tanker_number || '').toLowerCase();
        const sealNo = String(r.seal_number || '').toLowerCase();
        const driver = String(r.driver_name || '').toLowerCase();
        const dcNo = String(r.dc_number || (r.stage_data as any)?.dc_number || (r.stage_data as any)?.vehicle_entered?.dc_number || '').toLowerCase();
        const gatePass = String((r.stage_data as any)?.gate_pass_number || (r.stage_data as any)?.vehicle_exit?.gate_pass_number || '').toLowerCase();
        const unitName = String((r.bmcs as any)?.name || '').toLowerCase();
        return (
          tankerNo.includes(q) ||
          sealNo.includes(q) ||
          dcNo.includes(q) ||
          driver.includes(q) ||
          gatePass.includes(q) ||
          unitName.includes(q)
        );
      });
    }

    // 6. Sorting
    if (sort_by) {
      const isAsc = sort_order === 'asc';
      enriched.sort((a, b) => {
        let valA: any = a[sort_by];
        let valB: any = b[sort_by];

        if (sort_by === 'waiting_since') {
          valA = a.journey.waitingSinceMinutes;
          valB = b.journey.waitingSinceMinutes;
        } else if (sort_by === 'transit_loss') {
          valA = a.transit_loss_qty ?? -999999;
          valB = b.transit_loss_qty ?? -999999;
        } else if (sort_by === 'dispatched') {
          valA = Number(a.quantity_dispatched || 0);
          valB = Number(b.quantity_dispatched || 0);
        }

        if (valA < valB) return isAsc ? -1 : 1;
        if (valA > valB) return isAsc ? 1 : -1;
        return 0;
      });
    } else if (status === 'waiting') {
      // Default: sorted by longest wait first
      enriched.sort((a, b) => b.journey.waitingSinceMinutes - a.journey.waitingSinceMinutes);
    }

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/:id — Detailed view with full timeline and audit logs
router.get('/:id', async (req, res) => {
  const id = String(req.params.id);
  const zoneId = req.profile.zone_id;

  try {
    let data: any = null;
    let error: any = null;
    const tiers = [
      DYNAMIC_JOIN_TANKER_SELECT,
      DYNAMIC_BARE_TANKER_SELECT,
      FULL_TANKER_SELECT,
      EXTENDED_TANKER_SELECT,
      OPERATIONAL_TANKER_SELECT,
      V2_TANKER_SELECT,
      MINIMAL_TANKER_SELECT,
      BARE_TANKER_SELECT,
    ];

    for (const selectStr of tiers) {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('id', id);
      if (req.profile.role === 'bmc') {
        query = query.eq('bmc_id', req.profile.bmc_id!);
      } else {
        query = query.eq('zone_id', zoneId);
      }
      const singleRes = await query.maybeSingle();
      if (!singleRes.error) {
        data = singleRes.data;
        error = null;
        break;
      }
      error = singleRes.error;
      const msg = String(singleRes.error.message || '').toLowerCase();
      const code = String(singleRes.error.code || '').toUpperCase();
      if (
        isMissingSchemaError(singleRes.error) ||
        msg.includes('column') ||
        msg.includes('relation') ||
        msg.includes('does not exist') ||
        code.startsWith('PGRST')
      ) {
        continue;
      }
      break;
    }

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Tanker dispatch record not found' });
      return;
    }

    const [stages, auditLogs, settings] = await Promise.all([
      getTankerStagesForTrip(id),
      listAuditLogs(zoneId, undefined, id),
      getZoneSettings(zoneId),
    ]);

    const enriched = enrichTankerRow(data as Record<string, unknown>, stages as StageRecordItem[], settings);

    res.json({
      ...enriched,
      audit_logs: auditLogs,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /tanker — Create a new dispatch
router.post('/', async (req, res) => {
  const {
    date,
    tanker_number,
    driver_name,
    seal_number,
    dispatch_time,
    quantity_dispatched,
    destination,
    dispatch_fat_pct,
    dispatch_snf_pct,
  } = req.body as {
    date: string;
    tanker_number: string;
    driver_name?: string;
    seal_number?: string;
    dispatch_time?: string;
    quantity_dispatched: number;
    destination?: string;
    dispatch_fat_pct?: number;
    dispatch_snf_pct?: number;
    compartments?: any[];
    driver_phone?: string;
  };

  const rawCompartments = (req.body as any).compartments;
  const compartments = Array.isArray(rawCompartments) ? rawCompartments : [];

  let computedQty = Number(quantity_dispatched || 0);
  if ((!computedQty || computedQty <= 0) && compartments.length > 0) {
    computedQty = compartments.reduce((sum: number, c: any) => sum + Number(c.quantity_litres || 0), 0);
  }

  let computedFat = dispatch_fat_pct != null && String(dispatch_fat_pct) !== '' ? Number(dispatch_fat_pct) : null;
  let computedSnf = dispatch_snf_pct != null && String(dispatch_snf_pct) !== '' ? Number(dispatch_snf_pct) : null;

  if (computedFat == null && compartments.length > 0) {
    const totalWithFat = compartments.reduce((sum: number, c: any) => sum + (c.fat_pct != null ? Number(c.quantity_litres || 0) : 0), 0);
    if (totalWithFat > 0) {
      const sumFat = compartments.reduce((sum: number, c: any) => sum + (c.fat_pct != null ? Number(c.quantity_litres || 0) * Number(c.fat_pct) : 0), 0);
      computedFat = +(sumFat / totalWithFat).toFixed(2);
    }
  }

  if (computedSnf == null && compartments.length > 0) {
    const totalWithSnf = compartments.reduce((sum: number, c: any) => sum + (c.snf_pct != null ? Number(c.quantity_litres || 0) : 0), 0);
    if (totalWithSnf > 0) {
      const sumSnf = compartments.reduce((sum: number, c: any) => sum + (c.snf_pct != null ? Number(c.quantity_litres || 0) * Number(c.snf_pct) : 0), 0);
      computedSnf = +(sumSnf / totalWithSnf).toFixed(2);
    }
  }

  if (!date || !tanker_number || !computedQty || Number(computedQty) <= 0) {
    res.status(400).json({ error: 'date, tanker_number and positive quantity_dispatched (or compartment quantities) required' });
    return;
  }

  const bmc_id = req.profile.role === 'bmc' ? req.profile.bmc_id : req.body.bmc_id;
  if (!bmc_id) {
    res.status(400).json({ error: 'bmc_id required' });
    return;
  }

  let stockWarning: string | null = null;
  try {
    const stock = await computeAvailableStock(req.profile.zone_id, bmc_id);
    if (Number(computedQty) > stock.available_stock_qty) {
      stockWarning = `Dispatched quantity (${Number(computedQty).toFixed(1)} L) exceeds available stock (${stock.available_stock_qty.toFixed(1)} L).`;
    }
  } catch {
    // non-fatal check
  }

  const dcNo = ((req.body as any).dc_number || (req.body as any).dc_no)?.trim() || null;
  const shouldRecordEntry = Boolean((req.body as any).record_vehicle_entered);

  // Look up BMC unit name for compartment attribution
  let unitName = 'BMC Unit';
  if (bmc_id) {
    try {
      const { data: uRec } = await supabase.from('bmcs').select('name, bmc_code').eq('id', bmc_id).maybeSingle();
      if (uRec?.name) unitName = `${uRec.name}${uRec.bmc_code ? ` [${uRec.bmc_code}]` : ''}`;
    } catch {
      // non-fatal
    }
  }

  const taggedCompartments = compartments.map((c: any) => ({
    ...c,
    bmc_id: bmc_id,
    bmc_name: unitName,
    dc_number: dcNo,
  }));

  // MULTI-BMC ROUTE CHECK:
  // If this registered tanker is already on the way from a prior BMC, append/merge this BMC's compartments
  const normTanker = tanker_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const { data: activeTripsFromDb } = await runResilientTankerQuery((selectStr) => {
    return supabase
      .from('tanker_dispatches')
      .select(selectStr)
      .neq('trip_status', 'exited')
      .order('created_at', { ascending: false });
  });

  const allActiveTrips: any[] = activeTripsFromDb || [];
  try {
    const store = readFallback();
    if (store.tankerDispatches) {
      for (const [id, meta] of Object.entries(store.tankerDispatches as Record<string, any>)) {
        if (!allActiveTrips.some((t) => String(t.id) === String(id)) && meta.trip_status !== 'exited') {
          allActiveTrips.push(meta);
        }
      }
    }
  } catch {
    // non-fatal
  }

  const existingTrip = (allActiveTrips || []).find((t: any) => {
    const tNum = (t.tanker_number || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const isExited = t.trip_status === 'exited' || t.stage_data?.vehicle_exit != null;
    return tNum === normTanker && !isExited;
  });

  const isMultiBmcAppend = !shouldRecordEntry && existingTrip && (existingTrip.trip_status === 'on_the_way' || !existingTrip.trip_status) && !existingTrip.stage_data?.vehicle_entered;

  if (isMultiBmcAppend) {
    const existingComps = Array.isArray(existingTrip.compartments) && existingTrip.compartments.length > 0
      ? existingTrip.compartments
      : (Array.isArray(existingTrip.stage_data?.compartments) ? existingTrip.stage_data.compartments : []);

    const mergedComps = [...existingComps];
    for (const newC of taggedCompartments) {
      const exIdx = mergedComps.findIndex((c: any) =>
        (newC.cell_key && c.cell_key === newC.cell_key) ||
        (c.compartment_no === newC.compartment_no)
      );
      if (exIdx >= 0) {
        if (!mergedComps[exIdx].quantity_litres || Number(mergedComps[exIdx].quantity_litres) <= 0) {
          mergedComps[exIdx] = newC;
        } else {
          const oldQty = Number(mergedComps[exIdx].quantity_litres) || 0;
          const addQty = Number(newC.quantity_litres) || 0;
          mergedComps[exIdx] = {
            ...mergedComps[exIdx],
            quantity_litres: oldQty + addQty,
            bmc_name: `${mergedComps[exIdx].bmc_name || 'BMC'}, ${unitName}`,
            dc_number: mergedComps[exIdx].dc_number ? (mergedComps[exIdx].dc_number.includes(dcNo) ? mergedComps[exIdx].dc_number : `${mergedComps[exIdx].dc_number}, ${dcNo}`) : dcNo,
          };
        }
      } else {
        mergedComps.push(newC);
      }
    }

    const newTotalQty = +(Number(existingTrip.quantity_dispatched || 0) + computedQty).toFixed(2);

    let combinedFat = existingTrip.dispatch_fat_pct;
    let combinedSnf = existingTrip.dispatch_snf_pct;
    const totalWithFat = mergedComps.reduce((s: number, c: any) => s + (c.fat_pct != null ? Number(c.quantity_litres || 0) : 0), 0);
    if (totalWithFat > 0) {
      const sumFat = mergedComps.reduce((s: number, c: any) => s + (c.fat_pct != null ? Number(c.quantity_litres || 0) * Number(c.fat_pct) : 0), 0);
      combinedFat = +(sumFat / totalWithFat).toFixed(2);
    }
    const totalWithSnf = mergedComps.reduce((s: number, c: any) => s + (c.snf_pct != null ? Number(c.quantity_litres || 0) : 0), 0);
    if (totalWithSnf > 0) {
      const sumSnf = mergedComps.reduce((s: number, c: any) => s + (c.snf_pct != null ? Number(c.quantity_litres || 0) * Number(c.snf_pct) : 0), 0);
      combinedSnf = +(sumSnf / totalWithSnf).toFixed(2);
    }

    const existingDc = existingTrip.dc_number || existingTrip.stage_data?.dc_number || '';
    const combinedDc = existingDc ? (existingDc.includes(dcNo) ? existingDc : `${existingDc}, ${dcNo}`) : dcNo;

    const existingBmcList = Array.isArray(existingTrip.stage_data?.bmc_dispatches) ? existingTrip.stage_data.bmc_dispatches : [];
    const bmcDispatchEntry = {
      bmc_id,
      unit_name: unitName,
      dc_number: dcNo,
      quantity_dispatched: +Number(computedQty).toFixed(2),
      dispatch_time: dispatch_time || null,
      seal_number: seal_number || null,
      driver_name: driver_name || null,
      driver_phone: (req.body as any).driver_phone || null,
      compartments: taggedCompartments,
      created_at: new Date().toISOString(),
    };
    const updatedBmcList = [...existingBmcList, bmcDispatchEntry];

    const updatedStageData = {
      ...existingTrip.stage_data,
      quantity_dispatched: newTotalQty,
      dispatch_fat_pct: combinedFat,
      dispatch_snf_pct: combinedSnf,
      dc_number: combinedDc,
      compartments: mergedComps,
      bmc_dispatches: updatedBmcList,
    };

    try {
      const upRes = await supabase
        .from('tanker_dispatches')
        .update({
          quantity_dispatched: newTotalQty,
          dispatch_fat_pct: combinedFat,
          dispatch_snf_pct: combinedSnf,
          dc_number: combinedDc,
          compartments: mergedComps,
          stage_data: updatedStageData,
        })
        .eq('id', existingTrip.id);

      if (upRes.error) {
        // Fallback update with standard base columns if extra columns don't exist in Supabase
        await supabase
          .from('tanker_dispatches')
          .update({
            quantity_dispatched: newTotalQty,
            ...(combinedFat != null ? { dispatch_fat_pct: combinedFat } : {}),
            ...(combinedSnf != null ? { dispatch_snf_pct: combinedSnf } : {}),
            ...(combinedDc ? { dc_number: combinedDc } : {}),
          })
          .eq('id', existingTrip.id);
      }
    } catch (uErr) {
      console.warn('[tanker] multi-BMC append update warning:', (uErr as Error).message);
    }

    const mergedTripObj = {
      ...existingTrip,
      trip_status: 'on_the_way',
      quantity_dispatched: newTotalQty,
      dispatch_fat_pct: combinedFat,
      dispatch_snf_pct: combinedSnf,
      dc_number: combinedDc,
      compartments: mergedComps,
      stage_data: updatedStageData,
    };

    saveTankerDispatchMetadata({
      id: mergedTripObj.id,
      tanker_number: mergedTripObj.tanker_number,
      bmc_id: mergedTripObj.bmc_id,
      zone_id: req.profile.zone_id,
      date: mergedTripObj.date,
      trip_status: 'on_the_way',
      driver_name: mergedTripObj.driver_name,
      driver_phone: mergedTripObj.driver_phone,
      dc_number: combinedDc,
      seal_number: mergedTripObj.seal_number,
      dispatch_time: mergedTripObj.dispatch_time,
      dispatch_fat_pct: combinedFat,
      dispatch_snf_pct: combinedSnf,
      quantity_dispatched: newTotalQty,
      destination: mergedTripObj.destination,
      compartments: mergedComps,
      stage_data: updatedStageData,
    });

    const stages = await getTankerStagesForTrip(mergedTripObj.id);
    const settings = await getZoneSettings(req.profile.zone_id);
    res.status(201).json({
      ...enrichTankerRow(mergedTripObj, stages as StageRecordItem[], settings),
      stock_warning: stockWarning,
    });
    return;
  }

  const bmcInitialList = [
    {
      bmc_id,
      unit_name: unitName,
      dc_number: dcNo,
      quantity_dispatched: +Number(computedQty).toFixed(2),
      dispatch_time: dispatch_time || null,
      seal_number: seal_number || null,
      driver_name: driver_name || null,
      driver_phone: (req.body as any).driver_phone || null,
      compartments: taggedCompartments,
      created_at: new Date().toISOString(),
    },
  ];

  const stageData: Record<string, any> = {
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    destination: destination?.trim() || 'Namakkal Dairy',
    quantity_dispatched: +Number(computedQty).toFixed(2),
    bmc_dispatches: bmcInitialList,
    ...(dcNo ? { dc_number: dcNo } : {}),
    ...(taggedCompartments.length > 0 ? { compartments: taggedCompartments } : {}),
    ...((req.body as any).driver_phone ? { driver_phone: String((req.body as any).driver_phone).trim() } : {}),
    ...((req.body as any).dispatch_ampm ? { dispatch_ampm: (req.body as any).dispatch_ampm } : {}),
    ...(computedFat != null && String(computedFat) !== '' ? { dispatch_fat_pct: +Number(computedFat).toFixed(2) } : {}),
    ...(computedSnf != null && String(computedSnf) !== '' ? { dispatch_snf_pct: +Number(computedSnf).toFixed(2) } : {}),
  };

  const insertTier1: Record<string, any> = {
    bmc_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    dispatch_fat_pct: computedFat != null && String(computedFat) !== '' ? +Number(computedFat).toFixed(2) : null,
    dispatch_snf_pct: computedSnf != null && String(computedSnf) !== '' ? +Number(computedSnf).toFixed(2) : null,
    trip_status: shouldRecordEntry ? 'vehicle_entered' : 'on_the_way',
    dc_number: dcNo,
    stage_data: stageData,
    created_by: req.user.id,
  };
  if ((req.body as any).driver_phone) insertTier1.driver_phone = String((req.body as any).driver_phone).trim();
  if ((req.body as any).dispatch_ampm) insertTier1.dispatch_ampm = (req.body as any).dispatch_ampm;
  if (taggedCompartments.length > 0) insertTier1.compartments = taggedCompartments;

  const insertTier2 = {
    bmc_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    trip_status: shouldRecordEntry ? 'vehicle_entered' : 'on_the_way',
    dc_number: dcNo,
    stage_data: stageData,
    created_by: req.user.id,
  };

  const { dc_number: _d3, ...insertTier3 } = insertTier2;

  // Tier 4: Without dispatch_time and dc_number (if dispatch_time not present in schema)
  const insertTier4 = {
    bmc_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    stage_data: stageData,
    created_by: req.user.id,
  };

  // Tier 5: Without driver_name & seal_number (safely preserved in stage_data)
  const insertTier5 = {
    bmc_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    stage_data: stageData,
    created_by: req.user.id,
  };

  // Tier 6: Absolute baseline table (guaranteed on any bare tanker_dispatches table)
  const insertTier6 = {
    bmc_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    created_by: req.user.id,
  };

  let data: any = null;
  let error: any = null;

  for (const insertObj of [insertTier1, insertTier2, insertTier3, insertTier4, insertTier5, insertTier6]) {
    const res = await supabase.from('tanker_dispatches').insert(insertObj).select().single();
    if (!res.error) {
      data = res.data;
      error = null;
      break;
    }
    error = res.error;
    const msg = String(res.error.message || '').toLowerCase();
    if (!isMissingSchemaError(res.error) && !msg.includes('column') && !msg.includes('does not exist')) {
      break;
    }
  }

  if (data) {
    if (!data.driver_name && driver_name?.trim()) data.driver_name = driver_name.trim();
    if (!data.dc_number && dcNo) data.dc_number = dcNo;
    if (!data.seal_number && seal_number?.trim()) data.seal_number = seal_number.trim();
    if (!data.dispatch_time && dispatch_time) data.dispatch_time = dispatch_time;
    if (!data.stage_data) data.stage_data = stageData;
    if (!data.destination) data.destination = destination?.trim() || 'Namakkal Dairy';
    if (!data.compartments && taggedCompartments.length > 0) data.compartments = taggedCompartments;

    // Immediately persist full metadata in fallback store (guaranteed reflection across Gate, QC, Unloading, Admin)
    saveTankerDispatchMetadata({
      id: data.id,
      tanker_number: data.tanker_number || tanker_number.trim().toUpperCase(),
      bmc_id,
      zone_id: req.profile.zone_id,
      date,
      trip_status: shouldRecordEntry ? 'vehicle_entered' : 'on_the_way',
      driver_name: data.driver_name || driver_name?.trim() || null,
      driver_phone: (req.body as any).driver_phone ? String((req.body as any).driver_phone).trim() : null,
      dc_number: data.dc_number || dcNo,
      seal_number: data.seal_number || seal_number?.trim() || null,
      dispatch_time: data.dispatch_time || dispatch_time || null,
      dispatch_ampm: (req.body as any).dispatch_ampm || null,
      dispatch_fat_pct: computedFat != null && String(computedFat) !== '' ? +Number(computedFat).toFixed(2) : null,
      dispatch_snf_pct: computedSnf != null && String(computedSnf) !== '' ? +Number(computedSnf).toFixed(2) : null,
      quantity_dispatched: +Number(computedQty).toFixed(2),
      destination: data.destination || destination?.trim() || 'Namakkal Dairy',
      compartments: taggedCompartments,
      stage_data: stageData,
      created_at: data.created_at || new Date().toISOString(),
    });

    // Record initial stage for immediate reflection across all plant views
    try {
      await recordTankerStageInDb({
        trip_id: data.id,
        stage_name: 'dispatched',
        team: 'bmc',
        status: 'done',
        stage_data: {
          tanker_number: data.tanker_number,
          driver_name: data.driver_name,
          driver_phone: (req.body as any).driver_phone ? String((req.body as any).driver_phone).trim() : null,
          seal_number: data.seal_number,
          dc_number: data.dc_number || dcNo,
          dispatch_date: date,
          dispatch_time: data.dispatch_time || dispatch_time,
          destination: data.destination,
          quantity_dispatched: data.quantity_dispatched,
          compartments,
        },
        done_by: req.user.id,
        done_by_name: req.profile.full_name ?? req.user.email ?? 'BMC Operator',
        done_at: new Date().toISOString(),
      });
    } catch {
      // non-fatal
    }
  }

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  if (shouldRecordEntry && data) {
    try {
      await recordTankerStageInDb({
        trip_id: data.id,
        stage_name: 'vehicle_entered',
        team: 'gate',
        status: 'done',
        stage_data: {
          tanker_number: data.tanker_number,
          driver_name: data.driver_name,
          seal_number: data.seal_number,
          dc_number: dcNo,
          entry_date: (req.body as any).entry_date || data.date,
          entry_time: (req.body as any).entry_time || new Date().toISOString(),
          dispatch_date: (req.body as any).dispatch_date || data.date,
          dispatch_time: (req.body as any).dispatch_time || data.dispatch_time,
          time_difference: (req.body as any).time_difference || null,
          receiving_dairy: (req.body as any).receiving_dairy || 'NAMAKKAL DAIRY',
          seal_verified: true,
          compartments: compartments.length > 0 ? compartments : undefined,
        },
        done_by: req.user.id,
        done_by_name: req.profile.full_name ?? req.user.email ?? 'Gate Operator',
        done_at: new Date().toISOString(),
      });
    } catch (stageErr) {
      console.warn('[tanker/create] Could not auto-record entry stage:', stageErr);
    }
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    bmc_id,
    entity_type: 'tanker_dispatch',
    entity_id: data.id,
    action: 'create',
    changes: {
      date,
      tanker_number: data.tanker_number || tanker_number.trim().toUpperCase(),
      quantity_dispatched: data.quantity_dispatched || +Number(computedQty).toFixed(2),
      destination: data.destination || destination?.trim() || 'Namakkal Dairy',
      driver_name: data.driver_name || driver_name?.trim() || null,
      seal_number: data.seal_number || seal_number?.trim() || null,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
  });

  const settings = await getZoneSettings(req.profile.zone_id);
  res.status(201).json({
    ...enrichTankerRow(data as Record<string, unknown>, [], settings),
    stock_warning: stockWarning,
  });
});

// POST /tanker/:id/stages/:stageKey — Operator records stage completion
router.post('/:id/stages/:stageKey', async (req, res) => {
  const id = String(req.params.id);
  const stageKey = req.params.stageKey as TankerStageKey;
  const userRole = (req.profile.role || '').toLowerCase();
  const zoneId = req.profile.zone_id;

  const stageDef = TANKER_STAGES.find((s) => s.key === stageKey);
  if (!stageDef) {
    res.status(400).json({ error: `Invalid stage key: ${stageKey}` });
    return;
  }

  // 1. Enforce team permissions
  // Plant roles: GATE can do vehicle_entered, gross_weight, tare_weight, vehicle_exit
  // QC can do qc_completed, cip_completed
  // UNLOADING can do unloaded
  // ADMIN and SUPERADMIN can do any stage
  const isAdmin = userRole === 'admin';
  if (!isAdmin) {
    if (stageDef.team.toLowerCase() !== userRole) {
      res.status(403).json({
        error: `Only ${stageDef.teamLabel.toUpperCase()} team or ADMIN can record ${stageDef.title}`,
      });
      return;
    }
  }

  // 2. Fetch existing trip and its stage history
  const { data: trip, error: tripErr } = await supabase
    .from('tanker_dispatches')
    .select('*')
    .eq('id', id)
    .eq('zone_id', zoneId)
    .maybeSingle();

  if (tripErr) {
    res.status(500).json({ error: tripErr.message });
    return;
  }
  if (!trip) {
    res.status(404).json({ error: 'Tanker trip record not found' });
    return;
  }

  const existingStages = (await getTankerStagesForTrip(id)) as StageRecordItem[];
  const existingKeys = new Set(existingStages.map((s) => s.stage_name));
  const existingDoneKeys = new Set(
    existingStages.filter((s) => s.status === 'done').map((s) => s.stage_name)
  );
  const qcStage = existingStages.find((s) => s.stage_name === 'qc_completed');
  const isQcRejected = qcStage?.status === 'rejected';

  // Check current status and prevent re-recording completed stages or acting out of turn
  const settings = await getZoneSettings(zoneId);
  const journey = deriveTankerJourneyState({
    id,
    date: String(trip.date),
    tanker_number: String(trip.tanker_number ?? ''),
    driver_name: (trip.driver_name as string) || null,
    seal_number: (trip.seal_number as string) || null,
    quantity_dispatched: Number(trip.quantity_dispatched || 0),
    trip_status: trip.trip_status as any,
    current_stage: trip.current_stage as any,
    waiting_team: trip.waiting_team as any,
    stage_data: (trip.stage_data as Record<string, unknown>) || {},
    stages: existingStages,
    created_at: (trip.created_at as string) || undefined,
  }, settings);

  if (journey.tripStatus === 'exited') {
    res.status(400).json({ error: 'This tanker journey is already fully completed and exited' });
    return;
  }

  // Only done (passing) stages block re-recording. If CIP was unsatisfied/rejected, allow re-recording.
  if (existingDoneKeys.has(stageKey)) {
    res.status(400).json({ error: `Stage ${stageDef.title} has already been completed for this tanker` });
    return;
  }

  if (!isAdmin && journey.currentStageKey !== stageKey && !(stageKey === 'cip_completed' && (trip.cip_status === 'unsatisfied' || trip.trip_status === 'cip_unsatisfied'))) {
    res.status(400).json({
      error: `Cannot record ${stageDef.title}: Trip is currently waiting for stage "${journey.currentStageTitle}" (${journey.currentStageKey})`,
      current_stage: journey.currentStageKey,
      current_waiting_team: journey.waitingTeam,
    });
    return;
  }

  // 3. Enforce strict sequencing
  switch (stageKey) {
    case 'vehicle_entered':
      break;
    case 'gross_weight':
      if (!existingKeys.has('vehicle_entered')) {
        res.status(400).json({ error: 'Cannot record Gross Weight before Vehicle Entered' });
        return;
      }
      break;
    case 'qc_completed':
      if (!existingKeys.has('gross_weight')) {
        res.status(400).json({ error: 'Cannot record QC before Gross Weight' });
        return;
      }
      break;
    case 'unloaded':
      if (!existingKeys.has('qc_completed')) {
        res.status(400).json({ error: 'Cannot record Unloaded before QC Completed' });
        return;
      }
      if (isQcRejected) {
        res.status(400).json({ error: 'Cannot unload tanker: QC has REJECTED this tanker' });
        return;
      }
      break;
    case 'tare_weight':
      if (isQcRejected) {
        // Skip unloaded, tare follows directly after QC rejection
        if (!existingKeys.has('qc_completed')) {
          res.status(400).json({ error: 'Cannot record Tare Weight before QC Completed' });
          return;
        }
      } else {
        if (!existingKeys.has('unloaded')) {
          res.status(400).json({ error: 'Cannot record Tare Weight before Unloaded' });
          return;
        }
      }
      break;
    case 'cip_completed':
      if (!existingKeys.has('tare_weight')) {
        res.status(400).json({ error: 'Cannot record CIP Completed before Tare Weight' });
        return;
      }
      break;
    case 'vehicle_exit':
      if (!existingDoneKeys.has('cip_completed')) {
        res.status(400).json({ error: 'Cannot record Vehicle Exit: CIP cleaning must be successfully passed (Satisfied) first' });
        return;
      }
      break;
  }

  // 4. Extract and validate stage-specific payloads
  const payload = req.body || {};
  let stageStatus: 'done' | 'rejected' | 'skipped' = 'done';
  const stageData: Record<string, unknown> = { ...payload };

  const updateTripFields: Record<string, unknown> = {};

  if (stageKey === 'vehicle_entered') {
    const dcNo = payload.dc_number || payload.dc_no || trip.dc_number || (trip.stage_data as any)?.dc_number || null;
    const drvName = payload.driver_name || trip.driver_name || (trip.stage_data as any)?.driver_name || null;
    const drvPhone = payload.driver_phone || (trip as any).driver_phone || (trip.stage_data as any)?.driver_phone || null;
    const sealNo = payload.seal_number || trip.seal_number || (trip.stage_data as any)?.seal_number || null;

    stageData.tanker_number = trip.tanker_number;
    stageData.driver_name = drvName;
    stageData.driver_phone = drvPhone;
    stageData.seal_number = sealNo;
    stageData.dc_number = dcNo;
    stageData.entry_date = payload.entry_date || new Date().toISOString().slice(0, 10);
    stageData.entry_time = payload.entry_time || new Date().toISOString();
    stageData.entry_time_12h = payload.entry_time_12h || null;
    stageData.entry_ampm = payload.entry_ampm || null;
    stageData.dispatch_date = payload.dispatch_date || trip.date;
    stageData.dispatch_time = payload.dispatch_time || trip.dispatch_time;
    stageData.dispatch_ampm = payload.dispatch_ampm || null;
    stageData.time_difference = payload.time_difference || null;
    stageData.receiving_dairy = payload.receiving_dairy || 'NAMAKKAL DAIRY';
    updateTripFields.trip_status = 'vehicle_entered';
    if (dcNo) updateTripFields.dc_number = dcNo;
    if (drvName) updateTripFields.driver_name = drvName;
    if (sealNo) updateTripFields.seal_number = sealNo;
  } else if (stageKey === 'gross_weight') {
    const grossKg = Number(payload.gross_weight_kg);
    if (!grossKg || grossKg <= 0) {
      res.status(400).json({ error: 'Valid gross_weight_kg is required' });
      return;
    }
    stageData.gross_weight_kg = grossKg;
    stageData.weighbridge_slip_no = payload.weighbridge_slip_no || null;
    if (payload.number_of_cells != null) stageData.number_of_cells = Number(payload.number_of_cells);
    if (payload.gross_date) stageData.gross_date = payload.gross_date;
    if (payload.entry_time) stageData.entry_time = payload.entry_time;
    if (payload.dispatch_quantity != null) stageData.dispatch_quantity = Number(payload.dispatch_quantity);
    if (payload.dispatch_quality) stageData.dispatch_quality = payload.dispatch_quality;
    if (payload.received_from) stageData.received_from = payload.received_from;
    if (payload.dc_number) stageData.dc_number = payload.dc_number;
    updateTripFields.gross_weight_kg = grossKg;
    updateTripFields.trip_status = 'gross_done';
  } else if (stageKey === 'qc_completed') {
    const isReject = payload.qc_status === 'rejected' || payload.accepted === false;
    if (isReject) {
      if (!payload.rejection_reason || !String(payload.rejection_reason).trim()) {
        res.status(400).json({ error: 'rejection_reason is mandatory when rejecting tanker' });
        return;
      }
      stageStatus = 'rejected';
      stageData.qc_status = 'rejected';
      stageData.rejection_reason = String(payload.rejection_reason).trim();
      updateTripFields.qc_status = 'rejected';
      updateTripFields.trip_status = 'qc_rejected';
    } else {
      let fat = payload.received_fat_pct != null ? Number(payload.received_fat_pct) : null;
      let snf = payload.received_snf_pct != null ? Number(payload.received_snf_pct) : null;

      // Calculate weighted averages from received_quality if provided
      if (Array.isArray(payload.received_quality) && payload.received_quality.length > 0) {
        let totalQty = 0;
        let sumFat = 0;
        let sumSnf = 0;
        for (const item of payload.received_quality) {
          const q = Number(item.qty) || 1;
          const f = Number(item.fat);
          const s = Number(item.snf);
          if (!isNaN(f) && !isNaN(s) && f > 0 && s > 0) {
            totalQty += q;
            sumFat += f * q;
            sumSnf += s * q;
          }
        }
        if (totalQty > 0) {
          if (fat == null) fat = Number((sumFat / totalQty).toFixed(2));
          if (snf == null) snf = Number((sumSnf / totalQty).toFixed(2));
        }
      }

      if (fat == null || snf == null) {
        res.status(400).json({ error: 'received_fat_pct and received_snf_pct required for QC approval' });
        return;
      }
      stageStatus = 'done';
      stageData.qc_status = 'accepted';
      stageData.received_fat_pct = fat;
      stageData.received_snf_pct = snf;
      stageData.temperature = payload.temperature != null ? Number(payload.temperature) : null;
      updateTripFields.qc_status = 'accepted';
      updateTripFields.received_fat_pct = fat;
      updateTripFields.received_snf_pct = snf;
      updateTripFields.trip_status = 'qc_done';
    }
    if (payload.dispatch_quality) stageData.dispatch_quality = payload.dispatch_quality;
    if (payload.received_quality) stageData.received_quality = payload.received_quality;
    if (payload.qc_date) stageData.qc_date = payload.qc_date;
    if (payload.qc_time) stageData.qc_time = payload.qc_time;
    if (payload.test_types) stageData.test_types = payload.test_types;
    if (payload.manual_entry_reason) stageData.manual_entry_reason = payload.manual_entry_reason;
    if (payload.remarks) stageData.remarks = payload.remarks;
    if (payload.dc_number) stageData.dc_number = payload.dc_number;
    if (payload.received_from) stageData.received_from = payload.received_from;
    if (payload.test_categories) stageData.test_categories = payload.test_categories;
    if (payload.freshness_test) stageData.freshness_test = payload.freshness_test;
    if (payload.snf_adulteration_test) stageData.snf_adulteration_test = payload.snf_adulteration_test;
    if (payload.special_test) stageData.special_test = payload.special_test;
    if (payload.fat_adulteration_test) stageData.fat_adulteration_test = payload.fat_adulteration_test;
    if (payload.tests_completed) stageData.tests_completed = payload.tests_completed;
  } else if (stageKey === 'unloaded') {
    const litres = payload.unloaded_litres != null ? Number(payload.unloaded_litres) : Number(trip.quantity_dispatched);
    stageData.silo_or_bay = payload.silo_or_bay || payload.unloaded_to_silo || 'Main Bay';
    stageData.unloaded_litres = litres;
    if (payload.unloading_date) stageData.unloading_date = payload.unloading_date;
    if (payload.unloading_time) stageData.unloading_time = payload.unloading_time;
    if (payload.seal_number) stageData.seal_number = payload.seal_number;
    if (payload.unloaded_to_silo) stageData.unloaded_to_silo = payload.unloaded_to_silo;
    if (payload.unload_operator_name) stageData.unload_operator_name = payload.unload_operator_name;
    if (payload.line_number) stageData.line_number = payload.line_number;
    if (payload.gross_weight_kg) stageData.gross_weight_kg = payload.gross_weight_kg;
    if (payload.unloading_cells) stageData.unloading_cells = payload.unloading_cells;
    if (payload.dc_details) stageData.dc_details = payload.dc_details;
    if (payload.is_npd_transfer != null) stageData.is_npd_transfer = payload.is_npd_transfer;
    if (payload.received_quality) stageData.received_quality = payload.received_quality;
    if (payload.dc_number) stageData.dc_number = payload.dc_number;
    if (payload.received_from) stageData.received_from = payload.received_from;
    if (payload.dipstick_start_cm != null && payload.dipstick_start_cm !== '') stageData.dipstick_start_cm = Number(payload.dipstick_start_cm);
    if (payload.dipstick_end_cm != null && payload.dipstick_end_cm !== '') stageData.dipstick_end_cm = Number(payload.dipstick_end_cm);
    if (payload.flowmeter_reading != null && payload.flowmeter_reading !== '') stageData.flowmeter_reading = Number(payload.flowmeter_reading);
    if (payload.remarks) stageData.remarks = String(payload.remarks);
    updateTripFields.received_qty = litres;
    updateTripFields.trip_status = 'unloaded';
  } else if (stageKey === 'tare_weight') {
    const tareKg = Number(payload.tare_weight_kg);
    if (!tareKg || tareKg <= 0) {
      res.status(400).json({ error: 'Valid tare_weight_kg is required' });
      return;
    }
    const grossKg = Number(trip.gross_weight_kg || payload.gross_weight_kg || 0);
    if (grossKg > 0 && tareKg >= grossKg) {
      res.status(400).json({ error: `Tare weight (${tareKg} kg) must be less than gross weight (${grossKg} kg)` });
      return;
    }
    stageData.tare_weight_kg = tareKg;
    stageData.tare_slip_no = payload.tare_slip_no || null;
    const netKg = grossKg > 0 ? +(grossKg - tareKg).toFixed(2) : null;
    stageData.net_weight_kg = netKg;
    updateTripFields.tare_weight_kg = tareKg;
    updateTripFields.net_weight_kg = netKg;
    updateTripFields.trip_status = 'tare_done';
  } else if (stageKey === 'cip_completed') {
    const isUnsatisfied =
      payload.qc_inspection === 'UNSATISFIED' ||
      payload.qc_inspection === 'UNSATISFACTORY' ||
      payload.cip_status === 'fail' ||
      payload.cip_status === 'unsatisfied';

    if (isUnsatisfied) {
      stageStatus = 'rejected';
      stageData.cip_status = 'unsatisfied';
      stageData.qc_inspection = 'UNSATISFIED';
      updateTripFields.cip_status = 'unsatisfied';
      updateTripFields.trip_status = 'cip_unsatisfied';
    } else {
      stageStatus = 'done';
      stageData.cip_status = 'pass';
      stageData.qc_inspection = 'SATISFIED';
      updateTripFields.cip_status = 'pass';
      updateTripFields.trip_status = 'cip_done';
    }
    stageData.chemical_used = payload.chemical_used || 'Caustic Soda 1.5%';
    if (payload.vehicle_no) stageData.vehicle_no = payload.vehicle_no;
    if (payload.received_from) stageData.received_from = payload.received_from;
    if (payload.dc_number) stageData.dc_number = payload.dc_number;
    if (payload.dispatch_date) stageData.dispatch_date = payload.dispatch_date;
    if (payload.dispatch_time) stageData.dispatch_time = payload.dispatch_time;
    if (payload.cip_date) stageData.cip_date = payload.cip_date;
    if (payload.cip_time) stageData.cip_time = payload.cip_time;
    if (payload.cip_operator) stageData.cip_operator = payload.cip_operator;
    if (payload.cip_clean_types) stageData.cip_clean_types = payload.cip_clean_types;
    if (payload.is_cip_checked != null) stageData.is_cip_checked = payload.is_cip_checked;
    if (payload.remarks) stageData.remarks = payload.remarks;
    if (payload.ph_test) stageData.ph_test = payload.ph_test;
  } else if (stageKey === 'vehicle_exit') {
    stageData.gate_pass_number = payload.gate_pass_number || `GP-${Date.now().toString().slice(-6)}`;
    stageData.exit_time = new Date().toISOString();
    updateTripFields.receipt_time = new Date().toISOString().slice(11, 16);
    updateTripFields.trip_status = isQcRejected ? 'qc_rejected' : 'exited';
  }

  // 5. Persist stage record
  const stageRecord = await recordTankerStageInDb({
    trip_id: id,
    stage_name: stageKey,
    team: stageDef.team,
    status: stageStatus,
    stage_data: stageData,
    done_by: req.user.id,
    done_by_name: req.profile.full_name ?? req.user.email ?? 'Staff',
    done_at: new Date().toISOString(),
  });

  // 6. If QC was rejected, also mark 'unloaded' stage as explicitly 'skipped'
  if (stageKey === 'qc_completed' && stageStatus === 'rejected') {
    await recordTankerStageInDb({
      trip_id: id,
      stage_name: 'unloaded',
      team: 'unloading',
      status: 'skipped',
      stage_data: { note: 'Skipped (QC rejected)', reason: stageData.rejection_reason },
      done_by: req.user.id,
      done_by_name: req.profile.full_name ?? req.user.email ?? 'Staff',
      done_at: new Date().toISOString(),
    });
  }

  // 7. Update tanker_dispatches
  const mergedStageData = {
    ...((trip.stage_data as Record<string, unknown>) || {}),
    [stageKey]: {
      ...stageData,
      status: stageStatus,
      done_by: req.user.id,
      done_by_name: req.profile.full_name ?? req.user.email ?? 'Staff',
      done_at: stageRecord.done_at,
    },
  };
  updateTripFields.stage_data = mergedStageData;

  let updatedTrip: any = null;
  try {
    const initialUpdate = await supabase
      .from('tanker_dispatches')
      .update(updateTripFields)
      .eq('id', id)
      .select('*, bmcs(name, bmc_code)')
      .single();

    if (initialUpdate.error) {
      const knownBaseCols = ['quantity_dispatched', 'destination', 'date', 'tanker_number'];
      const safeBaseFields: Record<string, any> = {};
      for (const k of knownBaseCols) {
        if (k in updateTripFields) safeBaseFields[k] = updateTripFields[k];
      }
      if (Object.keys(safeBaseFields).length > 0) {
        const fallbackUpdate = await supabase
          .from('tanker_dispatches')
          .update(safeBaseFields)
          .eq('id', id)
          .select('*, bmcs(name, bmc_code)')
          .single();
        updatedTrip = fallbackUpdate.data;
      }
    } else {
      updatedTrip = initialUpdate.data;
    }
  } catch (err) {
    console.warn('[tanker] Supabase update warning:', (err as Error).message);
  }

  // Persist updated stage details in fallback store
  saveTankerDispatchMetadata({
    id,
    tanker_number: trip.tanker_number,
    ...updateTripFields,
    stage_data: mergedStageData,
  });

  // 8. Audit log
  await writeAuditLog({
    zone_id: zoneId,
    bmc_id: trip.bmc_id,
    entity_type: 'tanker_stage',
    entity_id: `${id}_${stageKey}`,
    action: `stage_${stageKey}_${stageStatus}`,
    changes: {
      stage: stageKey,
      status: stageStatus,
      data: stageData,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
  });

  const allStages = await getTankerStagesForTrip(id);
  const enriched = enrichTankerRow((updatedTrip || { ...trip, ...updateTripFields }) as Record<string, unknown>, allStages as StageRecordItem[], settings);

  res.json(enriched);
});

// POST /tanker/:id/correct — Admin corrects stage data with mandatory reason
router.post('/:id/correct', requireRole('admin'), async (req, res) => {
  const id = String(req.params.id);
  const zoneId = req.profile.zone_id;
  const { stage_name, changes, reason } = req.body as {
    stage_name: TankerStageKey;
    changes: Record<string, unknown>;
    reason: string;
  };

  if (!reason || !reason.trim()) {
    res.status(400).json({ error: 'Correction requires a mandatory reason' });
    return;
  }
  if (!stage_name) {
    res.status(400).json({ error: 'stage_name is required' });
    return;
  }

  const { data: trip, error: tripErr } = await supabase
    .from('tanker_dispatches')
    .select('*')
    .eq('id', id)
    .eq('zone_id', zoneId)
    .maybeSingle();

  if (tripErr) {
    res.status(500).json({ error: tripErr.message });
    return;
  }
  if (!trip) {
    res.status(404).json({ error: 'Tanker trip not found' });
    return;
  }

  const existingStages = await getTankerStagesForTrip(id);
  const targetStage = existingStages.find((s) => s.stage_name === stage_name);
  const oldData = targetStage ? targetStage.stage_data : {};

  const mergedData = {
    ...(oldData || {}),
    ...(changes || {}),
    corrected_at: new Date().toISOString(),
    corrected_by: req.user.id,
    corrected_by_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    correction_reason: reason.trim(),
  };

  const updatedStage = await recordTankerStageInDb({
    trip_id: id,
    stage_name,
    team: targetStage?.team || 'gate',
    status: (changes?.status as any) || targetStage?.status || 'done',
    stage_data: mergedData,
    done_by: req.user.id,
    done_by_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    done_at: targetStage?.done_at || new Date().toISOString(),
  });

  // Write audit log
  await writeAuditLog({
    zone_id: zoneId,
    bmc_id: trip.bmc_id,
    entity_type: 'tanker_stage_correction',
    entity_id: `${id}_${stage_name}`,
    action: 'correct_stage',
    changes: {
      stage: stage_name,
      reason: reason.trim(),
      old_value: oldData,
      new_value: changes,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  const allStages = await getTankerStagesForTrip(id);
  const settings = await getZoneSettings(zoneId);
  const enriched = enrichTankerRow(trip as Record<string, unknown>, allStages as StageRecordItem[], settings);

  res.json({
    message: 'Stage corrected successfully',
    updated_stage: updatedStage,
    trip: enriched,
  });
});

// POST /tanker/:id/remark — Admin adds remark or flags exception
router.post('/:id/remark', requireRole('admin'), async (req, res) => {
  const id = String(req.params.id);
  const zoneId = req.profile.zone_id;
  const { remark, is_exception } = req.body as {
    remark: string;
    is_exception?: boolean;
  };

  if (!remark || !remark.trim()) {
    res.status(400).json({ error: 'Remark content is required' });
    return;
  }

  const { data: trip } = await supabase
    .from('tanker_dispatches')
    .select('*')
    .eq('id', id)
    .eq('zone_id', zoneId)
    .maybeSingle();

  if (!trip) {
    res.status(404).json({ error: 'Tanker trip not found' });
    return;
  }

  await writeAuditLog({
    zone_id: zoneId,
    bmc_id: trip.bmc_id,
    entity_type: 'tanker_dispatch',
    entity_id: id,
    action: is_exception ? 'mark_exception' : 'add_remark',
    changes: {
      remark: remark.trim(),
      is_exception: Boolean(is_exception),
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json({ success: true, message: 'Remark recorded in audit log' });
});

// GET /tanker/export/stage-wise — Export CSV with complete stage progression
router.get('/export/stage-wise', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('zone_id', zoneId);
      if (req.profile.role === 'bmc') query = query.eq('bmc_id', req.profile.bmc_id!);
      else if (bmc_id) query = query.eq('bmc_id', bmc_id);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      return query;
    });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const tripIds = rows.map((r) => String(r.id));
    const stageMap = await getTankerStagesForTrips(tripIds);

    const exportRows = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      const enriched = enrichTankerRow(r, stages, settings);
      const u = r.bmcs as { name: string; bmc_code: string } | null;

      const rowOut: Record<string, any> = {
        'Date': formatDateDDMMYYYY(String(r.date)),
        'Tanker Number': r.tanker_number,
        'BMC': u?.name ?? '',
        'BMC Code': u?.bmc_code ?? '',
        'Driver': r.driver_name ?? '',
        'Seal Number': r.seal_number ?? '',
        'Dispatched (L)': r.quantity_dispatched,
        'Stage': enriched.journey.tripStatusLabel,
        'Waiting Team': enriched.journey.waitingTeamLabel,
        'Waiting (min)': enriched.journey.waitingSinceMinutes,
        'Delayed Flag': enriched.journey.isOverLimit ? 'YES' : 'NO',
        'Gross (kg)': enriched.calculated.gross_weight_kg ?? '',
        'Tare (kg)': enriched.calculated.tare_weight_kg ?? '',
        'Net (kg)': enriched.calculated.net_weight_kg ?? '',
        'Received (L)': enriched.calculated.received_litres ?? '',
        'Transit Loss (L)': enriched.calculated.transit_loss_litres ?? '',
        'Transit Loss (%)': enriched.calculated.transit_loss_pct ?? '',
        'Total Turnaround (min)': enriched.calculated.total_turnaround_min ?? '',
      };

      // Stage columns
      for (const st of enriched.stages) {
        rowOut[`${st.title} Status`] = st.status;
        rowOut[`${st.title} Done By`] = st.done_by_name ?? '';
        rowOut[`${st.title} Done At`] = st.done_at ?? '';
      }

      return rowOut;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Stage Progression');
    const csv = XLSX.utils.sheet_to_csv(ws);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Tanker_Stage_Progression_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/export/pdf — PDF / Register format export
router.get('/export/pdf', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('zone_id', zoneId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (bmc_id) query = query.eq('bmc_id', bmc_id);
      return query;
    });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const tripIds = rows.map((r) => String(r.id));
    const stageMap = await getTankerStagesForTrips(tripIds);

    const enriched = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      return enrichTankerRow(r, stages, settings);
    });

    res.json({
      title: 'Aavin Dairy Plant - Daily Tanker Receipt & Journey Register',
      date: new Date().toISOString(),
      zone_id: zoneId,
      tankers: enriched,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /tanker/:id/receive — Admin legacy endpoint maintained for compatibility
router.patch('/:id/receive', requireRole('admin'), async (req, res) => {
  const id = String(req.params.id);
  const { received_qty, receipt_time, received_fat_pct, received_snf_pct } = req.body as {
    received_qty?: number;
    receipt_time?: string;
    received_fat_pct?: number;
    received_snf_pct?: number;
  };

  if (received_qty == null || !Number.isFinite(Number(received_qty)) || Number(received_qty) < 0) {
    res.status(400).json({ error: 'Valid non-negative received_qty is required' });
    return;
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('tanker_dispatches')
    .select('*')
    .eq('id', id)
    .eq('zone_id', req.profile.zone_id)
    .maybeSingle();

  if (fetchErr) {
    res.status(500).json({ error: fetchErr.message });
    return;
  }
  if (!existing) {
    res.status(404).json({ error: 'Tanker dispatch record not found' });
    return;
  }

  const updateFields = {
    received_qty: +Number(received_qty).toFixed(2),
    receipt_time: receipt_time?.trim() || null,
    received_fat_pct: received_fat_pct != null && String(received_fat_pct) !== '' ? +Number(received_fat_pct).toFixed(2) : null,
    received_snf_pct: received_snf_pct != null && String(received_snf_pct) !== '' ? +Number(received_snf_pct).toFixed(2) : null,
    received_by: req.user.id,
  };

  const { data, error } = await supabase
    .from('tanker_dispatches')
    .update(updateFields)
    .eq('id', id)
    .eq('zone_id', req.profile.zone_id)
    .select('*, bmcs(name, bmc_code)')
    .single();

  if (error && !isMissingSchemaError(error)) {
    res.status(500).json({ error: error.message });
    return;
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    bmc_id: existing.bmc_id,
    entity_type: 'tanker_dispatch',
    entity_id: id,
    action: 'record_receipt',
    changes: updateFields,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  const stages = await getTankerStagesForTrip(id);
  const settings = await getZoneSettings(req.profile.zone_id);
  res.json(enrichTankerRow((data || { ...existing, ...updateFields }) as Record<string, unknown>, stages as StageRecordItem[], settings));
});

// DELETE /tanker/:id
router.delete('/:id', requireRole('admin', 'bmc'), async (req, res) => {
  const id = String(req.params.id);
  let query = supabase.from('tanker_dispatches').delete().eq('id', id);
  if (req.profile.role === 'bmc') query = query.eq('bmc_id', req.profile.bmc_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});

export default router;
