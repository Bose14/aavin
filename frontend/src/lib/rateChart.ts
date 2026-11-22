export interface RateChartGrid {
  fat_values: number[];
  snf_values: number[];
  rates: number[][];
}

/** Charts are priced in 0.1 steps: 4.57 uses the 4.6 row (same rule as the server). */
export function round1(x: number): number {
  return Math.round(Number((x * 10).toFixed(6))) / 10;
}

export function lookupRate(chart: RateChartGrid, fat: number, snf: number): number | null {
  if (!Number.isFinite(fat) || !Number.isFinite(snf)) return null;
  const f = chart.fat_values.findIndex((v) => Math.abs(v - round1(fat)) < 0.001);
  const s = chart.snf_values.findIndex((v) => Math.abs(v - round1(snf)) < 0.001);
  if (f < 0 || s < 0) return null;
  const r = chart.rates[f]?.[s];
  return typeof r === 'number' ? r : null;
}

export function chartRange(chart: RateChartGrid) {
  return {
    fatMin: Math.min(...chart.fat_values),
    fatMax: Math.max(...chart.fat_values),
    snfMin: Math.min(...chart.snf_values),
    snfMax: Math.max(...chart.snf_values),
  };
}

export const milkTypeLabel = (t: string | null | undefined) => (t === 'BUFFALO' ? 'Buffalo' : 'Cow');

/**
 * Reads a rate card CSV: first row "Fat/Snf,7.7,7.8,…", then one row per fat value
 * "3,35.97,36.22,…". Returns the grid or a list of problems to show the admin.
 */
export function parseRateCsv(text: string): { grid?: RateChartGrid; errors: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.replace(/,/g, '') !== '');
  if (lines.length < 2) return { errors: ['The file needs a header row (SNF values) and at least one fat row.'] };
  const cells = (l: string) => l.split(',').map((c) => c.trim());

  const header = cells(lines[0]);
  const snf = header.slice(1).map(Number);
  const errors: string[] = [];
  if (snf.length === 0 || snf.some((v) => !Number.isFinite(v) || v <= 0)) {
    return { errors: ['The first row must be a label followed by SNF values, e.g. Fat/Snf,7.7,7.8,7.9'] };
  }

  const fat: number[] = [];
  const rates: number[][] = [];
  lines.slice(1).forEach((line, i) => {
    const c = cells(line);
    const f = Number(c[0]);
    const rowNo = i + 2;
    if (!Number.isFinite(f) || f <= 0) {
      errors.push(`Row ${rowNo}: fat value "${c[0]}" is not a number.`);
      return;
    }
    const vals = c.slice(1);
    if (vals.length !== snf.length) {
      errors.push(`Row ${rowNo} (fat ${f}): expected ${snf.length} rates, found ${vals.length}.`);
      return;
    }
    const nums = vals.map((v) => (v === '' ? NaN : Number(v)));
    const bad = nums.findIndex((n) => !Number.isFinite(n) || n <= 0);
    if (bad >= 0) {
      errors.push(`Row ${rowNo} (fat ${f}): the rate under SNF ${snf[bad]} is missing or not a number.`);
      return;
    }
    fat.push(f);
    rates.push(nums);
  });

  const ascending = (v: number[]) => v.every((x, i) => i === 0 || x > v[i - 1]);
  if (!ascending(snf)) errors.push('SNF values must be in increasing order without repeats.');
  if (!ascending(fat)) errors.push('Fat values must be in increasing order without repeats.');
  if (errors.length > 0) return { errors: errors.slice(0, 8) };
  return { grid: { fat_values: fat, snf_values: snf, rates }, errors: [] };
}

export function gridToCsv(chart: RateChartGrid): string {
  const head = ['Fat/Snf', ...chart.snf_values].join(',');
  const body = chart.fat_values.map((f, i) => [f, ...chart.rates[i]].join(','));
  return [head, ...body].join('\n') + '\n';
}
