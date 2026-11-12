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
  unit_id?: string;
  date: string;
  shift?: string;
  quantity_litres: number;
  rejection_qty: number | null;
  fat_pct: number;
  snf_pct: number;
  rate_per_litre: number;
  selling_rate_applied?: number | null;
  units?: { name: string; unit_code?: string } | null;
}

async function fetchMilkRows(
  zoneId: string,
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
      .eq('zone_id', zoneId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true });
    if (role === 'unit') q = q.eq('unit_id', profileUnitId!);
    else if (filterUnitId) q = q.eq('unit_id', filterUnitId);
    return q;
  };

  let res = await run('unit_id, date, shift, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, selling_rate_applied, units(name, unit_code)');
  if (res.error && isMissingSchemaError(res.error)) {
    res = await run('unit_id, date, shift, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, units(name, unit_code)');
  }
  if (res.error) return { data: [], error: res.error.message };
  return { data: (res.data ?? []) as unknown as AnalyticsMilkRow[], error: null };
}

// GET /analytics/summary?period=week|month|year|custom&from=&to=&unit_id=
router.get('/summary', async (req, res) => {
  const { period = 'week', unit_id, from, to } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const { todayISO, fromDate, toDate, prevFromDate, prevToDate } = resolveDateRange(period, from, to);

  const [settings, rateHistory, currRes, prevRes, todayMilkRes, todayTankerRes, periodTankerRes] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    fetchMilkRows(zoneId, fromDate, toDate, req.profile.role, req.profile.unit_id, unit_id),
    fetchMilkRows(zoneId, prevFromDate, prevToDate, req.profile.role, req.profile.unit_id, unit_id),
    fetchMilkRows(zoneId, todayISO, todayISO, req.profile.role, req.profile.unit_id, unit_id),
    (async () => {
      let tq = supabase.from('tanker_dispatches').select('unit_id, quantity_dispatched').eq('zone_id', zoneId).eq('date', todayISO);
      if (req.profile.role === 'unit') tq = tq.eq('unit_id', req.profile.unit_id!);
      else if (unit_id) tq = tq.eq('unit_id', unit_id);
      return tq;
    })(),
    (async () => {
      const runT = (sel: string) => {
        let tq = supabase
          .from('tanker_dispatches')
          .select(sel)
          .eq('zone_id', zoneId)
          .gte('date', fromDate)
          .lte('date', toDate);
        if (req.profile.role === 'unit') tq = tq.eq('unit_id', req.profile.unit_id!);
        else if (unit_id) tq = tq.eq('unit_id', unit_id);
        return tq;
      };
      let resT = await runT('quantity_dispatched, received_qty');
      if (resT.error && isMissingSchemaError(resT.error)) {
        resT = await runT('quantity_dispatched');
      }
      return resT;
    })(),
  ]);

  if (currRes.error || prevRes.error) {
    res.status(500).json({ error: currRes.error || prevRes.error });
    return;
  }

  const hideProfitForUnit = req.profile.role === 'unit' && !settings.show_unit_profit;

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
    units_pending: Array<{ id: string; name: string; unit_code: string }>;
    units_flagged: Array<{ id: string; name: string; unit_code: string; reasons: string[] }>;
  } | null = null;

  if (req.profile.role === 'admin' || req.profile.role === 'superadmin') {
    const unitsRes = await supabase
      .from('units')
      .select('id, name, unit_code, is_active')
      .eq('zone_id', zoneId)
      .eq('is_active', true);

    const activeUnits = unitsRes.data ?? [];
    const byUnitToday = new Map<string, AnalyticsMilkRow[]>();
    for (const r of todayRows) {
      if (!r.unit_id) continue;
      const list = byUnitToday.get(r.unit_id) ?? [];
      list.push(r);
      byUnitToday.set(r.unit_id, list);
    }

    const pending: Array<{ id: string; name: string; unit_code: string }> = [];
    const flagged: Array<{ id: string; name: string; unit_code: string; reasons: string[] }> = [];

    for (const u of activeUnits) {
      const list = byUnitToday.get(u.id);
      if (!list || list.length === 0) {
        pending.push({ id: u.id, name: u.name, unit_code: u.unit_code });
      } else {
        const qty = list.reduce((s, r) => s + Number(r.quantity_litres), 0);
        const rej = list.reduce((s, r) => s + Number(r.rejection_qty ?? 0), 0);
        const rejPct = qty > 0 ? (rej / qty) * 100 : 0;
        const qual = calculateWeightedQuality(list);
        const reasons: string[] = [];
        if (rejPct >= settings.rejection_warn_pct) reasons.push(`Rejection ${rejPct.toFixed(1)}%`);
        if (qual.avg_fat < settings.fat_benchmark) reasons.push(`Fat ${qual.avg_fat.toFixed(2)}%`);
        if (qual.avg_snf < settings.snf_benchmark) reasons.push(`SNF ${qual.avg_snf.toFixed(2)}%`);
        if (reasons.length > 0) flagged.push({ id: u.id, name: u.name, unit_code: u.unit_code, reasons });
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

// GET /analytics/trend?period=week|month|year|custom&from=&to=&unit_id=
// Returns every calendar day in range with stacked AM/PM quantities & non-interpolated gaps
router.get('/trend', async (req, res) => {
  const { period = 'week', unit_id, from, to } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const { fromDate, toDate } = resolveDateRange(period, from, to);

  const [settings, rateHistory, milkRes] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    fetchMilkRows(zoneId, fromDate, toDate, req.profile.role, req.profile.unit_id, unit_id),
  ]);

  if (milkRes.error) { res.status(500).json({ error: milkRes.error }); return; }

  const hideProfitForUnit = req.profile.role === 'unit' && !settings.show_unit_profit;
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

// GET /analytics/units — admin: per-unit weighted quality, cost/L, profit/L, rejection %, health indicator
router.get('/units', async (req, res) => {
  if (req.profile.role !== 'admin' && req.profile.role !== 'superadmin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const { from, to, period = 'week' } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const resolved = resolveDateRange(from && to ? 'custom' : period, from, to);

  const [settings, rateHistory, unitsRes, milkRes] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    supabase.from('units').select('id, name, unit_code, location, is_active').eq('zone_id', zoneId),
    fetchMilkRows(zoneId, resolved.fromDate, resolved.toDate, 'admin', null),
  ]);

  if (milkRes.error) { res.status(500).json({ error: milkRes.error }); return; }

  const byUnit = new Map<string, {
    unit_id: string;
    name: string;
    unit_code: string;
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
      unit_id: u.id,
      name: u.name,
      unit_code: u.unit_code,
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
    if (!row.unit_id) continue;
    let bucket = byUnit.get(row.unit_id);
    if (!bucket) {
      bucket = {
        unit_id: row.unit_id,
        name: row.units?.name ?? '',
        unit_code: row.units?.unit_code ?? '',
        location: '',
        is_active: true,
        quantity: 0,
        rejection: 0,
        cost: 0,
        revenue: 0,
        rows: [],
      };
      byUnit.set(row.unit_id, bucket);
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
      unit_id: u.unit_id,
      name: u.name,
      unit_code: u.unit_code,
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

export default router;
