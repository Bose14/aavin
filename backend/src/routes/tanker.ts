import { Router } from 'express';
import * as XLSX from '../lib/spreadsheet';
import { requireRole } from '../middleware/requireRole';
import { authMiddleware } from '../middleware/auth';
import {
  getZoneSettings,
  listAuditLogs,
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
import {
  DispatchError,
  computeStock,
  deleteTrip,
  dispatchToTanker,
  fetchTrip,
  fetchTrips,
  findTanker,
  listTankerAvailability,
  recordStage,
  saveTanker,
  updateStageData,
  updateTrip,
} from '../lib/tripStore';
import type { LegacyTripRow } from '../lib/tripStore';
import { supabase } from '../supabase';
import { computeActiveUsersPerTeam } from '../lib/teamCounts';
import { syncTripAcknowledgements, litresFromNetWeight } from '../lib/ack';

const router = Router();
router.use(authMiddleware);

function sendError(res: import('express').Response, err: unknown) {
  if (err instanceof DispatchError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[tanker]', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/** Keep each BMC's acknowledged litres and fat/SNF in step with the trip; never blocks the plant. */
/**
 * Received litres follow the weighbridge: net weight (gross - tare) divided by the specific gravity of the QC
 * fat/SNF. Runs whenever a weight or the QC quality changes; until both weights are known the dispatched
 * litres stay as the placeholder. The unloading stage's litres are kept in step so every screen agrees.
 */
async function applyWeightBasedLitres(tripId: string): Promise<void> {
  try {
    const { data: t } = await supabase
      .from('tanker_trips')
      .select('net_weight_kg, received_fat_pct, received_snf_pct')
      .eq('id', tripId)
      .maybeSingle();
    const net = t?.net_weight_kg != null ? Number(t.net_weight_kg) : 0;
    if (!t || !(net > 0)) return;
    const litres = litresFromNetWeight(
      net,
      t.received_fat_pct != null ? Number(t.received_fat_pct) : null,
      t.received_snf_pct != null ? Number(t.received_snf_pct) : null,
    );
    await updateTrip(tripId, { received_litres: litres });
    const { data: st } = await supabase.from('trip_stages').select('data').eq('trip_id', tripId).eq('stage_key', 'unloaded').order('id', { ascending: false }).limit(1);
    const stageData = st?.[0]?.data as Record<string, unknown> | undefined;
    if (stageData) await updateStageData(tripId, 'unloaded', { data: { ...stageData, unloaded_litres: litres } });
  } catch (e) {
    console.error('[ack] could not apply weight-based litres for trip', tripId, (e as Error).message);
  }
}

async function refreshAcknowledgements(tripId: string): Promise<void> {
  try {
    await syncTripAcknowledgements(tripId);
  } catch (e) {
    console.error('[ack] could not update acknowledgements for trip', tripId, (e as Error).message);
  }
}

function actorName(req: import('express').Request, fallback: string): string {
  return req.profile.full_name ?? req.user.email ?? fallback;
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

/** Adds the journey timeline, flags and transit-loss figures to a trip row. */
export function enrichTankerRow(row: Record<string, unknown>, stages?: StageRecordItem[], settings?: any): EnrichedTankerRow {
  const rowStageData: Record<string, any> =
    row.stage_data && typeof row.stage_data === 'object' ? (row.stage_data as Record<string, any>) : {};
  const compartments: any[] = Array.isArray(row.compartments) ? (row.compartments as any[]) : [];

  const stagesMap: Record<string, any> = {};
  if (Array.isArray(stages)) {
    for (const s of stages) {
      if (s.stage_name && s.stage_data && typeof s.stage_data === 'object') {
        stagesMap[s.stage_name] = s.stage_data;
      }
    }
  }

  const driverName = (row.driver_name as string) || null;
  const sealNumber = (row.seal_number as string) || null;
  const dcNumber = (row.dc_number as string) || null;
  const dispatchTime = (row.dispatch_time as string) || null;
  const destination = (row.destination as string) || 'Dairy';
  const dispatchFat = row.dispatch_fat_pct != null ? Number(row.dispatch_fat_pct) : null;
  const dispatchSnf = row.dispatch_snf_pct != null ? Number(row.dispatch_snf_pct) : null;
  const grossWeightKg = row.gross_weight_kg != null ? Number(row.gross_weight_kg) : null;
  const tareWeightKg = row.tare_weight_kg != null ? Number(row.tare_weight_kg) : null;
  const netWeightKg = row.net_weight_kg != null ? Number(row.net_weight_kg) : null;
  const receivedQty = row.received_qty != null ? Number(row.received_qty) : null;

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
    qc_status: (row.qc_status as string) || null,
    trip_status: (row.trip_status as TripStatus) || undefined,
    stage_data: {
      ...rowStageData,
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
    seal_number: sealNumber,
    dispatch_time: dispatchTime,
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

/**
 * The trip as sent to the browser. The journey timeline already carries every stage, so the
 * repeated copies (a second `stages` list, full stage data inside each timeline step, compartments
 * in three more places, the QC cell tests stored under four names) are left out. The screens read
 * `compartments`, `stage_data.<stage>` and `journey.timelineSteps` (status, summary, first-step vehicle
 * and seal numbers), all of which stay.
 */
const QC_TEST_ALIASES = ['freshness_test', 'snf_adulteration_test', 'special_test', 'fat_adulteration_test'];

export function slimTankerForClient<T extends Record<string, any>>(row: T): T {
  const { stages: _stages, journey, stage_data, ...rest } = row;
  void _stages;

  const slimStageData: Record<string, any> = { ...(stage_data ?? {}) };
  delete slimStageData.compartments;
  if (Array.isArray(slimStageData.bmc_dispatches)) {
    slimStageData.bmc_dispatches = slimStageData.bmc_dispatches.map(({ compartments: _c, ...d }: Record<string, any>) => {
      void _c;
      return d;
    });
  }
  if (slimStageData.qc_completed && typeof slimStageData.qc_completed === 'object') {
    const qc = { ...slimStageData.qc_completed };
    for (const k of QC_TEST_ALIASES) delete qc[k];
    slimStageData.qc_completed = qc;
  }

  let slimJourney = journey;
  if (journey && typeof journey === 'object') {
    const { compartments: _jc, timelineSteps, ...jr } = journey as Record<string, any>;
    void _jc;
    slimJourney = {
      ...jr,
      timelineSteps: (timelineSteps ?? []).map((step: Record<string, any>) => {
        const { data, ...stepRest } = step;
        const keep: Record<string, unknown> = {};
        if (data?.tanker_number != null) keep.tanker_number = data.tanker_number;
        if (data?.seal_number != null) keep.seal_number = data.seal_number;
        return { ...stepRest, data: keep };
      }),
    };
  }
  return { ...rest, stage_data: slimStageData, journey: slimJourney } as unknown as T;
}

/** Milk stock: collected (net of rejections) minus litres loaded on tankers. */
export async function computeAvailableStock(dairyUnitId: string, bmcId?: string | null) {
  return computeStock(dairyUnitId, bmcId);
}

// GET /tanker/stock — available milk stock
router.get('/stock', async (req, res) => {
  try {
    const bmcId = req.profile.role === 'bmc' ? req.profile.bmc_id : (req.query.bmc_id as string | undefined);
    res.json(await computeStock(req.profile.dairy_unit_id, bmcId));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/registered — tankers of this dairy unit with live capacity and availability
router.get('/registered', async (req, res) => {
  try {
    res.json(await listTankerAvailability(req.profile.dairy_unit_id, undefined, req.profile.role === 'bmc' ? req.profile.bmc_id : null));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/registered/:vehicleNumber — one tanker by vehicle number
router.get('/registered/:vehicleNumber', async (req, res) => {
  try {
    const found = (await listTankerAvailability(req.profile.dairy_unit_id, req.params.vehicleNumber))[0];
    if (!found) {
      res.status(404).json({ error: 'Tanker registration not found' });
      return;
    }
    res.json(found);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /tanker/registration — register a tanker (or update the details of an existing one)
router.post('/registration', requireRole('admin'), async (req, res) => {
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
      driver_name,
      driver_phone,
      route_name,
      route_bmc_ids,
    } = req.body;

    if (!vehicle_number || !contractor_name || !supplier_name) {
      res.status(400).json({ error: 'Vehicle number, contractor name, and supplier name are required' });
      return;
    }
    if (!driver_name || !String(driver_name).trim()) {
      res.status(400).json({ error: 'Driver name is required' });
      return;
    }
    if (!route_name || !String(route_name).trim()) {
      res.status(400).json({ error: 'Route name is required' });
      return;
    }

    const saved = await saveTanker(req.profile.dairy_unit_id, {
      vehicle_number,
      contractor_name,
      from_date,
      vehicle_type,
      number_of_cells,
      front_cell_capacity,
      middle_cell_capacity,
      back_cell_capacity,
      supplier_name,
      driver_name,
      driver_phone,
      route_name,
      route_bmc_ids: Array.isArray(route_bmc_ids) ? route_bmc_ids : undefined,
    });

    res.status(201).json(saved);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/stats — Chip counts, waiting-too-long badges, and KPI summary
router.get('/stats', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const dairyUnitId = req.profile.dairy_unit_id;
    const [settings, teamUserCounts] = await Promise.all([
      getZoneSettings(dairyUnitId),
      computeActiveUsersPerTeam(dairyUnitId),
    ]);

    const { rows, stages: stageMap } = await fetchTrips({
      dairyUnitId,
      from,
      to,
      bmcId: req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id,
    });


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
      team_user_counts: teamUserCounts,
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
    sendError(res, err);
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

    const dairyUnitId = req.profile.dairy_unit_id;
    const settings = await getZoneSettings(dairyUnitId);

    const { rows, stages: stageMap } = await fetchTrips({
      dairyUnitId,
      from,
      to,
      bmcId: req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id,
    });


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

    res.json(enriched.map((e) => slimTankerForClient(e)));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/:id — Detailed view with full timeline and audit logs
router.get('/:id', async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;

  try {
    const found = await fetchTrip(dairyUnitId, String(req.params.id), req.profile.role === 'bmc' ? req.profile.bmc_id : null);
    if (!found) {
      res.status(404).json({ error: 'Tanker dispatch record not found' });
      return;
    }

    const [auditLogs, settings] = await Promise.all([
      listAuditLogs(dairyUnitId, undefined, found.row.id),
      getZoneSettings(dairyUnitId),
    ]);

    res.json({
      ...slimTankerForClient(enrichTankerRow(found.row, found.stages, settings)),
      audit_logs: auditLogs,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /tanker — a BMC loads milk onto a tanker (starts the tanker's trip, or adds to the open one)
router.post('/', requireRole('admin', 'bmc'), async (req, res) => {
  try {
    const body = req.body as Record<string, any>;
    const { date, tanker_number, seal_number, dispatch_time, destination: _destination } = body;
    void _destination;
    const compartments: any[] = Array.isArray(body.compartments) ? body.compartments : [];

    let computedQty = Number(body.quantity_dispatched || 0);
    if ((!computedQty || computedQty <= 0) && compartments.length > 0) {
      computedQty = compartments.reduce((sum: number, c: any) => sum + Number(c.quantity_litres || 0), 0);
    }
    if (!date || !tanker_number || !computedQty || Number(computedQty) <= 0) {
      res.status(400).json({ error: 'date, tanker_number and positive quantity_dispatched (or compartment quantities) required' });
      return;
    }
    const dcNo = String(body.dc_number || body.dc_no || '').trim();
    if (!dcNo) {
      res.status(400).json({ error: 'dc_number is required' });
      return;
    }

    const bmcId = req.profile.role === 'bmc' ? req.profile.bmc_id : body.bmc_id;
    if (!bmcId) {
      res.status(400).json({ error: 'bmc_id required' });
      return;
    }

    const dairyUnitId = req.profile.dairy_unit_id;
    const tanker = await findTanker(dairyUnitId, String(tanker_number));
    if (!tanker) {
      res.status(404).json({ error: `Tanker ${String(tanker_number).toUpperCase()} is not registered for this dairy unit` });
      return;
    }

    const cellKeys = tanker.cells.map((c) => c.cell_key);
    const loadings = (compartments.length > 0
      ? compartments.map((c: any, idx: number) => ({
          cell_key: String(c.cell_key || cellKeys[Number(c.compartment_no ? c.compartment_no - 1 : idx)] || ''),
          quantity_litres: Number(c.quantity_litres || 0),
          fat_pct: c.fat_pct != null && c.fat_pct !== '' ? Number(c.fat_pct) : null,
          snf_pct: c.snf_pct != null && c.snf_pct !== '' ? Number(c.snf_pct) : null,
          temperature: c.temperature != null && c.temperature !== '' ? Number(c.temperature) : null,
          milk_type: c.milk_type || null,
          seal_number: c.seal_number || null,
        }))
      : [
          {
            cell_key: cellKeys[0],
            quantity_litres: Number(computedQty),
            fat_pct: body.dispatch_fat_pct != null && body.dispatch_fat_pct !== '' ? Number(body.dispatch_fat_pct) : null,
            snf_pct: body.dispatch_snf_pct != null && body.dispatch_snf_pct !== '' ? Number(body.dispatch_snf_pct) : null,
            temperature: null,
            milk_type: null,
            seal_number: null,
          },
        ]
    ).filter((l) => l.quantity_litres > 0);

    if (loadings.length === 0 || loadings.some((l) => !l.cell_key)) {
      res.status(400).json({ error: 'Each compartment needs a cell and a positive quantity' });
      return;
    }

    const tripId = await dispatchToTanker({
      tankerId: tanker.id,
      bmcId: String(bmcId),
      dcNumber: dcNo.toUpperCase(),
      outletSealNo: seal_number ? String(seal_number).trim().toUpperCase() : null,
      // the driver comes from the tanker's registration
      driverName: tanker.driver_name,
      driverPhone: tanker.driver_phone,
      dispatchTimeText: dispatch_time ? String(dispatch_time) : null,
      tripDate: String(date).slice(0, 10),
      userId: req.profile.id,
      clientRequestId: body.client_request_id ? String(body.client_request_id) : null,
      loadings,
    });

    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      bmc_id: String(bmcId),
      entity_type: 'tanker_dispatch',
      entity_id: tripId,
      action: 'create',
      changes: {
        date,
        tanker_number: tanker.vehicle_number,
        quantity_dispatched: +Number(computedQty).toFixed(2),
        dc_number: dcNo,
        driver_name: tanker.driver_name,
        seal_number: seal_number || null,
      },
      actor_id: req.user.id,
      actor_name: actorName(req, 'Staff'),
    });

    const settings = await getZoneSettings(dairyUnitId);
    const found = await fetchTrip(dairyUnitId, tripId);
    res.status(201).json(slimTankerForClient(enrichTankerRow(found!.row, found!.stages, settings)));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /tanker/:id/stages/:stageKey — Operator records stage completion
router.post('/:id/stages/:stageKey', async (req, res) => {
  try {
    await recordStageHandler(req, res);
  } catch (err) {
    sendError(res, err);
  }
});

async function recordStageHandler(req: import('express').Request, res: import('express').Response) {
  const idParam = String(req.params.id);
  const stageKey = req.params.stageKey as TankerStageKey;
  const userRole = (req.profile.role || '').toLowerCase();
  const dairyUnitId = req.profile.dairy_unit_id;

  const stageDef = TANKER_STAGES.find((s) => s.key === stageKey);
  if (!stageDef) {
    res.status(400).json({ error: `Invalid stage key: ${stageKey}` });
    return;
  }

  // 1. Enforce team permissions
  // Plant roles: GATE can do vehicle_entered, gross_weight, tare_weight, vehicle_exit
  // QC can do qc_completed, cip_completed
  // UNLOADING can do unloaded
  // ADMIN can do any stage
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
  const found = await fetchTrip(dairyUnitId, idParam);
  if (!found) {
    res.status(404).json({ error: 'Tanker trip record not found' });
    return;
  }
  const trip = found.row;
  const id = String(trip.id);

  const existingStages = found.stages;
  const existingKeys = new Set(existingStages.map((s) => s.stage_name));
  const existingDoneKeys = new Set(
    existingStages.filter((s) => s.status === 'done').map((s) => s.stage_name)
  );
  const qcStage = existingStages.find((s) => s.stage_name === 'qc_completed');
  const isQcRejected = qcStage?.status === 'rejected';

  // Check current status and prevent re-recording completed stages or acting out of turn
  const settings = await getZoneSettings(dairyUnitId);
  const journey = deriveTankerJourneyState({
    id,
    date: String(trip.date),
    tanker_number: String(trip.tanker_number ?? ''),
    driver_name: (trip.driver_name as string) || null,
    seal_number: (trip.seal_number as string) || null,
    quantity_dispatched: Number(trip.quantity_dispatched || 0),
    trip_status: trip.trip_status as any,
    stage_data: (trip.stage_data as Record<string, unknown>) || {},
    stages: existingStages,
    created_at: (trip.created_at as string) || undefined,
  }, settings);

  if (journey.tripStatus === 'exited' || trip.stage_data?.vehicle_exit != null) {
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

  // 5. Persist the stage record, then the figures the reports read from the trip
  const doneAt = new Date().toISOString();
  const userName = actorName(req, 'Staff');
  await recordStage({
    tripId: id,
    stageKey,
    team: stageDef.team,
    status: stageStatus,
    data: stageData,
    userId: req.profile.id,
    userName,
    doneAt,
  });

  // 6. If QC was rejected, also mark 'unloaded' stage as explicitly 'skipped'
  if (stageKey === 'qc_completed' && stageStatus === 'rejected') {
    await recordStage({
      tripId: id,
      stageKey: 'unloaded',
      team: 'unloading',
      status: 'skipped',
      data: { note: 'Skipped (QC rejected)', reason: stageData.rejection_reason },
      userId: req.profile.id,
      userName,
      doneAt,
    });
  }

  // 7. Update the trip row
  const tripPatch: Record<string, unknown> = {
    status: updateTripFields.trip_status,
    driver_name: updateTripFields.driver_name,
    gross_weight_kg: updateTripFields.gross_weight_kg,
    tare_weight_kg: updateTripFields.tare_weight_kg,
    net_weight_kg: updateTripFields.net_weight_kg,
    received_litres: updateTripFields.received_qty,
    received_fat_pct: updateTripFields.received_fat_pct,
    received_snf_pct: updateTripFields.received_snf_pct,
    qc_status: updateTripFields.qc_status,
    cip_status: updateTripFields.cip_status,
  };
  if (stageKey === 'vehicle_entered') tripPatch.entered_at = doneAt;
  if (stageKey === 'vehicle_exit') tripPatch.exited_at = doneAt;
  for (const k of Object.keys(tripPatch)) {
    if (tripPatch[k] === undefined) delete tripPatch[k];
  }
  await updateTrip(id, tripPatch);
  if (['gross_weight', 'tare_weight', 'qc_completed', 'unloaded'].includes(stageKey)) {
    await applyWeightBasedLitres(id);
    await refreshAcknowledgements(id);
  }

  // 8. Audit log
  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
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
    actor_name: userName,
  });

  const updated = await fetchTrip(dairyUnitId, id);
  res.json(slimTankerForClient(enrichTankerRow(updated!.row, updated!.stages, settings)));
}

// POST /tanker/:id/correct — Admin corrects stage data with mandatory reason
router.post('/:id/correct', requireRole('admin'), async (req, res) => {
  try {
    const dairyUnitId = req.profile.dairy_unit_id;
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

    const found = await fetchTrip(dairyUnitId, String(req.params.id));
    if (!found) {
      res.status(404).json({ error: 'Tanker trip not found' });
      return;
    }
    const trip = found.row;
    const tripId = String(trip.id);

    const targetStage = found.stages.find((s) => s.stage_name === stage_name);
    if (!targetStage) {
      res.status(404).json({ error: `Stage ${stage_name} has not been recorded for this trip` });
      return;
    }
    const oldData = targetStage.stage_data;

    const mergedData = {
      ...(oldData || {}),
      ...(changes || {}),
      corrected_at: new Date().toISOString(),
      corrected_by: req.user.id,
      corrected_by_name: actorName(req, 'Admin'),
      correction_reason: reason.trim(),
    };

    const updatedStage = await updateStageData(tripId, stage_name, {
      data: mergedData,
      status: (changes?.status as any) || undefined,
    });

    // Keep the figures the reports read in step with the corrected stage
    const tripPatch: Record<string, unknown> = {};
    if (stage_name === 'gross_weight' && changes?.gross_weight_kg != null) {
      const gross = Number(changes.gross_weight_kg);
      tripPatch.gross_weight_kg = gross;
      if (trip.tare_weight_kg != null) tripPatch.net_weight_kg = +(gross - Number(trip.tare_weight_kg)).toFixed(2);
    }
    if (stage_name === 'tare_weight' && changes?.tare_weight_kg != null) {
      const tare = Number(changes.tare_weight_kg);
      tripPatch.tare_weight_kg = tare;
      if (trip.gross_weight_kg != null) tripPatch.net_weight_kg = +(Number(trip.gross_weight_kg) - tare).toFixed(2);
    }
    if (stage_name === 'qc_completed') {
      if (changes?.received_fat_pct != null) tripPatch.received_fat_pct = Number(changes.received_fat_pct);
      if (changes?.received_snf_pct != null) tripPatch.received_snf_pct = Number(changes.received_snf_pct);
    }
    if (stage_name === 'unloaded' && changes?.unloaded_litres != null) {
      tripPatch.received_litres = Number(changes.unloaded_litres);
    }
    await updateTrip(tripId, tripPatch);
    if (['gross_weight', 'tare_weight', 'qc_completed', 'unloaded'].includes(stage_name)) {
      // A typed correction of the unloaded litres is respected; weights and QC quality re-derive the litres
      if (!(stage_name === 'unloaded' && changes?.unloaded_litres != null)) await applyWeightBasedLitres(tripId);
      await refreshAcknowledgements(tripId);
    }

    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      bmc_id: trip.bmc_id,
      entity_type: 'tanker_stage_correction',
      entity_id: `${tripId}_${stage_name}`,
      action: 'correct_stage',
      changes: {
        stage: stage_name,
        reason: reason.trim(),
        old_value: oldData,
        new_value: changes,
      },
      actor_id: req.user.id,
      actor_name: actorName(req, 'Admin'),
    });

    const [settings, updated] = await Promise.all([getZoneSettings(dairyUnitId), fetchTrip(dairyUnitId, tripId)]);

    res.json({
      message: 'Stage corrected successfully',
      updated_stage: updatedStage,
      trip: slimTankerForClient(enrichTankerRow(updated!.row, updated!.stages, settings)),
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /tanker/:id/remark — Admin adds remark or flags exception
router.post('/:id/remark', requireRole('admin'), async (req, res) => {
  try {
    const dairyUnitId = req.profile.dairy_unit_id;
    const { remark, is_exception } = req.body as {
      remark: string;
      is_exception?: boolean;
    };

    if (!remark || !remark.trim()) {
      res.status(400).json({ error: 'Remark content is required' });
      return;
    }

    const found = await fetchTrip(dairyUnitId, String(req.params.id));
    if (!found) {
      res.status(404).json({ error: 'Tanker trip not found' });
      return;
    }

    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      bmc_id: found.row.bmc_id,
      entity_type: 'tanker_dispatch',
      entity_id: found.row.id,
      action: is_exception ? 'mark_exception' : 'add_remark',
      changes: {
        remark: remark.trim(),
        is_exception: Boolean(is_exception),
      },
      actor_id: req.user.id,
      actor_name: actorName(req, 'Admin'),
    });

    res.json({ success: true, message: 'Remark recorded in audit log' });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/export/stage-wise — Export CSV with complete stage progression
router.get('/export/stage-wise', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const dairyUnitId = req.profile.dairy_unit_id;
    const settings = await getZoneSettings(dairyUnitId);
    const { rows, stages: stageMap } = await fetchTrips({
      dairyUnitId,
      from,
      to,
      bmcId: req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id,
    });


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

    const wb = XLSX.book_new();
    const ws = XLSX.json_to_sheet(exportRows);
    XLSX.book_append_sheet(wb, ws, 'Stage Progression');
    const csv = XLSX.sheet_to_csv(ws);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Tanker_Stage_Progression_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    sendError(res, err);
  }
});

// GET /tanker/export/pdf — PDF / Register format export
router.get('/export/pdf', async (req, res) => {
  try {
    const { from, to, bmc_id } = req.query as Record<string, string>;
    const dairyUnitId = req.profile.dairy_unit_id;
    const settings = await getZoneSettings(dairyUnitId);
    const { rows, stages: stageMap } = await fetchTrips({
      dairyUnitId,
      from,
      to,
      bmcId: req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id,
    });


    const enriched = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      return enrichTankerRow(r, stages, settings);
    });

    res.json({
      title: 'Aavin Dairy Plant - Daily Tanker Receipt & Journey Register',
      date: new Date().toISOString(),
      dairy_unit_id: dairyUnitId,
      tankers: enriched,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /tanker/:id/receive — Admin legacy endpoint maintained for compatibility
router.patch('/:id/receive', requireRole('admin'), async (req, res) => {
  try {
    const dairyUnitId = req.profile.dairy_unit_id;
    const { received_qty, received_fat_pct, received_snf_pct } = req.body as {
      received_qty?: number;
      receipt_time?: string;
      received_fat_pct?: number;
      received_snf_pct?: number;
    };

    if (received_qty == null || !Number.isFinite(Number(received_qty)) || Number(received_qty) < 0) {
      res.status(400).json({ error: 'Valid non-negative received_qty is required' });
      return;
    }

    const existing = await fetchTrip(dairyUnitId, String(req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Tanker dispatch record not found' });
      return;
    }
    const tripId = String(existing.row.id);

    const updateFields = {
      received_litres: +Number(received_qty).toFixed(2),
      received_fat_pct: received_fat_pct != null && String(received_fat_pct) !== '' ? +Number(received_fat_pct).toFixed(2) : null,
      received_snf_pct: received_snf_pct != null && String(received_snf_pct) !== '' ? +Number(received_snf_pct).toFixed(2) : null,
    };
    await updateTrip(tripId, updateFields);
    await refreshAcknowledgements(tripId);

    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      bmc_id: existing.row.bmc_id,
      entity_type: 'tanker_dispatch',
      entity_id: tripId,
      action: 'record_receipt',
      changes: updateFields,
      actor_id: req.user.id,
      actor_name: actorName(req, 'Admin'),
    });

    const [settings, updated] = await Promise.all([getZoneSettings(dairyUnitId), fetchTrip(dairyUnitId, tripId)]);
    res.json(slimTankerForClient(enrichTankerRow(updated!.row, updated!.stages, settings)));
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE /tanker/:id — admin removes a trip; a BMC removes its own loadings while the tanker is still loading
router.delete('/:id', requireRole('admin', 'bmc'), async (req, res) => {
  try {
    const result = await deleteTrip(
      req.profile.dairy_unit_id,
      String(req.params.id),
      req.profile.role === 'bmc' ? req.profile.bmc_id : null,
    );
    if (result === 'not_found') {
      res.status(404).json({ error: 'Tanker dispatch record not found' });
      return;
    }
    if (result === 'locked') {
      res.status(409).json({ error: 'This tanker has already reached the dairy unit and can no longer be changed' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
