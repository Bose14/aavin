import { Router } from 'express';
import * as XLSX from 'xlsx';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  calculateEntryFinancials,
  calculateRateFromChart,
  formatDateDDMMYYYY,
  getEffectiveSellingRate,
} from '../lib/calculations';
import {
  createCorrectionRequest,
  getSellingRateHistory,
  getZoneSettings,
  isMissingSchemaError,
  listCorrectionRequests,
  resolveCorrectionRequest,
  writeAuditLog,
} from '../lib/settingsStore';

const router = Router();
router.use(authMiddleware);

const BASE_SELECT = `
  id, unit_id, date, shift, fat_pct, snf_pct, quantity_litres,
  rejection_qty, temperature, rate_per_litre, created_by, created_at,
  units(name, unit_code)
`;

const EXTENDED_SELECT = `
  id, unit_id, date, shift, fat_pct, snf_pct, quantity_litres,
  rejection_qty, temperature, rate_per_litre, created_by, created_at,
  rejection_reason, rate_override, rate_override_reason, selling_rate_applied,
  status, verified_by, verified_at, updated_at,
  units(name, unit_code)
`;

// GET /milk?from=YYYY-MM-DD&to=YYYY-MM-DD&unit_id=...&shift=AM|PM
router.get('/', async (req, res) => {
  const { from, to, unit_id, shift } = req.query as Record<string, string>;
  const zoneId = req.profile.zone_id;

  const runQuery = (columns: string) => {
    let query = supabase
      .from('milk_entries')
      .select(columns)
      .eq('zone_id', zoneId)
      .order('date', { ascending: false })
      .order('shift', { ascending: true });

    if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
    else if (unit_id) query = query.eq('unit_id', unit_id);
    if (shift === 'AM' || shift === 'PM') query = query.eq('shift', shift);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    return query;
  };

  let { data, error } = await runQuery(EXTENDED_SELECT);
  if (error && isMissingSchemaError(error)) {
    const fallback = await runQuery(BASE_SELECT);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) { res.status(500).json({ error: error.message }); return; }

  const [settings, rateHistory, profilesRes] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
    supabase.from('profiles').select('id, full_name').eq('zone_id', zoneId),
  ]);

  const nameById = new Map<string, string>();
  for (const p of (profilesRes.data ?? [])) {
    if (p.full_name) nameById.set(p.id, p.full_name);
  }

  const nowMs = Date.now();
  const lockMs = settings.edit_lock_hours * 3600 * 1000;
  const includeProfit = req.profile.role !== 'unit' || settings.show_unit_profit;

  const enriched = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const financials = calculateEntryFinancials(
      {
        date: String(row.date),
        fat_pct: Number(row.fat_pct),
        snf_pct: Number(row.snf_pct),
        quantity_litres: Number(row.quantity_litres),
        rejection_qty: Number(row.rejection_qty ?? 0),
        rate_per_litre: Number(row.rate_per_litre),
        selling_rate_applied: row.selling_rate_applied != null ? Number(row.selling_rate_applied) : null,
      },
      settings,
      rateHistory,
    );

    const createdMs = row.created_at ? new Date(String(row.created_at)).getTime() : nowMs;
    const status = String(row.status ?? 'submitted');
    const isLocked = req.profile.role === 'unit' && (nowMs - createdMs > lockMs || status === 'verified');
    const rejectionPct = financials.quantity > 0
      ? +((financials.rejection / financials.quantity) * 100).toFixed(1)
      : 0;

    return {
      ...row,
      net_quantity: financials.net_quantity,
      rejection_pct: rejectionPct,
      procurement_cost: financials.cost,
      rejection_loss: financials.rejection_loss,
      ...(includeProfit ? { revenue: financials.revenue, profit: financials.profit, selling_rate: financials.selling_rate } : {}),
      status,
      entered_by: row.created_by ? (nameById.get(String(row.created_by)) ?? 'Staff') : 'Staff',
      is_locked: isLocked,
    };
  });

  res.json(enriched);
});

// GET /milk/correction-requests — list correction requests
router.get('/correction-requests', async (req, res) => {
  try {
    const unitFilter = req.profile.role === 'unit' ? req.profile.unit_id : undefined;
    const rows = await listCorrectionRequests(req.profile.zone_id, unitFilter);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /milk/correction-requests/:reqId — admin resolves or rejects correction request
router.patch('/correction-requests/:reqId', requireRole('admin'), async (req, res) => {
  try {
    const status = req.body?.status === 'rejected' ? 'rejected' : 'resolved';
    await resolveCorrectionRequest(String(req.params.reqId), req.profile.zone_id, status, req.user.id);
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /milk — submit shift entry (auto chart rate or logged manual override)
router.post('/', async (req, res) => {
  const {
    date,
    shift,
    fat_pct,
    snf_pct,
    quantity_litres,
    rejection_qty = 0,
    rejection_reason,
    temperature,
    rate_per_litre,
    rate_override = false,
    rate_override_reason,
  } = req.body as {
    date: string; shift: 'AM' | 'PM';
    fat_pct: number; snf_pct: number;
    quantity_litres: number; rejection_qty?: number; rejection_reason?: string;
    temperature?: number; rate_per_litre?: number;
    rate_override?: boolean; rate_override_reason?: string;
  };

  if (date == null || !shift || fat_pct == null || snf_pct == null || quantity_litres == null) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const qty = Number(quantity_litres);
  const rej = Number(rejection_qty ?? 0);
  const fat = Number(fat_pct);
  const snf = Number(snf_pct);

  if (!Number.isFinite(qty) || qty <= 0) {
    res.status(400).json({ error: 'quantity_litres must be greater than 0' });
    return;
  }
  if (!Number.isFinite(rej) || rej < 0 || rej > qty) {
    res.status(400).json({ error: 'rejection_qty must be between 0 and quantity_litres' });
    return;
  }
  if (rej > 0 && (!rejection_reason || !String(rejection_reason).trim())) {
    res.status(400).json({ error: 'Rejection reason is required when rejection quantity is greater than 0' });
    return;
  }

  const zoneId = req.profile.zone_id;
  const [settings, rateHistory] = await Promise.all([
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
  ]);

  if (fat < settings.fat_min || fat > settings.fat_max) {
    res.status(400).json({ error: `Fat % must be between ${settings.fat_min.toFixed(2)} and ${settings.fat_max.toFixed(2)}` });
    return;
  }
  if (snf < settings.snf_min || snf > settings.snf_max) {
    res.status(400).json({ error: `SNF % must be between ${settings.snf_min.toFixed(2)} and ${settings.snf_max.toFixed(2)}` });
    return;
  }

  const chartRate = calculateRateFromChart(fat, snf, settings);
  let finalRate = chartRate;

  if (rate_override) {
    const manualRate = Number(rate_per_litre);
    if (!Number.isFinite(manualRate) || manualRate <= 0) {
      res.status(400).json({ error: 'Valid positive rate_per_litre required when overriding rate' });
      return;
    }
    if (!rate_override_reason || !String(rate_override_reason).trim()) {
      res.status(400).json({ error: 'Reason is required when overriding the Fat/SNF rate chart' });
      return;
    }
    finalRate = +manualRate.toFixed(2);
  }

  const unit_id = req.profile.role === 'unit' ? req.profile.unit_id : req.body.unit_id;
  if (!unit_id) { res.status(400).json({ error: 'unit_id required' }); return; }

  const sellingRateApplied = getEffectiveSellingRate(date, rateHistory);

  const extendedRow = {
    unit_id,
    zone_id: zoneId,
    date,
    shift,
    fat_pct: +fat.toFixed(2),
    snf_pct: +snf.toFixed(2),
    quantity_litres: +qty.toFixed(2),
    rejection_qty: +rej.toFixed(2),
    rejection_reason: rej > 0 ? String(rejection_reason).trim() : null,
    temperature: temperature != null ? Number(temperature) : null,
    rate_per_litre: finalRate,
    rate_override: Boolean(rate_override),
    rate_override_reason: rate_override ? String(rate_override_reason).trim() : null,
    selling_rate_applied: sellingRateApplied,
    status: 'submitted',
    created_by: req.user.id,
  };

  let { data, error } = await supabase.from('milk_entries').insert(extendedRow).select().single();
  if (error && isMissingSchemaError(error)) {
    const baseInsert = await supabase
      .from('milk_entries')
      .insert({
        unit_id,
        zone_id: zoneId,
        date,
        shift,
        fat_pct: +fat.toFixed(2),
        snf_pct: +snf.toFixed(2),
        quantity_litres: +qty.toFixed(2),
        rejection_qty: +rej.toFixed(2),
        temperature: temperature != null ? Number(temperature) : null,
        rate_per_litre: finalRate,
        created_by: req.user.id,
      })
      .select()
      .single();
    data = baseInsert.data;
    error = baseInsert.error;
  }

  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await supabase
        .from('milk_entries')
        .select('id')
        .eq('unit_id', unit_id)
        .eq('date', date)
        .eq('shift', shift)
        .maybeSingle();
      const shiftLabel = shift === 'AM' ? 'Morning' : 'Evening';
      res.status(409).json({
        error: `A ${shiftLabel} entry for ${formatDateDDMMYYYY(date)} already exists.`,
        existing_id: existing?.id ?? null,
      });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  await writeAuditLog({
    zone_id: zoneId,
    unit_id,
    entity_type: 'milk_entry',
    entity_id: data.id,
    action: rate_override ? 'create_with_rate_override' : 'create',
    changes: {
      date,
      shift,
      fat_pct: +fat.toFixed(2),
      snf_pct: +snf.toFixed(2),
      quantity_litres: +qty.toFixed(2),
      rejection_qty: +rej.toFixed(2),
      rejection_reason: rej > 0 ? rejection_reason : null,
      rate_per_litre: finalRate,
      chart_rate: chartRate,
      rate_override: Boolean(rate_override),
      rate_override_reason: rate_override ? rate_override_reason : null,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
  });

  res.status(201).json(data);
});

// PATCH /milk/:id — edit entry (within edit_lock_hours for unit staff; anytime for admin) + audit diff
router.patch('/:id', async (req, res) => {
  const entryId = String(req.params.id);
  const zoneId = req.profile.zone_id;

  let existingQuery = supabase.from('milk_entries').select('*').eq('id', entryId);
  if (req.profile.role === 'unit') existingQuery = existingQuery.eq('unit_id', req.profile.unit_id!);
  else existingQuery = existingQuery.eq('zone_id', zoneId);

  const { data: existing, error: fetchErr } = await existingQuery.maybeSingle();
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return; }
  if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }

  const settings = await getZoneSettings(zoneId);
  if (req.profile.role === 'unit') {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs > settings.edit_lock_hours * 3600 * 1000) {
      res.status(403).json({
        error: `Entries lock after ${settings.edit_lock_hours} hours. Submit a correction request instead.`,
      });
      return;
    }
    if ((existing as { status?: string }).status === 'verified') {
      res.status(403).json({ error: 'Verified entries are locked. Submit a correction request instead.' });
      return;
    }
  }

  const body = req.body as {
    fat_pct?: number; snf_pct?: number; quantity_litres?: number;
    rejection_qty?: number; rejection_reason?: string | null; temperature?: number | null;
    rate_per_litre?: number; rate_override?: boolean; rate_override_reason?: string | null;
  };

  const fat = body.fat_pct != null ? Number(body.fat_pct) : Number(existing.fat_pct);
  const snf = body.snf_pct != null ? Number(body.snf_pct) : Number(existing.snf_pct);
  const qty = body.quantity_litres != null ? Number(body.quantity_litres) : Number(existing.quantity_litres);
  const rej = body.rejection_qty != null ? Number(body.rejection_qty) : Number(existing.rejection_qty ?? 0);

  if (qty <= 0 || rej < 0 || rej > qty) {
    res.status(400).json({ error: 'Invalid quantity or rejection values' });
    return;
  }
  if (fat < settings.fat_min || fat > settings.fat_max || snf < settings.snf_min || snf > settings.snf_max) {
    res.status(400).json({ error: 'Fat % or SNF % outside allowed range' });
    return;
  }

  const nextRate = body.rate_override && body.rate_per_litre != null
    ? +Number(body.rate_per_litre).toFixed(2)
    : calculateRateFromChart(fat, snf, settings);

  if (body.rate_override && !String(body.rate_override_reason ?? '').trim()) {
    res.status(400).json({ error: 'Override reason is required when manually overriding rate' });
    return;
  }

  const extendedPatch: Record<string, unknown> = {
    fat_pct: +fat.toFixed(2),
    snf_pct: +snf.toFixed(2),
    quantity_litres: +qty.toFixed(2),
    rejection_qty: +rej.toFixed(2),
    rejection_reason: rej > 0 ? (body.rejection_reason ?? (existing as { rejection_reason?: string }).rejection_reason ?? 'Other') : null,
    temperature: body.temperature !== undefined ? body.temperature : existing.temperature,
    rate_per_litre: nextRate,
    rate_override: Boolean(body.rate_override),
    rate_override_reason: body.rate_override ? String(body.rate_override_reason).trim() : null,
    updated_by: req.user.id,
    updated_at: new Date().toISOString(),
  };

  let { data, error } = await supabase.from('milk_entries').update(extendedPatch).eq('id', entryId).select().single();
  if (error && isMissingSchemaError(error)) {
    const basePatch = {
      fat_pct: +fat.toFixed(2),
      snf_pct: +snf.toFixed(2),
      quantity_litres: +qty.toFixed(2),
      rejection_qty: +rej.toFixed(2),
      temperature: body.temperature !== undefined ? body.temperature : existing.temperature,
      rate_per_litre: nextRate,
    };
    const fallback = await supabase.from('milk_entries').update(basePatch).eq('id', entryId).select().single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) { res.status(500).json({ error: error.message }); return; }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['fat_pct', 'snf_pct', 'quantity_litres', 'rejection_qty', 'rate_per_litre'] as const) {
    if (Number(existing[key] ?? 0) !== Number(extendedPatch[key] ?? 0)) {
      changes[key] = { from: existing[key], to: extendedPatch[key] };
    }
  }

  await writeAuditLog({
    zone_id: zoneId,
    unit_id: existing.unit_id,
    entity_type: 'milk_entry',
    entity_id: entryId,
    action: 'edit',
    changes,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'User',
  });

  res.json(data);
});

// PATCH /milk/:id/verify — admin marks an entry verified
router.patch('/:id/verify', requireRole('admin'), async (req, res) => {
  const entryId = String(req.params.id);
  const { data, error } = await supabase
    .from('milk_entries')
    .update({ status: 'verified', verified_by: req.user.id, verified_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('zone_id', req.profile.zone_id)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    res.json({ id: entryId, status: 'verified', note: 'Extended status column pending SQL migration' });
    return;
  }
  if (error) { res.status(500).json({ error: error.message }); return; }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id: data.unit_id,
    entity_type: 'milk_entry',
    entity_id: entryId,
    action: 'verify',
    changes: { status: 'verified' },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json(data);
});

// POST /milk/:id/correction-request — unit submits correction request after edit lock window
router.post('/:id/correction-request', async (req, res) => {
  const entryId = String(req.params.id);
  const { reason, proposed_changes = {} } = req.body as {
    reason?: string;
    proposed_changes?: Record<string, unknown>;
  };

  if (!reason || !reason.trim()) {
    res.status(400).json({ error: 'Correction reason is required' });
    return;
  }

  const { data: entry } = await supabase
    .from('milk_entries')
    .select('id, zone_id, unit_id')
    .eq('id', entryId)
    .eq('zone_id', req.profile.zone_id)
    .maybeSingle();

  if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }

  try {
    const reqRecord = await createCorrectionRequest({
      milk_entry_id: entry.id,
      zone_id: entry.zone_id,
      unit_id: entry.unit_id,
      requested_by: req.user.id,
      requested_by_name: req.profile.full_name ?? req.user.email ?? 'Staff',
      reason: reason.trim(),
      proposed_changes,
    });

    await writeAuditLog({
      zone_id: entry.zone_id,
      unit_id: entry.unit_id,
      entity_type: 'milk_entry',
      entity_id: entry.id,
      action: 'correction_request',
      changes: { reason: reason.trim(), proposed_changes },
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
    });

    res.status(201).json(reqRecord);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /milk/bulk — admin bulk upload validated entries from JSON rows or base64 Excel/CSV file
router.post('/bulk', requireRole('admin'), async (req, res) => {
  let rows = Array.isArray(req.body?.rows) ? (req.body.rows as Array<Record<string, unknown>>) : [];
  if (rows.length === 0 && typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
    try {
      const base64Clean = req.body.fileBase64.includes(',') ? req.body.fileBase64.split(',')[1] : req.body.fileBase64;
      const buf = Buffer.from(base64Clean, 'base64');
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
      const firstSheet = wb.SheetNames[0];
      if (firstSheet) {
        rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: '' });
      }
    } catch {
      res.status(400).json({ error: 'Could not read Excel/CSV file. Please use the provided template.' });
      return;
    }
  }
  if (rows.length === 0) {
    res.status(400).json({ error: 'No rows provided for bulk upload' });
    return;
  }

  const zoneId = req.profile.zone_id;
  const [unitsRes, settings, rateHistory] = await Promise.all([
    supabase.from('units').select('id, unit_code').eq('zone_id', zoneId),
    getZoneSettings(zoneId),
    getSellingRateHistory(zoneId),
  ]);

  const unitByCode = new Map<string, string>();
  for (const u of (unitsRes.data ?? [])) {
    unitByCode.set(String(u.unit_code).trim().toUpperCase(), u.id);
  }

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // Excel row index (after header)
    const code = String(r.unit_code ?? r['Unit Code'] ?? '').trim().toUpperCase();
    const unitId = unitByCode.get(code);
    if (!unitId) {
      errors.push({ row: rowNum, error: `Unknown unit code "${code}"` });
      continue;
    }

    const rawCell = r.date ?? r['Date'] ?? '';
    let isoDate = '';
    if (typeof rawCell === 'number' && Number.isFinite(rawCell)) {
      const parsed = XLSX.SSF.parse_date_code(rawCell);
      if (parsed) {
        isoDate = `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
    } else {
      const rawDate = String(rawCell).trim();
      const ddmmyyyy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(rawDate);
      isoDate = ddmmyyyy
        ? `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`
        : rawDate;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      errors.push({ row: rowNum, error: `Invalid date "${String(rawCell)}" (use dd-mm-yyyy)` });
      continue;
    }

    const shift = String(r.shift ?? r['Shift'] ?? '').trim().toUpperCase();
    if (shift !== 'AM' && shift !== 'PM') {
      errors.push({ row: rowNum, error: `Invalid shift "${shift}" (use AM or PM)` });
      continue;
    }

    const fat = Number(r.fat_pct ?? r['Fat %']);
    const snf = Number(r.snf_pct ?? r['SNF %']);
    const qty = Number(r.quantity_litres ?? r['Quantity (L)']);
    const rej = Number(r.rejection_qty ?? r['Rejection (L)'] ?? 0) || 0;

    if (!Number.isFinite(fat) || fat < settings.fat_min || fat > settings.fat_max) {
      errors.push({ row: rowNum, error: `Fat % out of range (${settings.fat_min}-${settings.fat_max})` });
      continue;
    }
    if (!Number.isFinite(snf) || snf < settings.snf_min || snf > settings.snf_max) {
      errors.push({ row: rowNum, error: `SNF % out of range (${settings.snf_min}-${settings.snf_max})` });
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0 || rej < 0 || rej > qty) {
      errors.push({ row: rowNum, error: 'Invalid Quantity or Rejection litres' });
      continue;
    }

    const rate = calculateRateFromChart(fat, snf, settings);
    const sellingRateApplied = getEffectiveSellingRate(isoDate, rateHistory);

    let { error } = await supabase.from('milk_entries').insert({
      unit_id: unitId,
      zone_id: zoneId,
      date: isoDate,
      shift,
      fat_pct: +fat.toFixed(2),
      snf_pct: +snf.toFixed(2),
      quantity_litres: +qty.toFixed(2),
      rejection_qty: +rej.toFixed(2),
      rejection_reason: rej > 0 ? String(r.rejection_reason ?? r['Rejection Reason'] ?? 'Other') : null,
      rate_per_litre: rate,
      selling_rate_applied: sellingRateApplied,
      status: 'submitted',
      created_by: req.user.id,
    });

    if (error && isMissingSchemaError(error)) {
      const fb = await supabase.from('milk_entries').insert({
        unit_id: unitId,
        zone_id: zoneId,
        date: isoDate,
        shift,
        fat_pct: +fat.toFixed(2),
        snf_pct: +snf.toFixed(2),
        quantity_litres: +qty.toFixed(2),
        rejection_qty: +rej.toFixed(2),
        rate_per_litre: rate,
        created_by: req.user.id,
      });
      error = fb.error;
    }

    if (error) {
      errors.push({ row: rowNum, error: error.code === '23505' ? `Duplicate ${shift} entry on ${formatDateDDMMYYYY(isoDate)}` : error.message });
    } else {
      inserted += 1;
    }
  }

  res.json({ inserted, skipped: errors.length, errors });
});

// DELETE /milk/:id — unit can delete within lock window (used for 5-min Undo); admin anytime
router.delete('/:id', async (req, res) => {
  const entryId = String(req.params.id);
  const { data: existing } = await supabase
    .from('milk_entries')
    .select('id, unit_id, zone_id, created_at, date, shift')
    .eq('id', entryId)
    .eq('zone_id', req.profile.zone_id)
    .maybeSingle();

  if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }
  if (req.profile.role === 'unit') {
    if (existing.unit_id !== req.profile.unit_id) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const settings = await getZoneSettings(req.profile.zone_id);
    if (Date.now() - new Date(existing.created_at).getTime() > settings.edit_lock_hours * 3600 * 1000) {
      res.status(403).json({ error: 'Entry is locked and cannot be deleted' });
      return;
    }
  }

  const { error } = await supabase.from('milk_entries').delete().eq('id', entryId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  await writeAuditLog({
    zone_id: existing.zone_id,
    unit_id: existing.unit_id,
    entity_type: 'milk_entry',
    entity_id: entryId,
    action: 'delete_undo',
    changes: { date: existing.date, shift: existing.shift },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'User',
  });

  res.status(204).send();
});

export default router;
