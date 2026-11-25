import { Router } from 'express';
import * as XLSX from '../lib/spreadsheet';
import { supabase } from '../supabase';
import { fetchTrip, fetchTrips } from '../lib/tripStore';
import { ensureAcknowledgements } from '../lib/ack';
import { buildMilkAckRows, buildGroupedAckRows, buildAckSummary, ackTitle, ACK_COLUMNS } from '../lib/milkAckReport';
import type { AckViewRow, AckGroup } from '../lib/milkAckReport';
import { requireRole } from '../middleware/requireRole';
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
import { buildReconciliation } from '../lib/reconReport';
import type { ReconTripInput } from '../lib/reconReport';
import { buildReconPdf } from '../lib/reconPdf';
import { buildGatePassPdf } from '../lib/gatePassPdf';

const router = Router();
router.use(authMiddleware);

function sanitizeFilenamePart(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-');
}

async function resolveFilePrefix(dairyUnitId: string, unitId?: string | null): Promise<string> {
  if (unitId) {
    const { data } = await supabase.from('bmcs').select('bmc_code').eq('id', unitId).maybeSingle();
    if (data?.bmc_code) return sanitizeFilenamePart(String(data.bmc_code).toUpperCase());
  }
  const { data: z } = await supabase.from('dairy_units').select('name').eq('id', dairyUnitId).maybeSingle();
  return sanitizeFilenamePart((z?.name || 'DAIRY_UNIT').toUpperCase());
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
  bmcs?: { name: string; bmc_code: string } | null;
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

  const wb = XLSX.book_new();
  const ws = XLSX.json_to_sheet(sampleRows);
  XLSX.book_append_sheet(wb, ws, 'Template');
  const buf = await XLSX.writeXlsx(wb);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="milk_bulk_upload_template.xlsx"');
  res.send(buf);
});

// GET /export/milk/pdf?from=&to=&bmc_id=&shift=&quality=
router.get('/milk/pdf', async (req, res) => {
  const { from, to, bmc_id, shift, quality } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const effectiveUnitId = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;

  const [settings, rateHistory, dairyUnitRes, prefix] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    supabase.from('dairy_units').select('name').eq('id', dairyUnitId).maybeSingle(),
    resolveFilePrefix(dairyUnitId, effectiveUnitId),
  ]);

  const runQ = (sel: string) => {
    let q = supabase
      .from('milk_entries')
      .select(sel)
      .eq('dairy_unit_id', dairyUnitId)
      .order('date', { ascending: true })
      .order('shift', { ascending: true });
    if (effectiveUnitId) q = q.eq('bmc_id', effectiveUnitId);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (shift && (shift === 'AM' || shift === 'PM')) q = q.eq('shift', shift);
    return q;
  };

  let resQ = await runQ('date, shift, fat_pct, snf_pct, quantity_litres, rejection_qty, rate_per_litre, selling_rate_applied, status, bmcs(name, bmc_code)');
  if (resQ.error && isMissingSchemaError(resQ.error)) {
    resQ = await runQ('date, shift, fat_pct, snf_pct, quantity_litres, rejection_qty, rate_per_litre, bmcs(name, bmc_code)');
  }
  if (resQ.error) { console.error('[api]', req.method, req.originalUrl, resQ.error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  const hideProfit = req.profile.role === 'bmc' && !settings.show_unit_profit;
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
      unit: r.bmcs?.bmc_code || r.bmcs?.name || '-',
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
    title: `AAVIN Dairy Daily Milk Report - ${dairyUnitRes.data?.name || 'Dairy Unit'}`,
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

// GET /export/milk?from=&to=&format=csv|xlsx&bmc_id=&shift=&quality=&search=
router.get('/milk', async (req, res) => {
  const { from, to, format = 'xlsx', bmc_id, shift, quality, search } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const effectiveUnitId = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;

  const [settings, rateHistory, prefix, profilesRes] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    resolveFilePrefix(dairyUnitId, effectiveUnitId),
    supabase.from('users').select('auth_user_id, full_name').eq('dairy_unit_id', dairyUnitId),
  ]);

  const nameMap = new Map<string, string>();
  for (const p of (profilesRes.data ?? [])) {
    nameMap.set(p.auth_user_id, p.full_name || 'Staff');
  }

  const runQ = (sel: string) => {
    let q = supabase
      .from('milk_entries')
      .select(sel)
      .eq('dairy_unit_id', dairyUnitId)
      .order('date', { ascending: true })
      .order('shift', { ascending: true });
    if (effectiveUnitId) q = q.eq('bmc_id', effectiveUnitId);
    if (from) q = q.gte('date', from);
    if (to) q = q.lte('date', to);
    if (shift && (shift === 'AM' || shift === 'PM')) q = q.eq('shift', shift);
    return q;
  };

  let resQ = await runQ(`
    date, shift, fat_pct, snf_pct, quantity_litres,
    rejection_qty, rejection_reason, temperature, rate_per_litre,
    selling_rate_applied, status, created_by,
    bmcs(name, bmc_code)
  `);
  if (resQ.error && isMissingSchemaError(resQ.error)) {
    resQ = await runQ(`
      date, shift, fat_pct, snf_pct, quantity_litres,
      rejection_qty, temperature, rate_per_litre, created_by,
      bmcs(name, bmc_code)
    `);
  }
  if (resQ.error) { console.error('[api]', req.method, req.originalUrl, resQ.error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  const hideProfit = req.profile.role === 'bmc' && !settings.show_unit_profit;
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
      const hay = `${formatDateDDMMYYYY(r.date)} ${r.shift} ${r.bmcs?.name ?? ''} ${r.bmcs?.bmc_code ?? ''} ${r.rejection_reason ?? ''}`.toLowerCase();
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
      Unit: r.bmcs?.name ?? '',
      'Unit Code': r.bmcs?.bmc_code ?? '',
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

  const wb = XLSX.book_new();
  const ws = XLSX.json_to_sheet(rows);
  XLSX.book_append_sheet(wb, ws, 'Milk Entries');

  const baseName = `${prefix}_${buildRangeTag(from, to)}`;
  if (format === 'csv') {
    const csv = XLSX.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
  } else {
    const buf = await XLSX.writeXlsx(wb);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(buf);
  }
});

// GET /export/tanker?from=&to=&format=csv|xlsx&bmc_id=&status=&stage=&waiting_team=&delayed_only=&search=
// GET /export/milk-ack?from=&to=&format=xlsx|csv&group=date|team|bmc|tanker — Milk disposal & acknowledgement statement
router.get('/milk-ack', requireRole('admin'), async (req, res) => {
  const { from, to, format, group: groupParam } = req.query as Record<string, string | undefined>;
  const group: AckGroup | null = groupParam === 'team' || groupParam === 'bmc' || groupParam === 'tanker' ? groupParam : null;
  const dateOk = (v?: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!dateOk(from) || !dateOk(to)) {
    res.status(400).json({ error: 'from and to must be yyyy-mm-dd' });
    return;
  }
  if (!from || !to) {
    res.status(400).json({ error: 'Select a From and To date for the report' });
    return;
  }
  if (from > to) {
    res.status(400).json({ error: 'From date must be on or before To date' });
    return;
  }
  const dairyUnitId = req.profile.dairy_unit_id;

  try {
    await ensureAcknowledgements(dairyUnitId, from, to);
    let q = supabase.from('v_milk_ack').select('*').eq('dairy_unit_id', dairyUnitId);
    if (from) q = q.gte('trip_date', from);
    if (to) q = q.lte('trip_date', to);
    const { data, error } = await q.limit(20000);
    if (error) throw new Error(error.message);

    const viewRows = (data ?? []) as unknown as AckViewRow[];
    const wb = XLSX.book_new();
    const { data: unit } = await supabase.from('dairy_units').select('name').eq('id', dairyUnitId).maybeSingle();
    const isTotal = (r: Record<string, unknown>) => /^(TOTAL|GRAND TOTAL)/.test(String(r['NAME OF THE BMC/CC']));
    const heading = ackTitle(unit?.name, from, to);
    let ws;
    if (group) {
      const summary = buildAckSummary(viewRows, group);
      const label = summary.columns[0];
      XLSX.book_append_sheet(
        wb,
        { rows: summary.rows, columns: summary.columns, title: `${heading} - ${label} WISE SUMMARY`, highlightRow: (r) => r[label] === 'GRAND TOTAL' },
        'Summary',
      );
      ws = {
        rows: buildGroupedAckRows(viewRows, group, formatDateDDMMYYYY),
        columns: [...ACK_COLUMNS] as string[],
        title: `${heading} - ${label} WISE`,
        highlightRow: isTotal,
      };
      XLSX.book_append_sheet(wb, ws, 'Milk ACK');
    } else {
      ws = { rows: buildMilkAckRows(viewRows, formatDateDDMMYYYY), columns: [...ACK_COLUMNS] as string[], title: heading, highlightRow: isTotal };
      XLSX.book_append_sheet(wb, ws, 'Milk ACK');
    }

    const baseName = `Milk_ACK${group ? `_${group}_wise` : ''}_${buildRangeTag(from, to)}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      res.send(XLSX.sheet_to_csv(ws));
    } else {
      const buf = await XLSX.writeXlsx(wb);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      res.send(buf);
    }
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// GET /export/gate-pass/:id — Export Gate Pass as authentic yellow receipt PDF
router.get('/gate-pass/:id', async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;
  const tripIdParam = req.params.id;
  try {
    const found = await fetchTrip(dairyUnitId, tripIdParam);
    if (!found) {
      res.status(404).json({ error: 'Tanker trip record not found' });
      return;
    }
    const trip = found.row;
    const stageData = (trip.stage_data as Record<string, any>) || {};
    const gp =
      (trip.gate_pass as Record<string, any>) ||
      stageData.gate_pass ||
      (stageData.cip_completed as any)?.gate_pass ||
      {};

    // Get dairy unit union details
    const { data: du } = await supabase
      .from('dairy_units')
      .select('name, report_title')
      .eq('id', dairyUnitId)
      .maybeSingle();

    const pdfBuffer = await buildGatePassPdf({
      gate_pass_no: gp.gate_pass_no || gp.gate_pass_number || trip.gate_pass_no || '000001',
      union_name: du?.report_title || "Namakkal District Co-operative Milk Producers' Union Limited,",
      union_sub_name: du?.name ? `${du.name.toUpperCase()} MILK UNION` : 'NAMAKKAL MILK UNION',
      date: gp.date || trip.date || new Date().toISOString().slice(0, 10),
      time: gp.time || trip.dispatch_time || '12:00 PM',
      sl_no: gp.sl_no || '1)',
      item: gp.item || 'EMPTY TANKER',
      quantity: gp.quantity != null ? String(gp.quantity) : '1',
      purpose: gp.purpose || (trip.destination ? `TO ${trip.destination.toUpperCase()}` : 'TO BMC'),
      whether_returnable: gp.whether_returnable || 'Returnable',
      to_whom_issued: gp.to_whom_issued || trip.driver_name || 'Driver',
      issued_by: gp.issued_by || 'Lab',
      vehicle_no: gp.vehicle_no || trip.tanker_number || '',
      issuing_officer: gp.issuing_officer || (req.profile as any).name || req.profile.email || 'QC Officer',
      received_by: gp.received_by || trip.driver_name || '',
      security_officer: gp.security_officer || '',
    });

    const passDigits = String(gp.gate_pass_no || '000001').replace(/\D/g, '') || 'slip';
    const vNum = sanitizeFilenamePart(String(trip.tanker_number || 'tanker'));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Gate_Pass_${passDigits}_${vNum}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[export/gate-pass]', err);
    res.status(500).json({ error: 'Failed to generate Gate Pass PDF' });
  }
});

// GET /export/recon-report?from=&to= — Quantity And Quality Reconciliation Report (PDF)
router.get('/recon-report', requireRole('admin'), async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const dateOk = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!dateOk(from) || !dateOk(to)) {
    res.status(400).json({ error: 'Select a From and To date for the report' });
    return;
  }
  if (from! > to!) {
    res.status(400).json({ error: 'From date must be on or before To date' });
    return;
  }
  const dairyUnitId = req.profile.dairy_unit_id;
  try {
    await ensureAcknowledgements(dairyUnitId, from, to);
    const { data: trips, error: tErr } = await supabase
      .from('tanker_trips')
      .select('id, trip_date, tanker_id')
      .eq('dairy_unit_id', dairyUnitId)
      .neq('status', 'cancelled')
      .gte('trip_date', from!)
      .lte('trip_date', to!)
      .order('trip_date')
      .order('id')
      .limit(2000);
    if (tErr) throw new Error(tErr.message);
    const ids = (trips ?? []).map((t) => String(t.id));
    const tankerIds = [...new Set((trips ?? []).map((t) => String(t.tanker_id)))];

    const empty = { data: [] as any[], error: null };
    const [loadRes, ackRes, stageRes, tankerRes, unitRes] = await Promise.all([
      ids.length ? supabase.from('trip_loadings').select('id, trip_id, bmc_id, dc_number, cell_key, quantity_litres, fat_pct, snf_pct, dispatch_at').in('trip_id', ids) : empty,
      ids.length ? supabase.from('trip_acknowledgements').select('trip_id, bmc_id, dc_number, ack_litres, ack_fat_pct, ack_snf_pct').in('trip_id', ids) : empty,
      ids.length ? supabase.from('trip_stages').select('trip_id, data').eq('stage_key', 'qc_completed').eq('status', 'done').in('trip_id', ids) : empty,
      tankerIds.length ? supabase.from('tankers').select('id, vehicle_number').in('id', tankerIds) : empty,
      supabase.from('dairy_units').select('name, report_title, report_address').eq('id', dairyUnitId).maybeSingle(),
    ]);
    for (const r of [loadRes, ackRes, stageRes, tankerRes]) if (r.error) throw new Error(r.error.message);

    const bmcIds = [...new Set((loadRes.data ?? []).map((l: any) => String(l.bmc_id)))];
    const { data: bmcRows, error: bErr } = bmcIds.length ? await supabase.from('bmcs').select('id, name').in('id', bmcIds) : { data: [] as any[], error: null };
    if (bErr) throw new Error(bErr.message);
    const bmcNames = new Map((bmcRows ?? []).map((b: any) => [String(b.id), String(b.name).toUpperCase()]));
    const vehicles = new Map((tankerRes.data ?? []).map((k: any) => [String(k.id), String(k.vehicle_number)]));

    const by = <T extends { trip_id: any }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(String(r.trip_id), [...(m.get(String(r.trip_id)) ?? []), r]);
      return m;
    };
    const loadings = by((loadRes.data ?? []) as any[]);
    const acks = by((ackRes.data ?? []) as any[]);
    const qc = new Map((stageRes.data ?? []).map((s: any) => [String(s.trip_id), (s.data as any)?.received_quality]));

    const inputs: ReconTripInput[] = (trips ?? []).map((t) => ({
      trip_id: String(t.id),
      trip_date: String(t.trip_date),
      vehicle_number: vehicles.get(String(t.tanker_id)) ?? '',
      loadings: loadings.get(String(t.id)) ?? [],
      acks: acks.get(String(t.id)) ?? [],
      received_quality: qc.get(String(t.id)),
    }));

    const unit = unitRes.data as { name?: string; report_title?: string | null; report_address?: string | null } | null;
    const title = unit?.report_title?.trim() || `${String(unit?.name ?? '').toUpperCase()} DISTRICT COOPERATIVE MILK PRODUCERS' UNION LTD.`;
    const pdf = await buildReconPdf({
      title,
      address: unit?.report_address?.trim() || null,
      from: formatDateDDMMYYYY(from!).replace(/-/g, '/'),
      to: formatDateDDMMYYYY(to!).replace(/-/g, '/'),
      tankers: buildReconciliation(inputs, bmcNames),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Quantity_Quality_Reconciliation_${from}_to_${to}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/tanker', async (req, res) => {
  const { from, to, format = 'xlsx', bmc_id, status, stage, waiting_team, delayed_only, search } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const effectiveUnitId = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;
  const settings = await getZoneSettings(dairyUnitId);

  let fetched;
  try {
    fetched = await fetchTrips({ dairyUnitId, from, to, bmcId: effectiveUnitId });
  } catch (e) {
    console.error('[api]', req.method, req.originalUrl, (e as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }
  const rawRows = [...fetched.rows].reverse() as Array<Record<string, unknown>>;
  const { deriveTankerJourneyState } = await import('../lib/tankerJourney');
  const stageMap = fetched.stages;

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
    const u = r.bmcs as { name: string; bmc_code: string } | null;
    const disp = Number(r.quantity_dispatched ?? 0);
    const rec = r.journey.calculated.received_litres;
    return {
      Date: formatDateDDMMYYYY(String(r.date)),
      BMC: u?.name ?? '',
      'BMC Code': u?.bmc_code ?? '',
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

  const wb = XLSX.book_new();
  const ws = XLSX.json_to_sheet(rows);
  XLSX.book_append_sheet(wb, ws, 'Tanker Records');

  const tabTitle = status ? (status.charAt(0).toUpperCase() + status.slice(1)) : 'All';
  const todayDDMM = formatDateDDMMYYYY(new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
  const baseName = `Tanker_Records_${tabTitle}_${todayDDMM}`;

  if (format === 'csv') {
    const csv = XLSX.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
  } else {
    const buf = await XLSX.writeXlsx(wb);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(buf);
  }
});

// GET /export/tanker/daily-report — Official Aavin IDMS Daily Milk & Tanker Reconciliation Report
router.get('/tanker/daily-report', async (req, res) => {
  const { date, from, to, format = 'xlsx', bmc_id } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;
  const effectiveUnitId = req.profile.role === 'bmc' ? req.profile.bmc_id : bmc_id;
  const settings = await getZoneSettings(dairyUnitId);

  const targetDate = date || (from === to && from ? from : undefined);

  let fetched;
  try {
    fetched = await fetchTrips({
      dairyUnitId,
      from: targetDate ?? from,
      to: targetDate ?? to,
      bmcId: effectiveUnitId,
    });
  } catch (e) {
    console.error('[api]', req.method, req.originalUrl, (e as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }
  const rawRows = [...fetched.rows].reverse() as Array<Record<string, unknown>>;
  const { deriveTankerJourneyState } = await import('../lib/tankerJourney');
  const stageMap = fetched.stages;

  let totalDispatchedL = 0;
  let totalReceivedL = 0;
  let totalGrossKg = 0;
  let totalTareKg = 0;
  let totalNetKg = 0;
  let totalLossL = 0;
  let qcAcceptedCount = 0;
  let qcRejectedCount = 0;

  const tableRows = rawRows.map((r, idx) => {
    const id = String(r.id);
    const stages = stageMap[id] ?? [];
    const stageData = (r.stage_data as Record<string, any>) || {};
    const journey = deriveTankerJourneyState({
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
      stage_data: stageData,
      stages,
    } as any, settings);

    const u = r.bmcs as { name: string; bmc_code: string } | null;
    const disp = Number(r.quantity_dispatched ?? 0);
    const rec = journey.calculated.received_litres ?? (r.received_qty != null ? Number(r.received_qty) : null);
    const gross = journey.calculated.gross_weight_kg ?? (r.gross_weight_kg != null ? Number(r.gross_weight_kg) : null);
    const tare = journey.calculated.tare_weight_kg ?? (r.tare_weight_kg != null ? Number(r.tare_weight_kg) : null);
    const net = journey.calculated.net_weight_kg ?? (r.net_weight_kg != null ? Number(r.net_weight_kg) : null);
    const loss = journey.calculated.transit_loss_litres ?? null;

    totalDispatchedL += disp;
    if (rec != null) totalReceivedL += rec;
    if (gross != null) totalGrossKg += gross;
    if (tare != null) totalTareKg += tare;
    if (net != null) totalNetKg += net;
    if (loss != null) totalLossL += loss;

    const isRejected = journey.isQcRejected || r.qc_status === 'rejected';
    if (isRejected) qcRejectedCount += 1;
    else if (journey.currentStageKey === 'unloaded' || journey.currentStageKey === 'tare_weight' || journey.currentStageKey === 'cip_completed' || journey.currentStageKey === 'vehicle_exit' || journey.tripStatus === 'exited') {
      qcAcceptedCount += 1;
    }

    const vehicleEntryData = stageData.vehicle_entered || {};
    const qcData = stageData.qc_completed || {};
    const unloadedData = stageData.unloaded || {};
    const cipData = stageData.cip_completed || {};
    const exitData = stageData.vehicle_exit || {};

    const dcNo = r.dc_number || stageData.dc_number || vehicleEntryData.dc_number || '—';
    const entryTime = vehicleEntryData.entry_time || '—';
    const timeDiff = vehicleEntryData.time_difference || '—';
    const silo = unloadedData.silo_or_bay || '—';
    const testedFat = qcData.received_fat_pct != null ? Number(qcData.received_fat_pct).toFixed(2) : (r.received_fat_pct != null ? Number(r.received_fat_pct).toFixed(2) : '—');
    const testedSnf = qcData.received_snf_pct != null ? Number(qcData.received_snf_pct).toFixed(2) : (r.received_snf_pct != null ? Number(r.received_snf_pct).toFixed(2) : '—');
    const cipStatus = cipData.cip_status ? (cipData.cip_status === 'pass' ? 'PASSED' : 'FAILED') : '—';
    const exitPassNo = exitData.gate_pass_no || '—';
    const compCount = Array.isArray(journey.compartments) && journey.compartments.length > 0 ? journey.compartments.length : 1;

    return {
      'S.No': idx + 1,
      'Date': formatDateDDMMYYYY(String(r.date)),
      'Tanker / Vehicle No': r.tanker_number ?? '',
      'DC No (BMC Invoice)': dcNo !== '—' ? dcNo : '',
      'Source BMC': u?.name ?? '',
      'BMC Code': u?.bmc_code ?? '',
      'Driver Name': r.driver_name ?? '',
      'Dispatch Time': r.dispatch_time ?? '',
      'Gate Entry Time': entryTime !== '—' ? entryTime : '',
      'Transit Time (HH.MM)': timeDiff !== '—' ? timeDiff : '',
      'Dispatched Qty (L)': disp,
      'Dispatched Fat (%)': r.dispatch_fat_pct != null ? Number(r.dispatch_fat_pct).toFixed(2) : '',
      'Dispatched SNF (%)': r.dispatch_snf_pct != null ? Number(r.dispatch_snf_pct).toFixed(2) : '',
      'No. of Compartments': compCount,
      'Gross Weight (kg)': gross ?? '',
      'Tare Weight (kg)': tare ?? '',
      'Net Milk Weight (kg)': net ?? '',
      'Received Qty (L)': rec ?? '',
      'Receiving Silo / Bay': silo !== '—' ? silo : '',
      'Tested Fat (%)': testedFat !== '—' ? testedFat : '',
      'Tested SNF (%)': testedSnf !== '—' ? testedSnf : '',
      'QC Status': isRejected ? 'REJECTED' : (qcData.qc_status === 'accepted' ? 'ACCEPTED' : (journey.waitingTeam === 'qc' ? 'WAITING QC' : 'PENDING')),
      'Rejection Reason': journey.qcRejectionReason || '',
      'Transit Loss (L)': loss != null ? loss : '',
      'Transit Loss (%)': journey.calculated.transit_loss_pct != null ? `${journey.calculated.transit_loss_pct}%` : '',
      'CIP Status': cipStatus !== '—' ? cipStatus : '',
      'Exit Pass No': exitPassNo !== '—' ? exitPassNo : '',
      'Turnaround (min)': journey.calculated.total_turnaround_min ?? '',
      'Current Pipeline Stage': journey.tripStatusLabel,
    };
  });

  // Summary Totals row
  const overallLossPct = totalDispatchedL > 0 && totalLossL > 0 ? +((totalLossL / totalDispatchedL) * 100).toFixed(2) : 0;
  const summaryRow: Record<string, any> = {
    'S.No': 'TOTAL',
    'Date': `${tableRows.length} Tankers`,
    'Tanker / Vehicle No': '',
    'DC No (BMC Invoice)': '',
    'Source BMC': '',
    'BMC Code': '',
    'Driver Name': '',
    'Dispatch Time': '',
    'Gate Entry Time': '',
    'Transit Time (HH.MM)': '',
    'Dispatched Qty (L)': totalDispatchedL,
    'Dispatched Fat (%)': '',
    'Dispatched SNF (%)': '',
    'No. of Compartments': '',
    'Gross Weight (kg)': totalGrossKg || '',
    'Tare Weight (kg)': totalTareKg || '',
    'Net Milk Weight (kg)': totalNetKg || '',
    'Received Qty (L)': totalReceivedL || '',
    'Receiving Silo / Bay': '',
    'Tested Fat (%)': '',
    'Tested SNF (%)': '',
    'QC Status': `Acc: ${qcAcceptedCount} | Rej: ${qcRejectedCount}`,
    'Rejection Reason': '',
    'Transit Loss (L)': totalLossL || 0,
    'Transit Loss (%)': `${overallLossPct}%`,
    'CIP Status': '',
    'Exit Pass No': '',
    'Turnaround (min)': '',
    'Current Pipeline Stage': '',
  };

  const wb = XLSX.book_new();

  // Overview Sheet
  const overviewRows = [
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': 'TAMIL NADU CO-OPERATIVE MILK PRODUCERS FEDERATION (AAVIN)' },
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': `Receiving Dairy: NAMAKKAL DAIRY PLANT | Report Date: ${targetDate ? formatDateDDMMYYYY(targetDate) : buildRangeTag(from, to).replace(/_/g, ' ')}` },
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': `Generated At: ${formatDateDDMMYYYY(new Date().toISOString().slice(0, 10))} ${new Date().toLocaleTimeString('en-IN')}` },
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': '------------------------------------------------------------------------------------------------------------------------' },
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': `Total Tankers: ${tableRows.length} | Dispatched Volume: ${totalDispatchedL.toLocaleString('en-IN')} L | Unloaded Volume: ${totalReceivedL.toLocaleString('en-IN')} L` },
    { 'AAVIN DAIRY MILK RECEIPT & RECONCILIATION REPORT': `Net Transit Loss: ${totalLossL.toFixed(1)} L (${overallLossPct}%) | QC Accepted: ${qcAcceptedCount} | QC Rejected: ${qcRejectedCount}` },
  ];
  const wsOverview = XLSX.json_to_sheet(overviewRows);
  XLSX.book_append_sheet(wb, wsOverview, 'Summary Header');

  // Main Reconciliation Sheet
  const wsData = XLSX.json_to_sheet([...tableRows, summaryRow]);
  XLSX.book_append_sheet(wb, wsData, 'Daily Tanker Reception');

  const reportDateTag = targetDate ? formatDateDDMMYYYY(targetDate) : buildRangeTag(from, to);
  const baseName = `Aavin_Daily_Tanker_Report_${reportDateTag}`;

  if (format === 'csv') {
    const csv = XLSX.sheet_to_csv(wsData);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
    res.send(csv);
  } else {
    const buf = await XLSX.writeXlsx(wb);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
    res.send(buf);
  }
});

// GET /export/tanker/:id — Export complete single tanker dossier & compartment log
router.get('/tanker/:id', async (req, res) => {
  const { id } = req.params;
  const dairyUnitId = req.profile.dairy_unit_id;
  const settings = await getZoneSettings(dairyUnitId);

  let found;
  try {
    found = await fetchTrip(dairyUnitId, String(id));
  } catch (e) {
    console.error('[api]', req.method, req.originalUrl, (e as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }
  if (!found) {
    res.status(404).json({ error: 'Tanker record not found' });
    return;
  }

  const r = found.row as Record<string, unknown>;
  const { deriveTankerJourneyState } = await import('../lib/tankerJourney');
  const stages = found.stages;
  const stageData = (r.stage_data as Record<string, any>) || {};
  const fbMeta = null as any;

  const drvName = (r.driver_name as string) || stageData.driver_name || fbMeta?.driver_name || null;
  const sealNo = (r.seal_number as string) || stageData.seal_number || fbMeta?.seal_number || null;
  const resolvedDcNo = (r.dc_number as string) || stageData.dc_number || fbMeta?.dc_number || null;
  const dispatchTime = (r.dispatch_time as string) || stageData.dispatch_time || fbMeta?.dispatch_time || null;
  const comps = (r.compartments as any[]) || stageData.compartments || fbMeta?.compartments || [];

  const journey = deriveTankerJourneyState({
    id,
    date: String(r.date),
    tanker_number: String(r.tanker_number ?? ''),
    driver_name: drvName,
    seal_number: sealNo,
    dispatch_time: dispatchTime,
    quantity_dispatched: Number(r.quantity_dispatched ?? 0),
    destination: (r.destination as string) || fbMeta?.destination || null,
    dispatch_fat_pct: r.dispatch_fat_pct != null ? Number(r.dispatch_fat_pct) : fbMeta?.dispatch_fat_pct != null ? Number(fbMeta.dispatch_fat_pct) : null,
    dispatch_snf_pct: r.dispatch_snf_pct != null ? Number(r.dispatch_snf_pct) : fbMeta?.dispatch_snf_pct != null ? Number(fbMeta.dispatch_snf_pct) : null,
    received_qty: r.received_qty != null ? Number(r.received_qty) : fbMeta?.received_qty != null ? Number(fbMeta.received_qty) : null,
    receipt_time: (r.receipt_time as string) || null,
    received_fat_pct: r.received_fat_pct != null ? Number(r.received_fat_pct) : null,
    received_snf_pct: r.received_snf_pct != null ? Number(r.received_snf_pct) : null,
    gross_weight_kg: r.gross_weight_kg != null ? Number(r.gross_weight_kg) : fbMeta?.gross_weight_kg != null ? Number(fbMeta.gross_weight_kg) : null,
    tare_weight_kg: r.tare_weight_kg != null ? Number(r.tare_weight_kg) : fbMeta?.tare_weight_kg != null ? Number(fbMeta.tare_weight_kg) : null,
    net_weight_kg: r.net_weight_kg != null ? Number(r.net_weight_kg) : null,
    qc_status: (r.qc_status as string) || fbMeta?.qc_status || null,
    trip_status: (r.trip_status as any) || fbMeta?.trip_status || undefined,
    stage_data: { ...stageData, ...(fbMeta?.stage_data || {}), dc_number: resolvedDcNo, driver_name: drvName, seal_number: sealNo, compartments: comps },
    stages,
    dc_number: resolvedDcNo,
    compartments: comps,
  } as any, settings);

  const u = r.bmcs as { name: string; bmc_code: string } | null;
  const vehicleEntryData = stageData.vehicle_entered || {};
  const qcData = stageData.qc_completed || {};
  const unloadedData = stageData.unloaded || {};
  const cipData = stageData.cip_completed || {};
  const tareData = stageData.tare_weight || {};
  const grossData = stageData.gross_weight || {};
  const exitData = stageData.vehicle_exit || {};

  const dcNo = r.dc_number || stageData.dc_number || vehicleEntryData.dc_number || '—';
  const compartments = journey.compartments || stageData.compartments || [];

  // Sheet 1: Dossier Summary (Key-Value)
  const dossierRows = [
    { 'Field': 'Aavin Tanker Dossier', 'Value': 'CONFIDENTIAL LOGISTICS RECORD' },
    { 'Field': 'Tanker / Vehicle Number', 'Value': r.tanker_number || '' },
    { 'Field': 'Delivery Challan No (DC No)', 'Value': dcNo },
    { 'Field': 'Source BMC Unit', 'Value': `${u?.name || 'BMC'} (${u?.bmc_code || '—'})` },
    { 'Field': 'Destination Dairy', 'Value': r.destination || 'Namakkal Dairy' },
    { 'Field': 'Driver Name', 'Value': r.driver_name || '—' },
    { 'Field': 'Outlet Valve Seal Number', 'Value': r.seal_number || '—' },
    { 'Field': 'Dispatch Date & Time', 'Value': `${formatDateDDMMYYYY(String(r.date))} ${r.dispatch_time || ''}` },
    { 'Field': 'Plant Gate Entry Time', 'Value': vehicleEntryData.entry_time || '—' },
    { 'Field': 'Transit Time Difference', 'Value': vehicleEntryData.time_difference ? `${vehicleEntryData.time_difference} hours` : '—' },
    { 'Field': 'Dispatched Milk Volume', 'Value': `${Number(r.quantity_dispatched || 0).toLocaleString('en-IN')} Litres` },
    { 'Field': 'Dispatched Quality', 'Value': `Fat: ${r.dispatch_fat_pct != null ? r.dispatch_fat_pct : '—'}% | SNF: ${r.dispatch_snf_pct != null ? r.dispatch_snf_pct : '—'}%` },
    { 'Field': 'Weighbridge Gross Weight', 'Value': grossData.gross_weight_kg ? `${Number(grossData.gross_weight_kg).toLocaleString('en-IN')} kg (Slip #${grossData.weighbridge_slip_no || '—'})` : '—' },
    { 'Field': 'Weighbridge Tare Weight', 'Value': tareData.tare_weight_kg ? `${Number(tareData.tare_weight_kg).toLocaleString('en-IN')} kg (Slip #${tareData.weighbridge_slip_no || '—'})` : '—' },
    { 'Field': 'Calculated Net Milk Weight', 'Value': journey.calculated.net_weight_kg ? `${journey.calculated.net_weight_kg.toLocaleString('en-IN')} kg` : '—' },
    { 'Field': 'QC Decision', 'Value': journey.isQcRejected ? `REJECTED (${journey.qcRejectionReason || 'Quality failure'})` : (qcData.qc_status === 'accepted' ? 'ACCEPTED (Passed all tests)' : 'PENDING') },
    { 'Field': 'QC Lab Analysis', 'Value': `Fat: ${qcData.received_fat_pct ?? '—'}% | SNF: ${qcData.received_snf_pct ?? '—'}% | Temp: ${qcData.temperature ?? '—'}°C | MBRT: ${qcData.mbrt_minutes ?? '—'} min` },
    { 'Field': 'Receiving Silo / Bay', 'Value': unloadedData.silo_or_bay || '—' },
    { 'Field': 'Unloaded Volume', 'Value': unloadedData.unloaded_litres ? `${Number(unloadedData.unloaded_litres).toLocaleString('en-IN')} Litres` : '—' },
    { 'Field': 'Transit Loss / Gain', 'Value': journey.calculated.transit_loss_litres != null ? `${journey.calculated.transit_loss_litres} Litres (${journey.calculated.transit_loss_pct}%)` : '—' },
    { 'Field': 'CIP Sanitization Status', 'Value': cipData.cip_status ? `${cipData.cip_status.toUpperCase()} (${cipData.chemical_used || 'Standard CIP'})` : '—' },
    { 'Field': 'Exit Gate Pass No', 'Value': exitData.gate_pass_no || '—' },
    { 'Field': 'Total Plant Turnaround Time', 'Value': journey.calculated.total_turnaround_min != null ? `${journey.calculated.total_turnaround_min} minutes` : '—' },
    { 'Field': 'Final Journey Status', 'Value': journey.tripStatusLabel },
  ];

  // Sheet 2: Compartment Breakdown
  const compRows = (compartments || []).map((c: any, i: number) => ({
    'Comp #': c.compartment_no ?? (i + 1),
    'Compartment Name': c.compartment_name || `Compartment ${i + 1}`,
    'Milk Volume (L)': Number(c.quantity_litres || 0),
    'Dipstick Level (cm)': c.dipstick_cm ?? '—',
    'Fat (%)': c.fat_pct ?? '—',
    'SNF (%)': c.snf_pct ?? '—',
    'Top Seal Number': c.seal_number || '—',
    'Milk Type': c.milk_type || 'Mixed',
  }));

  // Sheet 3: 7-Stage Progression Timeline
  const stageRows = (journey.timelineSteps || []).map((st: any) => ({
    'Step': st.key,
    'Stage Name': st.title,
    'Responsible Team': st.team?.toUpperCase() || '',
    'Status': st.status.toUpperCase(),
    'Recorded At': st.completedAt ? new Date(st.completedAt).toLocaleString('en-IN') : '—',
    'Operator / Slip Details': st.summary || '—',
  }));

  const wb = XLSX.book_new();
  const wsDossier = XLSX.json_to_sheet(dossierRows);
  XLSX.book_append_sheet(wb, wsDossier, 'Tanker Dossier');

  if (compRows.length > 0) {
    const wsComp = XLSX.json_to_sheet(compRows);
    XLSX.book_append_sheet(wb, wsComp, 'Compartments');
  }

  if (stageRows.length > 0) {
    const wsStages = XLSX.json_to_sheet(stageRows);
    XLSX.book_append_sheet(wb, wsStages, 'Stage Progression');
  }

  const cleanNo = String(r.tanker_number || 'Tanker').replace(/[^A-Za-z0-9]/g, '_');
  const fileName = `Tanker_${cleanNo}_Dossier.xlsx`;

  const buf = await XLSX.writeXlsx(wb);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buf);
});

export default router;
