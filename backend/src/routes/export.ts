import { Router } from 'express';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /export/milk?from=&to=&format=csv|xlsx
router.get('/milk', async (req, res) => {
  const { from, to, format = 'xlsx', unit_id } = req.query as Record<string, string>;

  let query = supabase
    .from('milk_entries')
    .select(`
      date, shift, fat_pct, snf_pct, quantity_litres,
      rejection_qty, temperature, rate_per_litre,
      units(name, unit_code)
    `)
    .eq('zone_id', req.profile.zone_id)
    .order('date', { ascending: true });

  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else if (unit_id) query = query.eq('unit_id', unit_id);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = (data ?? []).map(r => {
    const u = r.units as { name: string; unit_code: string } | null;
    const qty = Number(r.quantity_litres);
    const rej = Number(r.rejection_qty ?? 0);
    const net = qty - rej;
    return {
      Date: r.date,
      Shift: r.shift,
      Unit: u?.name ?? '',
      'Unit Code': u?.unit_code ?? '',
      'Fat (%)': r.fat_pct,
      'SNF (%)': r.snf_pct,
      'Quantity (L)': qty,
      'Rejection (L)': rej,
      'Net Quantity (L)': +net.toFixed(2),
      'Temperature (°C)': r.temperature ?? '',
      'Rate (₹/L)': r.rate_per_litre,
      'Procurement Cost (₹)': +(qty * Number(r.rate_per_litre)).toFixed(2),
      'Revenue (₹)': +(net * 52).toFixed(2),
      'Profit (₹)': +(net * 52 - qty * Number(r.rate_per_litre)).toFixed(2),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Milk Entries');

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="milk_entries.csv"');
    res.send(csv);
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="milk_entries.xlsx"');
    res.send(buf);
  }
});

// GET /export/tanker?from=&to=&format=csv|xlsx
router.get('/tanker', async (req, res) => {
  const { from, to, format = 'xlsx', unit_id } = req.query as Record<string, string>;

  let query = supabase
    .from('tanker_dispatches')
    .select('date, tanker_number, quantity_dispatched, destination, units(name, unit_code)')
    .eq('zone_id', req.profile.zone_id)
    .order('date', { ascending: true });

  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else if (unit_id) query = query.eq('unit_id', unit_id);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = (data ?? []).map(r => {
    const u = r.units as { name: string; unit_code: string } | null;
    return {
      Date: r.date,
      Unit: u?.name ?? '',
      'Unit Code': u?.unit_code ?? '',
      'Tanker Number': r.tanker_number,
      'Quantity Dispatched (L)': r.quantity_dispatched,
      Destination: r.destination ?? '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Tanker Dispatches');

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tanker_dispatches.csv"');
    res.send(csv);
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tanker_dispatches.xlsx"');
    res.send(buf);
  }
});

export default router;
