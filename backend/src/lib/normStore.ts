import { supabase } from '../supabase';
import { normsLookup } from './norms';
import type { NormRow } from './norms';
import type { NormsFor } from './milkAck';

const shape = (r: any): NormRow => ({
  id: Number(r.id), effective_from: String(r.effective_from), kg_per_tanker: Number(r.kg_per_tanker), pct: Number(r.pct),
});

export async function listNorms(dairyUnitId: string): Promise<NormRow[]> {
  const { data, error } = await supabase
    .from('ack_norms')
    .select('id, effective_from, kg_per_tanker, pct')
    .eq('dairy_unit_id', dairyUnitId)
    .order('effective_from', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(shape);
}

export async function loadNormsFor(dairyUnitId: string): Promise<NormsFor> {
  return normsLookup(await listNorms(dairyUnitId));
}
