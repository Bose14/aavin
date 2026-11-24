/** Rows of the Milk ACK statement (one per BMC per tanker, plus a TOTAL row per tanker). */
import type { Row } from './spreadsheet';

export interface AckViewRow {
  trip_id: string | number;
  trip_date: string;
  dispatch_at: string;
  shift: string | null;
  kind: string | null;
  route_name: string | null;
  milk_type: string | null;
  team_name: string | null;
  code_no: number | null;
  bmc_code: string | null;
  bmc_name: string;
  dest: string;
  vehicle_number: string;
  dc_number: string;
  [key: string]: unknown;
}

const n = (v: unknown) => (v == null ? 0 : Number(v));
const sp = (fat: number, snf: number) => Math.round((1 + (snf - (fat * 0.2 + 0.36)) / 250) * 10000) / 10000;

const SUM_FIELDS = [
  'inv_l', 'inv_lit_fat', 'inv_lit_snf', 'inv_kg', 'inv_kg_fat', 'inv_kg_snf',
  'ack_litres', 'ack_lit_fat', 'ack_lit_snf', 'ack_kg', 'ack_kg_fat', 'ack_kg_snf',
  'qty_diff_lit', 'diff_fat_kg', 'diff_snf_kg', 'fat_lit_diff', 'snf_lit_diff',
  'milk30_kg', 'milk30_lit', 'milk30_lit_fat', 'milk30_lit_snf', 'norm_fat_032', 'norm_snf_032',
  'allowed_fat', 'allowed_snf', 'above_fat', 'above_snf', 'net_loss_fat', 'net_loss_snf',
] as const;

/** Header text exactly as in the statement, in column order. */
export const ACK_COLUMNS = [
  'Date', 'MOR/EVE', 'BMC/CC', 'NAME OF THE ROUTE', 'TYPE OF MILK', 'NAME OF THE TEAM', 'BMC/CC-CODE',
  'NAME OF THE BMC/CC', 'DEST', 'Tanker No.', 'Inv/Adv.No', 'Dmr/Inv.Qty (In Lts.)', 'Inv. Fat%', 'Inv. Snf%',
  'Dmr/Inv. LIT- FAT', 'Dmr/Inv. LIT- SNF', 'Dmr/Inv.Qty (In Kg)', 'Sp.Gr.', 'Dmr/Inv. Kg Fat', 'Dmr/Inv. Kg Snf',
  'Ack. Qty ( In Lts.)', 'Ack. Fat%', 'Ack. Snf%', 'Ack. LIT- FAT', 'Ack. LIT- SNF', 'Ack. Qty ( In Kg.)', 'Sp.Gr. (Ack)',
  'Ack. KG FAT', 'Ack. KG SNF', 'QTY -DIFF (LIT)', 'DIFF-FAT KG', 'DIFF-SNF KG', 'FAT LIT-DIFF', 'SNF LIT-DIFF',
  '30 KG-MILK', '30 KG- MILK (LIT)', '30 KG- MILK LIT FAT', '30 KG- MILK LIT SNF', '0.032% FAT', '0.032% SNF',
  'Allowed Norms. Total Lit Fat', 'Allowed Norms. Total Lit Snf', 'Above Norms Lit Fat', 'Above Norms Lit Snf',
  'Net Loss Fat', 'Net Loss Snf',
] as const;

function toSheetRow(r: Record<string, unknown>, label: Record<string, unknown>): Row {
  const out: Row = {};
  const vals: unknown[] = [
    label.date, label.shift, label.kind, label.route, label.milk, label.team, label.code, label.name, label.dest,
    label.tanker, label.dc,
    r.inv_l, r.inv_fat, r.inv_snf, r.inv_lit_fat, r.inv_lit_snf, r.inv_kg, r.inv_sp, r.inv_kg_fat, r.inv_kg_snf,
    r.ack_litres, r.ack_fat, r.ack_snf, r.ack_lit_fat, r.ack_lit_snf, r.ack_kg, r.ack_sp, r.ack_kg_fat, r.ack_kg_snf,
    r.qty_diff_lit, r.diff_fat_kg, r.diff_snf_kg, r.fat_lit_diff, r.snf_lit_diff,
    r.milk30_kg, r.milk30_lit, r.milk30_lit_fat, r.milk30_lit_snf, r.norm_fat_032, r.norm_snf_032,
    r.allowed_fat, r.allowed_snf, r.above_fat, r.above_snf, r.net_loss_fat, r.net_loss_snf,
  ];
  ACK_COLUMNS.forEach((c, i) => {
    const v = vals[i];
    out[c] = typeof v === 'number' || v == null ? v ?? '' : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && i >= 11 ? Number(v) : v;
  });
  return out;
}

/** Sums a set of rows into one TOTAL row; percentages and Sp.Gr. are recalculated from the totals (as in the statement). */
function totalRow(group: AckViewRow[], label: string, date: string, extra: Record<string, unknown> = {}): Row {
  const t: Record<string, number> = {};
  for (const f of SUM_FIELDS) t[f] = group.reduce((s, r) => s + n(r[f]), 0);
  const invFat = t.inv_l ? (t.inv_lit_fat / t.inv_l) * 100 : 0;
  const invSnf = t.inv_l ? (t.inv_lit_snf / t.inv_l) * 100 : 0;
  const ackFat = t.ack_litres ? (t.ack_lit_fat / t.ack_litres) * 100 : 0;
  const ackSnf = t.ack_litres ? (t.ack_lit_snf / t.ack_litres) * 100 : 0;
  return toSheetRow({
    ...t, inv_fat: invFat, inv_snf: invSnf, inv_sp: sp(invFat, invSnf),
    ack_fat: ackFat, ack_snf: ackSnf, ack_sp: sp(ackFat, ackSnf),
  }, {
    date, shift: '', kind: '', route: '', milk: '', team: '', code: '', name: label, dest: '', tanker: '', dc: '', ...extra,
  });
}

/** Build the statement rows, grouped by date, then tanker, with a TOTAL row after each tanker. */
export function buildMilkAckRows(rows: AckViewRow[], formatDate: (iso: string) => string): Row[] {
  const sorted = [...rows].sort((a, b) =>
    a.trip_date.localeCompare(b.trip_date) ||
    a.dispatch_at.localeCompare(b.dispatch_at) ||
    String(a.trip_id).localeCompare(String(b.trip_id), undefined, { numeric: true }) ||
    a.bmc_name.localeCompare(b.bmc_name),
  );

  const out: Row[] = [];
  let i = 0;
  while (i < sorted.length) {
    const tripId = sorted[i].trip_id;
    const group: AckViewRow[] = [];
    while (i < sorted.length && sorted[i].trip_id === tripId) group.push(sorted[i++]);

    for (const r of group) {
      out.push(toSheetRow(r, {
        date: formatDate(r.trip_date), shift: r.shift ?? '', kind: r.kind ?? '', route: r.route_name ?? '',
        milk: r.milk_type ?? '', team: r.team_name ?? '', code: r.code_no ?? r.bmc_code ?? '', name: r.bmc_name,
        dest: r.dest, tanker: r.vehicle_number, dc: r.dc_number,
      }));
    }

    out.push(totalRow(group, 'TOTAL', formatDate(group[0].trip_date), {
      route: group[0].route_name ?? '', milk: group[0].milk_type ?? '', dest: group[0].dest, tanker: group[0].vehicle_number,
    }));
  }
  return out;
}

export type AckGroup = 'team' | 'bmc' | 'tanker';

const NO_TEAM = 'NO TEAM';
const groupKey = (g: AckGroup, r: AckViewRow) =>
  g === 'team' ? (r.team_name?.trim() || NO_TEAM) : g === 'bmc' ? r.bmc_name : r.vehicle_number;

/**
 * Statement grouped by team, BMC or tanker: every group lists its rows (by date), then a
 * "TOTAL - <group>" row; a GRAND TOTAL closes the sheet.
 */
export function buildGroupedAckRows(rows: AckViewRow[], group: AckGroup, formatDate: (iso: string) => string): Row[] {
  const cmpIn = (a: AckViewRow, b: AckViewRow) =>
    a.trip_date.localeCompare(b.trip_date) ||
    a.dispatch_at.localeCompare(b.dispatch_at) ||
    String(a.trip_id).localeCompare(String(b.trip_id), undefined, { numeric: true }) ||
    a.bmc_name.localeCompare(b.bmc_name);
  const sorted = [...rows].sort((a, b) => {
    const ka = groupKey(group, a);
    const kb = groupKey(group, b);
    return (ka === NO_TEAM ? 1 : 0) - (kb === NO_TEAM ? 1 : 0) || ka.localeCompare(kb, undefined, { numeric: true }) || (group === 'team' ? a.bmc_name.localeCompare(b.bmc_name) : 0) || cmpIn(a, b);
  });

  const out: Row[] = [];
  let i = 0;
  while (i < sorted.length) {
    const key = groupKey(group, sorted[i]);
    const part: AckViewRow[] = [];
    while (i < sorted.length && groupKey(group, sorted[i]) === key) part.push(sorted[i++]);
    for (const r of part) {
      out.push(toSheetRow(r, {
        date: formatDate(r.trip_date), shift: r.shift ?? '', kind: r.kind ?? '', route: r.route_name ?? '',
        milk: r.milk_type ?? '', team: r.team_name ?? '', code: r.code_no ?? r.bmc_code ?? '', name: r.bmc_name,
        dest: r.dest, tanker: r.vehicle_number, dc: r.dc_number,
      }));
    }
    out.push(totalRow(part, `TOTAL - ${key}`, ''));
  }
  if (sorted.length) out.push(totalRow(sorted, 'GRAND TOTAL', ''));
  return out;
}

export const SUMMARY_COLUMNS = {
  team: 'TEAM', bmc: 'BMC', tanker: 'TANKER',
} as const;

/** One line per team / BMC / tanker with the quantities that matter, plus a grand total. */
export function buildAckSummary(rows: AckViewRow[], group: AckGroup): { columns: string[]; rows: Row[] } {
  const label = SUMMARY_COLUMNS[group];
  const columns = [
    label, 'Trips', 'Dmr/Inv.Qty (In Lts.)', 'Ack. Qty ( In Lts.)', 'QTY -DIFF (LIT)',
    'Inv. Fat%', 'Inv. Snf%', 'Ack. Fat%', 'Ack. Snf%',
    'Dmr/Inv. Kg Fat', 'Ack. KG FAT', 'DIFF-FAT KG', 'Dmr/Inv. Kg Snf', 'Ack. KG SNF', 'DIFF-SNF KG', 'Net Loss Fat', 'Net Loss Snf',
  ];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const line = (name: string, part: AckViewRow[]): Row => {
    const t: Record<string, number> = {};
    for (const f of SUM_FIELDS) t[f] = part.reduce((s, r) => s + n(r[f]), 0);
    return {
      [label]: name,
      Trips: new Set(part.map((r) => String(r.trip_id))).size,
      'Dmr/Inv.Qty (In Lts.)': r2(t.inv_l),
      'Ack. Qty ( In Lts.)': r2(t.ack_litres),
      'QTY -DIFF (LIT)': r2(t.qty_diff_lit),
      'Inv. Fat%': t.inv_l ? r2((t.inv_lit_fat / t.inv_l) * 100) : 0,
      'Inv. Snf%': t.inv_l ? r2((t.inv_lit_snf / t.inv_l) * 100) : 0,
      'Ack. Fat%': t.ack_litres ? r2((t.ack_lit_fat / t.ack_litres) * 100) : 0,
      'Ack. Snf%': t.ack_litres ? r2((t.ack_lit_snf / t.ack_litres) * 100) : 0,
      'Dmr/Inv. Kg Fat': r2(t.inv_kg_fat), 'Ack. KG FAT': r2(t.ack_kg_fat), 'DIFF-FAT KG': r2(t.diff_fat_kg),
      'Dmr/Inv. Kg Snf': r2(t.inv_kg_snf), 'Ack. KG SNF': r2(t.ack_kg_snf), 'DIFF-SNF KG': r2(t.diff_snf_kg),
      'Net Loss Fat': r2(t.net_loss_fat), 'Net Loss Snf': r2(t.net_loss_snf),
    };
  };
  const by = new Map<string, AckViewRow[]>();
  for (const r of rows) by.set(groupKey(group, r), [...(by.get(groupKey(group, r)) ?? []), r]);
  const keys = [...by.keys()].sort((a, b) => (a === NO_TEAM ? 1 : 0) - (b === NO_TEAM ? 1 : 0) || a.localeCompare(b, undefined, { numeric: true }));
  const out = keys.map((k) => line(k, by.get(k)!));
  if (rows.length) out.push(line('GRAND TOTAL', rows));
  return { columns, rows: out };
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Heading of the statement, e.g. "NAMAKKAL UNION-MILK DISPOSAL AND ACKNOWLEDGEMENT- STATEMENT FOR THE MONTH OF SEP-2026". */
export function ackTitle(unitName: string | null | undefined, from: string, to: string): string {
  const union = String(unitName ?? '').toUpperCase().replace(/\s+(DAIRY UNIT|DAIRY|UNION)$/, '').trim() || 'DAIRY';
  const dmy = (iso: string) => iso.split('-').reverse().join('-');
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const lastDay = new Date(fy, fm, 0).getDate();
  const wholeMonth = fy === ty && fm === tm && fd === 1 && to === `${ty}-${String(tm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const when = wholeMonth
    ? `FOR THE MONTH OF ${MON[fm - 1]}-${fy}`
    : from === to
      ? `FOR THE DATE ${dmy(from)}`
      : `FOR THE PERIOD ${dmy(from)} TO ${dmy(to)}`;
  return `${union} UNION-MILK DISPOSAL AND ACKNOWLEDGEMENT- STATEMENT ${when}`;
}
