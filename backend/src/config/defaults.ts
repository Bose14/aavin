export interface StageTimeLimits {
  vehicle_entered: number;
  gross_weight: number;
  qc_completed: number;
  unloaded: number;
  tare_weight: number;
  cip_completed: number;
  vehicle_exit: number;
}

export interface ZoneSettings {
  dairy_unit_id: string;
  fat_min: number;
  fat_max: number;
  fat_benchmark: number;
  snf_min: number;
  snf_max: number;
  snf_benchmark: number;
  rejection_warn_pct: number;
  rejection_danger_pct: number;
  /** Rate formula: rate_base + fat_pct * rate_fat_coeff + snf_pct * rate_snf_coeff */
  rate_base: number;
  rate_fat_coeff: number;
  rate_snf_coeff: number;
  /** 'net': pay only for accepted milk (net_qty * rate); 'gross': pay gross qty and track rejection loss separately */
  rejection_payment_rule: 'net' | 'gross';
  edit_lock_hours: number;
  show_unit_profit: boolean;
  destinations: string[];
  locations: string[];
  /** Tanker Journey Assumptions & Configurations */
  stage_time_limits_min: StageTimeLimits;
  transit_loss_warn_pct: number;
  transit_loss_danger_pct: number;
  net_weight_diff_threshold_kg: number;
  quality_drop_threshold_fat: number;
  quality_drop_threshold_snf: number;
  milk_density_kg_per_litre: number;
  auto_refresh_interval_sec: number;
  updated_at?: string;
}

export interface SellingRateRule {
  id: string;
  dairy_unit_id: string;
  rate_per_litre: number;
  effective_from: string; // YYYY-MM-DD
  notes?: string | null;
  created_at?: string;
}

export const DEFAULT_STAGE_TIME_LIMITS: StageTimeLimits = {
  vehicle_entered: 15,
  gross_weight: 15,
  qc_completed: 30,
  unloaded: 45,
  tare_weight: 15,
  cip_completed: 30,
  vehicle_exit: 15,
};

export const DEFAULT_ASSUMPTIONS = {
  sellingRatePerLitre: 52.0,
  sellingRateEffectiveFrom: '2020-01-01',
  fatMin: 3.5,
  fatMax: 8.5,
  fatBenchmark: 4.0,
  snfMin: 8.0,
  snfMax: 9.5,
  snfBenchmark: 8.2,
  rejectionWarnPct: 5.0,
  rejectionDangerPct: 10.0,
  // 4.2% Fat & 8.5% SNF -> 4.2*3.5 + 8.5*1.8 = ₹30.00/L procurement rate
  rateBase: 0.0,
  rateFatCoeff: 3.5,
  rateSnfCoeff: 1.8,
  rejectionPaymentRule: 'net' as const,
  editLockHours: 24,
  showUnitProfitToStaff: false,
  destinations: [
    'Namakkal Dairy',
    'Namakkal Chilling Plant',
    'Erode Dairy',
    'Coimbatore Main Dairy',
  ],
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
  stageTimeLimitsMin: DEFAULT_STAGE_TIME_LIMITS,
  transitLossWarnPct: 0.5,
  transitLossDangerPct: 1.5,
  netWeightDiffThresholdKg: 50.0,
  qualityDropThresholdFat: 0.20,
  qualityDropThresholdSnf: 0.20,
  milkDensityKgPerLitre: 1.030,
  autoRefreshIntervalSec: 30,
} as const;

export function buildDefaultZoneSettings(dairyUnitId: string): ZoneSettings {
  return {
    dairy_unit_id: dairyUnitId,
    fat_min: DEFAULT_ASSUMPTIONS.fatMin,
    fat_max: DEFAULT_ASSUMPTIONS.fatMax,
    fat_benchmark: DEFAULT_ASSUMPTIONS.fatBenchmark,
    snf_min: DEFAULT_ASSUMPTIONS.snfMin,
    snf_max: DEFAULT_ASSUMPTIONS.snfMax,
    snf_benchmark: DEFAULT_ASSUMPTIONS.snfBenchmark,
    rejection_warn_pct: DEFAULT_ASSUMPTIONS.rejectionWarnPct,
    rejection_danger_pct: DEFAULT_ASSUMPTIONS.rejectionDangerPct,
    rate_base: DEFAULT_ASSUMPTIONS.rateBase,
    rate_fat_coeff: DEFAULT_ASSUMPTIONS.rateFatCoeff,
    rate_snf_coeff: DEFAULT_ASSUMPTIONS.rateSnfCoeff,
    rejection_payment_rule: DEFAULT_ASSUMPTIONS.rejectionPaymentRule,
    edit_lock_hours: DEFAULT_ASSUMPTIONS.editLockHours,
    show_unit_profit: DEFAULT_ASSUMPTIONS.showUnitProfitToStaff,
    destinations: [...DEFAULT_ASSUMPTIONS.destinations],
    locations: [...DEFAULT_ASSUMPTIONS.locations],
    stage_time_limits_min: { ...DEFAULT_ASSUMPTIONS.stageTimeLimitsMin },
    transit_loss_warn_pct: DEFAULT_ASSUMPTIONS.transitLossWarnPct,
    transit_loss_danger_pct: DEFAULT_ASSUMPTIONS.transitLossDangerPct,
    net_weight_diff_threshold_kg: DEFAULT_ASSUMPTIONS.netWeightDiffThresholdKg,
    quality_drop_threshold_fat: DEFAULT_ASSUMPTIONS.qualityDropThresholdFat,
    quality_drop_threshold_snf: DEFAULT_ASSUMPTIONS.qualityDropThresholdSnf,
    milk_density_kg_per_litre: DEFAULT_ASSUMPTIONS.milkDensityKgPerLitre,
    auto_refresh_interval_sec: DEFAULT_ASSUMPTIONS.autoRefreshIntervalSec,
  };
}

