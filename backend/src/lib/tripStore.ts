/**
 * Storage layer for tankers, trips, BMC loadings and plant stage records.
 *
 * Tables: tankers, tanker_trips, trip_loadings, trip_stages (see
 * supabase/migrations/20261122000100_tanker_trips.sql).
 *
 * The rows returned here use the same shape the gate / QC / unloading / BMC
 * screens have always received, so the forms and `enrichTankerRow` keep working
 * unchanged. Only the storage underneath is new.
 */
import { supabase } from '../supabase';
import { idLookup } from './ids';
import type { PlantTeam, StageRecordItem, TankerStageKey } from './tankerJourney';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const CELL_NAMES: Record<string, string> = {
  FC: 'Front Compartment (Comp 1)',
  MC: 'Middle Compartment (Comp 2)',
  BC: 'Rear Compartment',
};

const CELL_ORDER = ['FC', 'MC', 'BC'];

export function normalizeVehicle(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Form value -> stored milk type code. */
export function milkTypeToCode(label: string | null | undefined): string {
  const v = String(label ?? '').trim();
  if (!v || /raw\s*cow/i.test(v) || v.toUpperCase() === 'RCM') return 'RCM';
  if (/skim\s*separated/i.test(v) || v.toUpperCase() === 'SSM') return 'SSM';
  return v;
}

/** Stored milk type code -> label shown in the forms. */
export function milkTypeToLabel(code: string | null | undefined): string {
  if (!code || code === 'RCM') return 'Raw Cow Milk';
  return code === 'SSM' ? 'Skim Separated Milk' : code;
}

/** "10:30 PM" on a calendar date, as an IST timestamp. Falls back to `now`. */
export function istTimestamp(date: string | null | undefined, timeText?: string | null): string {
  const d = String(date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date().toISOString();
  const m = String(timeText ?? '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return new Date(`${d}T00:00:00+05:30`).toISOString();
  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && hh < 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  const stamp = `${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`;
  const t = new Date(stamp);
  return Number.isNaN(t.getTime()) ? new Date().toISOString() : t.toISOString();
}

/** MOR / EVE from the AM / PM of the dispatch time. */
export function shiftFromTime(timeText: string | null | undefined): 'MOR' | 'EVE' | null {
  const m = String(timeText ?? '').match(/\b(AM|PM)\b/i);
  if (!m) return null;
  return m[1].toUpperCase() === 'AM' ? 'MOR' : 'EVE';
}

function istClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const ist = new Date(t.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(11, 16);
}

function num(v: unknown): number | null {
  return v == null || v === '' ? null : Number(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Tankers (vehicle master)
// ---------------------------------------------------------------------------

export interface TankerCell {
  cell_key: 'FC' | 'MC' | 'BC';
  capacity_litres: number;
}

export interface TankerRecord {
  id: string;
  id_token: string;
  vehicle_number: string;
  contractor_name: string;
  from_date: string | null;
  vehicle_type: string | null;
  number_of_cells: number;
  front_cell_capacity: number;
  middle_cell_capacity: number;
  back_cell_capacity: number;
  supplier_name: string;
  dairy_unit_id: string;
  is_active: boolean;
  driver_name: string | null;
  driver_phone: string | null;
  /** Route name shown in reports (e.g. "Rasipuram Route 1") */
  route_name: string | null;
  /** BMCs this tanker collects from; empty = any BMC of the dairy unit (older tankers) */
  route_bmc_ids: string[];
  route: { id: string; name: string }[];
  cells: TankerCell[];
  created_at: string;
}

/** Turn the registration form's cell fields into the stored cell list. */
export function cellsFromRegistration(input: {
  number_of_cells?: number | string | null;
  front_cell_capacity?: number | string | null;
  middle_cell_capacity?: number | string | null;
  back_cell_capacity?: number | string | null;
}): TankerCell[] {
  const n = Math.min(3, Math.max(1, Number(input.number_of_cells) || 1));
  const fc = Number(input.front_cell_capacity) || 0;
  const mc = Number(input.middle_cell_capacity) || 0;
  const bc = Number(input.back_cell_capacity) || 0;
  const cells: TankerCell[] = [];
  if (fc > 0) cells.push({ cell_key: 'FC', capacity_litres: fc });
  if (n === 3 && mc > 0) cells.push({ cell_key: 'MC', capacity_litres: mc });
  if (n >= 2 && bc > 0) cells.push({ cell_key: 'BC', capacity_litres: bc });
  return cells;
}

export function shapeTanker(row: Record<string, any>): TankerRecord {
  const cells: TankerCell[] = Array.isArray(row.cells) ? row.cells : [];
  const cap = (k: string) => Number(cells.find((c) => c.cell_key === k)?.capacity_litres ?? 0);
  return {
    id: String(row.id),
    id_token: String(row.id_token ?? ''),
    vehicle_number: String(row.vehicle_number ?? ''),
    contractor_name: String(row.contractor_name ?? ''),
    from_date: row.from_date ?? null,
    vehicle_type: row.vehicle_type ?? null,
    number_of_cells: cells.length,
    front_cell_capacity: cap('FC'),
    middle_cell_capacity: cap('MC'),
    back_cell_capacity: cap('BC'),
    supplier_name: String(row.supplier_name ?? ''),
    dairy_unit_id: String(row.dairy_unit_id ?? ''),
    is_active: row.is_active !== false,
    driver_name: row.driver_name ?? null,
    driver_phone: row.driver_phone ?? null,
    route_name: row.route_name ?? null,
    route_bmc_ids: Array.isArray(row.route_bmc_ids) ? row.route_bmc_ids.map(String) : [],
    route: [],
    cells,
    created_at: String(row.created_at ?? ''),
  };
}

/** Fill in the BMC names of each tanker's route (one query for all tankers). */
async function attachRouteNames(tankers: TankerRecord[]): Promise<TankerRecord[]> {
  const ids = [...new Set(tankers.flatMap((t) => t.route_bmc_ids))];
  if (ids.length === 0) return tankers;
  const { data, error } = await supabase.from('bmcs').select('id, name').in('id', ids);
  if (error) throw new Error(error.message);
  const names = new Map((data ?? []).map((b) => [String(b.id), String(b.name)]));
  return tankers.map((t) => ({
    ...t,
    route: t.route_bmc_ids.map((id) => ({ id, name: names.get(id) ?? id })),
  }));
}

export async function listTankers(dairyUnitId: string): Promise<TankerRecord[]> {
  const { data, error } = await supabase
    .from('tankers')
    .select('*')
    .eq('dairy_unit_id', dairyUnitId)
    .eq('is_active', true)
    .order('vehicle_number');
  if (error) throw new Error(error.message);
  return attachRouteNames((data ?? []).map(shapeTanker));
}

export async function findTanker(dairyUnitId: string, vehicleNumber: string): Promise<TankerRecord | null> {
  const target = normalizeVehicle(vehicleNumber);
  if (!target) return null;
  const list = await listTankers(dairyUnitId);
  return list.find((t) => normalizeVehicle(t.vehicle_number) === target) ?? null;
}

export interface TankerRegistrationInput {
  vehicle_number: string;
  contractor_name: string;
  supplier_name: string;
  from_date?: string | null;
  vehicle_type?: string | null;
  number_of_cells?: number | string | null;
  front_cell_capacity?: number | string | null;
  middle_cell_capacity?: number | string | null;
  back_cell_capacity?: number | string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  route_name?: string | null;
  /** BMC ids the tanker collects from; required when registering a new tanker */
  route_bmc_ids?: (string | number)[] | null;
}

/** Keeps only valid BMC ids of this dairy unit; throws when one is unknown. */
async function validateRoute(dairyUnitId: string, ids: (string | number)[]): Promise<string[]> {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return [];
  const { data, error } = await supabase.from('bmcs').select('id').eq('dairy_unit_id', dairyUnitId).in('id', unique);
  if (error) throw new Error(error.message);
  const ok = new Set((data ?? []).map((b) => String(b.id)));
  const bad = unique.filter((id) => !ok.has(id));
  if (bad.length) throw new Error('Route contains a BMC that does not belong to this dairy unit');
  return unique;
}

/** Register a new tanker, or update the details of one that already exists. */
export async function saveTanker(dairyUnitId: string, input: TankerRegistrationInput): Promise<TankerRecord> {
  const cells = cellsFromRegistration(input);
  if (cells.length === 0) throw new Error('At least one cell with a capacity is required');
  const total = cells.reduce((s, c) => s + c.capacity_litres, 0);
  const vehicle = input.vehicle_number.trim().toUpperCase();

  const existing = await findTanker(dairyUnitId, vehicle);
  const fields = {
    vehicle_number: vehicle,
    contractor_name: input.contractor_name.trim(),
    supplier_name: input.supplier_name.trim(),
    vehicle_type: input.vehicle_type?.trim() || null,
    from_date: input.from_date || null,
    cells,
    total_capacity_litres: total,
    driver_name: input.driver_name?.trim() || null,
    driver_phone: input.driver_phone?.trim() || null,
    route_name: input.route_name?.trim() || null,
  };
  const route = input.route_bmc_ids ? await validateRoute(dairyUnitId, input.route_bmc_ids) : null;
  if (!existing && (!route || route.length === 0)) throw new Error('Select at least one BMC for the tanker route');
  const withRoute: Record<string, unknown> = route ? { ...fields, route_bmc_ids: route } : { ...fields };

  if (existing) {
    // Cells can only change while the tanker has no trip in progress
    const open = await getOpenTripForTanker(existing.id);
    const patch = open ? { ...withRoute, cells: undefined, total_capacity_litres: undefined } : withRoute;
    const { data, error } = await supabase.from('tankers').update(patch).eq('id', existing.id).select('*').single();
    if (error) throw new Error(error.message);
    return (await attachRouteNames([shapeTanker(data)]))[0];
  }

  const { data, error } = await supabase
    .from('tankers')
    .insert({ ...withRoute, dairy_unit_id: dairyUnitId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`Tanker ${vehicle} is already registered`);
    throw new Error(error.message);
  }
  return (await attachRouteNames([shapeTanker(data)]))[0];
}

async function getOpenTripForTanker(tankerId: string): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('tanker_trips')
    .select('id')
    .eq('tanker_id', tankerId)
    .is('exited_at', null)
    .neq('status', 'cancelled')
    .maybeSingle();
  return data ? { id: String(data.id) } : null;
}

// ---------------------------------------------------------------------------
// Trips: loading rows -> legacy shape
// ---------------------------------------------------------------------------

export interface LoadingRow {
  id: string;
  bmc_id: string;
  cell_key: string;
  dc_number: string;
  outlet_seal_no: string | null;
  cell_seal_no: string | null;
  shift: string | null;
  milk_type: string | null;
  quantity_litres: number | string;
  fat_pct: number | string | null;
  snf_pct: number | string | null;
  temperature: number | string | null;
  dispatch_time_text: string | null;
  dispatch_at: string;
  bmcs?: { name: string; bmc_code: string } | null;
}

export interface StageRow {
  id: string;
  stage_key: TankerStageKey;
  team: PlantTeam;
  status: 'done' | 'rejected' | 'skipped';
  done_by: string | null;
  done_by_name: string | null;
  done_at: string;
  data: Record<string, unknown> | null;
}

function weighted(rows: LoadingRow[], field: 'fat_pct' | 'snf_pct'): number | null {
  let qty = 0;
  let sum = 0;
  for (const r of rows) {
    const v = num(r[field]);
    if (v == null) continue;
    const q = Number(r.quantity_litres) || 0;
    qty += q;
    sum += q * v;
  }
  return qty > 0 ? round2(sum / qty) : null;
}

function bmcLabel(l: LoadingRow): string {
  const b = l.bmcs;
  return b?.name ? `${b.name}${b.bmc_code ? ` [${b.bmc_code}]` : ''}` : 'BMC';
}

function joinUnique(values: Array<string | null | undefined>): string | null {
  const out: string[] = [];
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out.join(', ') : null;
}

/**
 * One compartment entry per BMC per cell (a cell shared by two BMCs shows as two entries,
 * each with its own BMC, DC number and quality), in loading order.
 */
export function buildCompartments(cells: TankerCell[], loadings: LoadingRow[]) {
  const order = [...cells].sort((a, b) => CELL_ORDER.indexOf(a.cell_key) - CELL_ORDER.indexOf(b.cell_key));
  const groups = new Map<string, LoadingRow[]>();
  for (const l of loadings) {
    const key = `${l.cell_key}|${l.bmc_id}|${l.dc_number}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const out: any[] = [];
  for (const [cellIdx, cell] of order.entries()) {
    for (const [key, rows] of groups) {
      if (!key.startsWith(`${cell.cell_key}|`)) continue;
      const last = rows[rows.length - 1];
      out.push({
        compartment_no: cellIdx + 1,
        compartment_name:
          cell.cell_key === 'BC'
            ? order.length === 3 ? 'Rear Compartment (Comp 3)' : 'Rear Compartment (Comp 2)'
            : CELL_NAMES[cell.cell_key],
        cell_key: cell.cell_key,
        cell: cell.cell_key,
        quantity_litres: round2(rows.reduce((s, r) => s + Number(r.quantity_litres), 0)),
        capacity_litres: cell.capacity_litres,
        fat_pct: weighted(rows, 'fat_pct'),
        snf_pct: weighted(rows, 'snf_pct'),
        seal_number: last.cell_seal_no,
        milk_type: milkTypeToLabel(last.milk_type),
        temperature: num(last.temperature),
        bmc_id: String(last.bmc_id),
        bmc_name: bmcLabel(last),
        dc_number: last.dc_number,
      });
    }
  }
  return out;
}

/** One entry per BMC dispatch (BMC + DC number). */
export function buildBmcDispatches(trip: Record<string, any>, loadings: LoadingRow[]) {
  const groups = new Map<string, LoadingRow[]>();
  for (const l of loadings) {
    const key = `${l.bmc_id}|${l.dc_number}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const cells: TankerCell[] = trip.cells ?? [];
  return [...groups.values()].map((rows) => {
    const first = rows[0];
    return {
      bmc_id: String(first.bmc_id),
      unit_name: bmcLabel(first),
      dc_number: first.dc_number,
      quantity_dispatched: round2(rows.reduce((s, r) => s + Number(r.quantity_litres), 0)),
      dispatch_time: first.dispatch_time_text,
      seal_number: first.outlet_seal_no,
      driver_name: trip.driver_name ?? null,
      driver_phone: trip.driver_phone ?? null,
      compartments: buildCompartments(cells, rows),
      created_at: first.dispatch_at,
    };
  });
}

/** The latest record of each stage (a failed CIP can be followed by a passing one). */
export function latestStages(stages: StageRow[]): StageRow[] {
  const byKey = new Map<string, StageRow>();
  for (const s of [...stages].sort((a, b) => (a.done_at < b.done_at ? -1 : a.done_at > b.done_at ? 1 : Number(a.id) - Number(b.id)))) {
    byKey.set(s.stage_key, s);
  }
  return [...byKey.values()];
}

export function toStageRecordItems(stages: StageRow[]): StageRecordItem[] {
  return latestStages(stages).map((s) => ({
    stage_name: s.stage_key,
    team: s.team,
    status: s.status,
    stage_data: (s.data ?? {}) as Record<string, unknown>,
    done_by: s.done_by,
    done_by_name: s.done_by_name,
    done_at: s.done_at,
  }));
}

export type LegacyTripRow = Record<string, any>;

/** Build the row the forms and `enrichTankerRow` expect from the new tables. */
export function shapeTrip(trip: Record<string, any>, loadings: LoadingRow[], stages: StageRow[]): LegacyTripRow {
  const cells: TankerCell[] = Array.isArray(trip.cells) ? trip.cells : [];
  const sortedLoadings = [...loadings].sort((a, b) => (a.dispatch_at < b.dispatch_at ? -1 : a.dispatch_at > b.dispatch_at ? 1 : Number(a.id) - Number(b.id)));
  const first = sortedLoadings[0];
  const compartments = buildCompartments(cells, sortedLoadings);
  const bmcDispatches = buildBmcDispatches(trip, sortedLoadings);
  const dcNumber = joinUnique(sortedLoadings.map((l) => l.dc_number));
  const destination = trip.dairy_units?.name ? `${trip.dairy_units.name} Dairy` : 'Dairy';
  const loaded = round2(sortedLoadings.reduce((s, l) => s + Number(l.quantity_litres), 0));
  const dispatchFat = weighted(sortedLoadings, 'fat_pct');
  const dispatchSnf = weighted(sortedLoadings, 'snf_pct');
  const ampm = String(first?.dispatch_time_text ?? '').match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() ?? null;

  const stageData: Record<string, any> = {
    driver_name: trip.driver_name ?? null,
    driver_phone: trip.driver_phone ?? null,
    seal_number: first?.outlet_seal_no ?? null,
    dispatch_time: first?.dispatch_time_text ?? null,
    dispatch_ampm: ampm,
    destination,
    quantity_dispatched: loaded,
    bmc_dispatches: bmcDispatches,
    ...(dcNumber ? { dc_number: dcNumber } : {}),
    ...(compartments.length > 0 ? { compartments } : {}),
    ...(dispatchFat != null ? { dispatch_fat_pct: dispatchFat } : {}),
    ...(dispatchSnf != null ? { dispatch_snf_pct: dispatchSnf } : {}),
  };
  for (const s of latestStages(stages)) {
    stageData[s.stage_key] = {
      ...(s.data ?? {}),
      status: s.status,
      done_by: s.done_by,
      done_by_name: s.done_by_name,
      done_at: s.done_at,
    };
  }

  return {
    id: String(trip.id),
    id_token: trip.id_token,
    dairy_unit_id: String(trip.dairy_unit_id),
    tanker_id: String(trip.tanker_id),
    bmc_id: first ? String(first.bmc_id) : null,
    bmcs: first?.bmcs ?? null,
    date: trip.trip_date,
    tanker_number: trip.tankers?.vehicle_number ?? '',
    driver_name: trip.driver_name ?? null,
    driver_phone: trip.driver_phone ?? null,
    dc_number: dcNumber,
    seal_number: first?.outlet_seal_no ?? null,
    dispatch_time: first?.dispatch_time_text ?? null,
    dispatch_ampm: ampm,
    quantity_dispatched: loaded,
    destination,
    dispatch_fat_pct: dispatchFat,
    dispatch_snf_pct: dispatchSnf,
    compartments,
    gross_weight_kg: num(trip.gross_weight_kg),
    tare_weight_kg: num(trip.tare_weight_kg),
    net_weight_kg: num(trip.net_weight_kg),
    received_qty: num(trip.received_litres),
    receipt_time: istClock(trip.exited_at),
    received_fat_pct: num(trip.received_fat_pct),
    received_snf_pct: num(trip.received_snf_pct),
    qc_status: trip.qc_status ?? null,
    cip_status: trip.cip_status ?? null,
    trip_status: trip.status,
    gate_pass: trip.gate_pass || stageData.gate_pass || null,
    gate_pass_no: trip.gate_pass_no || stageData.gate_pass?.gate_pass_no || null,
    stage_data: stageData,
    created_at: trip.created_at,
  };
}

// ---------------------------------------------------------------------------
// Trips: queries
// ---------------------------------------------------------------------------

const TRIP_SELECT = '*, tankers(id, id_token, vehicle_number), dairy_units(id, id_token, name)';

export interface TripQuery {
  dairyUnitId: string;
  from?: string;
  to?: string;
  /** Only trips that carry milk from this BMC. */
  bmcId?: string | null;
  /** Numeric id or id_token. */
  tripKey?: string;
  /** Only trips that have not left the dairy unit yet. */
  openOnly?: boolean;
}

export interface TripsResult {
  rows: LegacyTripRow[];
  stages: Record<string, StageRecordItem[]>;
}

export async function fetchTrips(q: TripQuery): Promise<TripsResult> {
  let tripIds: string[] | null = null;

  if (q.bmcId) {
    const { data, error } = await supabase.from('trip_loadings').select('trip_id').eq('bmc_id', q.bmcId);
    if (error) throw new Error(error.message);
    tripIds = [...new Set((data ?? []).map((r) => String(r.trip_id)))];
    if (tripIds.length === 0) return { rows: [], stages: {} };
  }

  let query = supabase.from('tanker_trips').select(TRIP_SELECT).eq('dairy_unit_id', q.dairyUnitId).neq('status', 'cancelled');
  if (tripIds) query = query.in('id', tripIds);
  if (q.from) query = query.gte('trip_date', q.from);
  if (q.to) query = query.lte('trip_date', q.to);
  if (q.openOnly) query = query.is('exited_at', null);
  if (q.tripKey) {
    const key = idLookup(q.tripKey);
    if (!key) return { rows: [], stages: {} };
    query = query.eq(key.column, key.value);
  }
  const { data: trips, error } = await query.order('trip_date', { ascending: false }).order('id', { ascending: false });
  if (error) throw new Error(error.message);
  if (!trips || trips.length === 0) return { rows: [], stages: {} };

  const ids = trips.map((t) => String(t.id));
  const [loadRes, stageRes] = await Promise.all([
    supabase.from('trip_loadings').select('*, bmcs(name, bmc_code)').in('trip_id', ids),
    supabase.from('trip_stages').select('*').in('trip_id', ids).order('done_at'),
  ]);
  if (loadRes.error) throw new Error(loadRes.error.message);
  if (stageRes.error) throw new Error(stageRes.error.message);

  const loadingsByTrip = new Map<string, LoadingRow[]>();
  for (const l of (loadRes.data ?? []) as any[]) {
    const k = String(l.trip_id);
    loadingsByTrip.set(k, [...(loadingsByTrip.get(k) ?? []), l]);
  }
  const stagesByTrip = new Map<string, StageRow[]>();
  for (const s of (stageRes.data ?? []) as any[]) {
    const k = String(s.trip_id);
    stagesByTrip.set(k, [...(stagesByTrip.get(k) ?? []), s]);
  }

  const rows: LegacyTripRow[] = [];
  const stages: Record<string, StageRecordItem[]> = {};
  for (const t of trips) {
    const id = String(t.id);
    const tripStages = stagesByTrip.get(id) ?? [];
    rows.push(shapeTrip(t, loadingsByTrip.get(id) ?? [], tripStages));
    stages[id] = toStageRecordItems(tripStages);
  }
  return { rows, stages };
}

export async function fetchTrip(
  dairyUnitId: string,
  tripKey: string,
  bmcId?: string | null,
): Promise<{ row: LegacyTripRow; stages: StageRecordItem[] } | null> {
  const { rows, stages } = await fetchTrips({ dairyUnitId, tripKey, bmcId });
  const row = rows[0];
  return row ? { row, stages: stages[row.id] ?? [] } : null;
}

// ---------------------------------------------------------------------------
// Trips: writes
// ---------------------------------------------------------------------------

export interface DispatchInput {
  tankerId: string;
  bmcId: string;
  dcNumber: string;
  outletSealNo?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  dispatchTimeText?: string | null;
  tripDate: string;
  userId?: string | null;
  clientRequestId?: string | null;
  loadings: Array<{
    cell_key: string;
    quantity_litres: number;
    fat_pct?: number | null;
    snf_pct?: number | null;
    temperature?: number | null;
    milk_type?: string | null;
    seal_number?: string | null;
  }>;
}

export class DispatchError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** One atomic BMC dispatch: finds or starts the tanker's trip and checks cell capacity. */
export async function dispatchToTanker(input: DispatchInput): Promise<string> {
  const payload = {
    tanker_id: input.tankerId,
    bmc_id: input.bmcId,
    dc_number: input.dcNumber,
    outlet_seal_no: input.outletSealNo ?? null,
    driver_name: input.driverName ?? null,
    driver_phone: input.driverPhone ?? null,
    dispatch_time_text: input.dispatchTimeText ?? null,
    shift: shiftFromTime(input.dispatchTimeText),
    dispatch_at: istTimestamp(input.tripDate, input.dispatchTimeText),
    trip_date: input.tripDate,
    created_by: input.userId ?? null,
    client_request_id: input.clientRequestId ?? null,
    loadings: input.loadings.map((l) => ({
      ...l,
      milk_type: milkTypeToCode(l.milk_type),
    })),
  };
  const { data, error } = await supabase.rpc('dispatch_to_tanker', { p: payload });
  if (error) {
    if (error.code === 'P0001') throw new DispatchError(error.message, 400);
    if (error.code === '23505') {
      throw new DispatchError('This DC number is already recorded for that cell on this trip', 409);
    }
    throw new Error(error.message);
  }
  return String(data);
}

export interface StageWrite {
  tripId: string;
  stageKey: TankerStageKey | string;
  team: PlantTeam;
  status: 'done' | 'rejected' | 'skipped';
  data: Record<string, unknown>;
  userId?: string | null;
  userName?: string | null;
  doneAt?: string;
}

export async function recordStage(w: StageWrite): Promise<StageRow> {
  const { data, error } = await supabase
    .from('trip_stages')
    .insert({
      trip_id: w.tripId,
      stage_key: w.stageKey,
      team: w.team,
      status: w.status,
      data: w.data,
      done_by: w.userId ?? null,
      done_by_name: w.userName ?? null,
      done_at: w.doneAt ?? new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new DispatchError(`Stage ${w.stageKey} has already been completed for this tanker`, 400);
    throw new Error(error.message);
  }
  return data as StageRow;
}

/** Edit the stored form data of a stage record (admin correction). */
export async function updateStageData(
  tripId: string,
  stageKey: TankerStageKey,
  patch: { data: Record<string, unknown>; status?: 'done' | 'rejected' | 'skipped' },
): Promise<StageRow | null> {
  const { data: rows, error } = await supabase
    .from('trip_stages')
    .select('*')
    .eq('trip_id', tripId)
    .eq('stage_key', stageKey)
    .order('done_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const target = rows?.[0];
  if (!target) return null;
  const { data, error: upErr } = await supabase
    .from('trip_stages')
    .update({ data: patch.data, ...(patch.status ? { status: patch.status } : {}) })
    .eq('id', target.id)
    .select('*')
    .single();
  if (upErr) throw new Error(upErr.message);
  return data as StageRow;
}

const TRIP_COLUMNS = new Set([
  'status', 'driver_name', 'driver_phone', 'gross_weight_kg', 'tare_weight_kg', 'net_weight_kg',
  'received_litres', 'received_fat_pct', 'received_snf_pct', 'qc_status', 'cip_status',
  'entered_at', 'exited_at', 'gate_pass', 'gate_pass_no',
]);

export async function updateTrip(tripId: string, fields: Record<string, unknown>): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (TRIP_COLUMNS.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from('tanker_trips').update(patch).eq('id', tripId);
  if (error) throw new Error(error.message);
}

/** Admin removes a whole trip; a BMC removes only its own loadings while the trip is still loading. */
export async function deleteTrip(
  dairyUnitId: string,
  tripKey: string,
  bmcId?: string | null,
): Promise<'deleted' | 'not_found' | 'locked'> {
  const key = idLookup(tripKey);
  if (!key) return 'not_found';
  const { data: trip } = await supabase
    .from('tanker_trips')
    .select('id, status')
    .eq('dairy_unit_id', dairyUnitId)
    .eq(key.column, key.value)
    .maybeSingle();
  if (!trip) return 'not_found';

  if (!bmcId) {
    const { error } = await supabase.from('tanker_trips').delete().eq('id', trip.id);
    if (error) throw new Error(error.message);
    return 'deleted';
  }

  if (trip.status !== 'on_the_way') return 'locked';
  const { error: delErr, count } = await supabase
    .from('trip_loadings')
    .delete({ count: 'exact' })
    .eq('trip_id', trip.id)
    .eq('bmc_id', bmcId);
  if (delErr) throw new Error(delErr.message);
  if (!count) return 'not_found';

  const { data: left } = await supabase.from('trip_loadings').select('quantity_litres').eq('trip_id', trip.id);
  if (!left || left.length === 0) {
    await supabase.from('tanker_trips').delete().eq('id', trip.id);
  } else {
    const total = round2(left.reduce((s, r) => s + Number(r.quantity_litres), 0));
    await supabase.from('tanker_trips').update({ loaded_litres: total }).eq('id', trip.id);
  }
  return 'deleted';
}

// ---------------------------------------------------------------------------
// Tanker availability for the BMC dispatch screen
// ---------------------------------------------------------------------------

const AT_PLANT_STATUSES = new Set([
  'vehicle_entered', 'gross_done', 'qc_done', 'qc_rejected', 'unloaded', 'tare_done', 'cip_done', 'cip_unsatisfied',
]);

/** Capacity, filled litres and availability of one tanker given its open trip (if any). */
export function buildTankerAvailability(tanker: TankerRecord, openTrip: LegacyTripRow | null) {
  const comps: any[] = openTrip?.compartments ?? [];
  const cells = [...tanker.cells]
    .sort((a, b) => CELL_ORDER.indexOf(a.cell_key) - CELL_ORDER.indexOf(b.cell_key))
    .map((cell, idx, all) => {
      const inCell = comps.filter((c) => c.cell_key === cell.cell_key);
      const matched = inCell[inCell.length - 1];
      const filled = inCell.reduce((sum, c) => sum + (Number(c.quantity_litres) || 0), 0);
      const avail = Math.max(0, cell.capacity_litres - filled);
      return {
        cell_index: idx,
        cell_key: cell.cell_key,
        cell_name:
          cell.cell_key === 'BC' ? (all.length === 3 ? 'Rear Compartment (Comp 3)' : 'Rear Compartment (Comp 2)') : CELL_NAMES[cell.cell_key],
        capacity: cell.capacity_litres,
        filled_litres: filled,
        available_litres: avail,
        is_cell_full: avail <= 0,
        loaded_by_bmc_name: joinUnique(inCell.map((c) => c.bmc_name)),
        dc_number: joinUnique(inCell.map((c) => c.dc_number)),
        fat_pct: matched?.fat_pct ?? null,
        snf_pct: matched?.snf_pct ?? null,
        seal_number: matched?.seal_number ?? null,
        milk_type: matched?.milk_type ?? 'Raw Cow Milk',
        temperature: matched?.temperature != null ? String(matched.temperature) : '4.0',
      };
    });

  const totalCap = cells.reduce((s, c) => s + c.capacity, 0);
  const totalFilled = cells.reduce((s, c) => s + c.filled_litres, 0);
  const availTotal = Math.max(0, totalCap - totalFilled);
  const isAtPlant = Boolean(openTrip && AT_PLANT_STATUSES.has(String(openTrip.trip_status)));
  const isFull = availTotal <= 0;

  return {
    ...tanker,
    total_capacity: totalCap,
    filled_capacity: totalFilled,
    available_capacity: availTotal,
    is_full: isFull,
    is_at_plant: isAtPlant,
    // Loading stays open until the gate entry; a full tanker has nothing left to take
    is_available_for_dispatch: !isAtPlant && !isFull,
    has_active_trip: Boolean(openTrip),
    active_trip_id: openTrip ? String(openTrip.id) : null,
    active_driver_name: openTrip?.driver_name ?? null,
    active_driver_phone: openTrip?.driver_phone ?? null,
    active_dc_number: openTrip?.dc_number ?? null,
    cells,
  };
}

export async function listTankerAvailability(dairyUnitId: string, vehicleNumber?: string, forBmcId?: string | null) {
  const tankers = vehicleNumber
    ? [await findTanker(dairyUnitId, vehicleNumber)].filter((t): t is TankerRecord => t != null)
    : await listTankers(dairyUnitId);
  // A BMC only sees tankers whose route includes it (a tanker with no route is open to every BMC)
  const visible = forBmcId
    ? tankers.filter((t) => t.route_bmc_ids.length === 0 || t.route_bmc_ids.includes(String(forBmcId)))
    : tankers;
  if (visible.length === 0) return [];
  const { rows } = await fetchTrips({ dairyUnitId, openOnly: true });
  const byTanker = new Map(rows.map((r) => [String(r.tanker_id), r]));
  return visible.map((t) => buildTankerAvailability(t, byTanker.get(t.id) ?? null));
}

// ---------------------------------------------------------------------------
// BMC stock
// ---------------------------------------------------------------------------

export async function computeStock(dairyUnitId: string, bmcId?: string | null) {
  let q = supabase.from('v_bmc_stock').select('collected_litres, dispatched_litres').eq('dairy_unit_id', dairyUnitId);
  if (bmcId) q = q.eq('bmc_id', bmcId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const collected = (data ?? []).reduce((s, r) => s + Number(r.collected_litres ?? 0), 0);
  const dispatched = (data ?? []).reduce((s, r) => s + Number(r.dispatched_litres ?? 0), 0);
  const available = Math.max(0, round2(collected - dispatched));
  const quality = bmcId && available > 0 ? await availableQuality(bmcId, available) : { fat: null, snf: null };
  return {
    collected_net_qty: round2(collected),
    dispatched_qty: round2(dispatched),
    available_stock_qty: available,
    raw_balance_qty: round2(collected - dispatched),
    available_fat_pct: quality.fat,
    available_snf_pct: quality.snf,
  };
}

/**
 * Litre-weighted fat/SNF of the milk still at the BMC. Dispatch takes the oldest milk
 * first, so what is left is the most recent collections covering `available` litres.
 */
export async function availableQuality(bmcId: string, available: number): Promise<{ fat: number | null; snf: number | null }> {
  const { data, error } = await supabase
    .from('milk_entries')
    .select('quantity_litres, rejection_qty, fat_pct, snf_pct')
    .eq('bmc_id', bmcId)
    .order('date', { ascending: false })
    .order('shift', { ascending: false }) // PM before AM, so the latest shift comes first
    .limit(60);
  if (error) throw new Error(error.message);
  return weightedQuality(data ?? [], available);
}

export function weightedQuality(
  entriesNewestFirst: { quantity_litres: unknown; rejection_qty: unknown; fat_pct: unknown; snf_pct: unknown }[],
  available: number,
): { fat: number | null; snf: number | null } {
  let left = available;
  let litres = 0;
  let fat = 0;
  let snf = 0;
  for (const e of entriesNewestFirst) {
    if (left <= 0) break;
    const net = Math.max(0, Number(e.quantity_litres ?? 0) - Number(e.rejection_qty ?? 0));
    const take = Math.min(net, left);
    if (take <= 0 || e.fat_pct == null || e.snf_pct == null) continue;
    litres += take;
    fat += take * Number(e.fat_pct);
    snf += take * Number(e.snf_pct);
    left -= take;
  }
  if (litres <= 0) return { fat: null, snf: null };
  return { fat: round2(fat / litres), snf: round2(snf / litres) };
}
