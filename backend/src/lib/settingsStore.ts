import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { supabase } from '../supabase';
import {
  DEFAULT_ASSUMPTIONS,
  buildDefaultZoneSettings,
} from '../config/defaults';
import type { SellingRateRule, ZoneSettings } from '../config/defaults';

export interface AuditLogEntry {
  id: string;
  zone_id: string;
  bmc_id?: string | null;
  entity_type: string;
  entity_id?: string | null;
  action: string;
  changes: Record<string, unknown>;
  actor_id?: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface CorrectionRequest {
  id: string;
  milk_entry_id: string;
  zone_id: string;
  bmc_id: string;
  requested_by?: string | null;
  requested_by_name?: string | null;
  reason: string;
  proposed_changes: Record<string, unknown>;
  status: 'pending' | 'resolved' | 'rejected';
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at: string;
}

export interface TeamRow {
  id: string;
  id_token: string;
  code: 'ADMIN' | 'GATE' | 'QC' | 'UNLOADING' | 'BMC';
  name: string;
  active: boolean;
  created_at?: string;
}

export interface TankerDispatchMetadata {
  id: string;
  tanker_number: string;
  bmc_id?: string | null;
  zone_id?: string | null;
  date?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  dc_number?: string | null;
  seal_number?: string | null;
  dispatch_time?: string | null;
  dispatch_ampm?: string | null;
  dispatch_fat_pct?: number | null;
  dispatch_snf_pct?: number | null;
  quantity_dispatched?: number | null;
  destination?: string | null;
  compartments?: any[];
  stage_data?: Record<string, any>;
  created_at?: string;
  gross_weight_kg?: number | null;
  tare_weight_kg?: number | null;
  qc_status?: string | null;
  received_qty?: number | null;
  received_fat_pct?: number | null;
  received_snf_pct?: number | null;
  trip_status?: string | null;
  [key: string]: any;
}

interface FallbackStoreData {
  zoneSettings: Record<string, ZoneSettings>;
  sellingRates: Record<string, SellingRateRule[]>;
  auditLogs: AuditLogEntry[];
  correctionRequests: CorrectionRequest[];
  tankerStages: Record<string, any[]>;
  tankerDispatches?: Record<string, TankerDispatchMetadata>;
  tankerDispatchesByNumber?: Record<string, TankerDispatchMetadata>;
  registeredTankers?: Record<string, RegisteredTanker>;
}

const FALLBACK_DIR = path.resolve(__dirname, '../../.data');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'ux_fallback.json');

export function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST100' ||
    code === 'PGRST200' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache') ||
    msg.includes('column') ||
    msg.includes('relation') ||
    msg.includes('table')
  );
}

export function readFallback(): FallbackStoreData {
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')) as Partial<FallbackStoreData>;
      return {
        zoneSettings: parsed.zoneSettings ?? {},
        sellingRates: parsed.sellingRates ?? {},
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        correctionRequests: Array.isArray(parsed.correctionRequests) ? parsed.correctionRequests : [],
        tankerStages: parsed.tankerStages && typeof parsed.tankerStages === 'object' ? parsed.tankerStages : {},
        tankerDispatches: parsed.tankerDispatches && typeof parsed.tankerDispatches === 'object' ? parsed.tankerDispatches : {},
        tankerDispatchesByNumber: parsed.tankerDispatchesByNumber && typeof parsed.tankerDispatchesByNumber === 'object' ? parsed.tankerDispatchesByNumber : {},
        registeredTankers: parsed.registeredTankers && typeof parsed.registeredTankers === 'object' ? parsed.registeredTankers : {},
      };
    }
  } catch {
    // Corrupted fallback ignored; return empty store
  }
  return {
    zoneSettings: {},
    sellingRates: {},
    auditLogs: [],
    correctionRequests: [],
    tankerStages: {},
    tankerDispatches: {},
    tankerDispatchesByNumber: {},
    registeredTankers: {},
  };
}

function writeFallback(data: FallbackStoreData): void {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function saveTankerDispatchMetadata(meta: TankerDispatchMetadata): void {
  try {
    const store = readFallback();
    if (!store.tankerDispatches) store.tankerDispatches = {};
    if (!store.tankerDispatchesByNumber) store.tankerDispatchesByNumber = {};

    const idKey = meta.id || '';
    const numKey = meta.tanker_number ? meta.tanker_number.toUpperCase().trim() : '';

    const existing: any = (idKey ? store.tankerDispatches[idKey] : null) || (numKey ? store.tankerDispatchesByNumber[numKey] : null) || {};

    const cleanMeta: Record<string, any> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) {
        if (k === 'tanker_number') {
          if (typeof v === 'string' && v.trim() !== '') {
            cleanMeta[k] = v.trim().toUpperCase();
          }
        } else {
          cleanMeta[k] = v;
        }
      }
    }

    const merged: TankerDispatchMetadata = {
      ...existing,
      ...cleanMeta,
      tanker_number: cleanMeta.tanker_number || existing.tanker_number || numKey || '',
      stage_data: {
        ...(existing.stage_data || {}),
        ...(meta.stage_data || {}),
      },
    };

    const finalNumKey = (merged.tanker_number || '').toUpperCase().trim();

    if (idKey) store.tankerDispatches[idKey] = merged;
    if (finalNumKey) store.tankerDispatchesByNumber[finalNumKey] = merged;

    writeFallback(store);
  } catch (err) {
    console.warn('[settingsStore] Could not save tanker fallback metadata:', err);
  }
}

export function getTankerDispatchMetadata(idOrNumber: string): TankerDispatchMetadata | null {
  try {
    if (!idOrNumber) return null;
    const store = readFallback();
    const idHit = store.tankerDispatches?.[idOrNumber];
    if (idHit) return idHit;
    const numHit = store.tankerDispatchesByNumber?.[idOrNumber.toUpperCase().trim()];
    if (numHit) return numHit;
    return null;
  } catch {
    return null;
  }
}

export async function getZoneSettings(zoneId: string): Promise<ZoneSettings> {
  const defaults = buildDefaultZoneSettings(zoneId);
  try {
    const { data, error } = await supabase
      .from('zone_settings')
      .select('*')
      .eq('zone_id', zoneId)
      .maybeSingle();

    if (error) {
      const store = readFallback();
      return { ...defaults, ...(store.zoneSettings[zoneId] ?? {}) };
    }

    if (!data) {
      const store = readFallback();
      return { ...defaults, ...(store.zoneSettings[zoneId] ?? {}) };
    }

    return {
      zone_id: zoneId,
      fat_min: Number(data.fat_min ?? defaults.fat_min),
      fat_max: Number(data.fat_max ?? defaults.fat_max),
      fat_benchmark: Number(data.fat_benchmark ?? defaults.fat_benchmark),
      snf_min: Number(data.snf_min ?? defaults.snf_min),
      snf_max: Number(data.snf_max ?? defaults.snf_max),
      snf_benchmark: Number(data.snf_benchmark ?? defaults.snf_benchmark),
      rejection_warn_pct: Number(data.rejection_warn_pct ?? defaults.rejection_warn_pct),
      rejection_danger_pct: Number(data.rejection_danger_pct ?? defaults.rejection_danger_pct),
      rate_base: Number(data.rate_base ?? defaults.rate_base),
      rate_fat_coeff: Number(data.rate_fat_coeff ?? defaults.rate_fat_coeff),
      rate_snf_coeff: Number(data.rate_snf_coeff ?? defaults.rate_snf_coeff),
      rejection_payment_rule: (data.rejection_payment_rule === 'gross' ? 'gross' : 'net'),
      edit_lock_hours: Number(data.edit_lock_hours ?? defaults.edit_lock_hours),
      show_unit_profit: Boolean(data.show_unit_profit),
      destinations: Array.isArray(data.destinations) ? data.destinations : defaults.destinations,
      locations: Array.isArray(data.locations) ? data.locations : defaults.locations,
      stage_time_limits_min: data.stage_time_limits_min ?? defaults.stage_time_limits_min,
      transit_loss_warn_pct: Number(data.transit_loss_warn_pct ?? defaults.transit_loss_warn_pct),
      transit_loss_danger_pct: Number(data.transit_loss_danger_pct ?? defaults.transit_loss_danger_pct),
      net_weight_diff_threshold_kg: Number(data.net_weight_diff_threshold_kg ?? defaults.net_weight_diff_threshold_kg),
      quality_drop_threshold_fat: Number(data.quality_drop_threshold_fat ?? defaults.quality_drop_threshold_fat),
      quality_drop_threshold_snf: Number(data.quality_drop_threshold_snf ?? defaults.quality_drop_threshold_snf),
      milk_density_kg_per_litre: Number(data.milk_density_kg_per_litre ?? defaults.milk_density_kg_per_litre),
      auto_refresh_interval_sec: Number(data.auto_refresh_interval_sec ?? defaults.auto_refresh_interval_sec),
      updated_at: data.updated_at,
    };
  } catch {
    const store = readFallback();
    return { ...defaults, ...(store.zoneSettings[zoneId] ?? {}) };
  }
}

export async function saveZoneSettings(zoneId: string, patch: Partial<ZoneSettings>): Promise<ZoneSettings> {
  const current = await getZoneSettings(zoneId);
  const next: ZoneSettings = {
    ...current,
    ...patch,
    zone_id: zoneId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from('zone_settings')
      .upsert(next, { onConflict: 'zone_id' });

    if (error) {
      const store = readFallback();
      store.zoneSettings[zoneId] = next;
      writeFallback(store);
      return next;
    }
  } catch {
    const store = readFallback();
    store.zoneSettings[zoneId] = next;
    writeFallback(store);
    return next;
  }
  return next;
}

export async function getSellingRateHistory(zoneId: string): Promise<SellingRateRule[]> {
  const defaultRule: SellingRateRule = {
    id: 'default',
    zone_id: zoneId,
    rate_per_litre: DEFAULT_ASSUMPTIONS.sellingRatePerLitre,
    effective_from: DEFAULT_ASSUMPTIONS.sellingRateEffectiveFrom,
    notes: 'Default Aavin standard rate',
  };

  const { data, error } = await supabase
    .from('selling_rate_history')
    .select('*')
    .eq('zone_id', zoneId)
    .order('effective_from', { ascending: false });

  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      const rows = store.sellingRates[zoneId] ?? [];
      return rows.length > 0 ? rows : [defaultRule];
    }
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    const store = readFallback();
    const rows = store.sellingRates[zoneId] ?? [];
    return rows.length > 0 ? rows : [defaultRule];
  }

  return data.map((r) => ({
    id: String(r.id),
    zone_id: String(r.zone_id),
    rate_per_litre: Number(r.rate_per_litre),
    effective_from: String(r.effective_from),
    notes: r.notes ?? null,
    created_at: r.created_at,
  }));
}

export async function addSellingRateRule(
  zoneId: string,
  ratePerLitre: number,
  effectiveFrom: string,
  notes: string | undefined,
  createdBy: string,
): Promise<SellingRateRule> {
  const { data, error } = await supabase
    .from('selling_rate_history')
    .upsert(
      {
        zone_id: zoneId,
        rate_per_litre: ratePerLitre,
        effective_from: effectiveFrom,
        notes: notes ?? null,
        created_by: createdBy,
      },
      { onConflict: 'zone_id,effective_from' },
    )
    .select()
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      const list = store.sellingRates[zoneId] ?? [
        {
          id: 'default',
          zone_id: zoneId,
          rate_per_litre: DEFAULT_ASSUMPTIONS.sellingRatePerLitre,
          effective_from: DEFAULT_ASSUMPTIONS.sellingRateEffectiveFrom,
          notes: 'Default Aavin standard rate',
        },
      ];
      const existingIdx = list.findIndex((r) => r.effective_from === effectiveFrom);
      const entry: SellingRateRule = {
        id: existingIdx >= 0 ? list[existingIdx].id : crypto.randomUUID(),
        zone_id: zoneId,
        rate_per_litre: ratePerLitre,
        effective_from: effectiveFrom,
        notes: notes ?? null,
        created_at: new Date().toISOString(),
      };
      if (existingIdx >= 0) list[existingIdx] = entry;
      else list.push(entry);
      list.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      store.sellingRates[zoneId] = list;
      writeFallback(store);
      return entry;
    }
    throw new Error(error.message);
  }

  return {
    id: String(data.id),
    zone_id: String(data.zone_id),
    rate_per_litre: Number(data.rate_per_litre),
    effective_from: String(data.effective_from),
    notes: data.notes ?? null,
    created_at: data.created_at,
  };
}

export async function writeAuditLog(entry: Omit<AuditLogEntry, 'id' | 'created_at'>): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert(entry);
  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      store.auditLogs.unshift({
        id: crypto.randomUUID(),
        ...entry,
        created_at: new Date().toISOString(),
      });
      if (store.auditLogs.length > 500) store.auditLogs.length = 500;
      writeFallback(store);
    } else {
      console.warn('[audit_logs] Failed to record audit log:', error.message);
    }
  }
}

export async function listAuditLogs(zoneId: string, entityType?: string, entityId?: string): Promise<AuditLogEntry[]> {
  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('zone_id', zoneId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (entityType) query = query.eq('entity_type', entityType);
  if (entityId) query = query.eq('entity_id', entityId);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      return store.auditLogs.filter(
        (l) =>
          l.zone_id === zoneId &&
          (!entityType || l.entity_type === entityType) &&
          (!entityId || l.entity_id === entityId),
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as AuditLogEntry[];
}

export async function createCorrectionRequest(
  reqData: Omit<CorrectionRequest, 'id' | 'status' | 'created_at'>,
): Promise<CorrectionRequest> {
  const { data, error } = await supabase
    .from('correction_requests')
    .insert({ ...reqData, status: 'pending' })
    .select()
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      const created: CorrectionRequest = {
        id: crypto.randomUUID(),
        ...reqData,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      store.correctionRequests.unshift(created);
      writeFallback(store);
      return created;
    }
    throw new Error(error.message);
  }
  return data as CorrectionRequest;
}

export async function listCorrectionRequests(zoneId: string, unitId?: string | null): Promise<CorrectionRequest[]> {
  let query = supabase
    .from('correction_requests')
    .select('*')
    .eq('zone_id', zoneId)
    .order('created_at', { ascending: false });
  if (unitId) query = query.eq('bmc_id', unitId);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      return store.correctionRequests.filter(
        (c) => c.zone_id === zoneId && (!unitId || c.bmc_id === unitId),
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as CorrectionRequest[];
}

export async function resolveCorrectionRequest(
  id: string,
  zoneId: string,
  status: 'resolved' | 'rejected',
  resolvedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('zone_id', zoneId);

  if (error && isMissingSchemaError(error)) {
    const store = readFallback();
    const target = store.correctionRequests.find((c) => c.id === id && c.zone_id === zoneId);
    if (target) {
      target.status = status;
      target.resolved_by = resolvedBy;
      target.resolved_at = new Date().toISOString();
      writeFallback(store);
    }
  }
}

export interface TankerStageRecordRow {
  id?: string;
  trip_id: string;
  stage_name: string;
  team: string;
  status: 'done' | 'rejected' | 'skipped';
  stage_data?: Record<string, unknown>;
  done_by?: string | null;
  done_by_name?: string | null;
  done_at?: string;
  created_at?: string;
}

export async function recordTankerStageInDb(stage: TankerStageRecordRow): Promise<TankerStageRecordRow> {
  const insertPayload = {
    trip_id: stage.trip_id,
    stage_name: stage.stage_name,
    team: stage.team,
    status: stage.status || 'done',
    stage_data: stage.stage_data || {},
    done_by: stage.done_by || null,
    done_by_name: stage.done_by_name || null,
    done_at: stage.done_at || new Date().toISOString(),
  };

  try {
    const { data, error } = await supabase
      .from('tanker_stages')
      .upsert(insertPayload, { onConflict: 'trip_id,stage_name' })
      .select()
      .single();

    if (error) {
      const store = readFallback();
      if (!store.tankerStages[stage.trip_id]) {
        store.tankerStages[stage.trip_id] = [];
      }
      const list = store.tankerStages[stage.trip_id];
      const existingIdx = list.findIndex((s) => s.stage_name === stage.stage_name);
      const row: TankerStageRecordRow = {
        id: existingIdx >= 0 ? list[existingIdx].id : crypto.randomUUID(),
        ...insertPayload,
        created_at: new Date().toISOString(),
      };
      if (existingIdx >= 0) list[existingIdx] = row;
      else list.push(row);
      writeFallback(store);

      if (stage.stage_data && typeof stage.stage_data === 'object') {
        const sd = stage.stage_data as Record<string, any>;
        saveTankerDispatchMetadata({
          id: stage.trip_id,
          tanker_number: sd.tanker_number || '',
          driver_name: sd.driver_name,
          driver_phone: sd.driver_phone,
          dc_number: sd.dc_number || sd.dc_no,
          seal_number: sd.seal_number || sd.outlet_seal_no,
          dispatch_time: sd.dispatch_time,
          dispatch_ampm: sd.dispatch_ampm,
          compartments: sd.compartments,
          gross_weight_kg: sd.gross_weight_kg,
          tare_weight_kg: sd.tare_weight_kg,
          qc_status: sd.qc_status,
          received_qty: sd.unloaded_litres,
          received_fat_pct: sd.received_fat_pct,
          received_snf_pct: sd.received_snf_pct,
          stage_data: { [stage.stage_name]: stage.stage_data },
        });
      }

      return row;
    }

    // Automatically update fallback metadata store with stage data
    if (stage.stage_data && typeof stage.stage_data === 'object') {
      const sd = stage.stage_data as Record<string, any>;
      saveTankerDispatchMetadata({
        id: stage.trip_id,
        tanker_number: sd.tanker_number || '',
        driver_name: sd.driver_name,
        driver_phone: sd.driver_phone,
        dc_number: sd.dc_number || sd.dc_no,
        seal_number: sd.seal_number || sd.outlet_seal_no,
        dispatch_time: sd.dispatch_time,
        dispatch_ampm: sd.dispatch_ampm,
        compartments: sd.compartments,
        gross_weight_kg: sd.gross_weight_kg,
        tare_weight_kg: sd.tare_weight_kg,
        qc_status: sd.qc_status,
        received_qty: sd.unloaded_litres,
        received_fat_pct: sd.received_fat_pct,
        received_snf_pct: sd.received_snf_pct,
        stage_data: { [stage.stage_name]: stage.stage_data },
      });
    }

    return data as TankerStageRecordRow;
  } catch {
    const store = readFallback();
    if (!store.tankerStages[stage.trip_id]) {
      store.tankerStages[stage.trip_id] = [];
    }
    const list = store.tankerStages[stage.trip_id];
    const existingIdx = list.findIndex((s) => s.stage_name === stage.stage_name);
    const row: TankerStageRecordRow = {
      id: existingIdx >= 0 ? list[existingIdx].id : crypto.randomUUID(),
      ...insertPayload,
      created_at: new Date().toISOString(),
    };
    if (existingIdx >= 0) list[existingIdx] = row;
    else list.push(row);
    writeFallback(store);

    if (stage.stage_data && typeof stage.stage_data === 'object') {
      const sd = stage.stage_data as Record<string, any>;
      saveTankerDispatchMetadata({
        id: stage.trip_id,
        tanker_number: sd.tanker_number || '',
        driver_name: sd.driver_name,
        driver_phone: sd.driver_phone,
        dc_number: sd.dc_number || sd.dc_no,
        seal_number: sd.seal_number || sd.outlet_seal_no,
        dispatch_time: sd.dispatch_time,
        dispatch_ampm: sd.dispatch_ampm,
        compartments: sd.compartments,
        gross_weight_kg: sd.gross_weight_kg,
        tare_weight_kg: sd.tare_weight_kg,
        qc_status: sd.qc_status,
        received_qty: sd.unloaded_litres,
        received_fat_pct: sd.received_fat_pct,
        received_snf_pct: sd.received_snf_pct,
        stage_data: { [stage.stage_name]: stage.stage_data },
      });
    }

    return row;
  }
}

export async function getTankerStagesForTrip(tripId: string): Promise<TankerStageRecordRow[]> {
  try {
    const { data, error } = await supabase
      .from('tanker_stages')
      .select('*')
      .eq('trip_id', tripId)
      .order('done_at', { ascending: true });

    if (error) {
      const store = readFallback();
      return store.tankerStages[tripId] ?? [];
    }
    const dbStages = (data ?? []) as TankerStageRecordRow[];
    const store = readFallback();
    const fbStages = store.tankerStages[tripId] ?? [];
    if (dbStages.length === 0 && fbStages.length > 0) return fbStages;
    return dbStages;
  } catch {
    const store = readFallback();
    return store.tankerStages[tripId] ?? [];
  }
}

export async function getTankerStagesForTrips(tripIds: string[]): Promise<Record<string, TankerStageRecordRow[]>> {
  if (tripIds.length === 0) return {};
  try {
    const { data, error } = await supabase
      .from('tanker_stages')
      .select('*')
      .in('trip_id', tripIds)
      .order('done_at', { ascending: true });

    const store = readFallback();
    if (error) {
      const result: Record<string, TankerStageRecordRow[]> = {};
      for (const id of tripIds) {
        if (store.tankerStages[id]) {
          result[id] = store.tankerStages[id];
        }
      }
      return result;
    }

    const result: Record<string, TankerStageRecordRow[]> = {};
    for (const row of (data ?? []) as TankerStageRecordRow[]) {
      if (!result[row.trip_id]) result[row.trip_id] = [];
      result[row.trip_id].push(row);
    }
    for (const id of tripIds) {
      if (!result[id] && store.tankerStages[id]) {
        result[id] = store.tankerStages[id];
      }
    }
    return result;
  } catch {
    const store = readFallback();
    const result: Record<string, TankerStageRecordRow[]> = {};
    for (const id of tripIds) {
      if (store.tankerStages[id]) {
        result[id] = store.tankerStages[id];
      }
    }
    return result;
  }
}

async function withTimeout<T>(thenable: any, ms = 800): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('DB timeout')), ms);
  });
  return Promise.race([Promise.resolve(thenable) as Promise<T>, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

export async function getTeamsFromDb(): Promise<TeamRow[]> {
  const { data, error } = await supabase.from('teams').select('*').order('id');
  if (error) throw new Error(`Could not load teams: ${error.message}`);
  return (data ?? []) as TeamRow[];
}

export async function getTeamByCode(code: string): Promise<TeamRow | null> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle();
  if (error) throw new Error(`Could not load team ${code}: ${error.message}`);
  return (data as TeamRow | null) ?? null;
}

export async function updateTeamStatusInDb(code: string, active: boolean): Promise<TeamRow> {
  const { data, error } = await supabase
    .from('teams')
    .update({ active })
    .eq('code', code.trim().toUpperCase())
    .select()
    .single();
  if (error) throw new Error(`Could not update team ${code}: ${error.message}`);
  return data as TeamRow;
}

export interface RegisteredTanker {
  id: string;
  vehicle_number: string;
  contractor_name: string;
  from_date: string;
  vehicle_type: 'Registered' | 'Unregistered';
  number_of_cells: 1 | 2 | 3;
  front_cell_capacity: number;
  middle_cell_capacity?: number | null;
  back_cell_capacity?: number | null;
  supplier_name: string;
  created_at: string;
}

export const INITIAL_REGISTERED_TANKERS: RegisteredTanker[] = [
  {
    id: 't-reg-1',
    vehicle_number: 'TN28BF9717',
    contractor_name: 'Murugan Transport',
    from_date: '2026-01-01',
    vehicle_type: 'Registered',
    number_of_cells: 2,
    front_cell_capacity: 6500,
    middle_cell_capacity: 0,
    back_cell_capacity: 5500,
    supplier_name: 'Krishnampudur CC',
    created_at: new Date().toISOString(),
  },
  {
    id: 't-reg-2',
    vehicle_number: 'TN54J9599',
    contractor_name: 'Selvam Logistics',
    from_date: '2026-02-15',
    vehicle_type: 'Registered',
    number_of_cells: 2,
    front_cell_capacity: 6000,
    middle_cell_capacity: 0,
    back_cell_capacity: 5000,
    supplier_name: 'Mallur Vadakadu BMC',
    created_at: new Date().toISOString(),
  },
  {
    id: 't-reg-3',
    vehicle_number: 'TN28BJ1697',
    contractor_name: 'Kongu Dairy Express',
    from_date: '2026-03-10',
    vehicle_type: 'Registered',
    number_of_cells: 2,
    front_cell_capacity: 7000,
    middle_cell_capacity: 0,
    back_cell_capacity: 6000,
    supplier_name: 'Vanavasi BMC',
    created_at: new Date().toISOString(),
  },
  {
    id: 't-reg-4',
    vehicle_number: 'TN69AX2529',
    contractor_name: 'Raman Carriers',
    from_date: '2026-04-01',
    vehicle_type: 'Registered',
    number_of_cells: 3,
    front_cell_capacity: 4500,
    middle_cell_capacity: 4500,
    back_cell_capacity: 4500,
    supplier_name: 'Ariyanoor BMC',
    created_at: new Date().toISOString(),
  },
];

export async function getRegisteredTankersInDb(): Promise<RegisteredTanker[]> {
  try {
    const res: any = await withTimeout(supabase.from('registered_tankers').select('*').order('created_at', { ascending: false }), 5000);
    if (!res?.error && res?.data && res.data.length > 0) {
      return res.data as RegisteredTanker[];
    }
    if (res?.error) console.error('getRegisteredTankersInDb failed:', res.error);
  } catch {
    // fallback
  }

  const store = readFallback();
  if (!store.registeredTankers || Object.keys(store.registeredTankers).length === 0) {
    if (!store.registeredTankers) store.registeredTankers = {};
    for (const t of INITIAL_REGISTERED_TANKERS) {
      store.registeredTankers[t.vehicle_number] = t;
    }
    writeFallback(store);
  }

  return Object.values(store.registeredTankers);
}

export async function saveRegisteredTankerInDb(data: Omit<RegisteredTanker, 'id' | 'created_at'>): Promise<RegisteredTanker> {
  const normVeh = data.vehicle_number.trim().toUpperCase();
  const id = `reg-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const row: RegisteredTanker = {
    id,
    vehicle_number: normVeh,
    contractor_name: data.contractor_name.trim(),
    from_date: data.from_date || now.slice(0, 10),
    vehicle_type: data.vehicle_type || 'Registered',
    number_of_cells: data.number_of_cells || 2,
    front_cell_capacity: Number(data.front_cell_capacity) || 0,
    middle_cell_capacity: data.middle_cell_capacity != null ? Number(data.middle_cell_capacity) : 0,
    back_cell_capacity: data.back_cell_capacity != null ? Number(data.back_cell_capacity) : 0,
    supplier_name: data.supplier_name.trim(),
    created_at: now,
  };

  // Persist to the database first. A failure here must be reported to the caller,
  // otherwise the UI shows "registered" while nothing was actually saved.
  let dbError: { code?: string; message?: string } | null = null;
  try {
    const res: any = await withTimeout(
      supabase.from('registered_tankers').upsert(row, { onConflict: 'vehicle_number' }).select().maybeSingle(),
      10000,
    );
    if (res?.error) dbError = res.error;
    else if (res?.data) row.id = res.data.id ?? row.id;
  } catch (err) {
    dbError = { message: (err as Error).message };
  }

  if (dbError) {
    console.error('saveRegisteredTankerInDb failed:', dbError);
    throw new Error(
      isMissingSchemaError(dbError)
        ? 'registered_tankers table is missing in the database. Run supabase/patch_registered_tankers.sql in the Supabase SQL editor.'
        : `Could not save tanker to database: ${dbError.message ?? 'unknown error'}`,
    );
  }

  // Keep the local cache in sync only after the DB write succeeded.
  const store = readFallback();
  if (!store.registeredTankers) store.registeredTankers = {};
  store.registeredTankers[normVeh] = row;
  writeFallback(store);

  return row;
}

export async function findRegisteredTankerInDb(vehicleNumber: string): Promise<RegisteredTanker | null> {
  const norm = vehicleNumber.trim().toUpperCase();
  const clean = norm.replace(/[^A-Z0-9]/g, '');
  try {
    const res: any = await withTimeout(supabase.from('registered_tankers').select('*').eq('vehicle_number', norm).maybeSingle());
    if (!res?.error && res?.data) {
      return res.data as RegisteredTanker;
    }
  } catch {
    // fallback
  }

  const store = readFallback();
  return (
    store.registeredTankers?.[norm] ||
    store.registeredTankers?.[clean] ||
    INITIAL_REGISTERED_TANKERS.find((t) => t.vehicle_number === norm || t.vehicle_number.replace(/[^A-Z0-9]/g, '') === clean) ||
    null
  );
}



