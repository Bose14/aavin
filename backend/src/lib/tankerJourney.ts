import type { StageTimeLimits, ZoneSettings } from '../config/defaults';
import { DEFAULT_STAGE_TIME_LIMITS, DEFAULT_ASSUMPTIONS } from '../config/defaults';

export type TankerStageKey =
  | 'vehicle_entered'
  | 'gross_weight'
  | 'qc_completed'
  | 'unloaded'
  | 'tare_weight'
  | 'cip_completed'
  | 'vehicle_exit';

export type PlantTeam = 'gate' | 'qc' | 'unloading';

export type StageStepStatus = 'done' | 'current' | 'pending' | 'skipped' | 'rejected';

export type TripStatus =
  | 'on_the_way'
  | 'vehicle_entered'
  | 'gross_done'
  | 'qc_done'
  | 'unloaded'
  | 'tare_done'
  | 'cip_done'
  | 'cip_unsatisfied'
  | 'exited'
  | 'qc_rejected';

export interface StageDefinition {
  key: TankerStageKey;
  stepNumber: number;
  title: string;
  team: PlantTeam;
  teamLabel: string;
  defaultTimeLimitMin: number;
}

export const TANKER_STAGES: readonly StageDefinition[] = [
  { key: 'vehicle_entered', stepNumber: 1, title: 'Vehicle Entered', team: 'gate', teamLabel: 'Gate', defaultTimeLimitMin: 15 },
  { key: 'gross_weight', stepNumber: 2, title: 'Gross Weight', team: 'gate', teamLabel: 'Gate', defaultTimeLimitMin: 15 },
  { key: 'qc_completed', stepNumber: 3, title: 'QC Completed', team: 'qc', teamLabel: 'QC', defaultTimeLimitMin: 30 },
  { key: 'unloaded', stepNumber: 4, title: 'Unloaded', team: 'unloading', teamLabel: 'Unloading', defaultTimeLimitMin: 45 },
  { key: 'tare_weight', stepNumber: 5, title: 'Tare Weight', team: 'gate', teamLabel: 'Gate', defaultTimeLimitMin: 15 },
  { key: 'cip_completed', stepNumber: 6, title: 'CIP Completed', team: 'qc', teamLabel: 'QC', defaultTimeLimitMin: 30 },
  { key: 'vehicle_exit', stepNumber: 7, title: 'Vehicle Exit', team: 'gate', teamLabel: 'Gate', defaultTimeLimitMin: 15 },
] as const;

export const STAGE_COLORS: Record<TripStatus | 'on_the_way', {
  dot: string;
  badgeBg: string;
  badgeText: string;
  border: string;
  label: string;
}> = {
  on_the_way: { dot: '#94a3b8', badgeBg: '#f1f5f9', badgeText: '#475569', border: '#cbd5e1', label: 'On the way' },
  vehicle_entered: { dot: '#64748b', badgeBg: '#f8fafc', badgeText: '#334155', border: '#94a3b8', label: 'Vehicle Entered' },
  gross_done: { dot: '#eab308', badgeBg: '#fef9c3', badgeText: '#854d0e', border: '#eab308', label: 'Gross Done' },
  qc_done: { dot: '#f97316', badgeBg: '#ffedd5', badgeText: '#9a3412', border: '#f97316', label: 'QC Done' },
  unloaded: { dot: '#3b82f6', badgeBg: '#dbeafe', badgeText: '#1e40af', border: '#3b82f6', label: 'Unloaded' },
  tare_done: { dot: '#d97706', badgeBg: '#fffbeb', badgeText: '#b45309', border: '#fde68a', label: 'Tare Done' },
  cip_done: { dot: '#06b6d4', badgeBg: '#cffafe', badgeText: '#155e75', border: '#06b6d4', label: 'CIP Done' },
  cip_unsatisfied: { dot: '#d97706', badgeBg: '#fef3c7', badgeText: '#92400e', border: '#f59e0b', label: 'CIP Unsatisfied' },
  exited: { dot: '#22c55e', badgeBg: '#dcfce7', badgeText: '#166534', border: '#22c55e', label: 'Exited' },
  qc_rejected: { dot: '#ef4444', badgeBg: '#fee2e2', badgeText: '#991b1b', border: '#ef4444', label: 'QC Rejected' },
};

export interface StageRecordItem {
  stage_name: TankerStageKey;
  team: PlantTeam;
  status: 'done' | 'rejected' | 'skipped';
  stage_data?: Record<string, unknown>;
  done_by?: string | null;
  done_by_name?: string | null;
  done_at?: string;
}

export interface DerivedTimelineStep {
  key: TankerStageKey;
  stepNumber: number;
  title: string;
  team: PlantTeam;
  teamLabel: string;
  status: StageStepStatus;
  statusIcon: 'check' | 'clock' | 'circle' | 'cross' | 'skip';
  done_by?: string | null;
  done_by_name?: string | null;
  done_at?: string | null;
  timeSpentMin?: number | null;
  timeLimitMin: number;
  isOverLimit: boolean;
  waitingMinutes?: number | null;
  ariaLabel: string;
  keyDataSummary: string;
  data: Record<string, unknown>;
  rejectionReason?: string | null;
}

export interface AutoFlagBadge {
  id: string;
  type: 'transit_loss' | 'net_weight_diff' | 'quality_drop';
  label: string;
  description: string;
  tone: 'amber' | 'red';
}

export interface CompartmentDetail {
  compartment_no: number;
  compartment_name: string;
  quantity_litres: number;
  capacity_litres?: number | null;
  fat_pct?: number | null;
  snf_pct?: number | null;
  dipstick_cm?: number | null;
  seal_number?: string | null;
  milk_type?: string | null;
  temperature?: number | null;
}

export interface DerivedTankerJourney {
  tripStatus: TripStatus;
  tripStatusLabel: string;
  stageColor: typeof STAGE_COLORS['on_the_way'];
  currentStageIndex: number; // 0 to 6, or -1 if on the way, 7 if exited
  currentStageKey: TankerStageKey | null;
  currentStageTitle: string;
  waitingTeam: PlantTeam | 'transit' | null;
  waitingTeamLabel: string;
  waitingSinceMinutes: number;
  isOverLimit: boolean;
  isQcRejected: boolean;
  qcRejectionReason: string | null;
  timelineSteps: DerivedTimelineStep[];
  completedStepsCount: number;
  completedStageKeys: TankerStageKey[];
  compartments?: CompartmentDetail[];
  calculated: {
    gross_weight_kg: number | null;
    tare_weight_kg: number | null;
    net_weight_kg: number | null;
    net_litres: number | null;
    dispatched_litres: number;
    received_litres: number | null;
    transit_loss_litres: number | null;
    transit_loss_pct: number | null;
    total_turnaround_min: number | null;
    density: number;
  };
  autoFlags: AutoFlagBadge[];
}

export interface TankerTripInput {
  id: string;
  date: string;
  tanker_number: string;
  driver_name?: string | null;
  seal_number?: string | null;
  dispatch_time?: string | null;
  quantity_dispatched: number;
  destination?: string | null;
  dispatch_fat_pct?: number | null;
  dispatch_snf_pct?: number | null;
  received_qty?: number | null;
  receipt_time?: string | null;
  received_fat_pct?: number | null;
  received_snf_pct?: number | null;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  net_weight_kg?: number | null;
  unloaded_litres?: number | null;
  compartments?: CompartmentDetail[];
  trip_status?: TripStatus;
  stage_data?: Record<string, unknown>;
  stages?: StageRecordItem[];
  created_at?: string;
  [key: string]: unknown;
}

/**
 * Calculates net weight, net litres, transit loss, and turnaround.
 */
export function calculateTankerMetrics(params: {
  dispatchedLitres: number;
  grossWeightKg?: number | null;
  tareWeightKg?: number | null;
  unloadedLitres?: number | null;
  fallbackReceivedQty?: number | null;
  density?: number;
  entryDoneAt?: string | null;
  exitDoneAt?: string | null;
}) {
  const density = params.density && params.density > 0 ? params.density : DEFAULT_ASSUMPTIONS.milkDensityKgPerLitre;
  const gross = params.grossWeightKg != null ? Number(params.grossWeightKg) : null;
  const tare = params.tareWeightKg != null ? Number(params.tareWeightKg) : null;
  const netWeightKg = gross != null && tare != null ? +(gross - tare).toFixed(2) : null;
  const netLitres = netWeightKg != null ? +(netWeightKg / density).toFixed(2) : null;

  const dispatched = Number(params.dispatchedLitres || 0);
  const receivedLitres = params.unloadedLitres != null
    ? Number(params.unloadedLitres)
    : netLitres != null
    ? netLitres
    : params.fallbackReceivedQty != null
    ? Number(params.fallbackReceivedQty)
    : null;

  const transitLossLitres = receivedLitres != null ? +(dispatched - receivedLitres).toFixed(2) : null;
  const transitLossPct = receivedLitres != null && dispatched > 0
    ? +(((dispatched - receivedLitres) / dispatched) * 100).toFixed(2)
    : null;

  let totalTurnaroundMin: number | null = null;
  if (params.entryDoneAt && params.exitDoneAt) {
    const startMs = new Date(params.entryDoneAt).getTime();
    const endMs = new Date(params.exitDoneAt).getTime();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      totalTurnaroundMin = Math.round((endMs - startMs) / 60000);
    }
  }

  return {
    gross_weight_kg: gross,
    tare_weight_kg: tare,
    net_weight_kg: netWeightKg,
    net_litres: netLitres,
    dispatched_litres: dispatched,
    received_litres: receivedLitres,
    transit_loss_litres: transitLossLitres,
    transit_loss_pct: transitLossPct,
    total_turnaround_min: totalTurnaroundMin,
    density,
  };
}

/**
 * Derives the strict 7-stage tanker timeline and pipeline status.
 * Single source of truth for Admin Table, Drawer, Form Steppers, and Unit view.
 */
export function deriveTankerJourneyState(
  trip: TankerTripInput,
  settings?: Partial<ZoneSettings>,
  nowMs: number = Date.now(),
): DerivedTankerJourney {
  const stageLimits: StageTimeLimits = {
    ...DEFAULT_STAGE_TIME_LIMITS,
    ...(settings?.stage_time_limits_min || {}),
  };

  const density = settings?.milk_density_kg_per_litre || DEFAULT_ASSUMPTIONS.milkDensityKgPerLitre;
  const transitWarnPct = settings?.transit_loss_warn_pct ?? DEFAULT_ASSUMPTIONS.transitLossWarnPct;
  const transitDangerPct = settings?.transit_loss_danger_pct ?? DEFAULT_ASSUMPTIONS.transitLossDangerPct;
  const netWeightDiffThresh = settings?.net_weight_diff_threshold_kg ?? DEFAULT_ASSUMPTIONS.netWeightDiffThresholdKg;
  const fatDropThresh = settings?.quality_drop_threshold_fat ?? DEFAULT_ASSUMPTIONS.qualityDropThresholdFat;
  const snfDropThresh = settings?.quality_drop_threshold_snf ?? DEFAULT_ASSUMPTIONS.qualityDropThresholdSnf;

  // Extract stage records from trip.stages or from trip.stage_data map
  const stageRecordMap = new Map<TankerStageKey, StageRecordItem>();
  if (Array.isArray(trip.stages)) {
    for (const st of trip.stages) {
      if (st && st.stage_name) stageRecordMap.set(st.stage_name, st);
    }
  }

  if (trip.stage_data && typeof trip.stage_data === 'object') {
    for (const [k, v] of Object.entries(trip.stage_data)) {
      const stageKey = k as TankerStageKey;
      if (!stageRecordMap.has(stageKey) && v && typeof v === 'object') {
        const obj = v as Record<string, unknown>;
        stageRecordMap.set(stageKey, {
          stage_name: stageKey,
          team: (obj.team as PlantTeam) || 'gate',
          status: (obj.status as 'done' | 'rejected' | 'skipped') || 'done',
          stage_data: obj,
          done_by: typeof obj.done_by === 'string' ? obj.done_by : null,
          done_by_name: typeof obj.done_by_name === 'string' ? obj.done_by_name : null,
          done_at: typeof obj.done_at === 'string' ? obj.done_at : undefined,
        });
      }
    }
  }

  // Also check top-level columns on trip for backwards compatibility
  if (!stageRecordMap.has('vehicle_entered') && (trip.gate_pass_no || trip.receipt_time || trip.driver_name)) {
    if (trip.trip_status && trip.trip_status !== 'on_the_way') {
      stageRecordMap.set('vehicle_entered', {
        stage_name: 'vehicle_entered',
        team: 'gate',
        status: 'done',
        done_at: trip.created_at,
        done_by_name: 'Gate Staff',
      });
    }
  }
  if (!stageRecordMap.has('gross_weight') && trip.gross_weight_kg != null) {
    stageRecordMap.set('gross_weight', {
      stage_name: 'gross_weight',
      team: 'gate',
      status: 'done',
      stage_data: { gross_weight_kg: trip.gross_weight_kg, ticket_no: trip.weighbridge_gross_ticket },
    });
  }
  if (!stageRecordMap.has('qc_completed') && (trip.received_fat_pct != null || trip.qc_status)) {
    stageRecordMap.set('qc_completed', {
      stage_name: 'qc_completed',
      team: 'qc',
      status: trip.qc_status === 'rejected' ? 'rejected' : 'done',
      stage_data: {
        fat_pct: trip.received_fat_pct,
        snf_pct: trip.received_snf_pct,
        qc_status: trip.qc_status || 'accepted',
        rejection_reason: trip.qc_rejection_reason,
      },
    });
  }
  if (!stageRecordMap.has('unloaded') && (trip.unloaded_litres != null || trip.received_qty != null)) {
    stageRecordMap.set('unloaded', {
      stage_name: 'unloaded',
      team: 'unloading',
      status: 'done',
      stage_data: { unloaded_litres: trip.unloaded_litres ?? trip.received_qty, bay: trip.unloading_bay },
    });
  }
  if (!stageRecordMap.has('tare_weight') && trip.tare_weight_kg != null) {
    stageRecordMap.set('tare_weight', {
      stage_name: 'tare_weight',
      team: 'gate',
      status: 'done',
      stage_data: { tare_weight_kg: trip.tare_weight_kg, ticket_no: trip.weighbridge_tare_ticket },
    });
  }
  if (!stageRecordMap.has('cip_completed') && trip.cip_status != null) {
    const isUnsat = trip.cip_status === 'unsatisfied' || trip.cip_status === 'fail';
    stageRecordMap.set('cip_completed', {
      stage_name: 'cip_completed',
      team: 'qc',
      status: isUnsat ? 'rejected' : 'done',
      stage_data: { cip_status: trip.cip_status },
    });
  }
  if (!stageRecordMap.has('vehicle_exit') && (trip.exit_gate_pass_no || trip.trip_status === 'exited')) {
    stageRecordMap.set('vehicle_exit', {
      stage_name: 'vehicle_exit',
      team: 'gate',
      status: 'done',
      stage_data: { exit_gate_pass_no: trip.exit_gate_pass_no },
    });
  }

  // Check QC status
  const qcRec = stageRecordMap.get('qc_completed');
  const isQcRejected = qcRec?.status === 'rejected' || (qcRec?.stage_data?.qc_status === 'rejected') || trip.qc_status === 'rejected';
  const qcRejectionReason = (qcRec?.stage_data?.rejection_reason as string) || (trip.qc_rejection_reason as string) || null;

  // Derive steps in order
  const timelineSteps: DerivedTimelineStep[] = [];
  let foundCurrent = false;
  let lastCompletedDoneAt: string | null = null;
  let activeWaitingSinceMinutes = 0;
  let activeIsOverLimit = false;
  let currentStageKey: TankerStageKey | null = null;
  let currentStageTitle = 'On the way';
  let waitingTeam: PlantTeam | 'transit' | null = 'transit';
  let tripStatus: TripStatus = 'on_the_way';
  let completedCount = 0;

  // If vehicle has not entered at all
  const vehicleEnteredRec = stageRecordMap.get('vehicle_entered');
  const hasEntered = vehicleEnteredRec && vehicleEnteredRec.status !== 'skipped';

  if (!hasEntered) {
    tripStatus = 'on_the_way';
    waitingTeam = 'gate';
    currentStageKey = 'vehicle_entered';
    currentStageTitle = 'Waiting for Gate entry';
    const dispatchTimeMs = trip.created_at ? new Date(trip.created_at).getTime() : nowMs;
    activeWaitingSinceMinutes = Math.max(0, Math.floor((nowMs - dispatchTimeMs) / 60000));
    activeIsOverLimit = activeWaitingSinceMinutes > stageLimits.vehicle_entered;
  }

  for (let i = 0; i < TANKER_STAGES.length; i++) {
    const def = TANKER_STAGES[i];
    const rec = stageRecordMap.get(def.key);
    const limit = stageLimits[def.key] ?? def.defaultTimeLimitMin;

    if (!hasEntered) {
      // All steps are pending, except vehicle_entered is current waiting step
      if (def.key === 'vehicle_entered') {
        timelineSteps.push({
          key: def.key,
          stepNumber: def.stepNumber,
          title: def.title,
          team: def.team,
          teamLabel: def.teamLabel,
          status: 'current',
          statusIcon: 'clock',
          timeLimitMin: limit,
          isOverLimit: activeIsOverLimit,
          waitingMinutes: activeWaitingSinceMinutes,
          ariaLabel: `${def.title}, current step, waiting for ${def.teamLabel} team for ${activeWaitingSinceMinutes} minutes`,
          keyDataSummary: `Waiting for ${def.teamLabel} team · ${activeWaitingSinceMinutes}m`,
          data: {},
        });
      } else {
        timelineSteps.push({
          key: def.key,
          stepNumber: def.stepNumber,
          title: def.title,
          team: def.team,
          teamLabel: def.teamLabel,
          status: 'pending',
          statusIcon: 'circle',
          timeLimitMin: limit,
          isOverLimit: false,
          ariaLabel: `${def.title}, pending`,
          keyDataSummary: 'Pending',
          data: {},
        });
      }
      continue;
    }

    // Special rule: if QC Rejected and current stage is 'unloaded', skip it!
    if (def.key === 'unloaded' && isQcRejected) {
      timelineSteps.push({
        key: def.key,
        stepNumber: def.stepNumber,
        title: def.title,
        team: def.team,
        teamLabel: def.teamLabel,
        status: 'skipped',
        statusIcon: 'skip',
        timeLimitMin: limit,
        isOverLimit: false,
        ariaLabel: `${def.title}, skipped due to QC rejection`,
        keyDataSummary: 'Skipped (QC rejected)',
        data: rec?.stage_data || {},
      });
      continue;
    }

    if (rec && (rec.status === 'done' || (rec.status as string) === 'rejected')) {
      const isRejectStep =
        (def.key === 'qc_completed' && isQcRejected) ||
        (def.key === 'cip_completed' && (rec.status === 'rejected' || (rec.stage_data?.cip_status as string) === 'unsatisfied' || trip.cip_status === 'unsatisfied'));
      if (!isRejectStep || def.key === 'qc_completed') {
        completedCount++;
      }
      const doneAtStr = rec.done_at || trip.created_at || new Date(nowMs).toISOString();

      let timeSpentMin: number | null = null;
      if (lastCompletedDoneAt) {
        const prevMs = new Date(lastCompletedDoneAt).getTime();
        const currMs = new Date(doneAtStr).getTime();
        if (Number.isFinite(prevMs) && Number.isFinite(currMs) && currMs >= prevMs) {
          timeSpentMin = Math.round((currMs - prevMs) / 60000);
        }
      }
      lastCompletedDoneAt = doneAtStr;

      // Extract key summary line
      let summary = '';
      const d = rec.stage_data || {};
      if (def.key === 'vehicle_entered') {
        const tNo = (d.tanker_number as string) || trip.tanker_number;
        const drv = (d.driver_name as string) || trip.driver_name || 'Driver';
        const seal = (d.seal_number as string) || trip.seal_number || 'Seal OK';
        const dc = (d.dc_number as string) || (trip.dc_number as string) || (trip.stage_data as any)?.dc_number || '';
        summary = `${tNo}${dc ? ` · DC #${dc}` : ''} · ${drv} · ${seal}`;
      } else if (def.key === 'gross_weight') {
        const kg = d.gross_weight_kg ?? trip.gross_weight_kg;
        const ticket = (d.ticket_no as string) || trip.weighbridge_gross_ticket || '';
        summary = `${kg ? `${Number(kg).toLocaleString('en-IN')} kg` : 'Gross Done'}${ticket ? ` · Ticket #${ticket}` : ''}`;
      } else if (def.key === 'qc_completed') {
        if (isRejectStep) {
          summary = `REJECTED: ${qcRejectionReason || 'Failed quality threshold'}`;
        } else {
          const fat = d.fat_pct ?? trip.received_fat_pct;
          const snf = d.snf_pct ?? trip.received_snf_pct;
          summary = `Fat ${fat != null ? Number(fat).toFixed(2) : '-'}% · SNF ${snf != null ? Number(snf).toFixed(2) : '-'}% · Accepted`;
        }
      } else if (def.key === 'unloaded') {
        const ltr = d.unloaded_litres ?? trip.unloaded_litres ?? trip.received_qty;
        const bay = (d.bay as string) || trip.unloading_bay || 'Silo 1';
        summary = `${ltr ? `${Number(ltr).toLocaleString('en-IN')} L` : 'Unloaded'} · ${bay}`;
      } else if (def.key === 'tare_weight') {
        const tare = d.tare_weight_kg ?? trip.tare_weight_kg;
        const gross = trip.gross_weight_kg;
        const net = gross != null && tare != null ? Number(gross) - Number(tare) : null;
        summary = `Tare ${tare ? `${Number(tare).toLocaleString('en-IN')} kg` : '-'} · Net ${net ? `${Number(net).toLocaleString('en-IN')} kg` : '-'}`;
      } else if (def.key === 'cip_completed') {
        const isCipUnsat = rec.status === 'rejected' || (d.cip_status as string) === 'unsatisfied' || trip.cip_status === 'unsatisfied';
        const st = isCipUnsat ? 'Unsatisfied (Re-cleaning required)' : (d.cip_status as string) || trip.cip_status || 'Pass';
        summary = `CIP Sanitization: ${st}`;
      } else if (def.key === 'vehicle_exit') {
        const pass = (d.exit_gate_pass_no as string) || trip.exit_gate_pass_no || '';
        summary = `Exit Cleared${pass ? ` · Pass #${pass}` : ''}`;
      }

      timelineSteps.push({
        key: def.key,
        stepNumber: def.stepNumber,
        title: def.title,
        team: def.team,
        teamLabel: def.teamLabel,
        status: isRejectStep ? 'rejected' : 'done',
        statusIcon: isRejectStep ? 'cross' : 'check',
        done_by: rec.done_by,
        done_by_name: rec.done_by_name || 'Plant Staff',
        done_at: doneAtStr,
        timeSpentMin,
        timeLimitMin: limit,
        isOverLimit: timeSpentMin != null && timeSpentMin > limit,
        ariaLabel: `${def.title}, completed on ${doneAtStr} by ${rec.done_by_name || 'staff'}. ${summary}`,
        keyDataSummary: summary,
        data: d,
        rejectionReason: isRejectStep ? qcRejectionReason : undefined,
      });

      // Update derived tripStatus based on latest completed step
      if (def.key === 'vehicle_entered') tripStatus = 'vehicle_entered';
      else if (def.key === 'gross_weight') tripStatus = 'gross_done';
      else if (def.key === 'qc_completed') tripStatus = isRejectStep ? 'qc_rejected' : 'qc_done';
      else if (def.key === 'unloaded') tripStatus = 'unloaded';
      else if (def.key === 'tare_weight') tripStatus = 'tare_done';
      else if (def.key === 'cip_completed') tripStatus = isRejectStep ? 'cip_unsatisfied' : 'cip_done';
      else if (def.key === 'vehicle_exit') tripStatus = 'exited';
    } else if (!foundCurrent) {
      // First uncompleted stage is the CURRENT active waiting step
      foundCurrent = true;
      currentStageKey = def.key;
      currentStageTitle = def.title;
      waitingTeam = def.team;

      const baseTimeMs = lastCompletedDoneAt ? new Date(lastCompletedDoneAt).getTime() : (trip.created_at ? new Date(trip.created_at).getTime() : nowMs);
      activeWaitingSinceMinutes = Math.max(0, Math.floor((nowMs - baseTimeMs) / 60000));
      activeIsOverLimit = activeWaitingSinceMinutes > limit;

      timelineSteps.push({
        key: def.key,
        stepNumber: def.stepNumber,
        title: def.title,
        team: def.team,
        teamLabel: def.teamLabel,
        status: 'current',
        statusIcon: 'clock',
        timeLimitMin: limit,
        isOverLimit: activeIsOverLimit,
        waitingMinutes: activeWaitingSinceMinutes,
        ariaLabel: `${def.title}, current stage, waiting for ${def.teamLabel} team for ${activeWaitingSinceMinutes} minutes`,
        keyDataSummary: `Waiting for ${def.teamLabel} team · ${activeWaitingSinceMinutes}m`,
        data: {},
      });
    } else {
      // Future stage is pending
      timelineSteps.push({
        key: def.key,
        stepNumber: def.stepNumber,
        title: def.title,
        team: def.team,
        teamLabel: def.teamLabel,
        status: 'pending',
        statusIcon: 'circle',
        timeLimitMin: limit,
        isOverLimit: false,
        ariaLabel: `${def.title}, pending`,
        keyDataSummary: 'Pending',
        data: {},
      });
    }
  }

  if (!foundCurrent && hasEntered) {
    // All steps completed!
    tripStatus = 'exited';
    waitingTeam = null;
    currentStageKey = null;
    currentStageTitle = 'Completed / Exited';
    activeWaitingSinceMinutes = 0;
    activeIsOverLimit = false;
  }

  // Calculate metrics
  const entryStep = timelineSteps.find(s => s.key === 'vehicle_entered' && s.status === 'done');
  const exitStep = timelineSteps.find(s => s.key === 'vehicle_exit' && s.status === 'done');
  const grossStep = timelineSteps.find(s => s.key === 'gross_weight');
  const tareStep = timelineSteps.find(s => s.key === 'tare_weight');
  const unloadStep = timelineSteps.find(s => s.key === 'unloaded');

  const calculated = calculateTankerMetrics({
    dispatchedLitres: trip.quantity_dispatched,
    grossWeightKg: (grossStep?.data?.gross_weight_kg as number | undefined) ?? (trip.gross_weight_kg != null ? Number(trip.gross_weight_kg) : null),
    tareWeightKg: (tareStep?.data?.tare_weight_kg as number | undefined) ?? (trip.tare_weight_kg != null ? Number(trip.tare_weight_kg) : null),
    unloadedLitres: (unloadStep?.data?.unloaded_litres as number | undefined) ?? (trip.unloaded_litres != null ? Number(trip.unloaded_litres) : null),
    fallbackReceivedQty: trip.received_qty != null ? Number(trip.received_qty) : null,
    density,
    entryDoneAt: entryStep?.done_at,
    exitDoneAt: exitStep?.done_at,
  });

  // Calculate auto-flags (mismatch detection)
  const autoFlags: AutoFlagBadge[] = [];

  // Flag 1: Transit loss above threshold
  if (calculated.transit_loss_pct != null) {
    if (calculated.transit_loss_pct >= transitDangerPct) {
      autoFlags.push({
        id: 'loss_danger',
        type: 'transit_loss',
        label: `High Transit Loss (${calculated.transit_loss_pct.toFixed(1)}%)`,
        description: `Transit loss of ${calculated.transit_loss_litres?.toFixed(1)} L exceeds red threshold (${transitDangerPct}%).`,
        tone: 'red',
      });
    } else if (calculated.transit_loss_pct >= transitWarnPct) {
      autoFlags.push({
        id: 'loss_warn',
        type: 'transit_loss',
        label: `Transit Loss (${calculated.transit_loss_pct.toFixed(1)}%)`,
        description: `Transit loss of ${calculated.transit_loss_litres?.toFixed(1)} L exceeds warning threshold (${transitWarnPct}%).`,
        tone: 'amber',
      });
    }
  }

  // Flag 2: Net weight differs from dispatched quantity beyond threshold
  if (calculated.net_litres != null && calculated.dispatched_litres > 0) {
    const diffLitres = Math.abs(calculated.dispatched_litres - calculated.net_litres);
    const diffKg = diffLitres * density;
    if (diffKg >= netWeightDiffThresh) {
      autoFlags.push({
        id: 'net_weight_mismatch',
        type: 'net_weight_diff',
        label: `Weight Discrepancy (Δ ${diffKg.toFixed(0)} kg)`,
        description: `Plant net weight (${calculated.net_litres.toFixed(1)} L) differs from dispatched quantity (${calculated.dispatched_litres.toFixed(1)} L) by ${diffKg.toFixed(1)} kg (limit: ${netWeightDiffThresh} kg).`,
        tone: 'amber',
      });
    }
  }

  // Flag 3: Quality drop at plant vs unit dispatch
  const qcStep = timelineSteps.find(s => s.key === 'qc_completed');
  const plantFat = (qcStep?.data?.fat_pct as number) ?? trip.received_fat_pct;
  const plantSnf = (qcStep?.data?.snf_pct as number) ?? trip.received_snf_pct;
  const unitFat = trip.dispatch_fat_pct;
  const unitSnf = trip.dispatch_snf_pct;

  if (plantFat != null && unitFat != null && (unitFat - plantFat) >= fatDropThresh) {
    const fatDrop = unitFat - plantFat;
    autoFlags.push({
      id: 'fat_drop',
      type: 'quality_drop',
      label: `Fat Drop (-${fatDrop.toFixed(2)}%)`,
      description: `Plant Fat (${plantFat.toFixed(2)}%) dropped below dispatch Fat (${unitFat.toFixed(2)}%) by ${fatDrop.toFixed(2)}% (limit: ${fatDropThresh.toFixed(2)}%).`,
      tone: 'amber',
    });
  }

  if (plantSnf != null && unitSnf != null && (unitSnf - plantSnf) >= snfDropThresh) {
    const snfDrop = unitSnf - plantSnf;
    autoFlags.push({
      id: 'snf_drop',
      type: 'quality_drop',
      label: `SNF Drop (-${snfDrop.toFixed(2)}%)`,
      description: `Plant SNF (${plantSnf.toFixed(2)}%) dropped below dispatch SNF (${unitSnf.toFixed(2)}%) by ${snfDrop.toFixed(2)}% (limit: ${snfDropThresh.toFixed(2)}%).`,
      tone: 'amber',
    });
  }

  const stageColor = STAGE_COLORS[tripStatus] || STAGE_COLORS.on_the_way;
  const waitingTeamLabel = waitingTeam === 'gate' ? 'Gate' : waitingTeam === 'qc' ? 'QC Lab' : waitingTeam === 'unloading' ? 'Unloading' : waitingTeam === 'transit' ? 'On the way' : 'None';

  const currentIdx = TANKER_STAGES.findIndex(s => s.key === currentStageKey);

  const compartments =
    (trip.compartments as CompartmentDetail[]) ||
    ((trip.stage_data as any)?.compartments as CompartmentDetail[]) ||
    ((trip.stage_data as any)?.vehicle_entered?.compartments as CompartmentDetail[]) ||
    [];

  return {
    tripStatus,
    tripStatusLabel: stageColor.label,
    stageColor,
    currentStageIndex: currentIdx,
    currentStageKey,
    currentStageTitle,
    waitingTeam,
    waitingTeamLabel,
    waitingSinceMinutes: activeWaitingSinceMinutes,
    isOverLimit: activeIsOverLimit,
    isQcRejected,
    qcRejectionReason,
    timelineSteps,
    completedStepsCount: completedCount,
    completedStageKeys: timelineSteps
      .filter((s) => s.status === 'done' || (s.status === 'rejected' && s.key === 'qc_completed'))
      .map((s) => s.key as TankerStageKey),
    compartments: compartments.length > 0 ? compartments : undefined,
    calculated,
    autoFlags,
  };
}
