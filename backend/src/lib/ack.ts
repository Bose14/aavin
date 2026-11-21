/**
 * Acknowledgement of each BMC's dispatch once a tanker has been received at the dairy unit.
 *
 * The dairy unit measures one received quantity for the whole tanker, so it is shared back to the
 * BMCs in proportion to the litres each one sent. Fat and SNF come from the QC test of the cell(s)
 * the BMC's milk was loaded into (BMCs sharing a cell share that cell's result).
 */
import { supabase } from '../supabase';

export interface AckInputRow {
  bmc_id: string;
  dc_number: string;
  /** Litres this BMC loaded into each cell, e.g. { FC: 3000 } */
  cell_litres: Record<string, number>;
}

export interface CellQuality {
  fat: number;
  snf: number;
}

export interface AckResultRow {
  bmc_id: string;
  dc_number: string;
  ack_litres: number;
  ack_fat_pct: number;
  ack_snf_pct: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function allocateAcknowledgements(
  rows: AckInputRow[],
  receivedLitres: number,
  cellQuality: Record<string, CellQuality>,
  fallback: CellQuality,
): AckResultRow[] {
  const litresOf = (r: AckInputRow) => Object.values(r.cell_litres).reduce((s, v) => s + v, 0);
  const total = rows.reduce((s, r) => s + litresOf(r), 0);
  if (rows.length === 0 || total <= 0) return [];

  let allocated = 0;
  return rows.map((row, idx) => {
    const own = litresOf(row);
    const isLast = idx === rows.length - 1;
    const ack = isLast ? r2(receivedLitres - allocated) : r2((own / total) * receivedLitres);
    allocated = r2(allocated + ack);

    let fat = 0;
    let snf = 0;
    for (const [cell, l] of Object.entries(row.cell_litres)) {
      const q = cellQuality[cell] ?? fallback;
      fat += l * q.fat;
      snf += l * q.snf;
    }
    return {
      bmc_id: row.bmc_id,
      dc_number: row.dc_number,
      ack_litres: Math.max(0, ack),
      ack_fat_pct: r4(own > 0 ? fat / own : fallback.fat),
      ack_snf_pct: r4(own > 0 ? snf / own : fallback.snf),
    };
  });
}

/** Per-cell fat/SNF from the QC form's received_quality list (one entry per cell). */
export function cellQualityFromQc(receivedQuality: unknown): Record<string, CellQuality> {
  const sums: Record<string, { w: number; fat: number; snf: number }> = {};
  if (!Array.isArray(receivedQuality)) return {};
  for (const item of receivedQuality as Array<Record<string, unknown>>) {
    const cell = String(item.cell ?? '').toUpperCase();
    const fat = Number(item.fat);
    const snf = Number(item.snf);
    if (!cell || !(fat > 0) || !(snf > 0)) continue;
    const w = Number(item.qty) > 0 ? Number(item.qty) : 1;
    const s = (sums[cell] ??= { w: 0, fat: 0, snf: 0 });
    s.w += w;
    s.fat += fat * w;
    s.snf += snf * w;
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, { fat: v.fat / v.w, snf: v.snf / v.w }]));
}

/**
 * Recalculate and store the per-BMC acknowledgement of one trip. Safe to call repeatedly:
 * it runs after unloading / QC and again after an admin correction. A trip that is not yet
 * QC-accepted and unloaded, or was rejected, has no acknowledgement rows.
 */
export async function syncTripAcknowledgements(tripId: string): Promise<void> {
  const { data: trip, error } = await supabase
    .from('tanker_trips')
    .select('id, status, qc_status, received_litres, received_fat_pct, received_snf_pct')
    .eq('id', tripId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!trip) return;

  const ready = trip.status !== 'cancelled' && trip.qc_status === 'accepted' && trip.received_litres != null;
  const { data: existing } = await supabase.from('trip_acknowledgements').select('id, bmc_id, dc_number').eq('trip_id', tripId);

  if (!ready) {
    if (existing && existing.length > 0) await supabase.from('trip_acknowledgements').delete().eq('trip_id', tripId);
    return;
  }

  const [{ data: loadings, error: lErr }, { data: qcRows, error: qErr }] = await Promise.all([
    supabase.from('trip_loadings').select('bmc_id, dc_number, cell_key, quantity_litres, dispatch_at, id').eq('trip_id', tripId).order('dispatch_at').order('id'),
    supabase.from('trip_stages').select('data').eq('trip_id', tripId).eq('stage_key', 'qc_completed').eq('status', 'done').order('done_at', { ascending: false }).limit(1),
  ]);
  if (lErr) throw new Error(lErr.message);
  if (qErr) throw new Error(qErr.message);

  const groups = new Map<string, AckInputRow>();
  for (const l of loadings ?? []) {
    const key = `${l.bmc_id}|${l.dc_number}`;
    const g = groups.get(key) ?? { bmc_id: String(l.bmc_id), dc_number: String(l.dc_number), cell_litres: {} };
    g.cell_litres[l.cell_key] = (g.cell_litres[l.cell_key] ?? 0) + Number(l.quantity_litres);
    groups.set(key, g);
  }

  const qcData = (qcRows?.[0]?.data ?? {}) as Record<string, unknown>;
  const fallback = {
    fat: Number(trip.received_fat_pct ?? 0),
    snf: Number(trip.received_snf_pct ?? 0),
  };
  const result = allocateAcknowledgements(
    [...groups.values()],
    Number(trip.received_litres),
    cellQualityFromQc(qcData.received_quality),
    fallback,
  );

  if (result.length > 0) {
    const { error: upErr } = await supabase
      .from('trip_acknowledgements')
      .upsert(result.map((r) => ({ trip_id: tripId, ...r })), { onConflict: 'trip_id,bmc_id,dc_number' });
    if (upErr) throw new Error(upErr.message);
  }
  const keep = new Set(result.map((r) => `${r.bmc_id}|${r.dc_number}`));
  const stale = (existing ?? []).filter((e) => !keep.has(`${e.bmc_id}|${e.dc_number}`)).map((e) => e.id);
  if (stale.length > 0) await supabase.from('trip_acknowledgements').delete().in('id', stale);
}

/** Fill in acknowledgements for finished trips in a date range that do not have any yet. */
export async function ensureAcknowledgements(dairyUnitId: string, from?: string, to?: string): Promise<void> {
  let q = supabase
    .from('tanker_trips')
    .select('id, trip_acknowledgements(id)')
    .eq('dairy_unit_id', dairyUnitId)
    .eq('qc_status', 'accepted')
    .not('received_litres', 'is', null)
    .neq('status', 'cancelled');
  if (from) q = q.gte('trip_date', from);
  if (to) q = q.lte('trip_date', to);
  const { data } = await q;
  const missing = (data ?? []).filter((t) => !Array.isArray(t.trip_acknowledgements) || t.trip_acknowledgements.length === 0);
  for (const t of missing) {
    try {
      await syncTripAcknowledgements(String(t.id));
    } catch (e) {
      console.error('[ack] sync failed for trip', t.id, (e as Error).message);
    }
  }
}
