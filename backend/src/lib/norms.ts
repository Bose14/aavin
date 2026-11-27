import { DEFAULT_NORMS } from './milkAck';
import type { AckNorms, NormsFor } from './milkAck';

export interface NormRow { id: number; effective_from: string; kg_per_tanker: number; pct: number }

/** pct is stored as a percentage (0.032); the calculation uses the fraction (0.00032). */
export function normsLookup(rows: NormRow[]): NormsFor {
  const sorted = [...rows].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  return (date) => {
    let hit: NormRow | undefined;
    for (const r of sorted) if (r.effective_from <= date) hit = r;
    const use: AckNorms = hit ? { kgPerTanker: hit.kg_per_tanker, pct: hit.pct / 100 } : DEFAULT_NORMS;
    return use;
  };
}

export function validateNorm(input: { effective_from?: unknown; kg_per_tanker?: unknown; pct?: unknown }): string | null {
  const d = String(input.effective_from ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return 'Choose a valid effective date.';
  const kg = Number(input.kg_per_tanker);
  const pct = Number(input.pct);
  if (!Number.isFinite(kg) || kg < 0 || kg > 1000) return 'Kg per tanker must be between 0 and 1000.';
  if (!Number.isFinite(pct) || pct < 0 || pct > 5) return 'The percentage must be between 0 and 5.';
  return null;
}
