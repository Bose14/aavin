import api from './api';

export interface SellingRateRule {
  id?: string;
  rate_per_litre: number;
  effective_from: string; // YYYY-MM-DD
  note?: string;
  created_at?: string;
}

export interface ZoneSettings {
  zone_id?: string;
  rate_base: number;
  rate_fat_coeff: number;
  rate_snf_coeff: number;
  fat_min: number;
  fat_max: number;
  fat_benchmark: number;
  snf_min: number;
  snf_max: number;
  snf_benchmark: number;
  rejection_warn_pct: number;
  rejection_danger_pct: number;
  rejection_payment_rule: 'net' | 'gross';
  edit_lock_hours: number;
  show_unit_profit: boolean;
  destinations: string[];
  locations: string[];
}

export const DEFAULT_SELLING_RATE = 52;

export const DEFAULT_ZONE_SETTINGS: ZoneSettings = {
  rate_base: 0,
  rate_fat_coeff: 3.5,
  rate_snf_coeff: 1.8,
  fat_min: 3.5,
  fat_max: 8.5,
  fat_benchmark: 4.0,
  snf_min: 8.0,
  snf_max: 9.5,
  snf_benchmark: 8.2,
  rejection_warn_pct: 5.0,
  rejection_danger_pct: 10.0,
  rejection_payment_rule: 'net',
  edit_lock_hours: 24,
  show_unit_profit: false,
  destinations: ['Namakkal Dairy', 'Salem Chilling Plant', 'Erode Dairy', 'Coimbatore Main Dairy'],
  locations: [
    'Rasipuram',
    'Namakkal',
    'Tiruchengode',
    'Paramathi Velur',
    'Sendamangalam',
    'Kolli Hills',
    'Komarapalayam',
    'Mohanur',
    'Vennandur',
    'Puduchatram',
    'Other',
  ],
};

/** Format currency in Indian numbering with negative sign placed before ₹ (e.g. -₹1,930, ₹1,25,000). */
export function formatINR(value: number, options?: { showPlus?: boolean; maximumFractionDigits?: number }): string {
  const safe = Math.abs(value) < 0.005 ? 0 : value;
  const maxDecimals = options?.maximumFractionDigits ?? 2;
  const formatted = Math.abs(safe).toLocaleString('en-IN', { maximumFractionDigits: maxDecimals });
  if (safe < 0) return `-₹${formatted}`;
  if (safe > 0 && options?.showPlus) return `+₹${formatted}`;
  return `₹${formatted}`;
}

/** Format compact currency ticks for chart axes (e.g. ₹0, ₹2k, ₹4k, -₹3k, ₹1.2L). */
export function formatCompactINR(value: number): string {
  const safe = Math.abs(value) < 0.005 ? 0 : value;
  if (safe === 0) return '₹0';
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);

  if (abs >= 100000) {
    const lakhs = abs / 100000;
    const text = Number.isInteger(lakhs) ? lakhs.toFixed(0) : lakhs.toFixed(1).replace(/\.0$/, '');
    return `${sign}₹${text}L`;
  }
  if (abs >= 1000) {
    const thousands = abs / 1000;
    const text = Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1).replace(/\.0$/, '');
    return `${sign}₹${text}k`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

/** Format YYYY-MM-DD (or ISO timestamp) strictly as dd-mm-yyyy everywhere. */
export function formatDateDDMMYYYY(input?: string | null): string {
  if (!input) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim());
  if (!m) return input;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Format ISO timestamp in dd-mm-yyyy, hh:mm AM/PM (IST). */
export function formatDateTimeDDMMYYYY(input?: string | null): string {
  if (!input) return '—';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return formatDateDDMMYYYY(input);
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const day = String(ist.getUTCDate()).padStart(2, '0');
  const mon = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yr = ist.getUTCFullYear();
  let hr = ist.getUTCHours();
  const min = String(ist.getUTCMinutes()).padStart(2, '0');
  const ampm = hr >= 12 ? 'PM' : 'AM';
  hr = hr % 12 || 12;
  return `${day}-${mon}-${yr} ${String(hr).padStart(2, '0')}:${min} ${ampm}`;
}

/** Backward-compatible aliases ensuring dd-mm-yyyy is used consistently on charts & tooltips. */
export function formatShortDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}-${m[2]}`;
}

export function formatFullDate(isoDate: string): string {
  return formatDateDDMMYYYY(isoDate);
}

/** Format Fat % or SNF % always to 2 decimal places (e.g. 4.50, 8.20). */
export function formatFatSnf(value: number | string | null | undefined, withPct = false): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return withPct ? '0.00%' : '0.00';
  return `${num.toFixed(2)}${withPct ? '%' : ''}`;
}

/** Format volume in Indian numbering with 1–2 decimals + L suffix (e.g. 1,250.5 L). */
export function formatLitres(value: number, maximumFractionDigits = 2): string {
  const safe = Math.abs(value) < 0.005 ? 0 : value;
  return `${safe.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits })} L`;
}

/** Calculate per-litre rate from configurable zone chart formula. */
export function calcRateFromChart(
  fatPct: number,
  snfPct: number,
  settings: Pick<ZoneSettings, 'rate_base' | 'rate_fat_coeff' | 'rate_snf_coeff'> = DEFAULT_ZONE_SETTINGS,
): number {
  const rate =
    Number(settings.rate_base) +
    fatPct * Number(settings.rate_fat_coeff) +
    snfPct * Number(settings.rate_snf_coeff);
  return +Math.max(0, rate).toFixed(2);
}

/** Resolve active zone selling rate for a given entry date (YYYY-MM-DD). */
export function getEffectiveSellingRate(
  entryDate: string,
  history: ReadonlyArray<Pick<SellingRateRule, 'rate_per_litre' | 'effective_from'>>,
  fallbackRate = DEFAULT_SELLING_RATE,
): number {
  if (!history || history.length === 0) return fallbackRate;
  const sorted = [...history].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const match = sorted.find(r => r.effective_from <= entryDate);
  return match ? Number(match.rate_per_litre) : Number(sorted[sorted.length - 1]?.rate_per_litre ?? fallbackRate);
}

/** Validate & normalize Indian mobile phone numbers (+91 XXXXX XXXXX). Returns null if invalid. */
export function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91')
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
}

/** Today's calendar date in local timezone (YYYY-MM-DD). */
export function getLocalTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/** Compute period-over-period percentage change label when baseline is non-zero. */
export function calcPeriodDelta(curr: number, prev: number): string | null {
  if (!prev) return null;
  const raw = ((curr - prev) / Math.abs(prev)) * 100;
  return `${curr >= prev ? '↑' : '↓'} ${Math.abs(raw).toFixed(1)}% vs prev`;
}

/** Download a binary file via authenticated API request and honor server Content-Disposition filename. */
export async function triggerBlobDownload(
  endpoint: string,
  params: Record<string, string | undefined>,
  fallbackFilename: string,
): Promise<void> {
  const cleanParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') cleanParams[k] = v;
  }

  const res = await api.get(endpoint, { params: cleanParams, responseType: 'blob' });
  const disp = String(res.headers['content-disposition'] || '');
  const match = /filename="?([^";]+)"?/i.exec(disp);
  const filename = match?.[1] || fallbackFilename;

  const blob = new Blob([res.data], { type: String(res.headers['content-type'] || 'application/octet-stream') });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
