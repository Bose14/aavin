import { supabase } from '../supabase';

export type MilkType = 'COW' | 'BUFFALO';

/** A fat × SNF price grid: rates[fatIndex][snfIndex] is the procurement rate per litre. */
export interface RateChart {
  id: string;
  milk_type: MilkType;
  effective_from: string;
  name: string | null;
  fat_values: number[];
  snf_values: number[];
  rates: number[][];
}

/** Charts are priced in 0.1 steps: 4.57 looks up the 4.6 row. */
export function round1(x: number): number {
  return Math.round(Number((x * 10).toFixed(6))) / 10;
}

function indexOfValue(values: number[], x: number): number {
  return values.findIndex((v) => Math.abs(v - x) < 0.001);
}

/** Chart rate for a fat/SNF pair, or null when the pair is outside the chart. */
export function lookupRate(chart: Pick<RateChart, 'fat_values' | 'snf_values' | 'rates'>, fat: number, snf: number): number | null {
  if (!Number.isFinite(fat) || !Number.isFinite(snf)) return null;
  const f = indexOfValue(chart.fat_values, round1(fat));
  const s = indexOfValue(chart.snf_values, round1(snf));
  if (f < 0 || s < 0) return null;
  const rate = chart.rates[f]?.[s];
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
}

export function outOfChartMessage(chart: Pick<RateChart, 'fat_values' | 'snf_values' | 'milk_type'>, fat: number, snf: number): string {
  const lo = (v: number[]) => Math.min(...v).toFixed(1);
  const hi = (v: number[]) => Math.max(...v).toFixed(1);
  const kind = chart.milk_type === 'BUFFALO' ? 'buffalo' : 'cow';
  return `No ${kind} rate for Fat ${fat} / SNF ${snf}. The rate chart covers Fat ${lo(chart.fat_values)}–${hi(chart.fat_values)} and SNF ${lo(chart.snf_values)}–${hi(chart.snf_values)}.`;
}

// ---------------------------------------------------------------------------
// Loading (charts never change once published, so they are cached by id)
// ---------------------------------------------------------------------------

const PAGE = 1000;
const chartCache = new Map<string, RateChart>();
const versionCache = new Map<string, { expires: number; versions: { id: string; effective_from: string; name: string | null }[] }>();
const VERSION_TTL_MS = 60_000;

export function clearRateChartCache(): void {
  chartCache.clear();
  versionCache.clear();
}

async function loadChartById(row: { id: string | number; milk_type: string; effective_from: string; name: string | null }): Promise<RateChart> {
  const id = String(row.id);
  const hit = chartCache.get(id);
  if (hit) return hit;

  const cells: { fat: number; snf: number; rate: number }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('rate_chart_cells')
      .select('fat, snf, rate')
      .eq('chart_id', id)
      .order('fat')
      .order('snf')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const c of data ?? []) cells.push({ fat: Number(c.fat), snf: Number(c.snf), rate: Number(c.rate) });
    if ((data ?? []).length < PAGE) break;
  }
  const fats = [...new Set(cells.map((c) => c.fat))].sort((a, b) => a - b);
  const snfs = [...new Set(cells.map((c) => c.snf))].sort((a, b) => a - b);
  const rates = fats.map(() => snfs.map(() => 0));
  for (const c of cells) rates[fats.indexOf(c.fat)][snfs.indexOf(c.snf)] = c.rate;

  const chart: RateChart = {
    id,
    milk_type: row.milk_type === 'BUFFALO' ? 'BUFFALO' : 'COW',
    effective_from: String(row.effective_from),
    name: row.name ?? null,
    fat_values: fats,
    snf_values: snfs,
    rates,
  };
  chartCache.set(id, chart);
  return chart;
}

export async function getChartById(dairyUnitId: string, id: string): Promise<RateChart | null> {
  const { data, error } = await supabase
    .from('rate_charts')
    .select('id, milk_type, effective_from, name')
    .eq('id', id)
    .eq('dairy_unit_id', dairyUnitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? loadChartById(data as any) : null;
}

/** The chart in force on `date` (the latest one that started on or before it). */
export async function getChartFor(dairyUnitId: string, milkType: MilkType, date: string): Promise<RateChart | null> {
  const key = `${dairyUnitId}:${milkType}`;
  let entry = versionCache.get(key);
  if (!entry || entry.expires < Date.now()) {
    const { data, error } = await supabase
      .from('rate_charts')
      .select('id, milk_type, effective_from, name')
      .eq('dairy_unit_id', dairyUnitId)
      .eq('milk_type', milkType)
      .order('effective_from', { ascending: false });
    if (error) throw new Error(error.message);
    entry = {
      expires: Date.now() + VERSION_TTL_MS,
      versions: (data ?? []).map((r) => ({ id: String(r.id), effective_from: String(r.effective_from), name: r.name ?? null })),
    };
    versionCache.set(key, entry);
  }
  const match = entry.versions.find((v) => v.effective_from <= date);
  return match ? loadChartById({ ...match, milk_type: milkType }) : null;
}

export async function getBmcMilkType(bmcId: string): Promise<MilkType> {
  const { data, error } = await supabase.from('bmcs').select('milk_type').eq('id', bmcId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.milk_type === 'BUFFALO' ? 'BUFFALO' : 'COW';
}

/** Rate for one fat/SNF reading of a BMC on a date, or an error message to show the user. */
export async function resolveRate(args: {
  dairyUnitId: string;
  bmcId: string;
  date: string;
  fat: number;
  snf: number;
}): Promise<{ rate: number } | { error: string }> {
  const milkType = await getBmcMilkType(args.bmcId);
  const chart = await getChartFor(args.dairyUnitId, milkType, args.date);
  if (!chart) return { error: `No ${milkType === 'BUFFALO' ? 'buffalo' : 'cow'} rate chart is set for ${args.date}. Ask the admin to add one.` };
  const rate = lookupRate(chart, args.fat, args.snf);
  return rate == null ? { error: outOfChartMessage(chart, args.fat, args.snf) } : { rate };
}

// ---------------------------------------------------------------------------
// Validating an uploaded chart
// ---------------------------------------------------------------------------

export interface ChartInput {
  milk_type: MilkType;
  effective_from: string;
  name: string | null;
  fat_values: number[];
  snf_values: number[];
  rates: number[][];
}

const MAX_FAT_ROWS = 200;
const MAX_SNF_COLS = 100;

function validAxis(values: unknown, label: string, max: number): number[] | string {
  if (!Array.isArray(values) || values.length === 0) return `${label} values are missing`;
  if (values.length > max) return `Too many ${label} values (max ${max})`;
  const out: number[] = [];
  for (const raw of values) {
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0 || v > 30) return `${label} values must be numbers between 0 and 30`;
    if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return `${label} value ${v} has more than 2 decimals`;
    if (out.length && v <= out[out.length - 1]) return `${label} values must be in increasing order without repeats (check ${v})`;
    out.push(+v.toFixed(2));
  }
  return out;
}

export function parseChartInput(body: unknown): { chart: ChartInput } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const milkType = String(b.milk_type ?? '').toUpperCase();
  if (milkType !== 'COW' && milkType !== 'BUFFALO') return { error: 'Choose cow or buffalo' };

  const eff = String(b.effective_from ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || Number.isNaN(Date.parse(eff))) return { error: 'Effective from must be a valid date' };

  const fats = validAxis(b.fat_values, 'Fat', MAX_FAT_ROWS);
  if (typeof fats === 'string') return { error: fats };
  const snfs = validAxis(b.snf_values, 'SNF', MAX_SNF_COLS);
  if (typeof snfs === 'string') return { error: snfs };

  if (!Array.isArray(b.rates) || b.rates.length !== fats.length) return { error: 'Every fat row needs a rate for each SNF column' };
  const rates: number[][] = [];
  for (let i = 0; i < fats.length; i += 1) {
    const row = (b.rates as unknown[])[i];
    if (!Array.isArray(row) || row.length !== snfs.length) return { error: `Fat ${fats[i]} does not have a rate for every SNF column` };
    const parsed: number[] = [];
    for (const raw of row) {
      const r = Number(raw);
      if (raw === '' || raw === null || !Number.isFinite(r) || r <= 0 || r > 1000) return { error: `Fat ${fats[i]} has a missing or invalid rate` };
      if (Math.abs(r * 100 - Math.round(r * 100)) > 1e-6) return { error: `Fat ${fats[i]} has a rate with more than 2 decimals` };
      parsed.push(+r.toFixed(2));
    }
    rates.push(parsed);
  }

  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 120) : null;
  return { chart: { milk_type: milkType as MilkType, effective_from: eff, name, fat_values: fats, snf_values: snfs, rates } };
}
