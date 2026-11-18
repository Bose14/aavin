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

const EXTENDED_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time,
  quantity_dispatched, destination, dispatch_fat_pct, dispatch_snf_pct,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, stage_data,
  units(name, unit_code)
`;

const OPERATIONAL_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time,
  quantity_dispatched, destination,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, stage_data,
  units(name, unit_code)
`;

const V2_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time,
  quantity_dispatched, destination, stage_data, created_at,
  units(name, unit_code)
`;

const MINIMAL_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time, quantity_dispatched, destination, stage_data, created_at,
  units(name, unit_code)
`;

const BARE_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time, quantity_dispatched, destination, stage_data, created_at
`;

async function runResilientTankerQuery(
  buildQuery: (selectStr: string) => any,
): Promise<{ data: any[]; error: any }> {
  const tiers = [
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

function enrichTankerRow(row: Record<string, unknown>, stages?: StageRecordItem[], settings?: any): EnrichedTankerRow {
  const dcNumber =
    (row.dc_number as string) ||
    (row.stage_data as any)?.dc_number ||
    (row.stage_data as any)?.vehicle_entered?.dc_number ||
    (stages?.find((s) => s.stage_name === 'vehicle_entered')?.stage_data as any)?.dc_number ||
    null;

  const compartments =
    (row.compartments as any[]) ||
    (row.stage_data as any)?.compartments ||
    (row.stage_data as any)?.vehicle_entered?.compartments ||
    [];

  const driverName =
    (row.driver_name as string) ||
    (row.stage_data as any)?.driver_name ||
    (row.stage_data as any)?.vehicle_entered?.driver_name ||
    null;

  const driverPhone =
    (row.driver_phone as string) ||
    (row.stage_data as any)?.driver_phone ||
    (row.stage_data as any)?.vehicle_entered?.driver_phone ||
    null;

  const sealNumber =
    (row.seal_number as string) ||
    (row.stage_data as any)?.seal_number ||
    (row.stage_data as any)?.vehicle_entered?.seal_number ||
    null;

  const dispatchTime =
    (row.dispatch_time as string) ||
    (row.stage_data as any)?.dispatch_time ||
    null;

  const destination =
    (row.destination as string) ||
    (row.stage_data as any)?.destination ||
    'Namakkal Dairy';

  const dispatchFat =
    row.dispatch_fat_pct != null
      ? Number(row.dispatch_fat_pct)
      : (row.stage_data as any)?.dispatch_fat_pct != null
        ? Number((row.stage_data as any).dispatch_fat_pct)
        : null;

  const dispatchSnf =
    row.dispatch_snf_pct != null
      ? Number(row.dispatch_snf_pct)
      : (row.stage_data as any)?.dispatch_snf_pct != null
        ? Number((row.stage_data as any).dispatch_snf_pct)
        : null;

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
    received_qty: row.received_qty != null ? Number(row.received_qty) : null,
    receipt_time: (row.receipt_time as string) || null,
    received_fat_pct: row.received_fat_pct != null ? Number(row.received_fat_pct) : null,
    received_snf_pct: row.received_snf_pct != null ? Number(row.received_snf_pct) : null,
    gross_weight_kg: row.gross_weight_kg != null ? Number(row.gross_weight_kg) : null,
    tare_weight_kg: row.tare_weight_kg != null ? Number(row.tare_weight_kg) : null,
    net_weight_kg: row.net_weight_kg != null ? Number(row.net_weight_kg) : null,
    qc_status: (row.qc_status as string) || null,
    trip_status: (row.trip_status as TripStatus) || undefined,
    stage_data: (row.stage_data as Record<string, unknown>) || {},
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
    destination,
    dispatch_fat_pct: dispatchFat,
    dispatch_snf_pct: dispatchSnf,
    dc_number: dcNumber,
    compartments,
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

async function computeAvailableStock(zoneId: string, unitId?: string | null) {
  let milkQ = supabase.from('milk_entries').select('quantity_litres, rejection_qty').eq('zone_id', zoneId);
  let tankerQ = supabase.from('tanker_dispatches').select('quantity_dispatched').eq('zone_id', zoneId);

  if (unitId) {
    milkQ = milkQ.eq('unit_id', unitId);
    tankerQ = tankerQ.eq('unit_id', unitId);
  }

  const [mRes, tRes] = await Promise.all([milkQ, tankerQ]);
  if (mRes.error || tRes.error) {
    throw new Error(mRes.error?.message || tRes.error?.message || 'Failed to compute stock');
  }

  const totalCollectedNet = (mRes.data ?? []).reduce(
    (sum, r) => sum + Math.max(0, Number(r.quantity_litres ?? 0) - Number(r.rejection_qty ?? 0)),
    0,
  );
  const totalDispatched = (tRes.data ?? []).reduce(
    (sum, r) => sum + Number(r.quantity_dispatched ?? 0),
    0,
  );
  const availableStock = Math.max(0, +(totalCollectedNet - totalDispatched).toFixed(2));

  return {
    collected_net_qty: +totalCollectedNet.toFixed(2),
    dispatched_qty: +totalDispatched.toFixed(2),
    available_stock_qty: availableStock,
    raw_balance_qty: +(totalCollectedNet - totalDispatched).toFixed(2),
  };
}

// GET /tanker/stock — available milk stock
router.get('/stock', async (req, res) => {
  try {
    const unitId = req.profile.role === 'unit' ? req.profile.unit_id : (req.query.unit_id as string | undefined);
    const stock = await computeAvailableStock(req.profile.zone_id, unitId);
    res.json(stock);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker/stats — Chip counts, waiting-too-long badges, and KPI summary
router.get('/stats', async (req, res) => {
  try {
    const { from, to, unit_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase
        .from('tanker_dispatches')
        .select(selectStr)
        .eq('zone_id', zoneId);

      if (req.profile.role === 'unit') {
        query = query.eq('unit_id', req.profile.unit_id!);
      } else if (unit_id) {
        query = query.eq('unit_id', unit_id);
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
      unit_id,
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

      if (req.profile.role === 'unit') {
        query = query.eq('unit_id', req.profile.unit_id!);
      } else if (unit_id) {
        query = query.eq('unit_id', unit_id);
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
        const unitName = String((r.units as any)?.name || '').toLowerCase();
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
    const tiers = [EXTENDED_TANKER_SELECT, V2_TANKER_SELECT, MINIMAL_TANKER_SELECT, BARE_TANKER_SELECT];

    for (const selectStr of tiers) {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('id', id);
      if (req.profile.role === 'unit') {
        query = query.eq('unit_id', req.profile.unit_id!);
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

  const unit_id = req.profile.role === 'unit' ? req.profile.unit_id : req.body.unit_id;
  if (!unit_id) {
    res.status(400).json({ error: 'unit_id required' });
    return;
  }

  let stockWarning: string | null = null;
  try {
    const stock = await computeAvailableStock(req.profile.zone_id, unit_id);
    if (Number(computedQty) > stock.available_stock_qty) {
      stockWarning = `Dispatched quantity (${Number(computedQty).toFixed(1)} L) exceeds available stock (${stock.available_stock_qty.toFixed(1)} L).`;
    }
  } catch {
    // non-fatal check
  }

  const dcNo = ((req.body as any).dc_number || (req.body as any).dc_no)?.trim() || null;
  const shouldRecordEntry = Boolean((req.body as any).record_vehicle_entered);

  const stageData: Record<string, any> = {
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    destination: destination?.trim() || 'Namakkal Dairy',
    quantity_dispatched: +Number(computedQty).toFixed(2),
    ...(dcNo ? { dc_number: dcNo } : {}),
    ...(compartments.length > 0 ? { compartments } : {}),
    ...((req.body as any).driver_phone ? { driver_phone: String((req.body as any).driver_phone).trim() } : {}),
    ...((req.body as any).dispatch_ampm ? { dispatch_ampm: (req.body as any).dispatch_ampm } : {}),
    ...(computedFat != null && String(computedFat) !== '' ? { dispatch_fat_pct: +Number(computedFat).toFixed(2) } : {}),
    ...(computedSnf != null && String(computedSnf) !== '' ? { dispatch_snf_pct: +Number(computedSnf).toFixed(2) } : {}),
  };

  const insertTier1: Record<string, any> = {
    unit_id,
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
  if (compartments.length > 0) insertTier1.compartments = compartments;

  const insertTier2 = {
    unit_id,
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

  const insertTier4 = {
    unit_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    quantity_dispatched: +Number(computedQty).toFixed(2),
    destination: destination?.trim() || 'Namakkal Dairy',
    stage_data: stageData,
    created_by: req.user.id,
  };

  let data: any = null;
  let error: any = null;

  for (const insertObj of [insertTier1, insertTier2, insertTier3, insertTier4]) {
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
    if (!data.stage_data) data.stage_data = stageData;
    if (!data.destination) data.destination = destination?.trim() || 'Namakkal Dairy';
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
    unit_id,
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
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
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

  if (existingKeys.has(stageKey)) {
    res.status(400).json({ error: `Stage ${stageDef.title} has already been completed for this tanker` });
    return;
  }

  if (!isAdmin && journey.currentStageKey !== stageKey) {
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
      if (!existingKeys.has('cip_completed')) {
        res.status(400).json({ error: 'Cannot record Vehicle Exit before CIP Completed' });
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
      const fat = payload.received_fat_pct != null ? Number(payload.received_fat_pct) : null;
      const snf = payload.received_snf_pct != null ? Number(payload.received_snf_pct) : null;
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
  } else if (stageKey === 'unloaded') {
    const litres = payload.unloaded_litres != null ? Number(payload.unloaded_litres) : Number(trip.quantity_dispatched);
    stageData.silo_or_bay = payload.silo_or_bay || 'Main Bay';
    stageData.unloaded_litres = litres;
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
    stageData.cip_status = payload.cip_status || 'pass';
    stageData.chemical_used = payload.chemical_used || 'Caustic Soda 1.5%';
    updateTripFields.trip_status = 'cip_done';
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
  const initialUpdate = await supabase
    .from('tanker_dispatches')
    .update(updateTripFields)
    .eq('id', id)
    .select('*, units(name, unit_code)')
    .single();

  if (initialUpdate.error && initialUpdate.error.message?.includes('column')) {
    const { dc_number, ...safeFields } = updateTripFields;
    const fallbackUpdate = await supabase
      .from('tanker_dispatches')
      .update(safeFields)
      .eq('id', id)
      .select('*, units(name, unit_code)')
      .single();
    updatedTrip = fallbackUpdate.data;
  } else {
    updatedTrip = initialUpdate.data;
  }

  // 8. Audit log
  await writeAuditLog({
    zone_id: zoneId,
    unit_id: trip.unit_id,
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
router.post('/:id/correct', requireRole('admin', 'superadmin'), async (req, res) => {
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
    unit_id: trip.unit_id,
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
router.post('/:id/remark', requireRole('admin', 'superadmin'), async (req, res) => {
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
    unit_id: trip.unit_id,
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
    const { from, to, unit_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('zone_id', zoneId);
      if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
      else if (unit_id) query = query.eq('unit_id', unit_id);
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
      const u = r.units as { name: string; unit_code: string } | null;

      const rowOut: Record<string, any> = {
        'Date': formatDateDDMMYYYY(String(r.date)),
        'Tanker Number': r.tanker_number,
        'BMC': u?.name ?? '',
        'BMC Code': u?.unit_code ?? '',
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
    const { from, to, unit_id } = req.query as Record<string, string>;
    const zoneId = req.profile.zone_id;
    const settings = await getZoneSettings(zoneId);

    const { data, error } = await runResilientTankerQuery((selectStr) => {
      let query = supabase.from('tanker_dispatches').select(selectStr).eq('zone_id', zoneId);
      if (from) query = query.gte('date', from);
      if (to) query = query.lte('date', to);
      if (unit_id) query = query.eq('unit_id', unit_id);
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

// POST /tanker/seed — Injects test data covering every stage, delayed, and QC rejected
router.post('/seed', requireRole('admin', 'superadmin'), async (req, res) => {
  const zoneId = req.profile.zone_id;
  try {
    // 1. Get or create a default unit
    let { data: units } = await supabase.from('units').select('id').eq('zone_id', zoneId).limit(1);
    let unitId = units?.[0]?.id;
    if (!unitId) {
      const { data: newUnit } = await supabase
        .from('units')
        .insert({
          zone_id: zoneId,
          name: 'Tiruvannamalai Village Unit',
          unit_code: 'TVM-001',
          contact_number: '9876543210',
        })
        .select()
        .single();
      unitId = newUnit?.id;
    }

    const today = new Date().toISOString().slice(0, 10);
    const nowMs = Date.now();
    const actorId = req.user.id;
    const actorName = req.profile.full_name || 'Admin';

    // Helper to generate ISO time offset in minutes from now
    const offsetIso = (minsAgo: number) => new Date(nowMs - minsAgo * 60000).toISOString();

    const seedConfigs: Array<{
      tanker_number: string;
      driver_name: string;
      seal_number: string;
      quantity: number;
      stagesToApply: Array<{
        stage_name: TankerStageKey;
        team: PlantTeam;
        status: 'done' | 'rejected' | 'skipped';
        data: Record<string, unknown>;
        minsAgo: number;
      }>;
    }> = [
      {
        tanker_number: 'TN-25-A-1001',
        driver_name: 'Murugan K',
        seal_number: 'SL-9001',
        quantity: 9000,
        stagesToApply: [], // 1. On the way
      },
      {
        tanker_number: 'TN-25-B-1002',
        driver_name: 'Ravi Chandran',
        seal_number: 'SL-9002',
        quantity: 8500,
        stagesToApply: [
          // 2. Vehicle Entered
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 10 },
        ],
      },
      {
        tanker_number: 'TN-25-C-1003',
        driver_name: 'Karthik S',
        seal_number: 'SL-9003',
        quantity: 9200,
        stagesToApply: [
          // 3. Gross Done
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 25 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 24500, weighbridge_slip_no: 'WB-101' }, minsAgo: 15 },
        ],
      },
      {
        tanker_number: 'TN-25-D-1004',
        driver_name: 'Selvam P',
        seal_number: 'SL-9004',
        quantity: 8800,
        stagesToApply: [
          // 4. QC Done
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 50 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 24100 }, minsAgo: 40 },
          { stage_name: 'qc_completed', team: 'qc', status: 'done', data: { qc_status: 'accepted', received_fat_pct: 4.5, received_snf_pct: 8.4 }, minsAgo: 20 },
        ],
      },
      {
        tanker_number: 'TN-25-E-1005',
        driver_name: 'Gopal R',
        seal_number: 'SL-9005',
        quantity: 9500,
        stagesToApply: [
          // 5. Unloaded
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 80 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 25000 }, minsAgo: 70 },
          { stage_name: 'qc_completed', team: 'qc', status: 'done', data: { qc_status: 'accepted', received_fat_pct: 4.6, received_snf_pct: 8.5 }, minsAgo: 50 },
          { stage_name: 'unloaded', team: 'unloading', status: 'done', data: { silo_or_bay: 'Silo-2', unloaded_litres: 9480 }, minsAgo: 15 },
        ],
      },
      {
        tanker_number: 'TN-25-F-1006',
        driver_name: 'Mani V',
        seal_number: 'SL-9006',
        quantity: 8900,
        stagesToApply: [
          // 6. Tare Done
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 110 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 24200 }, minsAgo: 95 },
          { stage_name: 'qc_completed', team: 'qc', status: 'done', data: { qc_status: 'accepted', received_fat_pct: 4.45, received_snf_pct: 8.42 }, minsAgo: 75 },
          { stage_name: 'unloaded', team: 'unloading', status: 'done', data: { silo_or_bay: 'Silo-1', unloaded_litres: 8880 }, minsAgo: 45 },
          { stage_name: 'tare_weight', team: 'gate', status: 'done', data: { tare_weight_kg: 15050, net_weight_kg: 9150 }, minsAgo: 10 },
        ],
      },
      {
        tanker_number: 'TN-25-G-1007',
        driver_name: 'Anbuchelvan',
        seal_number: 'SL-9007',
        quantity: 9100,
        stagesToApply: [
          // 7. CIP Done
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 140 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 24600 }, minsAgo: 125 },
          { stage_name: 'qc_completed', team: 'qc', status: 'done', data: { qc_status: 'accepted', received_fat_pct: 4.52, received_snf_pct: 8.48 }, minsAgo: 105 },
          { stage_name: 'unloaded', team: 'unloading', status: 'done', data: { silo_or_bay: 'Silo-3', unloaded_litres: 9080 }, minsAgo: 70 },
          { stage_name: 'tare_weight', team: 'gate', status: 'done', data: { tare_weight_kg: 15230, net_weight_kg: 9370 }, minsAgo: 45 },
          { stage_name: 'cip_completed', team: 'qc', status: 'done', data: { cip_status: 'pass', chemical_used: 'Nitric Acid 1%' }, minsAgo: 5 },
        ],
      },
      {
        tanker_number: 'TN-25-H-1008',
        driver_name: 'Sundaram P',
        seal_number: 'SL-9008',
        quantity: 9400,
        stagesToApply: [
          // 8. Exited
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 180 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 24900 }, minsAgo: 165 },
          { stage_name: 'qc_completed', team: 'qc', status: 'done', data: { qc_status: 'accepted', received_fat_pct: 4.5, received_snf_pct: 8.4 }, minsAgo: 145 },
          { stage_name: 'unloaded', team: 'unloading', status: 'done', data: { silo_or_bay: 'Silo-1', unloaded_litres: 9380 }, minsAgo: 115 },
          { stage_name: 'tare_weight', team: 'gate', status: 'done', data: { tare_weight_kg: 15220, net_weight_kg: 9680 }, minsAgo: 90 },
          { stage_name: 'cip_completed', team: 'qc', status: 'done', data: { cip_status: 'pass' }, minsAgo: 50 },
          { stage_name: 'vehicle_exit', team: 'gate', status: 'done', data: { gate_pass_number: 'GP-889901' }, minsAgo: 20 },
        ],
      },
      {
        tanker_number: 'TN-25-R-9999',
        driver_name: 'Dharmalingam',
        seal_number: 'SL-REJ-01',
        quantity: 8000,
        stagesToApply: [
          // 9. QC Rejected (Unloaded Skipped)
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 70 },
          { stage_name: 'gross_weight', team: 'gate', status: 'done', data: { gross_weight_kg: 23200 }, minsAgo: 55 },
          { stage_name: 'qc_completed', team: 'qc', status: 'rejected', data: { qc_status: 'rejected', rejection_reason: 'Sour milk / Acidity 0.18% exceeds limit' }, minsAgo: 35 },
          { stage_name: 'unloaded', team: 'unloading', status: 'skipped', data: { note: 'Skipped (QC rejected)' }, minsAgo: 35 },
        ],
      },
      {
        tanker_number: 'TN-25-L-8888',
        driver_name: 'Govindan V',
        seal_number: 'SL-DELAY-01',
        quantity: 9100,
        stagesToApply: [
          // 10. Delayed trip: entered 120 minutes ago, Gate gross weight still pending (> 15 min limit!)
          { stage_name: 'vehicle_entered', team: 'gate', status: 'done', data: { seal_verified: true }, minsAgo: 120 },
        ],
      },
    ];

    const insertedTrips = [];

    for (const sc of seedConfigs) {
      let tripRec: any = null;
      const { data: extRec, error: insErr } = await supabase
        .from('tanker_dispatches')
        .insert({
          zone_id: zoneId,
          unit_id: unitId,
          date: today,
          tanker_number: sc.tanker_number,
          driver_name: sc.driver_name,
          seal_number: sc.seal_number,
          quantity_dispatched: sc.quantity,
          dispatch_time: '07:30',
          destination: 'Main Processing Plant',
          dispatch_fat_pct: 4.5,
          dispatch_snf_pct: 8.5,
          created_by: actorId,
        })
        .select()
        .single();

      if (!insErr && extRec) {
        tripRec = extRec;
      } else {
        const { data: minRec, error: minErr } = await supabase
          .from('tanker_dispatches')
          .insert({
            zone_id: zoneId,
            unit_id: unitId,
            date: today,
            tanker_number: sc.tanker_number,
            quantity_dispatched: sc.quantity,
            destination: 'Main Processing Plant',
            created_by: actorId,
          })
          .select()
          .single();
        if (minErr) {
          console.warn('Seed insert minimal dispatch error:', minErr.message);
          continue;
        }
        tripRec = minRec;
      }

      const tripId = tripRec.id;
      for (const st of sc.stagesToApply) {
        await recordTankerStageInDb({
          trip_id: tripId,
          stage_name: st.stage_name,
          team: st.team,
          status: st.status,
          stage_data: st.data,
          done_by: actorId,
          done_by_name: actorName,
          done_at: offsetIso(st.minsAgo),
        });
      }

      insertedTrips.push(tripRec.id);
    }

    res.json({
      success: true,
      message: `Seeded ${insertedTrips.length} test tanker journeys covering every stage, QC rejection, and delayed trips.`,
      trips_created: insertedTrips.length,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /tanker/:id/receive — Admin legacy endpoint maintained for compatibility
router.patch('/:id/receive', requireRole('admin', 'superadmin'), async (req, res) => {
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
    .select('*, units(name, unit_code)')
    .single();

  if (error && !isMissingSchemaError(error)) {
    res.status(500).json({ error: error.message });
    return;
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id: existing.unit_id,
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
router.delete('/:id', requireRole('admin', 'superadmin', 'unit'), async (req, res) => {
  const id = String(req.params.id);
  let query = supabase.from('tanker_dispatches').delete().eq('id', id);
  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { error } = await query;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(204).send();
});

export default router;
