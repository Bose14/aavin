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
  dairy_unit_id: string;
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
  dairy_unit_id: string;
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

interface FallbackStoreData {
  zoneSettings: Record<string, ZoneSettings>;
  sellingRates: Record<string, SellingRateRule[]>;
  auditLogs: AuditLogEntry[];
  correctionRequests: CorrectionRequest[];
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

/** Older fallback files stored `zone_id`; read it as `dairy_unit_id`. */
function withDairyUnit<T extends object>(row: T): T {
  const r = row as Record<string, unknown>;
  if (r && r.dairy_unit_id === undefined && r.zone_id !== undefined) {
    return { ...row, dairy_unit_id: r.zone_id } as T;
  }
  return row;
}

export function readFallback(): FallbackStoreData {
  try {
    if (fs.existsSync(FALLBACK_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')) as Partial<FallbackStoreData>;
      const sellingRates: Record<string, SellingRateRule[]> = {};
      for (const [key, rules] of Object.entries(parsed.sellingRates ?? {})) {
        sellingRates[key] = Array.isArray(rules) ? rules.map(withDairyUnit) : [];
      }
      const zoneSettings: Record<string, ZoneSettings> = {};
      for (const [key, value] of Object.entries(parsed.zoneSettings ?? {})) {
        zoneSettings[key] = withDairyUnit(value);
      }
      return {
        zoneSettings,
        sellingRates,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs.map(withDairyUnit) : [],
        correctionRequests: Array.isArray(parsed.correctionRequests) ? parsed.correctionRequests.map(withDairyUnit) : [],
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
  };
}

function writeFallback(data: FallbackStoreData): void {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function getZoneSettings(dairyUnitId: string): Promise<ZoneSettings> {
  const defaults = buildDefaultZoneSettings(dairyUnitId);
  try {
    const { data, error } = await supabase
      .from('zone_settings')
      .select('*')
      .eq('dairy_unit_id', dairyUnitId)
      .maybeSingle();

    if (error) {
      const store = readFallback();
      return { ...defaults, ...(store.zoneSettings[dairyUnitId] ?? {}) };
    }

    if (!data) {
      const store = readFallback();
      return { ...defaults, ...(store.zoneSettings[dairyUnitId] ?? {}) };
    }

    return {
      dairy_unit_id: dairyUnitId,
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
    return { ...defaults, ...(store.zoneSettings[dairyUnitId] ?? {}) };
  }
}

export async function saveZoneSettings(dairyUnitId: string, patch: Partial<ZoneSettings>): Promise<ZoneSettings> {
  const current = await getZoneSettings(dairyUnitId);
  const next: ZoneSettings = {
    ...current,
    ...patch,
    dairy_unit_id: dairyUnitId,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase
      .from('zone_settings')
      .upsert(next, { onConflict: 'dairy_unit_id' });

    if (error) {
      const store = readFallback();
      store.zoneSettings[dairyUnitId] = next;
      writeFallback(store);
      return next;
    }
  } catch {
    const store = readFallback();
    store.zoneSettings[dairyUnitId] = next;
    writeFallback(store);
    return next;
  }
  return next;
}

export async function getSellingRateHistory(dairyUnitId: string): Promise<SellingRateRule[]> {
  const defaultRule: SellingRateRule = {
    id: 'default',
    dairy_unit_id: dairyUnitId,
    rate_per_litre: DEFAULT_ASSUMPTIONS.sellingRatePerLitre,
    effective_from: DEFAULT_ASSUMPTIONS.sellingRateEffectiveFrom,
    notes: 'Default Aavin standard rate',
  };

  const { data, error } = await supabase
    .from('selling_rate_history')
    .select('*')
    .eq('dairy_unit_id', dairyUnitId)
    .order('effective_from', { ascending: false });

  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      const rows = store.sellingRates[dairyUnitId] ?? [];
      return rows.length > 0 ? rows : [defaultRule];
    }
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    const store = readFallback();
    const rows = store.sellingRates[dairyUnitId] ?? [];
    return rows.length > 0 ? rows : [defaultRule];
  }

  return data.map((r) => ({
    id: String(r.id),
    dairy_unit_id: String(r.dairy_unit_id),
    rate_per_litre: Number(r.rate_per_litre),
    effective_from: String(r.effective_from),
    notes: r.notes ?? null,
    created_at: r.created_at,
  }));
}

export async function addSellingRateRule(
  dairyUnitId: string,
  ratePerLitre: number,
  effectiveFrom: string,
  notes: string | undefined,
  createdBy: string,
): Promise<SellingRateRule> {
  const { data, error } = await supabase
    .from('selling_rate_history')
    .upsert(
      {
        dairy_unit_id: dairyUnitId,
        rate_per_litre: ratePerLitre,
        effective_from: effectiveFrom,
        notes: notes ?? null,
        created_by: createdBy,
      },
      { onConflict: 'dairy_unit_id,effective_from' },
    )
    .select()
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      const list = store.sellingRates[dairyUnitId] ?? [
        {
          id: 'default',
          dairy_unit_id: dairyUnitId,
          rate_per_litre: DEFAULT_ASSUMPTIONS.sellingRatePerLitre,
          effective_from: DEFAULT_ASSUMPTIONS.sellingRateEffectiveFrom,
          notes: 'Default Aavin standard rate',
        },
      ];
      const existingIdx = list.findIndex((r) => r.effective_from === effectiveFrom);
      const entry: SellingRateRule = {
        id: existingIdx >= 0 ? list[existingIdx].id : crypto.randomUUID(),
        dairy_unit_id: dairyUnitId,
        rate_per_litre: ratePerLitre,
        effective_from: effectiveFrom,
        notes: notes ?? null,
        created_at: new Date().toISOString(),
      };
      if (existingIdx >= 0) list[existingIdx] = entry;
      else list.push(entry);
      list.sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      store.sellingRates[dairyUnitId] = list;
      writeFallback(store);
      return entry;
    }
    throw new Error(error.message);
  }

  return {
    id: String(data.id),
    dairy_unit_id: String(data.dairy_unit_id),
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

export async function listAuditLogs(dairyUnitId: string, entityType?: string, entityId?: string): Promise<AuditLogEntry[]> {
  let query = supabase
    .from('audit_logs')
    .select('*')
    .eq('dairy_unit_id', dairyUnitId)
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
          l.dairy_unit_id === dairyUnitId &&
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

export async function listCorrectionRequests(dairyUnitId: string, unitId?: string | null): Promise<CorrectionRequest[]> {
  let query = supabase
    .from('correction_requests')
    .select('*')
    .eq('dairy_unit_id', dairyUnitId)
    .order('created_at', { ascending: false });
  if (unitId) query = query.eq('bmc_id', unitId);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) {
      const store = readFallback();
      return store.correctionRequests.filter(
        (c) => c.dairy_unit_id === dairyUnitId && (!unitId || c.bmc_id === unitId),
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as CorrectionRequest[];
}

export async function resolveCorrectionRequest(
  id: string,
  dairyUnitId: string,
  status: 'resolved' | 'rejected',
  resolvedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('correction_requests')
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('dairy_unit_id', dairyUnitId);

  if (error && isMissingSchemaError(error)) {
    const store = readFallback();
    const target = store.correctionRequests.find((c) => c.id === id && c.dairy_unit_id === dairyUnitId);
    if (target) {
      target.status = status;
      target.resolved_by = resolvedBy;
      target.resolved_at = new Date().toISOString();
      writeFallback(store);
    }
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
