/**
 * Per-BMC "dispatched vs acknowledged" figures for one tanker trip, shown on the tanker details page.
 * Uses the same formulas as the Milk ACK statement (see milkAckReport).
 */
import { specificGravity } from './ack';

export interface LoadingInput {
  bmc_id: string | number;
  dc_number: string;
  cell_key: string;
  quantity_litres: number | string;
  fat_pct: number | string | null;
  snf_pct: number | string | null;
  milk_type?: string | null;
}

export interface AckInput {
  bmc_id: string | number;
  dc_number: string;
  ack_litres: number | string;
  ack_fat_pct: number | string;
  ack_snf_pct: number | string;
}

export interface MilkFigures {
  litres: number;
  fat_pct: number;
  snf_pct: number;
  sp_gr: number;
  kg: number;
  fat_kg: number;
  snf_kg: number;
}

export interface DispatchAckRow {
  bmc_id: string;
  bmc_name: string;
  bmc_code: string | null;
  dc_number: string;
  cells: string[];
  milk_type: string | null;
  dispatched: MilkFigures;
  acknowledged: MilkFigures | null;
  difference: { litres: number; fat_pct: number; snf_pct: number; kg: number; fat_kg: number; snf_kg: number } | null;
}

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export function figures(litres: number, fat: number, snf: number): MilkFigures {
  const sp = specificGravity(fat, snf);
  return {
    litres: round(litres, 2),
    fat_pct: round(fat, 2),
    snf_pct: round(snf, 2),
    sp_gr: sp,
    kg: round(litres * sp, 1),
    fat_kg: round((sp * fat * litres) / 100, 2),
    snf_kg: round((sp * snf * litres) / 100, 2),
  };
}

export function buildDispatchAckRows(
  loadings: LoadingInput[],
  acks: AckInput[],
  bmcs: Map<string, { name: string; code: string | null }>,
): DispatchAckRow[] {
  const groups = new Map<string, { bmc_id: string; dc: string; litres: number; fatL: number; snfL: number; cells: Set<string>; milk: string | null }>();
  for (const l of loadings) {
    const key = `${l.bmc_id}|${l.dc_number}`;
    const g = groups.get(key) ?? { bmc_id: String(l.bmc_id), dc: String(l.dc_number), litres: 0, fatL: 0, snfL: 0, cells: new Set<string>(), milk: l.milk_type ?? null };
    const q = n(l.quantity_litres);
    g.litres += q;
    g.fatL += q * n(l.fat_pct);
    g.snfL += q * n(l.snf_pct);
    g.cells.add(String(l.cell_key));
    groups.set(key, g);
  }
  const ackBy = new Map(acks.map((a) => [`${a.bmc_id}|${a.dc_number}`, a]));

  return [...groups.entries()].map(([key, g]) => {
    const dispatched = figures(g.litres, g.litres ? g.fatL / g.litres : 0, g.litres ? g.snfL / g.litres : 0);
    const a = ackBy.get(key);
    const acknowledged = a ? figures(n(a.ack_litres), n(a.ack_fat_pct), n(a.ack_snf_pct)) : null;
    const b = bmcs.get(g.bmc_id);
    return {
      bmc_id: g.bmc_id,
      bmc_name: b?.name ?? `BMC ${g.bmc_id}`,
      bmc_code: b?.code ?? null,
      dc_number: g.dc,
      cells: [...g.cells].sort(),
      milk_type: g.milk,
      dispatched,
      acknowledged,
      difference: acknowledged
        ? {
            litres: round(acknowledged.litres - dispatched.litres, 2),
            fat_pct: round(acknowledged.fat_pct - dispatched.fat_pct, 2),
            snf_pct: round(acknowledged.snf_pct - dispatched.snf_pct, 2),
            kg: round(acknowledged.kg - dispatched.kg, 1),
            fat_kg: round(acknowledged.fat_kg - dispatched.fat_kg, 2),
            snf_kg: round(acknowledged.snf_kg - dispatched.snf_kg, 2),
          }
        : null,
    };
  });
}
