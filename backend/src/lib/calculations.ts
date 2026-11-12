import { DEFAULT_ASSUMPTIONS } from '../config/defaults';
import type { SellingRateRule, ZoneSettings } from '../config/defaults';

export interface MilkMetricInput {
  date: string;
  fat_pct: number | string;
  snf_pct: number | string;
  quantity_litres: number | string;
  rejection_qty?: number | string | null;
  rate_per_litre: number | string;
  selling_rate_applied?: number | string | null;
}

/** Calculate per-litre procurement rate from Fat %, SNF % and configurable zone rate chart. */
export function calculateRateFromChart(
  fatPct: number,
  snfPct: number,
  settings: Pick<ZoneSettings, 'rate_base' | 'rate_fat_coeff' | 'rate_snf_coeff'>,
): number {
  const rate =
    Number(settings.rate_base) +
    fatPct * Number(settings.rate_fat_coeff) +
    snfPct * Number(settings.rate_snf_coeff);
  return +Math.max(0, rate).toFixed(2);
}

/** Resolve the selling rate active on a given entry date (YYYY-MM-DD) without altering past rates. */
export function getEffectiveSellingRate(
  entryDate: string,
  history: ReadonlyArray<Pick<SellingRateRule, 'rate_per_litre' | 'effective_from'>>,
  fallbackRate = DEFAULT_ASSUMPTIONS.sellingRatePerLitre,
): number {
  if (!history || history.length === 0) return fallbackRate;
  const sorted = [...history].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const match = sorted.find((r) => r.effective_from <= entryDate);
  return match ? Number(match.rate_per_litre) : Number(sorted[sorted.length - 1]?.rate_per_litre ?? fallbackRate);
}

/** Compute quantity-weighted Fat % and SNF % (sum(qty * value) / sum(qty)). */
export function calculateWeightedQuality(rows: ReadonlyArray<Pick<MilkMetricInput, 'quantity_litres' | 'fat_pct' | 'snf_pct'>>) {
  let totalQty = 0;
  let fatWeightedSum = 0;
  let snfWeightedSum = 0;

  for (const row of rows) {
    const qty = Math.max(0, Number(row.quantity_litres) || 0);
    if (qty <= 0) continue;
    totalQty += qty;
    fatWeightedSum += qty * (Number(row.fat_pct) || 0);
    snfWeightedSum += qty * (Number(row.snf_pct) || 0);
  }

  if (totalQty <= 0) {
    return { avg_fat: 0, avg_snf: 0, total_qty: 0 };
  }

  return {
    avg_fat: +(fatWeightedSum / totalQty).toFixed(2),
    avg_snf: +(snfWeightedSum / totalQty).toFixed(2),
    total_qty: +totalQty.toFixed(2),
  };
}

/** Compute single milk entry financials using NET or GROSS rejection rule and effective-date selling rate. */
export function calculateEntryFinancials(
  entry: MilkMetricInput,
  settings: Pick<ZoneSettings, 'rejection_payment_rule'>,
  sellingRateHistory: ReadonlyArray<Pick<SellingRateRule, 'rate_per_litre' | 'effective_from'>>,
) {
  const quantity = Math.max(0, Number(entry.quantity_litres) || 0);
  const rejection = Math.min(quantity, Math.max(0, Number(entry.rejection_qty ?? 0) || 0));
  const netQuantity = Math.max(0, +(quantity - rejection).toFixed(2));
  const rate = Math.max(0, Number(entry.rate_per_litre) || 0);

  const sellingRate = entry.selling_rate_applied != null && Number(entry.selling_rate_applied) > 0
    ? Number(entry.selling_rate_applied)
    : getEffectiveSellingRate(entry.date, sellingRateHistory);

  const payableQty = settings.rejection_payment_rule === 'gross' ? quantity : netQuantity;
  const cost = +(payableQty * rate).toFixed(2);
  const rejectionLoss = settings.rejection_payment_rule === 'gross' ? +(rejection * rate).toFixed(2) : 0;
  const revenue = +(netQuantity * sellingRate).toFixed(2);
  const profit = +(revenue - cost).toFixed(2);

  return {
    quantity: +quantity.toFixed(2),
    rejection: +rejection.toFixed(2),
    net_quantity: netQuantity,
    selling_rate: +sellingRate.toFixed(2),
    cost,
    rejection_loss: rejectionLoss,
    revenue,
    profit,
  };
}

/** Format YYYY-MM-DD as dd-mm-yyyy. */
export function formatDateDDMMYYYY(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Normalize Indian phone number (+91 XXXXXXXXXX) or return null if invalid. */
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

