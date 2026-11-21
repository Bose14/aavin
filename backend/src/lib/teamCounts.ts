import { supabase } from '../supabase';

/**
 * Computes active user count per team in a dairy unit.
 */
export async function computeActiveUsersPerTeam(dairyUnitId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = { ADMIN: 0, GATE: 0, QC: 0, UNLOADING: 0, BMC: 0 };

  const { data, error } = await supabase
    .from('users')
    .select('teams(code)')
    .eq('dairy_unit_id', dairyUnitId)
    .eq('is_active', true);

  if (error) {
    console.warn('[computeActiveUsersPerTeam] Error:', error.message);
    return counts;
  }

  for (const row of (data ?? []) as unknown as Array<{ teams: { code: string } | null }>) {
    const code = row.teams?.code;
    if (code && counts[code] !== undefined) counts[code] += 1;
  }
  return counts;
}
