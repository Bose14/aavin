import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const SELLING_RATE = 52; // ₹ per litre (standard Aavin rate)

// GET /analytics/summary?period=week|month|year&unit_id=...
router.get('/summary', async (req, res) => {
  const { period = 'week', unit_id } = req.query as Record<string, string>;

  const today = new Date();
  let fromDate: string;
  let prevFromDate: string;
  let prevToDate: string;

  if (period === 'week') {
    fromDate = new Date(today.getTime() - 6 * 86400000).toISOString().split('T')[0];
    prevFromDate = new Date(today.getTime() - 13 * 86400000).toISOString().split('T')[0];
    prevToDate = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];
  } else if (period === 'month') {
    fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    prevFromDate = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0];
    prevToDate = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split('T')[0];
  } else {
    fromDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
    prevFromDate = new Date(today.getFullYear() - 1, 0, 1).toISOString().split('T')[0];
    prevToDate = new Date(today.getFullYear() - 1, 11, 31).toISOString().split('T')[0];
  }

  const toDate = today.toISOString().split('T')[0];

  const buildQuery = (from: string, to: string) => {
    let q = supabase
      .from('milk_entries')
      .select('quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre')
      .eq('zone_id', req.profile.zone_id)
      .gte('date', from)
      .lte('date', to);
    if (req.profile.role === 'unit') q = q.eq('unit_id', req.profile.unit_id!);
    else if (unit_id) q = q.eq('unit_id', unit_id);
    return q;
  };

  const [curr, prev] = await Promise.all([
    buildQuery(fromDate, toDate),
    buildQuery(prevFromDate, prevToDate)
  ]);

  if (curr.error || prev.error) {
    res.status(500).json({ error: curr.error?.message || prev.error?.message });
    return;
  }

  const calcStats = (rows: typeof curr.data) => {
    if (!rows || rows.length === 0) return { quantity: 0, rejection: 0, net_quantity: 0, avg_fat: 0, avg_snf: 0, revenue: 0, cost: 0, profit: 0 };
    const quantity = rows.reduce((s, r) => s + Number(r.quantity_litres), 0);
    const rejection = rows.reduce((s, r) => s + Number(r.rejection_qty ?? 0), 0);
    const net_quantity = quantity - rejection;
    const avg_fat = rows.reduce((s, r) => s + Number(r.fat_pct), 0) / rows.length;
    const avg_snf = rows.reduce((s, r) => s + Number(r.snf_pct), 0) / rows.length;
    const cost = rows.reduce((s, r) => s + Number(r.quantity_litres) * Number(r.rate_per_litre), 0);
    const revenue = net_quantity * SELLING_RATE;
    const profit = revenue - cost;
    return { quantity: +quantity.toFixed(2), rejection: +rejection.toFixed(2), net_quantity: +net_quantity.toFixed(2), avg_fat: +avg_fat.toFixed(2), avg_snf: +avg_snf.toFixed(2), revenue: +revenue.toFixed(2), cost: +cost.toFixed(2), profit: +profit.toFixed(2) };
  };

  res.json({ current: calcStats(curr.data), previous: calcStats(prev.data), period, selling_rate: SELLING_RATE });
});

// GET /analytics/trend?period=week|month|year&unit_id=...
// Returns day-by-day data for charts
router.get('/trend', async (req, res) => {
  const { period = 'week', unit_id } = req.query as Record<string, string>;

  const today = new Date();
  let fromDate: string;

  if (period === 'week') fromDate = new Date(today.getTime() - 6 * 86400000).toISOString().split('T')[0];
  else if (period === 'month') fromDate = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()).toISOString().split('T')[0];
  else fromDate = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).toISOString().split('T')[0];

  const toDate = today.toISOString().split('T')[0];

  let query = supabase
    .from('milk_entries')
    .select('date, shift, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, units(name)')
    .eq('zone_id', req.profile.zone_id)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });

  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else if (unit_id) query = query.eq('unit_id', unit_id);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Group by date
  const byDate: Record<string, { date: string; quantity: number; rejection: number; fat_pct: number; snf_pct: number; revenue: number; cost: number; count: number }> = {};
  for (const row of (data ?? [])) {
    if (!byDate[row.date]) byDate[row.date] = { date: row.date, quantity: 0, rejection: 0, fat_pct: 0, snf_pct: 0, revenue: 0, cost: 0, count: 0 };
    const d = byDate[row.date];
    d.quantity += Number(row.quantity_litres);
    d.rejection += Number(row.rejection_qty ?? 0);
    d.fat_pct += Number(row.fat_pct);
    d.snf_pct += Number(row.snf_pct);
    d.cost += Number(row.quantity_litres) * Number(row.rate_per_litre);
    d.count += 1;
  }

  const trend = Object.values(byDate).map(d => ({
    date: d.date,
    quantity: +d.quantity.toFixed(2),
    net_quantity: +(d.quantity - d.rejection).toFixed(2),
    rejection: +d.rejection.toFixed(2),
    avg_fat: +(d.fat_pct / d.count).toFixed(2),
    avg_snf: +(d.snf_pct / d.count).toFixed(2),
    revenue: +((d.quantity - d.rejection) * SELLING_RATE).toFixed(2),
    cost: +d.cost.toFixed(2),
    profit: +((d.quantity - d.rejection) * SELLING_RATE - d.cost).toFixed(2),
  }));

  res.json(trend);
});

// GET /analytics/units — admin: per-unit breakdown
router.get('/units', async (req, res) => {
  if (req.profile.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }

  const { from, to } = req.query as Record<string, string>;
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('milk_entries')
    .select('unit_id, quantity_litres, rejection_qty, fat_pct, snf_pct, rate_per_litre, units(name, unit_code)')
    .eq('zone_id', req.profile.zone_id)
    .gte('date', from ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
    .lte('date', to ?? today);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const byUnit: Record<string, { unit_id: string; name: string; unit_code: string; quantity: number; rejection: number; fat_sum: number; snf_sum: number; cost: number; count: number }> = {};

  for (const row of (data ?? [])) {
    const uid = row.unit_id;
    const u = row.units as unknown as { name: string; unit_code: string } | null;
    if (!byUnit[uid]) byUnit[uid] = { unit_id: uid, name: u?.name ?? '', unit_code: u?.unit_code ?? '', quantity: 0, rejection: 0, fat_sum: 0, snf_sum: 0, cost: 0, count: 0 };
    byUnit[uid].quantity += Number(row.quantity_litres);
    byUnit[uid].rejection += Number(row.rejection_qty ?? 0);
    byUnit[uid].fat_sum += Number(row.fat_pct);
    byUnit[uid].snf_sum += Number(row.snf_pct);
    byUnit[uid].cost += Number(row.quantity_litres) * Number(row.rate_per_litre);
    byUnit[uid].count += 1;
  }

  const result = Object.values(byUnit).map(u => {
    const net = u.quantity - u.rejection;
    const revenue = net * SELLING_RATE;
    return {
      unit_id: u.unit_id,
      name: u.name,
      unit_code: u.unit_code,
      quantity: +u.quantity.toFixed(2),
      net_quantity: +net.toFixed(2),
      rejection: +u.rejection.toFixed(2),
      avg_fat: +(u.fat_sum / u.count).toFixed(2),
      avg_snf: +(u.snf_sum / u.count).toFixed(2),
      revenue: +revenue.toFixed(2),
      cost: +u.cost.toFixed(2),
      profit: +(revenue - u.cost).toFixed(2),
    };
  }).sort((a, b) => b.quantity - a.quantity);

  res.json(result);
});

export default router;
