/**
 * Milk Disposal & Acknowledgement statement (the "MILK ACK" sheet).
 *
 * One row per BMC/CC invoice on a tanker (what was sent) next to what the union
 * acknowledged (what was received), with weights, differences and the allowed-loss
 * norms. Every formula below was checked against the October 2026 sheet.
 *
 * Pure functions only: no database access, so the maths is easy to test.
 */

export interface AckInput {
  date: string; // YYYY-MM-DD
  shift: string; // MOR | EVE | EVE/MOR
  kind: string; // BMC | CC
  route: string;
  milk_type: string;
  team: string;
  code: number | null;
  name: string;
  dest: string;
  tanker: string;
  inv_no: string;
  qty: number; // litres sent
  fat: number;
  snf: number;
  ack: { qty: number; fat: number; snf: number } | null; // null = not acknowledged yet
  /**
   * Separate block of the sheet on the same tanker and day (the extra EVE block at the end of a period).
   * Each block has its own TOTAL line and its own 30 kg allowance. Leave unset for live data.
   */
  block?: string;
}

export interface AckRow {
  is_total: boolean;
  date: string;
  shift: string;
  kind: string;
  route: string;
  milk_type: string;
  team: string;
  code: number | null;
  name: string;
  dest: string;
  tanker: string;
  inv_no: string;
  // Sent (Dmr / Inv)
  qty: number; fat: number; snf: number; lit_fat: number; lit_snf: number;
  kg: number; sg: number; kg_fat: number; kg_snf: number;
  // Received (Ack) — null when not acknowledged yet
  acked: boolean;
  ack_qty: number | null; ack_fat: number | null; ack_snf: number | null;
  ack_lit_fat: number | null; ack_lit_snf: number | null;
  ack_kg: number | null; ack_sg: number | null; ack_kg_fat: number | null; ack_kg_snf: number | null;
  // Differences and norms
  qty_diff: number | null; diff_fat_kg: number | null; diff_snf_kg: number | null;
  fat_lit_diff: number | null; snf_lit_diff: number | null;
  kg30: number | null; kg30_lit: number | null; kg30_lit_fat: number | null; kg30_lit_snf: number | null;
  p032_fat: number | null; p032_snf: number | null;
  allowed_fat: number | null; allowed_snf: number | null;
  above_fat: number | null; above_snf: number | null;
  loss_fat: number | null; loss_snf: number | null;
}

export interface AckDay { date: string; rows: AckRow[] }

/** Allowed transit loss: 30 kg of milk per tanker (shared by litres) plus 0.032% of the litres sent. */
export const ALLOWED_KG_PER_TANKER = 30;
export const ALLOWED_PCT = 0.00032;

/** Allowed-loss norms in force on a date. The defaults apply when none are configured. */
export interface AckNorms { kgPerTanker: number; pct: number } // pct as a fraction: 0.032% = 0.00032
export type NormsFor = (date: string) => AckNorms;
export const DEFAULT_NORMS: AckNorms = { kgPerTanker: ALLOWED_KG_PER_TANKER, pct: ALLOWED_PCT };
const defaultNormsFor: NormsFor = () => DEFAULT_NORMS;

const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round((v + Number.EPSILON) * f) / f;
};

/** Specific gravity from fat and SNF (CLR = 4 x (SNF - 0.2 x Fat - 0.36)). */
export function specificGravity(fat: number, snf: number): number {
  return round(1 + (4 * (snf - 0.2 * fat - 0.36)) / 1000, 4);
}

const emptyAck = {
  acked: false,
  ack_qty: null, ack_fat: null, ack_snf: null, ack_lit_fat: null, ack_lit_snf: null,
  ack_kg: null, ack_sg: null, ack_kg_fat: null, ack_kg_snf: null,
  qty_diff: null, diff_fat_kg: null, diff_snf_kg: null, fat_lit_diff: null, snf_lit_diff: null,
  kg30: null, kg30_lit: null, kg30_lit_fat: null, kg30_lit_snf: null,
  p032_fat: null, p032_snf: null, allowed_fat: null, allowed_snf: null,
  above_fat: null, above_snf: null, loss_fat: null, loss_snf: null,
} as const;

/** `groupQty` = litres sent on the whole tanker that day (the 30 kg allowance is shared by it). */
export function computeAckRow(i: AckInput, groupQty: number, norms: AckNorms = DEFAULT_NORMS): AckRow {
  const sg = specificGravity(i.fat, i.snf);
  const kg = i.qty * sg;
  const base = {
    is_total: false, date: i.date, shift: i.shift, kind: i.kind, route: i.route, milk_type: i.milk_type,
    team: i.team, code: i.code, name: i.name, dest: i.dest, tanker: i.tanker, inv_no: i.inv_no,
    qty: i.qty, fat: i.fat, snf: i.snf,
    lit_fat: (i.qty * i.fat) / 100, lit_snf: (i.qty * i.snf) / 100,
    kg, sg, kg_fat: (kg * i.fat) / 100, kg_snf: (kg * i.snf) / 100,
  };
  if (!i.ack) return { ...base, ...emptyAck };

  const a = i.ack;
  const asg = specificGravity(a.fat, a.snf);
  const akg = a.qty * asg;
  const ackLitFat = (a.qty * a.fat) / 100;
  const ackLitSnf = (a.qty * a.snf) / 100;
  const ackKgFat = (akg * a.fat) / 100;
  const ackKgSnf = (akg * a.snf) / 100;

  const fatLitDiff = ackLitFat - base.lit_fat;
  const snfLitDiff = ackLitSnf - base.lit_snf;

  const kg30 = groupQty > 0 ? (norms.kgPerTanker * i.qty) / groupQty : 0;
  const kg30Lit = kg30 / sg;
  const kg30LitFat = (kg30Lit * i.fat) / 100;
  const kg30LitSnf = (kg30Lit * i.snf) / 100;
  const p032 = i.qty * norms.pct;
  const allowedFat = kg30LitFat + p032;
  const allowedSnf = kg30LitSnf + p032;
  const aboveFat = fatLitDiff + allowedFat;
  const aboveSnf = snfLitDiff + allowedSnf;

  return {
    ...base,
    acked: true,
    ack_qty: a.qty, ack_fat: a.fat, ack_snf: a.snf, ack_lit_fat: ackLitFat, ack_lit_snf: ackLitSnf,
    ack_kg: akg, ack_sg: asg, ack_kg_fat: ackKgFat, ack_kg_snf: ackKgSnf,
    qty_diff: a.qty - i.qty, diff_fat_kg: ackKgFat - base.kg_fat, diff_snf_kg: ackKgSnf - base.kg_snf,
    fat_lit_diff: fatLitDiff, snf_lit_diff: snfLitDiff,
    kg30, kg30_lit: kg30Lit, kg30_lit_fat: kg30LitFat, kg30_lit_snf: kg30LitSnf,
    p032_fat: p032, p032_snf: p032,
    allowed_fat: allowedFat, allowed_snf: allowedSnf,
    above_fat: aboveFat, above_snf: aboveSnf,
    loss_fat: Math.min(aboveFat, 0), loss_snf: Math.min(aboveSnf, 0),
  };
}

const SUM_KEYS = [
  'qty', 'lit_fat', 'lit_snf', 'kg', 'kg_fat', 'kg_snf',
  'ack_qty', 'ack_lit_fat', 'ack_lit_snf', 'ack_kg', 'ack_kg_fat', 'ack_kg_snf',
  'qty_diff', 'diff_fat_kg', 'diff_snf_kg', 'fat_lit_diff', 'snf_lit_diff',
  'kg30', 'kg30_lit', 'kg30_lit_fat', 'kg30_lit_snf', 'p032_fat', 'p032_snf',
  'allowed_fat', 'allowed_snf', 'above_fat', 'above_snf', 'loss_fat', 'loss_snf',
] as const;

/** TOTAL line for a route/tanker: sums, with fat/SNF as litre-weighted averages. */
export function totalRow(rows: AckRow[], label: { date: string; route: string; milk_type: string; dest: string; tanker: string }): AckRow {
  const sums: Record<string, number> = {};
  for (const k of SUM_KEYS) sums[k] = 0;
  let ackedSent = 0; // litres sent on rows that were acknowledged
  let anyAck = false;
  for (const r of rows) {
    for (const k of SUM_KEYS) sums[k] += (r[k] as number | null) ?? 0;
    if (r.acked) { anyAck = true; ackedSent += r.qty; }
  }
  void ackedSent;
  const q = sums.qty;
  const aq = sums.ack_qty;
  const ackOrNull = (v: number) => (anyAck ? v : null);
  return {
    is_total: true, date: label.date, shift: '', kind: '', route: label.route, milk_type: label.milk_type,
    team: '', code: null, name: 'TOTAL', dest: label.dest, tanker: label.tanker, inv_no: '',
    qty: q, fat: q > 0 ? (sums.lit_fat / q) * 100 : 0, snf: q > 0 ? (sums.lit_snf / q) * 100 : 0,
    lit_fat: sums.lit_fat, lit_snf: sums.lit_snf,
    kg: sums.kg, sg: q > 0 ? round(sums.kg / q, 4) : 0, kg_fat: sums.kg_fat, kg_snf: sums.kg_snf,
    acked: anyAck,
    ack_qty: ackOrNull(aq),
    ack_fat: anyAck && aq > 0 ? (sums.ack_lit_fat / aq) * 100 : null,
    ack_snf: anyAck && aq > 0 ? (sums.ack_lit_snf / aq) * 100 : null,
    ack_lit_fat: ackOrNull(sums.ack_lit_fat), ack_lit_snf: ackOrNull(sums.ack_lit_snf),
    ack_kg: ackOrNull(sums.ack_kg), ack_sg: anyAck && aq > 0 ? round(sums.ack_kg / aq, 4) : null,
    ack_kg_fat: ackOrNull(sums.ack_kg_fat), ack_kg_snf: ackOrNull(sums.ack_kg_snf),
    qty_diff: ackOrNull(sums.qty_diff), diff_fat_kg: ackOrNull(sums.diff_fat_kg), diff_snf_kg: ackOrNull(sums.diff_snf_kg),
    fat_lit_diff: ackOrNull(sums.fat_lit_diff), snf_lit_diff: ackOrNull(sums.snf_lit_diff),
    kg30: ackOrNull(sums.kg30), kg30_lit: ackOrNull(sums.kg30_lit),
    kg30_lit_fat: ackOrNull(sums.kg30_lit_fat), kg30_lit_snf: ackOrNull(sums.kg30_lit_snf),
    p032_fat: ackOrNull(sums.p032_fat), p032_snf: ackOrNull(sums.p032_snf),
    allowed_fat: ackOrNull(sums.allowed_fat), allowed_snf: ackOrNull(sums.allowed_snf),
    above_fat: ackOrNull(sums.above_fat), above_snf: ackOrNull(sums.above_snf),
    loss_fat: ackOrNull(sums.loss_fat), loss_snf: ackOrNull(sums.loss_snf),
  };
}

const groupKey = (i: { date: string; route: string; tanker: string; block?: string }) => `${i.date}|${i.route}|${i.tanker}|${i.block ?? ''}`;

/**
 * Builds the day-by-day statement. Rows keep the order given for the
 * routes; each route/tanker gets a TOTAL line (CC rows with no route have none).
 */
export function buildAckDays(inputs: AckInput[], normsFor: NormsFor = defaultNormsFor): AckDay[] {
  const groupQty = new Map<string, number>();
  for (const i of inputs) groupQty.set(groupKey(i), (groupQty.get(groupKey(i)) ?? 0) + i.qty);

  const byDay = new Map<string, Map<string, AckInput[]>>();
  for (const i of inputs) {
    let day = byDay.get(i.date);
    if (!day) byDay.set(i.date, (day = new Map()));
    const k = groupKey(i);
    const list = day.get(k);
    if (list) list.push(i);
    else day.set(k, [i]);
  }

  const days: AckDay[] = [];
  for (const date of [...byDay.keys()].sort()) {
    const rows: AckRow[] = [];
    for (const [k, list] of byDay.get(date)!) {
      const computed = list.map((i) => computeAckRow(i, groupQty.get(k) ?? 0, normsFor(date)));
      rows.push(...computed);
      const first = list[0];
      if (first.route) {
        rows.push(totalRow(computed, { date, route: first.route, milk_type: first.milk_type, dest: first.dest, tanker: first.tanker }));
      }
    }
    days.push({ date, rows });
  }
  return days;
}

/** The three statement periods of a month: 1-10, 11-20 and 21-end. */
export function monthPeriods(month: string): Array<{ key: '1-10' | '11-20' | '21-end'; from: string; to: string }> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
  return [
    { key: '1-10', from: d(1), to: d(10) },
    { key: '11-20', from: d(11), to: d(20) },
    { key: '21-end', from: d(21), to: d(last) },
  ];
}
