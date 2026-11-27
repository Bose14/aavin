/** Period choices shared by the month-based reports (Milk Ack, BMC DMR Loss, Reports tab). */
export type PeriodKey = '1-10' | '11-20' | '21-end' | 'month' | 'year' | 'custom';
export type FixedPeriodKey = Exclude<PeriodKey, 'custom'>;

export const PERIODS: Array<{ key: FixedPeriodKey; label: string }> = [
  { key: '1-10', label: '1 – 10' },
  { key: '11-20', label: '11 – 20' },
  { key: '21-end', label: '21 – end' },
  { key: 'month', label: 'Full month' },
  { key: 'year', label: 'Full year' },
];

/** The on-screen table (testing) covers up to a month; Excel downloads can cover up to a year. */
export const MAX_VIEW_DAYS = 31;
export const MAX_DOWNLOAD_DAYS = 366;

export const spanDays = (from: string, to: string) =>
  from && to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** `month` is YYYY-MM; the year periods use its year (1 Jan to 31 Dec). */
export function periodRange(month: string, key: FixedPeriodKey): { from: string; to: string } {
  if (key === '1-10') return { from: `${month}-01`, to: `${month}-10` };
  if (key === '11-20') return { from: `${month}-11`, to: `${month}-20` };
  if (key === '21-end') return { from: `${month}-21`, to: `${month}-${pad(lastDay(month))}` };
  if (key === 'month') return { from: `${month}-01`, to: `${month}-${pad(lastDay(month))}` };
  return { from: `${month.slice(0, 4)}-01-01`, to: `${month.slice(0, 4)}-12-31` };
}

export function previousMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
