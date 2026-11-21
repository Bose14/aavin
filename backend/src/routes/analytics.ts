import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import {
  calculateEntryFinancials,
  calculateWeightedQuality,
  getEffectiveSellingRate,
} from '../lib/calculations';
import {
  getSellingRateHistory,
  getZoneSettings,
  isMissingSchemaError,
} from '../lib/settingsStore';
import { enrichTankerRow } from './tanker';
import { fetchTrips } from '../lib/tripStore';
import { STAGE_COLORS } from '../lib/tankerJourney';
import type { StageRecordItem } from '../lib/tankerJourney';

const router = Router();
router.use(authMiddleware);

function getIstTodayISO(): string {
  const nowIst = new Date(Date.now() + 5.5 * 3600 * 1000);
  return nowIst.toISOString().slice(0, 10);
}

function addDaysISO(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function resolveDateRange(period: string, fromParam?: string, toParam?: string) {
  const todayISO = getIstTodayISO();
  let fromDate: string;
  let toDate: string;
  let prevFromDate: string;
  let prevToDate: string;

  if (period === 'custom' && fromParam && toParam) {
    fromDate = fromParam <= toParam ? fromParam : toParam;
    toDate = fromParam <= toParam ? toParam : fromParam;
    const startMs = Date.parse(`${fromDate}T00:00:00Z`);
    const endMs = Date.parse(`${toDate}T00:00:00Z`);
    const spanDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
    prevToDate = addDaysISO(fromDate, -1);
    prevFromDate = addDaysISO(prevToDate, -(spanDays - 1));
  } else if (period === 'month') {
    fromDate = `${todayISO.slice(0, 7)}-01`;
    toDate = todayISO;
    const [y, m] = todayISO.split('-').map(Number);
    const prevLast = new Date(Date.UTC(y, m - 1, 0));
    const prevFirst = new Date(Date.UTC(y, m - 2, 1));
    prevFromDate = prevFirst.toISOString().slice(0, 10);
    prevToDate = prevLast.toISOString().slice(0, 10);
  } else if (period === 'year') {
    const year = todayISO.slice(0, 4);
    fromDate = `${year}-01-01`;
    toDate = todayISO;
    const prevYear = String(Number(year) - 1);
    prevFromDate = `${prevYear}-01-01`;
    prevToDate = `${prevYear}-12-31`;
  } else {
    fromDate = addDaysISO(todayISO, -6);
    toDate = todayISO;
    prevFromDate = addDaysISO(todayISO, -13);
    prevToDate = addDaysISO(todayISO, -7);
  }

  return { todayISO, fromDate, toDate, prevFromDate, prevToDate };
}

function buildDateSequence(fromISO: string, toISO: string): string[] {
  const dates: string[] = [];
  let cursor = fromISO;
  let guard = 0;
  while (cursor <= toISO && guard < 370) {
    dates.push(cursor);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }
  return dates;
}

interface AnalyticsMilkRow {
  bmc_id?: string;
  date: string;
  shift?: string;
  quantity_litres: number;
  rejection_qty: number | null;
  fat_pct: number;
  snf_pct: number;
  rate_per_litre: number;
  selling_rate_applied?: number | null;
  bmcs?: { name: string; bmc_code?: string } | null;
}

async function fetchMilkRows(
  dairyUnitId: string,
  from: string,
  to: string,
  role: string,
  profileUnitId: string | null,
  filterUnitId?: string,
): Promise<{ data: AnalyticsMilkRow[]; error: string | null }> {
  const run = (sel: string) => {
    let q = supabase
      .from('milk_entries')
      .select(sel)
      .eq('dairy_unit_id', dairyUnitId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (role === 'bmc') q = q.eq('bmc_id', profileUnitId!);
    else if (filterUnitId) q = q.eq('bmc_id', filterUnitId);
    return q;
  };

  let res = await run('bmc_id, date, shift, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, selling_rate_applied, bmcs(name, bmc_code)');
  if (res.error && isMissingSchemaError(res.error)) {
    res = await run('bmc_id, date, shift, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, bmcs(name, bmc_code)');
  }
  if (res.error) return { data: [], error: res.error.message };
  return { data: (res.data ?? []) as unknown as AnalyticsMilkRow[], error: null };
}

// GET /analytics/summary?period=week|month|year|custom&from=&to=&bmc_id=
router.get('/summary', async (req, res) => {
  const { period = 'week', bmc_id, from, to } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const { todayISO, fromDate, toDate, prevFromDate, prevToDate } = resolveDateRange(period, from, to);

  const [settings, rateHistory, currRes, prevRes, todayMilkRes, todayTankerRes, periodTankerRes] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    fetchMilkRows(dairyUnitId, fromDate, toDate, req.profile.role, req.profile.bmc_id, bmc_id),
    fetchMilkRows(dairyUnitId, prevFromDate, prevToDate, req.profile.role, req.profile.bmc_id, bmc_id),
    fetchMilkRows(dairyUnitId, todayISO, todayISO, req.profile.role, req.profile.bmc_id, bmc_id),
    (async () => {
      let tq = supabase
        .from('trip_loadings')
        .select('bmc_id, quantity_litres, tanker_trips!inner(trip_date, dairy_unit_id, status)')
        .eq('tanker_trips.dairy_unit_id', dairyUnitId)
        .neq('tanker_trips.status', 'cancelled')
        .eq('tanker_trips.trip_date', todayISO);
      if (req.profile.role === 'bmc') tq = tq.eq('bmc_id', req.profile.bmc_id!);
      else if (bmc_id) tq = tq.eq('bmc_id', bmc_id);
      return tq;
    })(),
    (async () => {
      const bmcFilter = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;
      try {
        const { rows } = await fetchTrips({ dairyUnitId, from: fromDate, to: toDate, bmcId: bmcFilter });
        return {
          error: null,
          data: rows.map((r) => ({ quantity_dispatched: r.quantity_dispatched, received_qty: r.received_qty })),
        };
      } catch (e) {
        return { error: e as Error, data: [] as Array<{ quantity_dispatched: number; received_qty: number | null }> };
      }
    })(),
  ]);

  if (currRes.error || prevRes.error) {
    res.status(500).json({ error: currRes.error || prevRes.error });
    return;
  }

  const hideProfitForUnit = req.profile.role === 'bmc' && !settings.show_unit_profit;

  const calcStats = (rows: AnalyticsMilkRow[]) => {
    if (rows.length === 0) {
      return {
        quantity: 0,
        rejection: 0,
        rejection_pct: 0,
        net_quantity: 0,
        avg_fat: 0,
        avg_snf: 0,
        cost: 0,
        rejection_loss: 0,
        revenue: hideProfitForUnit ? null : 0,
        profit: hideProfitForUnit ? null : 0,
      };
    }

    let quantity = 0;
    let rejection = 0;
    let cost = 0;
    let rejectionLoss = 0;
    let revenue = 0;

    for (const r of rows) {
      const fin = calculateEntryFinancials(r, settings, rateHistory);
      quantity += fin.quantity;
      rejection += fin.rejection;
      cost += fin.cost;
      rejectionLoss += fin.rejection_loss;
      revenue += fin.revenue;
    }

    const netQty = Math.max(0, quantity - rejection);
    const quality = calculateWeightedQuality(rows);
    const rejPct = quantity > 0 ? +((rejection / quantity) * 100).toFixed(2) : 0;

    return {
      quantity: +quantity.toFixed(2),
      rejection: +rejection.toFixed(2),
      rejection_pct: rejPct,
      net_quantity: +netQty.toFixed(2),
      avg_fat: quality.avg_fat,
      avg_snf: quality.avg_snf,
      cost: +cost.toFixed(2),
      rejection_loss: +rejectionLoss.toFixed(2),
      revenue: hideProfitForUnit ? null : +revenue.toFixed(2),
      profit: hideProfitForUnit ? null : +(revenue - cost).toFixed(2),
    };
  };

  // Tanker totals for period
  const tankerRows = (periodTankerRes.data ?? []) as unknown as Array<{ quantity_dispatched: number; received_qty?: number | null }>;
  const totalDispatched = +tankerRows.reduce((s, r) => s + Number(r.quantity_dispatched ?? 0), 0).toFixed(2);
  let receivedMatchedDispatched = 0;
  let totalReceived = 0;
  let receivedCount = 0;
  for (const t of tankerRows) {
    if (t.received_qty != null) {
      receivedMatchedDispatched += Number(t.quantity_dispatched ?? 0);
      totalReceived += Number(t.received_qty);
      receivedCount += 1;
    }
  }
  const transitLoss = receivedCount > 0 ? +(receivedMatchedDispatched - totalReceived).toFixed(2) : 0;
  const transitLossPct = receivedMatchedDispatched > 0
    ? +((transitLoss / receivedMatchedDispatched) * 100).toFixed(2)
    : 0;

  // Today status
  const todayRows = todayMilkRes.data;
  const amDone = todayRows.some(r => r.shift === 'AM');
  const pmDone = todayRows.some(r => r.shift === 'PM');
  const tankerDispatchedToday = (todayTankerRes.data ?? []).length > 0;

  let adminTodayStatus: {
    total_active_units: number;
    units_reported: number;
    units_pending: Array<{ id: string; name: string; bmc_code: string }>;
    units_flagged: Array<{ id: string; name: string; bmc_code: string; reasons: string[] }>;
  } | null = null;

  if (req.profile.role === 'admin') {
    const unitsRes = await supabase
      .from('bmcs')
      .select('id, name, bmc_code, is_active')
      .eq('dairy_unit_id', dairyUnitId)
      .eq('is_active', true);

    const activeUnits = unitsRes.data ?? [];
    const byUnitToday = new Map<string, AnalyticsMilkRow[]>();
    for (const r of todayRows) {
      if (!r.bmc_id) continue;
      const list = byUnitToday.get(r.bmc_id) ?? [];
      list.push(r);
      byUnitToday.set(r.bmc_id, list);
    }

    const pending: Array<{ id: string; name: string; bmc_code: string }> = [];
    const flagged: Array<{ id: string; name: string; bmc_code: string; reasons: string[] }> = [];

    for (const u of activeUnits) {
      const list = byUnitToday.get(u.id);
      if (!list || list.length === 0) {
        pending.push({ id: u.id, name: u.name, bmc_code: u.bmc_code });
      } else {
        const qty = list.reduce((s, r) => s + Number(r.quantity_litres), 0);
        const rej = list.reduce((s, r) => s + Number(r.rejection_qty ?? 0), 0);
        const rejPct = qty > 0 ? (rej / qty) * 100 : 0;
        const qual = calculateWeightedQuality(list);
        const reasons: string[] = [];
        if (rejPct >= settings.rejection_warn_pct) reasons.push(`Rejection ${rejPct.toFixed(1)}%`);
        if (qual.avg_fat < settings.fat_benchmark) reasons.push(`Fat ${qual.avg_fat.toFixed(2)}%`);
        if (qual.avg_snf < settings.snf_benchmark) reasons.push(`SNF ${qual.avg_snf.toFixed(2)}%`);
        if (reasons.length > 0) flagged.push({ id: u.id, name: u.name, bmc_code: u.bmc_code, reasons });
      }
    }

    adminTodayStatus = {
      total_active_units: activeUnits.length,
      units_reported: activeUnits.length - pending.length,
      units_pending: pending,
      units_flagged: flagged,
    };
  }

  const currentSellingRate = getEffectiveSellingRate(todayISO, rateHistory);

  res.json({
    current: calcStats(currRes.data),
    previous: calcStats(prevRes.data),
    period,
    date_range: { from: fromDate, to: toDate },
    selling_rate: currentSellingRate,
    tanker_summary: {
      total_dispatched: totalDispatched,
      total_received: +totalReceived.toFixed(2),
      received_records_count: receivedCount,
      transit_loss: transitLoss,
      transit_loss_pct: transitLossPct,
    },
    today_status: {
      date: todayISO,
      am_done: amDone,
      pm_done: pmDone,
      tanker_dispatched: tankerDispatchedToday,
      admin: adminTodayStatus,
    },
    settings,
  });
});

// GET /analytics/trend?period=week|month|year|custom&from=&to=&bmc_id=
// Returns every calendar day in range with stacked AM/PM quantities & non-interpolated gaps
router.get('/trend', async (req, res) => {
  const { period = 'week', bmc_id, from, to } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const { fromDate, toDate } = resolveDateRange(period, from, to);

  const [settings, rateHistory, milkRes] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    fetchMilkRows(dairyUnitId, fromDate, toDate, req.profile.role, req.profile.bmc_id, bmc_id),
  ]);

  if (milkRes.error) { res.status(500).json({ error: milkRes.error }); return; }

  const hideProfitForUnit = req.profile.role === 'bmc' && !settings.show_unit_profit;
  const byDate = new Map<string, {
    am_quantity: number;
    pm_quantity: number;
    quantity: number;
    rejection: number;
    cost: number;
    revenue: number;
    rows: AnalyticsMilkRow[];
  }>();

  for (const row of milkRes.data) {
    const existing = byDate.get(row.date) ?? {
      am_quantity: 0,
      pm_quantity: 0,
      quantity: 0,
      rejection: 0,
      cost: 0,
      revenue: 0,
      rows: [],
    };
    const fin = calculateEntryFinancials(row, settings, rateHistory);

    if (row.shift === 'PM') existing.pm_quantity += fin.quantity;
    else existing.am_quantity += fin.quantity;
    existing.quantity += fin.quantity;
    existing.rejection += fin.rejection;
    existing.cost += fin.cost;
    existing.revenue += fin.revenue;
    existing.rows.push(row);
    byDate.set(row.date, existing);
  }

  // Only enumerate full calendar sequence if <= 95 days; for yearly keep month-level/sparse dates cleanly
  const daySpan = buildDateSequence(fromDate, toDate);
  const dates = daySpan.length <= 95 ? daySpan : Array.from(byDate.keys()).sort();

  const trend = dates.map(date => {
    const d = byDate.get(date);
    if (!d) {
      return {
        date,
        no_entry: true,
        am_quantity: 0,
        pm_quantity: 0,
        quantity: 0,
        net_quantity: 0,
        rejection: 0,
        avg_fat: null,
        avg_snf: null,
        revenue: hideProfitForUnit ? null : 0,
        cost: 0,
        profit: hideProfitForUnit ? null : 0,
      };
    }

    const qual = calculateWeightedQuality(d.rows);
    const netQty = Math.max(0, d.quantity - d.rejection);
    return {
      date,
      no_entry: false,
      am_quantity: +d.am_quantity.toFixed(2),
      pm_quantity: +d.pm_quantity.toFixed(2),
      quantity: +d.quantity.toFixed(2),
      net_quantity: +netQty.toFixed(2),
      rejection: +d.rejection.toFixed(2),
      avg_fat: qual.avg_fat,
      avg_snf: qual.avg_snf,
      revenue: hideProfitForUnit ? null : +d.revenue.toFixed(2),
      cost: +d.cost.toFixed(2),
      profit: hideProfitForUnit ? null : +(d.revenue - d.cost).toFixed(2),
    };
  });

  res.json(trend);
});

// GET /analytics/bmcs — admin: per-unit weighted quality, cost/L, profit/L, rejection %, health indicator
router.get('/bmcs', async (req, res) => {
  if (req.profile.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const { from, to, period = 'week' } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const resolved = resolveDateRange(from && to ? 'custom' : period, from, to);

  const [settings, rateHistory, unitsRes, milkRes] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    supabase.from('bmcs').select('id, name, bmc_code, location, is_active').eq('dairy_unit_id', dairyUnitId),
    fetchMilkRows(dairyUnitId, resolved.fromDate, resolved.toDate, 'admin', null),
  ]);

  if (milkRes.error) { res.status(500).json({ error: milkRes.error }); return; }

  const byUnit = new Map<string, {
    bmc_id: string;
    name: string;
    bmc_code: string;
    location: string;
    is_active: boolean;
    quantity: number;
    rejection: number;
    cost: number;
    revenue: number;
    rows: AnalyticsMilkRow[];
  }>();

  for (const u of (unitsRes.data ?? [])) {
    byUnit.set(u.id, {
      bmc_id: u.id,
      name: u.name,
      bmc_code: u.bmc_code,
      location: u.location ?? '',
      is_active: u.is_active !== false,
      quantity: 0,
      rejection: 0,
      cost: 0,
      revenue: 0,
      rows: [],
    });
  }

  for (const row of milkRes.data) {
    if (!row.bmc_id) continue;
    let bucket = byUnit.get(row.bmc_id);
    if (!bucket) {
      bucket = {
        bmc_id: row.bmc_id,
        name: row.bmcs?.name ?? '',
        bmc_code: row.bmcs?.bmc_code ?? '',
        location: '',
        is_active: true,
        quantity: 0,
        rejection: 0,
        cost: 0,
        revenue: 0,
        rows: [],
      };
      byUnit.set(row.bmc_id, bucket);
    }
    const fin = calculateEntryFinancials(row, settings, rateHistory);

    bucket.quantity += fin.quantity;
    bucket.rejection += fin.rejection;
    bucket.cost += fin.cost;
    bucket.revenue += fin.revenue;
    bucket.rows.push(row);
  }

  const result = Array.from(byUnit.values()).map(u => {
    const net = Math.max(0, u.quantity - u.rejection);
    const profit = u.revenue - u.cost;
    const qual = calculateWeightedQuality(u.rows);
    const rejPct = u.quantity > 0 ? +((u.rejection / u.quantity) * 100).toFixed(2) : 0;
    const costPerLitre = net > 0 ? +(u.cost / net).toFixed(2) : 0;
    const profitPerLitre = net > 0 ? +(profit / net).toFixed(2) : 0;

    let health: 'ok' | 'warn' | 'danger' | 'inactive' = 'ok';
    if (!u.is_active) health = 'inactive';
    else if (u.rows.length === 0) health = 'warn';
    else if (
      rejPct >= settings.rejection_danger_pct ||
      profit < 0 ||
      qual.avg_snf < settings.snf_benchmark ||
      qual.avg_fat < settings.fat_benchmark
    ) {
      health = 'danger';
    } else if (rejPct >= settings.rejection_warn_pct) {
      health = 'warn';
    }

    return {
      bmc_id: u.bmc_id,
      name: u.name,
      bmc_code: u.bmc_code,
      location: u.location,
      is_active: u.is_active,
      entries_count: u.rows.length,
      quantity: +u.quantity.toFixed(2),
      net_quantity: +net.toFixed(2),
      rejection: +u.rejection.toFixed(2),
      rejection_pct: rejPct,
      avg_fat: qual.avg_fat,
      avg_snf: qual.avg_snf,
      revenue: +u.revenue.toFixed(2),
      cost: +u.cost.toFixed(2),
      profit: +profit.toFixed(2),
      cost_per_litre: costPerLitre,
      profit_per_litre: profitPerLitre,
      health,
    };
  }).sort((a, b) => b.quantity - a.quantity);

  res.json(result);
});

// GET /analytics/process?period=today|week|month|year|custom&from=&to=&bmc_id=
router.get('/process', async (req, res) => {
  try {
    const { period = 'week', bmc_id, from, to } = req.query as Record<string, string>;
    const dairyUnitId = req.profile.dairy_unit_id;
    const settings = await getZoneSettings(dairyUnitId);

    // Resolve date range
    let fromDate: string;
    let toDate: string;
    const todayISO = getIstTodayISO();

    if (period === 'today') {
      fromDate = todayISO;
      toDate = todayISO;
    } else {
      const resolved = resolveDateRange(period, from, to);
      fromDate = resolved.fromDate;
      toDate = resolved.toDate;
    }

    const bmcFilter = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;
    const [tripsResult, unitsResult] = await Promise.all([
      fetchTrips({ dairyUnitId, from: fromDate, to: toDate, bmcId: bmcFilter }),
      supabase
        .from('bmcs')
        .select('id, name, bmc_code, location')
        .eq('dairy_unit_id', dairyUnitId),
    ]);

    const rows = tripsResult.rows as Array<Record<string, unknown>>;
    const stageMap = tripsResult.stages;

    const unitMap = new Map<string, { id: string; name: string; bmc_code: string; location: string }>();
    for (const u of (unitsResult.data ?? [])) {
      unitMap.set(u.id, u);
    }

    const enriched = rows.map((r) => {
      const tripId = String(r.id);
      const stages = (stageMap[tripId] ?? []) as StageRecordItem[];
      return enrichTankerRow(r, stages, settings);
    });

    // 1. Process KPIs
    const totalDispatchedCount = enriched.length;
    let totalDispatchedLitres = 0;
    let activeInPlantCount = 0;
    let completedCount = 0;
    let completedLitres = 0;
    let qcRejectedCount = 0;
    let qcRejectedLitres = 0;
    let waitingTooLongCount = 0;
    let turnaroundMinSum = 0;
    let turnaroundMinCount = 0;

    // Quality accumulators
    let dispFatWeight = 0;
    let dispSnfWeight = 0;
    let dispLitresWithQual = 0;
    let recFatWeight = 0;
    let recSnfWeight = 0;
    let recLitresWithQual = 0;
    let recTempSum = 0;
    let recTempCount = 0;
    let recTempCompliantCount = 0;
    let organolepticSatisfiedCount = 0;
    let organolepticTotalCount = 0;

    // Team operations accumulators
    const teamStats = {
      gate: { ops: 0, activeWaiting: 0, delayed: 0, grossMinSum: 0, grossCount: 0, tareMinSum: 0, tareCount: 0 },
      qc: { inspected: 0, accepted: 0, rejected: 0, activeWaiting: 0, delayed: 0, testMinSum: 0, testCount: 0, cipCount: 0, cipMinSum: 0 },
      unloading: { unloadedCount: 0, litresUnloaded: 0, activeWaiting: 0, delayed: 0, unloadMinSum: 0, unloadCount: 0 },
    };

    const rejectionReasonsMap = new Map<string, number>();

    // Stage pipeline counters
    const stageCounters: Record<string, { active: number; delayed: number; totalProcessed: number; durationMinSum: number; durationCount: number }> = {
      on_the_way: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      vehicle_entered: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      gross_done: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      qc_done: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      unloaded: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      tare_done: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      cip_done: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      exited: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
      qc_rejected: { active: 0, delayed: 0, totalProcessed: 0, durationMinSum: 0, durationCount: 0 },
    };

    // Per-BMC accumulators
    const bmcAccum = new Map<string, {
      bmc_id: string;
      name: string;
      bmc_code: string;
      dispatched_count: number;
      dispatched_litres: number;
      received_litres: number;
      transit_loss_litres: number;
      qc_rejected_count: number;
      turnaround_min_sum: number;
      turnaround_count: number;
      fat_diff_sum: number;
      snf_diff_sum: number;
      diff_count: number;
    }>();

    // Daily trend accumulators
    const dailyAccum = new Map<string, {
      date: string;
      dispatched_count: number;
      dispatched_litres: number;
      received_litres: number;
      received_count: number;
      transit_loss_litres: number;
      qc_rejected_count: number;
      turnaround_min_sum: number;
      turnaround_count: number;
    }>();

    // Active in-plant tankers list
    const activeInPlantList: Array<{
      id: string;
      tanker_number: string;
      dc_number: string;
      bmc_name: string;
      bmc_code: string;
      current_stage_key: string;
      current_stage_title: string;
      stage_color: string;
      waiting_team: string;
      waiting_team_label: string;
      waiting_since_minutes: number;
      is_over_limit: boolean;
      dispatched_litres: number;
      compartments_count: number;
      driver_name: string;
    }> = [];

    for (const item of enriched) {
      const trip = item.journey;
      const status = trip.tripStatus;
      const dLitres = Number(item.quantity_dispatched || 0);
      const rLitres = item.calculated?.received_litres != null ? Number(item.calculated.received_litres) : null;
      const tripDate = item.date || getIstTodayISO();
      const uId = item.bmc_id ? String(item.bmc_id) : 'unknown';
      const uInfo = unitMap.get(uId) || { id: uId, name: (item.bmcs?.name as string) || 'BMC', bmc_code: (item.bmcs?.bmc_code as string) || '', location: '' };

      totalDispatchedLitres += dLitres;

      // Status classification
      if (status === 'qc_rejected') {
        qcRejectedCount++;
        qcRejectedLitres += dLitres;
        stageCounters.qc_rejected.active++;
        if (trip.qcRejectionReason) {
          const rText = trip.qcRejectionReason;
          rejectionReasonsMap.set(rText, (rejectionReasonsMap.get(rText) || 0) + 1);
        }
      } else if (status === 'exited') {
        completedCount++;
        stageCounters.exited.active++;
        if (rLitres != null) completedLitres += rLitres;
        if (item.calculated?.total_turnaround_min != null) {
          turnaroundMinSum += item.calculated.total_turnaround_min;
          turnaroundMinCount++;
        }
      } else {
        // In process
        if (status !== 'on_the_way') {
          activeInPlantCount++;
          activeInPlantList.push({
            id: String(item.id),
            tanker_number: item.tanker_number || '',
            dc_number: item.dc_number || item.dc_no || '',
            bmc_name: uInfo.name,
            bmc_code: uInfo.bmc_code,
            current_stage_key: trip.currentStageKey || status,
            current_stage_title: trip.currentStageTitle || status,
            stage_color: trip.stageColor?.dot || '#0284c7',
            waiting_team: trip.waitingTeam || '',
            waiting_team_label: trip.waitingTeamLabel || '',
            waiting_since_minutes: trip.waitingSinceMinutes || 0,
            is_over_limit: Boolean(trip.isOverLimit),
            dispatched_litres: dLitres,
            compartments_count: Array.isArray(trip.compartments) && trip.compartments.length > 0 ? trip.compartments.length : 1,
            driver_name: item.driver_name || '',
          });
        }
      }

      // Stage counters
      if (stageCounters[status]) {
        stageCounters[status].active++;
        if (trip.isOverLimit) {
          stageCounters[status].delayed++;
        }
      }

      if (trip.isOverLimit) {
        waitingTooLongCount++;
      }

      // Team queue and operation tracking
      if (trip.waitingTeam === 'gate') {
        teamStats.gate.activeWaiting++;
        if (trip.isOverLimit) teamStats.gate.delayed++;
      } else if (trip.waitingTeam === 'qc') {
        teamStats.qc.activeWaiting++;
        if (trip.isOverLimit) teamStats.qc.delayed++;
      } else if (trip.waitingTeam === 'unloading') {
        teamStats.unloading.activeWaiting++;
        if (trip.isOverLimit) teamStats.unloading.delayed++;
      }

      // Track completed stages for throughput and duration
      for (const step of (trip.timelineSteps || [])) {
        if (step.isDone) {
          if (step.key === 'vehicle_entered' || step.key === 'gross_weight' || step.key === 'tare_weight' || step.key === 'vehicle_exit') {
            teamStats.gate.ops++;
          }
          if (step.key === 'gross_weight' && step.durationMinutes != null) {
            teamStats.gate.grossMinSum += step.durationMinutes;
            teamStats.gate.grossCount++;
          }
          if (step.key === 'tare_weight' && step.durationMinutes != null) {
            teamStats.gate.tareMinSum += step.durationMinutes;
            teamStats.gate.tareCount++;
          }
          if (step.key === 'qc_completed') {
            teamStats.qc.inspected++;
            if (trip.isQcRejected) teamStats.qc.rejected++;
            else teamStats.qc.accepted++;
            if (step.durationMinutes != null) {
              teamStats.qc.testMinSum += step.durationMinutes;
              teamStats.qc.testCount++;
            }
          }
          if (step.key === 'cip_completed') {
            teamStats.qc.cipCount++;
            if (step.durationMinutes != null) {
              teamStats.qc.cipMinSum += step.durationMinutes;
            }
          }
          if (step.key === 'unloaded') {
            teamStats.unloading.unloadedCount++;
            if (rLitres != null) teamStats.unloading.litresUnloaded += rLitres;
            if (step.durationMinutes != null) {
              teamStats.unloading.unloadMinSum += step.durationMinutes;
              teamStats.unloading.unloadCount++;
            }
          }
        }
      }

      // Quality accumulators
      if (item.dispatch_fat_pct != null && dLitres > 0) {
        dispFatWeight += Number(item.dispatch_fat_pct) * dLitres;
        dispSnfWeight += Number(item.dispatch_snf_pct || 0) * dLitres;
        dispLitresWithQual += dLitres;
      }
      if (item.received_fat_pct != null && (rLitres || dLitres) > 0) {
        const qVol = rLitres || dLitres;
        recFatWeight += Number(item.received_fat_pct) * qVol;
        recSnfWeight += Number(item.received_snf_pct || 0) * qVol;
        recLitresWithQual += qVol;
      }
      const stageQcData = item.stages?.find((s: any) => s.stage_name === 'qc_completed')?.stage_data as any;
      if (stageQcData?.received_quality?.[0]?.temp != null) {
        const tVal = parseFloat(stageQcData.received_quality[0].temp);
        if (!isNaN(tVal)) {
          recTempSum += tVal;
          recTempCount++;
          if (tVal <= 4.5) recTempCompliantCount++;
        }
      }
      if (stageQcData?.test_categories?.FC?.freshnessOrganoleptic) {
        organolepticTotalCount++;
        if (stageQcData.test_categories.FC.freshnessOrganoleptic === 'Satisfied') {
          organolepticSatisfiedCount++;
        }
      }

      // BMC grouping
      let bmcRec = bmcAccum.get(uId);
      if (!bmcRec) {
        bmcRec = {
          bmc_id: uId,
          name: uInfo.name,
          bmc_code: uInfo.bmc_code,
          dispatched_count: 0,
          dispatched_litres: 0,
          received_litres: 0,
          transit_loss_litres: 0,
          qc_rejected_count: 0,
          turnaround_min_sum: 0,
          turnaround_count: 0,
          fat_diff_sum: 0,
          snf_diff_sum: 0,
          diff_count: 0,
        };
        bmcAccum.set(uId, bmcRec);
      }
      bmcRec.dispatched_count++;
      bmcRec.dispatched_litres += dLitres;
      if (rLitres != null) {
        bmcRec.received_litres += rLitres;
        bmcRec.transit_loss_litres += +(dLitres - rLitres).toFixed(2);
      }
      if (status === 'qc_rejected') {
        bmcRec.qc_rejected_count++;
      }
      if (item.calculated?.total_turnaround_min != null) {
        bmcRec.turnaround_min_sum += item.calculated.total_turnaround_min;
        bmcRec.turnaround_count++;
      }
      if (item.fat_diff != null) {
        bmcRec.fat_diff_sum += Number(item.fat_diff);
        bmcRec.snf_diff_sum += Number(item.snf_diff || 0);
        bmcRec.diff_count++;
      }

      // Daily trend grouping
      let dayRec = dailyAccum.get(tripDate);
      if (!dayRec) {
        dayRec = {
          date: tripDate,
          dispatched_count: 0,
          dispatched_litres: 0,
          received_litres: 0,
          received_count: 0,
          transit_loss_litres: 0,
          qc_rejected_count: 0,
          turnaround_min_sum: 0,
          turnaround_count: 0,
        };
        dailyAccum.set(tripDate, dayRec);
      }
      dayRec.dispatched_count++;
      dayRec.dispatched_litres += dLitres;
      if (rLitres != null) {
        dayRec.received_litres += rLitres;
        dayRec.received_count++;
        dayRec.transit_loss_litres += +(dLitres - rLitres).toFixed(2);
      }
      if (status === 'qc_rejected') {
        dayRec.qc_rejected_count++;
      }
      if (item.calculated?.total_turnaround_min != null) {
        dayRec.turnaround_min_sum += item.calculated.total_turnaround_min;
        dayRec.turnaround_count++;
      }
    }

    const totalTransitLossLitres = completedCount > 0
      ? +(totalDispatchedLitres - completedLitres).toFixed(2)
      : 0;
    const totalTransitLossPct = totalDispatchedLitres > 0
      ? +((totalTransitLossLitres / totalDispatchedLitres) * 100).toFixed(2)
      : 0;

    let transitLossTone: 'green' | 'amber' | 'red' = 'green';
    if (totalTransitLossPct >= (settings.transit_loss_danger_pct ?? 2.0)) transitLossTone = 'red';
    else if (totalTransitLossPct >= (settings.transit_loss_warn_pct ?? 1.0)) transitLossTone = 'amber';

    const avgTurnaroundMin = turnaroundMinCount > 0
      ? Math.round(turnaroundMinSum / turnaroundMinCount)
      : null;

    const slaCompliancePct = totalDispatchedCount > 0
      ? Math.round(((totalDispatchedCount - waitingTooLongCount) / totalDispatchedCount) * 100)
      : 100;

    // Pipeline list
    const pipeline = [
      {
        key: 'on_the_way',
        title: 'BMC Dispatched',
        team: 'bmc',
        team_label: 'BMC Center',
        active_count: stageCounters.on_the_way.active,
        delayed_count: stageCounters.on_the_way.delayed,
        color: STAGE_COLORS.on_the_way.dot,
        desc: 'Tankers in transit from BMC to Dairy Plant',
      },
      {
        key: 'vehicle_entered',
        title: 'Gate Reception',
        team: 'gate',
        team_label: 'Gate Team',
        active_count: stageCounters.vehicle_entered.active,
        delayed_count: stageCounters.vehicle_entered.delayed,
        color: STAGE_COLORS.vehicle_entered.dot,
        desc: 'Milk Receipt registered, waiting for gross weighbridge',
      },
      {
        key: 'gross_done',
        title: 'Gross Weight Done',
        team: 'gate',
        team_label: 'Gate Team',
        active_count: stageCounters.gross_done.active,
        delayed_count: stageCounters.gross_done.delayed,
        color: STAGE_COLORS.gross_done.dot,
        desc: 'Gross weight recorded, waiting for QC Lab inspection',
      },
      {
        key: 'qc_done',
        title: 'QC Passed',
        team: 'qc',
        team_label: 'QC Lab',
        active_count: stageCounters.qc_done.active,
        delayed_count: stageCounters.qc_done.delayed,
        color: STAGE_COLORS.qc_done.dot,
        desc: 'Chemical and adulteration tests satisfied, waiting for unloading',
      },
      {
        key: 'unloaded',
        title: 'Milk Unloaded',
        team: 'unloading',
        team_label: 'Unloading Bay',
        active_count: stageCounters.unloaded.active,
        delayed_count: stageCounters.unloaded.delayed,
        color: STAGE_COLORS.unloaded.dot,
        desc: 'Pumping into silos completed, waiting for tare weight',
      },
      {
        key: 'tare_done',
        title: 'Tare Weight Done',
        team: 'gate',
        team_label: 'Gate Team',
        active_count: stageCounters.tare_done.active,
        delayed_count: stageCounters.tare_done.delayed,
        color: STAGE_COLORS.tare_done.dot,
        desc: 'Empty tanker weighed, waiting for CIP wash & sanitization',
      },
      {
        key: 'cip_done',
        title: 'CIP Cleaning Done',
        team: 'qc',
        team_label: 'QC Lab',
        active_count: stageCounters.cip_done.active,
        delayed_count: stageCounters.cip_done.delayed,
        color: STAGE_COLORS.cip_done.dot,
        desc: 'Clean-in-place sanitization certified, waiting for gate exit',
      },
      {
        key: 'exited',
        title: 'Tanker Exited',
        team: 'gate',
        team_label: 'Gate Team',
        active_count: stageCounters.exited.active,
        delayed_count: 0,
        color: STAGE_COLORS.exited.dot,
        desc: 'Successfully dispatched out of plant gate',
      },
      {
        key: 'qc_rejected',
        title: 'QC Rejected',
        team: 'qc',
        team_label: 'QC Lab',
        active_count: stageCounters.qc_rejected.active,
        delayed_count: 0,
        color: STAGE_COLORS.qc_rejected.dot,
        desc: 'Failed organoleptic, adulteration or quality standards',
      },
    ];

    // BMC scorecard list
    const bmcScorecard = Array.from(bmcAccum.values()).map((b) => {
      const lossPct = b.dispatched_litres > 0
        ? +((b.transit_loss_litres / b.dispatched_litres) * 100).toFixed(2)
        : 0;
      let health: 'ok' | 'warn' | 'danger' = 'ok';
      if (b.qc_rejected_count > 0 || lossPct >= (settings.transit_loss_danger_pct ?? 2.0)) {
        health = 'danger';
      } else if (lossPct >= (settings.transit_loss_warn_pct ?? 1.0)) {
        health = 'warn';
      }

      return {
        bmc_id: b.bmc_id,
        name: b.name,
        bmc_code: b.bmc_code,
        dispatched_count: b.dispatched_count,
        dispatched_litres: +b.dispatched_litres.toFixed(1),
        received_litres: +b.received_litres.toFixed(1),
        transit_loss_litres: +b.transit_loss_litres.toFixed(1),
        transit_loss_pct: lossPct,
        qc_rejected_count: b.qc_rejected_count,
        avg_turnaround_min: b.turnaround_count > 0 ? Math.round(b.turnaround_min_sum / b.turnaround_count) : null,
        avg_fat_diff: b.diff_count > 0 ? +(b.fat_diff_sum / b.diff_count).toFixed(2) : 0,
        avg_snf_diff: b.diff_count > 0 ? +(b.snf_diff_sum / b.diff_count).toFixed(2) : 0,
        health,
      };
    }).sort((a, b) => b.dispatched_litres - a.dispatched_litres);

    // Daily trend list
    const dailyTrend = Array.from(dailyAccum.values()).map((d) => ({
      date: d.date,
      dispatched_count: d.dispatched_count,
      dispatched_litres: +d.dispatched_litres.toFixed(1),
      received_count: d.received_count,
      received_litres: +d.received_litres.toFixed(1),
      transit_loss_litres: +d.transit_loss_litres.toFixed(1),
      qc_rejected_count: d.qc_rejected_count,
      avg_turnaround_min: d.turnaround_count > 0 ? Math.round(d.turnaround_min_sum / d.turnaround_count) : null,
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Rejection reasons list
    const rejectionReasons = Array.from(rejectionReasonsMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      period,
      date_range: { from: fromDate, to: toDate },
      kpis: {
        total_dispatched_count: totalDispatchedCount,
        total_dispatched_litres: +totalDispatchedLitres.toFixed(1),
        active_in_plant_count: activeInPlantCount,
        completed_count: completedCount,
        completed_litres: +completedLitres.toFixed(1),
        qc_rejected_count: qcRejectedCount,
        qc_rejected_litres: +qcRejectedLitres.toFixed(1),
        transit_loss_litres: totalTransitLossLitres,
        transit_loss_pct: totalTransitLossPct,
        transit_loss_tone: transitLossTone,
        avg_plant_turnaround_min: avgTurnaroundMin,
        sla_delayed_count: waitingTooLongCount,
        sla_compliance_pct: slaCompliancePct,
      },
      pipeline,
      team_performance: {
        gate: {
          name: 'Gate Operations Team',
          active_queue: teamStats.gate.activeWaiting,
          total_ops: teamStats.gate.ops,
          avg_gross_min: teamStats.gate.grossCount > 0 ? Math.round(teamStats.gate.grossMinSum / teamStats.gate.grossCount) : null,
          avg_tare_min: teamStats.gate.tareCount > 0 ? Math.round(teamStats.gate.tareMinSum / teamStats.gate.tareCount) : null,
          delayed_count: teamStats.gate.delayed,
        },
        qc: {
          name: 'Quality Control (QC) Lab',
          active_queue: teamStats.qc.activeWaiting,
          total_inspected: teamStats.qc.inspected,
          accepted_count: teamStats.qc.accepted,
          rejected_count: teamStats.qc.rejected,
          rejection_rate_pct: teamStats.qc.inspected > 0 ? +((teamStats.qc.rejected / teamStats.qc.inspected) * 100).toFixed(1) : 0,
          avg_test_min: teamStats.qc.testCount > 0 ? Math.round(teamStats.qc.testMinSum / teamStats.qc.testCount) : null,
          cip_cleanings_count: teamStats.qc.cipCount,
          delayed_count: teamStats.qc.delayed,
          rejection_reasons: rejectionReasons,
        },
        unloading: {
          name: 'Milk Unloading Bay',
          active_queue: teamStats.unloading.activeWaiting,
          total_unloaded: teamStats.unloading.unloadedCount,
          total_volume_litres: +teamStats.unloading.litresUnloaded.toFixed(1),
          avg_unload_min: teamStats.unloading.unloadCount > 0 ? Math.round(teamStats.unloading.unloadMinSum / teamStats.unloading.unloadCount) : null,
          delayed_count: teamStats.unloading.delayed,
        },
      },
      quality_reconciliation: {
        avg_dispatch_fat: dispLitresWithQual > 0 ? +(dispFatWeight / dispLitresWithQual).toFixed(2) : 0,
        avg_received_fat: recLitresWithQual > 0 ? +(recFatWeight / recLitresWithQual).toFixed(2) : 0,
        fat_variance: (dispLitresWithQual > 0 && recLitresWithQual > 0)
          ? +((recFatWeight / recLitresWithQual) - (dispFatWeight / dispLitresWithQual)).toFixed(2)
          : 0,
        avg_dispatch_snf: dispLitresWithQual > 0 ? +(dispSnfWeight / dispLitresWithQual).toFixed(2) : 0,
        avg_received_snf: recLitresWithQual > 0 ? +(recSnfWeight / recLitresWithQual).toFixed(2) : 0,
        snf_variance: (dispLitresWithQual > 0 && recLitresWithQual > 0)
          ? +((recSnfWeight / recLitresWithQual) - (dispSnfWeight / dispLitresWithQual)).toFixed(2)
          : 0,
        avg_temperature: recTempCount > 0 ? +(recTempSum / recTempCount).toFixed(1) : null,
        temp_compliant_pct: recTempCount > 0 ? Math.round((recTempCompliantCount / recTempCount) * 100) : 100,
        organoleptic_satisfied_pct: organolepticTotalCount > 0 ? Math.round((organolepticSatisfiedCount / organolepticTotalCount) * 100) : 100,
      },
      bmc_performance: bmcScorecard,
      active_tankers: activeInPlantList,
      daily_trend: dailyTrend,
    });
  } catch (err: any) {
    console.error('[analytics/process] Error:', err);
    res.status(500).json({ error: err?.message || 'Failed to compute process analytics' });
  }
});

export default router;
