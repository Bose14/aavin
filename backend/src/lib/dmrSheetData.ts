import { supabase } from '../supabase';
import { fetchAllPages } from './paging';
import { loadAckDays } from './milkAckData';
import { buildDmrSheet, makePctSource } from './dmrSheet';
import type { DmrSheet } from './dmrSheet';

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/** Loads the DMR statement for a date range: Milk Ack rows plus the BMC fat/SNF (imported periods or live entries). */
export async function loadDmrSheet(dairyUnitId: string, from: string, to: string): Promise<DmrSheet> {
  const [days, history, entries] = await Promise.all([
    loadAckDays(dairyUnitId, from, to),
    supabase
      .from('dmr_history')
      .select('period_from, period_to, bmc_code, qty, fat_lit, snf_lit')
      .eq('dairy_unit_id', dairyUnitId)
      .lte('period_from', to)
      .gte('period_to', from),
    fetchAllPages<any>((a, b) =>
      supabase
        .from('milk_entries')
        .select('id, quantity_litres, fat_pct, snf_pct, bmcs(cc_code)')
        .eq('dairy_unit_id', dairyUnitId)
        .gte('date', from)
        .lte('date', to)
        .order('id')
        .range(a, b),
    ),
  ]);
  if (history.error) throw new Error(history.error.message);
  if (entries.error) throw new Error(entries.error.message);
  const pct = makePctSource(
    (history.data ?? []).map((h: any) => ({
      period_from: String(h.period_from), period_to: String(h.period_to),
      bmc_code: Number(h.bmc_code), qty: Number(h.qty), fat_lit: Number(h.fat_lit), snf_lit: Number(h.snf_lit),
    })),
    (entries.data ?? []).map((e: any) => ({
      code: one<any>(e.bmcs)?.cc_code != null ? Number(one<any>(e.bmcs).cc_code) : null,
      qty: Number(e.quantity_litres ?? 0), fat_pct: Number(e.fat_pct ?? 0), snf_pct: Number(e.snf_pct ?? 0),
    })),
  );
  return buildDmrSheet(days, pct);
}
