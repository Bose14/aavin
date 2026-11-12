import { DEFAULT_SELLING_RATE } from './format';

export interface EntryValuation {
  grossQty: number;
  rejectionQty: number;
  netQty: number;
  ratePerLitre: number;
  procurementCost: number;
  rejectionLoss: number;
  estimatedRevenue: number;
  estimatedProfit: number;
  marginPct: number | null;
  rejectionPct: number;
}

/**
 * Calculate net litres, procurement cost, rejection loss, revenue, and projected profit/loss.
 * - 'net': farmers paid for accepted milk (netQty * rate), rejectionLoss = 0.
 * - 'gross': farmers paid for full poured quantity (grossQty * rate), rejectionLoss = rejectionQty * rate.
 */
export function computeEntryValuation({
  quantityLitres,
  rejectionQty = 0,
  ratePerLitre,
  sellingRate = DEFAULT_SELLING_RATE,
  rejectionPaymentRule = 'net',
}: {
  quantityLitres: number;
  rejectionQty?: number;
  ratePerLitre: number;
  sellingRate?: number;
  rejectionPaymentRule?: 'net' | 'gross';
}): EntryValuation {
  const grossQty = Number.isFinite(quantityLitres) && quantityLitres > 0 ? quantityLitres : 0;
  const rawRej = Number.isFinite(rejectionQty) && rejectionQty > 0 ? rejectionQty : 0;
  const rejectionQtySafe = Math.min(rawRej, grossQty);
  const netQty = Math.max(0, +(grossQty - rejectionQtySafe).toFixed(2));
  const safeRate = Number.isFinite(ratePerLitre) && ratePerLitre > 0 ? ratePerLitre : 0;

  const payableQty = rejectionPaymentRule === 'gross' ? grossQty : netQty;
  const procurementCost = +(payableQty * safeRate).toFixed(2);
  const rejectionLoss = rejectionPaymentRule === 'gross' ? +(rejectionQtySafe * safeRate).toFixed(2) : 0;
  const estimatedRevenue = +(netQty * sellingRate).toFixed(2);
  const estimatedProfit = +(estimatedRevenue - procurementCost).toFixed(2);
  const marginPct = estimatedRevenue > 0 ? +((estimatedProfit / estimatedRevenue) * 100).toFixed(1) : null;
  const rejectionPct = grossQty > 0 ? +((rejectionQtySafe / grossQty) * 100).toFixed(2) : 0;

  return {
    grossQty,
    rejectionQty: rejectionQtySafe,
    netQty,
    ratePerLitre: safeRate,
    procurementCost,
    rejectionLoss,
    estimatedRevenue,
    estimatedProfit,
    marginPct,
    rejectionPct,
  };
}

export interface MilkSummaryRow {
  quantity_litres: number;
  rejection_qty?: number | null;
  rate_per_litre: number;
  fat_pct?: number;
  snf_pct?: number;
  selling_rate_applied?: number | null;
}

/** Aggregate total collected volume, weighted quality, procurement value, and profit across entries. */
export function summarizeMilkEntries(
  rows: ReadonlyArray<MilkSummaryRow>,
  options?: { rejectionPaymentRule?: 'net' | 'gross'; defaultSellingRate?: number },
) {
  const rule = options?.rejectionPaymentRule ?? 'net';
  const fallbackSell = options?.defaultSellingRate ?? DEFAULT_SELLING_RATE;

  let grossQty = 0;
  let rejectionQty = 0;
  let netQty = 0;
  let procurementCost = 0;
  let rejectionLoss = 0;
  let estimatedRevenue = 0;
  let estimatedProfit = 0;
  let fatWeighted = 0;
  let snfWeighted = 0;

  for (const r of rows) {
    const v = computeEntryValuation({
      quantityLitres: Number(r.quantity_litres),
      rejectionQty: Number(r.rejection_qty ?? 0),
      ratePerLitre: Number(r.rate_per_litre),
      sellingRate: r.selling_rate_applied != null ? Number(r.selling_rate_applied) : fallbackSell,
      rejectionPaymentRule: rule,
    });
    grossQty += v.grossQty;
    rejectionQty += v.rejectionQty;
    netQty += v.netQty;
    procurementCost += v.procurementCost;
    rejectionLoss += v.rejectionLoss;
    estimatedRevenue += v.estimatedRevenue;
    estimatedProfit += v.estimatedProfit;
    fatWeighted += v.grossQty * Number(r.fat_pct ?? 0);
    snfWeighted += v.grossQty * Number(r.snf_pct ?? 0);
  }

  return {
    grossQty: +grossQty.toFixed(2),
    rejectionQty: +rejectionQty.toFixed(2),
    netQty: +netQty.toFixed(2),
    rejectionPct: grossQty > 0 ? +((rejectionQty / grossQty) * 100).toFixed(2) : 0,
    avgFat: grossQty > 0 ? +(fatWeighted / grossQty).toFixed(2) : 0,
    avgSnf: grossQty > 0 ? +(snfWeighted / grossQty).toFixed(2) : 0,
    procurementCost: +procurementCost.toFixed(2),
    rejectionLoss: +rejectionLoss.toFixed(2),
    estimatedRevenue: +estimatedRevenue.toFixed(2),
    estimatedProfit: +estimatedProfit.toFixed(2),
  };
}
