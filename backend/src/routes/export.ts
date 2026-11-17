import { Router } from 'express';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import {
  calculateEntryFinancials,
  formatDateDDMMYYYY,
  getEffectiveSellingRate,
} from '../lib/calculations';
import {
  getSellingRateHistory,
  getZoneSettings,
  isMissingSchemaError,
} from '../lib/settingsStore';
import { buildDailyPdfReport } from '../utils/pdfReport';

const router = Router();
router.use(authMiddleware);

function sanitizeFilenamePart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-');
}

async function resolveFilePrefix(zoneId: string, unitId?: string | null): Promise<string> {
  if (unitId) {
    const { data } = await supabase.from('units').select('unit_code').eq('id', unitId).maybeSingle();
    if (data?.unit_code) return sanitizeFilenamePart(String(data.unit_code).toUpperCase());
  }
  const { data: z } = await supabase.from('zones').select('name').eq('id', zoneId).maybeSingle();
  return sanitizeFilenamePart((z?.name || 'ZONE').toUpperCase());
}

function buildRangeTag(from?: string, to?: string): string {
  const f = from ? formatDateDDMMYYYY(from) : 'START';
  const t = to ? formatDateDDMMYYYY(to) : formatDateDDMMYYYY(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  return `${f}_to_${t}`;
}

interface ExportMilkRow {
  date: string;
  shift: string;
  fat_pct: number;
  snf_pct: number;
  quantity_litres: number;
  rejection_qty: number | null;
  rejection_reason?: string | null;
  temperature: number | null;
  rate_per_litre: number;
  selling_rate_applied?: number | null;
  status?: string | null;
  created_by?: string | null;
  units?: { name: string; unit_code: string } | null;
}

// GET /export/milk/template — Excel template for Admin bulk upload
router.get('/milk/template', async (_req, res) => {
  const sampleRows = [
    {
      'Unit Code': 'RNK-001',
      'Date': formatDateDDMMYYYY(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)),
      'Shift': 'AM',
      'Fat %': 4.5,
      'SNF %': 8.4,
      'Quantity (L)': 250.0,
      'Rejection (L)': 0,
      'Rejection Reason': '',
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="milk_bulk_upload_template.xlsx"');
  res.send(buf);
});

// GET /export/milk/pdf?from=&to=&unit_id=&shift=&quality=
router.get('/milk/pdf', async (req, res) => {
  const { from, to, unit_id, shift, quality } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const effectiveUnitId = req.profile.role === 'unit' ? req.profile.unit_id : unit_id;

  const [settings, rateHistory, zoneRes, prefix] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    supabase.from('zones').select('name').eq('id', zoneId).maybeSingle(),
    resolveFilePrefix(zoneId, effectiveUnitId),
  ]);

  const runQ = (sel: string) => {
    let q = supabase
      .from('milk_entries')
      .select(sel)
      .eq('zone_id', zoneId)
      .order('date', { ascending: true })
      .order('shift', { ascending: true });
    if (effectiveUnitId) q = q.eq('unit_id', effectiveUnitId);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (shift && (shift === 'AM' || shift === 'PM')) q = q.eq('shift', shift);
    return q;
  };

  let resQ = await runQ('date, shift, fat_pct, snf_pct, quantity_litres, rejection_qty, rate_per_litre, selling_rate_applied, status, units(name, unit_code)');
  if (resQ.error && isMissingSchemaError(resQ.error)) {
    resQ = await runQ('date, shift, fat_pct, snf_pct, quantity_litres, rejection_qty, rate_per_litre, units(name, unit_code)');
  }
  if (resQ.error) { res.status(500).json({ error: resQ.error.message }); return; }

  const hideProfit = req.profile.role === 'unit' && !settings.show_unit_profit;
  const rows = ((resQ.data ?? []) as unknown as ExportMilkRow[]).filter(r => {
    if (!quality || quality === 'all') return true;
    const qty = Number(r.quantity_litres);
    const rej = Number(r.rejection_qty ?? 0);
    const rejPct = qty > 0 ? (rej / qty) * 100 : 0;
    const flagged = rejPct >= settings.rejection_warn_pct || Number(r.fat_pct) < settings.fat_benchmark || Number(r.snf_pct) < settings.snf_benchmark;
    return quality === 'flagged' ? flagged : !flagged;
  });

  let totalQty = 0;
  let totalRej = 0;
  let totalNet = 0;
  let totalCost = 0;
  let totalProfit = 0;
  let fatWeighted = 0;
  let snfWeighted = 0;

  const pdfRows = rows.map(r => {
    const fin = calculateEntryFinancials(r, settings, rateHistory);

    totalQty += fin.quantity;
    totalRej += fin.rejection;
    totalNet += fin.net_quantity;
    totalCost += fin.cost;
    totalProfit += fin.profit;
    fatWeighted += fin.quantity * Number(r.fat_pct);
    snfWeighted += fin.quantity * Number(r.snf_pct);

    return {
      date: formatDateDDMMYYYY(r.date),
      unit: r.units?.unit_code || r.units?.name || '-',
      shift: r.shift,
      fat: Number(r.fat_pct).toFixed(2),
      snf: Number(r.snf_pct).toFixed(2),
      qty: fin.quantity.toFixed(1),
      rej: fin.rejection.toFixed(1),
      net: fin.net_quantity.toFixed(1),
      rate: Number(r.rate_per_litre).toFixed(2),
      cost: Math.round(fin.cost).toLocaleString('en-IN'),
      status: (r.status || 'submitted').toUpperCase(),
    };
  });

  const pdfBuffer = buildDailyPdfReport({
    title: `AAVIN Dairy Daily Milk Report - ${zoneRes.data?.name || 'Zone'}`,
    subtitle: `Period: ${buildRangeTag(from, to).replace(/_/g, ' ')} | Generated: ${formatDateDDMMYYYY(new Date().toISOString().slice(0, 10))}`,
    summaryLines: [
      `Entries: ${pdfRows.length} | Gross Qty: ${totalQty.toFixed(1)} L | Rejected: ${totalRej.toFixed(1)} L | Net Accepted: ${totalNet.toFixed(1)} L`,
      `Weighted Avg Fat: ${(totalQty > 0 ? fatWeighted / totalQty : 0).toFixed(2)}% | Weighted Avg SNF: ${(totalQty > 0 ? snfWeighted / totalQty : 0).toFixed(2)}% | Procurement Cost: INR ${Math.round(totalCost).toLocaleString('en-IN')}${hideProfit ? '' : ` | Est. Profit: INR ${Math.round(totalProfit).toLocaleString('en-IN')}`}`,
    ],
    rows: pdfRows,
  });

  const fileName = `${prefix}_${buildRangeTag(from, to)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(pdfBuffer);
});

// GET /export/milk?from=&to=&format=csv|xlsx&unit_id=&shift=&quality=&search=
router.get('/milk', async (req, res) => {
  const { from, to, format = 'xlsx', unit_id, shift, quality, search } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const effectiveUnitId = req.profile.role === 'unit' ? req.profile.unit_id : unit_id;

  const [settings, rateHistory, prefix, profilesRes] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    resolveFilePrefix(zoneId, effectiveUnitId),
    supabase.from('profiles').select('id, full_name').eq('zone_id', zoneId),
  ]);

  const nameMap = new Map<string, string>();
  for (const p of (profilesRes.data ?? [])) {
    nameMap.set(p.id, p.full_name || 'Staff');
  }

  const runQ = (sel: string) => {
    let q = supabase
      .from('milk_entries')
      .select(sel)
      .eq('zone_id', zoneId)
      .order('date', { ascending: true })
      .order('shift', { ascending: true });
    if (effectiveUnitId) q = q.eq('unit_id', effectiveUnitId);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (shift && (shift === 'AM' || shift === 'PM')) q = q.eq('shift', shift);
    return q;
  };

  let resQ = await runQ(`
    date, shift, fat_pct, snf_pct, quantity_litres,
    rejection_qty, rejection_reason, temperature, rate_per_litre,
    selling_rate_applied, status, created_by,
    units(name, unit_code)
  `);
  if (resQ.error && isMissingSchemaError(resQ.error)) {
    resQ = await runQ(`
      date, shift, fat_pct, snf_pct, quantity_litres,
      rejection_qty, temperature, rate_per_litre, created_by,
      units(name, unit_code)
    `);
  }
  if (resQ.error) { res.status(500).json({ error: resQ.error.message }); return; }

  const hideProfit = req.profile.role === 'unit' && !settings.show_unit_profit;
  const searchLower = search?.trim().toLowerCase() ?? '';

  const filtered = ((resQ.data ?? []) as unknown as ExportMilkRow[]).filter(r => {
    const qty = Number(r.quantity_litres);
    const rej = Number(r.rejection_qty ?? 0);
    const rejPct = qty > 0 ? (rej / qty) * 100 : 0;

    if (quality === 'flagged' && rejPct < settings.rejection_warn_pct && Number(r.fat_pct) >= settings.fat_benchmark && Number(r.snf_pct) >= settings.snf_benchmark) {
      return false;
    }
    if (quality === 'ok' && (rejPct >= settings.rejection_warn_pct || Number(r.fat_pct) < settings.fat_benchmark || Number(r.snf_pct) < settings.snf_benchmark)) {
      return false;
    }
    if (searchLower) {
      const hay = `${formatDateDDMMYYYY(r.date)} ${r.shift} ${r.units?.name ?? ''} ${r.units?.unit_code ?? ''} ${r.rejection_reason ?? ''}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  });

  const rows = filtered.map(r => {
    const fin = calculateEntryFinancials(r, settings, rateHistory);
    const rejPct = fin.quantity > 0 ? +((fin.rejection / fin.quantity) * 100).toFixed(2) : 0;

    const baseRow: Record<string, string | number> = {
      Date: formatDateDDMMYYYY(r.date),
      Shift: r.shift,
      Unit: r.units?.name ?? '',
      'Unit Code': r.units?.unit_code ?? '',
      'Fat (%)': Number(r.fat_pct).toFixed(2),
      'SNF (%)': Number(r.snf_pct).toFixed(2),
      'Quantity (L)': fin.quantity,
      'Rejection (L)': fin.rejection,
      'Rejection (%)': rejPct,
      'Rejection Reason': r.rejection_reason ?? '',
      'Net Quantity (L)': fin.net_quantity,
      'Temperature (°C)': r.temperature ?? '',
      'Rate (₹/L)': Number(r.rate_per_litre).toFixed(2),
      'Procurement Value (₹)': fin.cost,
      'Rejection Loss (₹)': fin.rejection_loss,
      Status: r.status ?? 'submitted',
      'Entered By': r.created_by ? (nameMap.get(r.created_by) ?? 'Staff') : 'Staff',
    };

    if (!hideProfit) {
      baseRow['Est. Revenue (₹)'] = fin.revenue;
      baseRow['Projected Profit (₹)'] = fin.profit;
    }
    return baseRow;
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Milk Entries');

  const baseName = `${prefix}_${buildRangeTag(from, to)}`;
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(buf);
  }
});

// GET /export/tanker?from=&to=&format=csv|xlsx&unit_id=&status=&stage=&waiting_team=&delayed_only=&search=
router.get('/tanker', async (req, res) => {
  const { from, to, format = 'xlsx', unit_id, status, stage, waiting_team, delayed_only, search } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;
  const effectiveUnitId = req.profile.role === 'unit' ? req.profile.unit_id : unit_id;
  const settings = await getZoneSettings(zoneId);

  const runT = (sel: string) => {
    let q = supabase
      .from('tanker_dispatches')
      .select(sel)
      .eq('zone_id', zoneId)
      .order('date', { ascending: true });
    if (effectiveUnitId) q = q.eq('unit_id', effectiveUnitId);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    return q;
  };

  let resT = await runT('id, date, tanker_number, driver_name, seal_number, dispatch_time, quantity_dispatched, destination, dispatch_fat_pct, dispatch_snf_pct, received_qty, receipt_time, received_fat_pct, received_snf_pct, gross_weight_kg, tare_weight_kg, net_weight_kg, qc_status, trip_status, stage_data, units(name, unit_code)');
  if (resT.error && isMissingSchemaError(resT.error)) {
    resT = await runT('id, date, tanker_number, quantity_dispatched, destination, units(name, unit_code)');
  }
  if (resT.error) { res.status(500).json({ error: resT.error.message }); return; }

  const rawRows = (resT.data ?? []) as unknown as Array<Record<string, unknown>>;
  const tripIds = rawRows.map((r) => String(r.id));
  const { getTankerStagesForTrips } = await import('../lib/settingsStore');
  const { deriveTankerJourneyState } = await import('../lib/tankerJourney');
  const stageMap = await getTankerStagesForTrips(tripIds);

  let enrichedList: any[] = rawRows.map((r) => {
    const id = String(r.id);
    const stages = stageMap[id] ?? [];
    const tripInput = {
      id,
      date: String(r.date),
      tanker_number: String(r.tanker_number ?? ''),
      driver_name: (r.driver_name as string) || null,
      seal_number: (r.seal_number as string) || null,
      dispatch_time: (r.dispatch_time as string) || null,
      quantity_dispatched: Number(r.quantity_dispatched ?? 0),
      destination: (r.destination as string) || null,
      dispatch_fat_pct: r.dispatch_fat_pct != null ? Number(r.dispatch_fat_pct) : null,
      dispatch_snf_pct: r.dispatch_snf_pct != null ? Number(r.dispatch_snf_pct) : null,
      received_qty: r.received_qty != null ? Number(r.received_qty) : null,
      receipt_time: (r.receipt_time as string) || null,
      received_fat_pct: r.received_fat_pct != null ? Number(r.received_fat_pct) : null,
      received_snf_pct: r.received_snf_pct != null ? Number(r.received_snf_pct) : null,
      gross_weight_kg: r.gross_weight_kg != null ? Number(r.gross_weight_kg) : null,
      tare_weight_kg: r.tare_weight_kg != null ? Number(r.tare_weight_kg) : null,
      net_weight_kg: r.net_weight_kg != null ? Number(r.net_weight_kg) : null,
      qc_status: (r.qc_status as string) || null,
      trip_status: (r.trip_status as any) || undefined,
      stage_data: (r.stage_data as any) || {},
      stages,
    };
    const journey = deriveTankerJourneyState(tripInput as any, settings);
    return { ...r, journey };
  });

  if (stage) enrichedList = enrichedList.filter((r) => r.journey.tripStatus === stage);
  if (waiting_team) enrichedList = enrichedList.filter((r) => r.journey.waitingTeam === waiting_team);
  if (status === 'waiting') {
    enrichedList = enrichedList.filter((r) => r.journey.tripStatus !== 'exited' && r.journey.tripStatus !== 'qc_rejected');
  } else if (status === 'processed') {
    enrichedList = enrichedList.filter((r) => r.journey.tripStatus === 'exited');
  } else if (status === 'rejected') {
    enrichedList = enrichedList.filter((r) => r.journey.tripStatus === 'qc_rejected');
  }
  if (delayed_only === 'true') {
    enrichedList = enrichedList.filter((r) => r.journey.isOverLimit);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    enrichedList = enrichedList.filter((r) => {
      const tankerNo = String(r.tanker_number || '').toLowerCase();
      const sealNo = String(r.seal_number || '').toLowerCase();
      const driver = String(r.driver_name || '').toLowerCase();
      return tankerNo.includes(q) || sealNo.includes(q) || driver.includes(q);
    });
  }

  const rows = enrichedList.map((r) => {
    const u = r.units as { name: string; unit_code: string } | null;
    const disp = Number(r.quantity_dispatched ?? 0);
    const rec = r.journey.calculated.received_litres;
    return {
      Date: formatDateDDMMYYYY(String(r.date)),
      BMC: u?.name ?? '',
      'BMC Code': u?.unit_code ?? '',
      'Tanker Number': r.tanker_number ?? '',
      Driver: r.driver_name ?? '',
      'Seal Number': r.seal_number ?? '',
      'Dispatch Time': r.dispatch_time ?? '',
      'Quantity Dispatched (L)': disp,
      'Stage': r.journey.tripStatusLabel,
      'Waiting Team': r.journey.waitingTeamLabel,
      'Waiting (min)': r.journey.waitingSinceMinutes,
      'Over-limit Flag': r.journey.isOverLimit ? 'YES' : 'NO',
      'Gross (kg)': r.journey.calculated.gross_weight_kg ?? '',
      'Tare (kg)': r.journey.calculated.tare_weight_kg ?? '',
      'Net (kg)': r.journey.calculated.net_weight_kg ?? '',
      'Received Qty (L)': rec ?? '',
      'Transit Loss (L)': r.journey.calculated.transit_loss_litres ?? '',
      'Transit Loss (%)': r.journey.calculated.transit_loss_pct != null ? `${r.journey.calculated.transit_loss_pct}%` : '',
      'Total Turnaround (min)': r.journey.calculated.total_turnaround_min ?? '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Tanker Records');

  const tabTitle = status ? (status.charAt(0).toUpperCase() + status.slice(1)) : 'All';
  const todayDDMM = formatDateDDMMYYYY(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  const baseName = `Tanker_Records_${tabTitle}_${todayDDMM}`;

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
  } else {
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(buf);
  }
});

export default router;
