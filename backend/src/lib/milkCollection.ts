import { lookupRate, outOfChartMessage } from './rateChart';
import type { RateChart } from './rateChart';

export interface CollectionLineInput {
  society_id: string | number;
  cans?: number | string | null;
  litres: number | string;
  fat_pct: number | string;
  snf_pct: number | string;
}

export interface CollectionLine {
  society_id: number;
  cans: number;
  litres: number;
  fat_pct: number;
  snf_pct: number;
  rate: number;
  amount: number;
}

const MAX_LINES = 300;

/** Validates society lines and prices each one from the rate chart (rate × litres = amount). */
export function prepareCollectionLines(
  input: unknown,
  chart: Pick<RateChart, 'milk_type' | 'fat_values' | 'snf_values' | 'rates'>,
): { lines: CollectionLine[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'Enter litres for at least one society' };
  if (input.length > MAX_LINES) return { error: `Too many societies (max ${MAX_LINES})` };

  const seen = new Set<number>();
  const lines: CollectionLine[] = [];
  for (const raw of input as CollectionLineInput[]) {
    const societyId = Number(raw?.society_id);
    const litres = Number(raw?.litres);
    const fat = Number(raw?.fat_pct);
    const snf = Number(raw?.snf_pct);
    const cans = raw?.cans == null || raw.cans === '' ? 0 : Number(raw.cans);

    if (!Number.isInteger(societyId) || societyId <= 0) return { error: 'Invalid society' };
    if (seen.has(societyId)) return { error: 'A society is listed twice' };
    seen.add(societyId);
    if (!Number.isFinite(litres) || litres <= 0 || litres > 100000) return { error: 'Litres must be greater than 0' };
    if (!Number.isInteger(cans) || cans < 0 || cans > 10000) return { error: 'Cans must be a whole number' };
    if (!Number.isFinite(fat) || fat <= 0 || fat > 30) return { error: 'Enter a valid Fat %' };
    if (!Number.isFinite(snf) || snf <= 0 || snf > 30) return { error: 'Enter a valid SNF %' };

    const rate = lookupRate(chart, fat, snf);
    if (rate == null) return { error: outOfChartMessage(chart, fat, snf) };
    lines.push({
      society_id: societyId,
      cans,
      litres: +litres.toFixed(2),
      fat_pct: +fat.toFixed(2),
      snf_pct: +snf.toFixed(2),
      rate,
      amount: +(litres * rate).toFixed(2),
    });
  }
  return { lines };
}

/** Totals for a shift: litres, litre-weighted fat/snf, weighted rate, fat/snf in kg. */
export function summarizeCollection(lines: ReadonlyArray<CollectionLine>) {
  const litres = lines.reduce((s, l) => s + l.litres, 0);
  const amount = lines.reduce((s, l) => s + l.amount, 0);
  const ltFat = lines.reduce((s, l) => s + l.litres * l.fat_pct / 100, 0);
  const ltSnf = lines.reduce((s, l) => s + l.litres * l.snf_pct / 100, 0);
  return {
    cans: lines.reduce((s, l) => s + l.cans, 0),
    litres: +litres.toFixed(2),
    fat_pct: litres > 0 ? +((ltFat / litres) * 100).toFixed(2) : 0,
    snf_pct: litres > 0 ? +((ltSnf / litres) * 100).toFixed(2) : 0,
    rate_per_litre: litres > 0 ? +(amount / litres).toFixed(2) : 0,
    amount: +amount.toFixed(2),
    lt_fat: +ltFat.toFixed(3),
    lt_snf: +ltSnf.toFixed(3),
  };
}
