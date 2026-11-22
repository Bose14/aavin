import { Router } from 'express';
import { readFirstSheetRows } from '../lib/spreadsheet';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { idLookup } from '../lib/ids';
import { prepareCollectionLines, summarizeCollection } from '../lib/milkCollection';
import { getBmcMilkType, getChartFor, resolveRate } from '../lib/rateChart';
import {
  calculateEntryFinancials,
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
  id, bmc_id, date, shift, fat_pct, snf_pct, quantity_litres,
  rejection_qty, temperature, rate_per_litre, created_by, created_at,
  bmcs(name, bmc_code)
`;

const EXTENDED_SELECT = `
  id, bmc_id, date, shift, fat_pct, snf_pct, quantity_litres,
  rejection_qty, temperature, rate_per_litre, created_by, created_at,
  rejection_reason, rate_override, rate_override_reason, selling_rate_applied,
  status, verified_by, verified_at, updated_at, dispatch_date, cans,
  bmcs(name, bmc_code)
`;

// GET /milk?from=YYYY-MM-DD&to=YYYY-MM-DD&bmc_id=...&shift=AM|PM
router.get('/', async (req, res) => {
  const { from, to, bmc_id, shift } = req.query as Record<string, string>;
  const dairyUnitId = req.profile.dairy_unit_id;

  const runQuery = (columns: string) => {
    let query = supabase
      .from('milk_entries')
      .select(columns)
      .eq('dairy_unit_id', dairyUnitId)
      .order('date', { ascending: false })
      .order('shift', { ascending: true });

    if (req.profile.role === 'bmc') query = query.eq('bmc_id', req.profile.bmc_id!);
    else if (bmc_id) query = query.eq('bmc_id', bmc_id);
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

  if (error?.code === 'P0001') { res.status(400).json({ error: error.message }); return; }
  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  const [settings, rateHistory, profilesRes] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
    supabase.from('users').select('auth_user_id, full_name').eq('dairy_unit_id', dairyUnitId),
  ]);

  const nameById = new Map<string, string>();
  for (const p of (profilesRes.data ?? [])) {
    if (p.full_name) nameById.set(p.auth_user_id, p.full_name);
  }

  const nowMs = Date.now();
  const lockMs = settings.edit_lock_hours * 3600 * 1000;
  const includeProfit = req.profile.role !== 'bmc' || settings.show_unit_profit;

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
    const isLocked = req.profile.role === 'bmc' && (nowMs - createdMs > lockMs || status === 'verified');
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
    const unitFilter = req.profile.role === 'bmc' ? req.profile.bmc_id : undefined;
    const rows = await listCorrectionRequests(req.profile.dairy_unit_id, unitFilter);
    res.json(rows);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PATCH /milk/correction-requests/:reqId — admin resolves or rejects correction request
router.patch('/correction-requests/:reqId', requireRole('admin'), async (req, res) => {
  try {
    const status = req.body?.status === 'rejected' ? 'rejected' : 'resolved';
    await resolveCorrectionRequest(String(req.params.reqId), req.profile.dairy_unit_id, status, req.user.id);
    res.json({ ok: true, status });
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/**
 * Society-wise shift entry: one row per society (cans, litres, fat, snf). The shift
 * totals on milk_entries are derived from the rows by save_milk_collection().
 */
async function saveCollection(req: any, res: any, existing: { id: string; bmc_id: string } | null) {
  const body = req.body as Record<string, any>;
  const dairyUnitId = req.profile.dairy_unit_id;

  const date = existing ? undefined : String(body.date ?? '');
  const shift = existing ? undefined : String(body.shift ?? '');
  if (!existing) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date!)) { res.status(400).json({ error: 'A valid date is required' }); return; }
    if (shift !== 'AM' && shift !== 'PM') { res.status(400).json({ error: 'shift must be AM or PM' }); return; }
  }
  const dispatchDate = body.dispatch_date ? String(body.dispatch_date) : null;
  if (dispatchDate && !/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) {
    res.status(400).json({ error: 'Invalid dispatch date' }); return;
  }
  const temperature = body.temperature === '' || body.temperature == null ? null : Number(body.temperature);
  if (temperature != null && !Number.isFinite(temperature)) { res.status(400).json({ error: 'Invalid temperature' }); return; }

  let bmcId: string | null = existing ? String(existing.bmc_id) : (req.profile.role === 'bmc' ? req.profile.bmc_id : body.bmc_id);
  if (!bmcId) { res.status(400).json({ error: 'bmc_id required' }); return; }
  if (!existing && req.profile.role !== 'bmc') {
    const lookup = idLookup(String(bmcId));
    const { data: ownBmc } = lookup
      ? await supabase.from('bmcs').select('id').eq(lookup.column, lookup.value).eq('dairy_unit_id', dairyUnitId).maybeSingle()
      : { data: null };
    if (!ownBmc) { res.status(400).json({ error: 'bmc_id does not belong to your dairy unit' }); return; }
    bmcId = String(ownBmc.id);
  }

  // The entry's date decides which rate chart version prices it (an edit keeps the original date)
  let entryDate = date;
  if (existing) {
    const { data: row } = await supabase.from('milk_entries').select('date').eq('id', existing.id).maybeSingle();
    entryDate = row?.date ? String(row.date) : undefined;
  }
  if (!entryDate) { res.status(404).json({ error: 'Entry not found' }); return; }
  const rateHistory = await getSellingRateHistory(dairyUnitId);
  const milkType = await getBmcMilkType(String(bmcId));
  const chart = await getChartFor(dairyUnitId, milkType, entryDate);
  if (!chart) {
    res.status(400).json({ error: `No ${milkType === 'BUFFALO' ? 'buffalo' : 'cow'} rate chart is set for ${formatDateDDMMYYYY(entryDate)}. Ask the admin to add one.` });
    return;
  }
  const prepared = prepareCollectionLines(body.lines, chart);
  if ('error' in prepared) { res.status(400).json({ error: prepared.error }); return; }
  const totals = summarizeCollection(prepared.lines);

  const { data: entryId, error } = await supabase.rpc('save_milk_collection', {
    p: {
      entry_id: existing ? Number(existing.id) : null,
      bmc_id: Number(bmcId),
      dairy_unit_id: Number(dairyUnitId),
      date,
      shift,
      dispatch_date: dispatchDate,
      temperature,
      actor: req.user.id,
      selling_rate_applied: existing ? null : getEffectiveSellingRate(date!, rateHistory),
      lines: prepared.lines,
    },
  });

  if (error) {
    if (error.code === 'P0001') { res.status(400).json({ error: error.message }); return; }
    if (error.code === '23505') {
      const { data: dup } = await supabase
        .from('milk_entries').select('id').eq('bmc_id', bmcId).eq('date', date!).eq('shift', shift!).maybeSingle();
      res.status(409).json({
        error: `A ${shift === 'AM' ? 'Morning' : 'Evening'} entry for ${formatDateDDMMYYYY(date!)} already exists.`,
        existing_id: dup?.id ?? null,
      });
      return;
    }
    console.error('[api]', req.method, req.originalUrl, error.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }

  const { data: entry } = await supabase.from('milk_entries').select('*').eq('id', String(entryId)).single();

  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: bmcId,
    entity_type: 'milk_entry',
    entity_id: String(entryId),
    action: existing ? 'edit' : 'create',
    changes: { societies: prepared.lines.length, ...totals, dispatch_date: dispatchDate },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
  });

  res.status(existing ? 200 : 201).json(entry);
}

// GET /milk/:id/lines — society rows of one shift entry (for editing / viewing)
router.get('/:id/lines', async (req, res) => {
  try {
    let q = supabase.from('milk_entries').select('id, bmc_id, date, shift, dispatch_date, temperature, status, created_at')
      .eq('id', String(req.params.id)).eq('dairy_unit_id', req.profile.dairy_unit_id);
    if (req.profile.role === 'bmc') q = q.eq('bmc_id', req.profile.bmc_id!);
    const { data: entry, error } = await q.maybeSingle();
    if (error) throw error;
    if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }
    const { data: lines, error: lineErr } = await supabase
      .from('milk_collection_lines')
      .select('society_id, cans, litres, fat_pct, snf_pct, lt_fat, lt_snf, rate, amount, societies(code, name, sort_order)')
      .eq('entry_id', entry.id);
    if (lineErr) throw lineErr;
    const rows = ((lines ?? []) as any[])
      .map((l) => ({ ...l, code: l.societies?.code, name: l.societies?.name, sort_order: l.societies?.sort_order ?? 0, societies: undefined }))
      .sort((a, b) => a.sort_order - b.sort_order);
    res.json({ entry, lines: rows });
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /milk — submit shift entry (auto chart rate or logged manual override)
router.post('/', requireRole('admin', 'bmc'), async (req, res) => {
  if (Array.isArray(req.body?.lines)) { await saveCollection(req, res, null); return; }
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

  const dairyUnitId = req.profile.dairy_unit_id;
  const [settings, rateHistory] = await Promise.all([
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
  ]);

  if (fat < settings.fat_min || fat > settings.fat_max) {
    res.status(400).json({ error: `Fat % must be between ${settings.fat_min.toFixed(2)} and ${settings.fat_max.toFixed(2)}` });
    return;
  }
  if (snf < settings.snf_min || snf > settings.snf_max) {
    res.status(400).json({ error: `SNF % must be between ${settings.snf_min.toFixed(2)} and ${settings.snf_max.toFixed(2)}` });
    return;
  }

  const bmcForRate = req.profile.role === 'bmc' ? req.profile.bmc_id : req.body.bmc_id;
  let chartRate = 0;
  if (bmcForRate && !rate_override) {
    const priced = await resolveRate({ dairyUnitId, bmcId: String(bmcForRate), date: String(date), fat, snf });
    if ('error' in priced) { res.status(400).json({ error: priced.error }); return; }
    chartRate = priced.rate;
  }
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

  const bmc_id = req.profile.role === 'bmc' ? req.profile.bmc_id : req.body.bmc_id;
  if (!bmc_id) { res.status(400).json({ error: 'bmc_id required' }); return; }
  if (req.profile.role !== 'bmc') {
    // An admin may only record milk for a BMC of their own dairy unit
    const lookup = idLookup(String(bmc_id));
    const { data: ownBmc } = lookup
      ? await supabase.from('bmcs').select('id').eq(lookup.column, lookup.value).eq('dairy_unit_id', dairyUnitId).maybeSingle()
      : { data: null };
    if (!ownBmc) { res.status(400).json({ error: 'bmc_id does not belong to your dairy unit' }); return; }
  }

  const sellingRateApplied = getEffectiveSellingRate(date, rateHistory);

  const extendedRow = {
    bmc_id,
    dairy_unit_id: dairyUnitId,
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
        bmc_id,
        dairy_unit_id: dairyUnitId,
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
        .eq('bmc_id', bmc_id)
        .eq('date', date)
        .eq('shift', shift)
        .maybeSingle();
      const shiftLabel = shift === 'AM' ? 'Morning' : 'Evening';
      res.status(409).json({
        error: `A ${shiftLabel} entry for ${formatDateDDMMYYYY(date)} already exists.`,
        existing_id: existing?.id ?? null,
      });
    } else {
      console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    return;
  }

  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id,
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
router.patch('/:id', requireRole('admin', 'bmc'), async (req, res) => {
  const entryId = String(req.params.id);
  const dairyUnitId = req.profile.dairy_unit_id;

  let existingQuery = supabase.from('milk_entries').select('*').eq('id', entryId);
  if (req.profile.role === 'bmc') existingQuery = existingQuery.eq('bmc_id', req.profile.bmc_id!);
  else existingQuery = existingQuery.eq('dairy_unit_id', dairyUnitId);

  const { data: existing, error: fetchErr } = await existingQuery.maybeSingle();
  if (fetchErr) { console.error('[api]', req.method, req.originalUrl, fetchErr.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }
  if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }

  const settings = await getZoneSettings(dairyUnitId);
  if (req.profile.role === 'bmc') {
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

  if (Array.isArray(req.body?.lines)) {
    await saveCollection(req, res, { id: entryId, bmc_id: String(existing.bmc_id) });
    return;
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

  let nextRate: number;
  if (body.rate_override && body.rate_per_litre != null) {
    nextRate = +Number(body.rate_per_litre).toFixed(2);
  } else {
    const priced = await resolveRate({
      dairyUnitId: String(existing.dairy_unit_id ?? req.profile.dairy_unit_id),
      bmcId: String(existing.bmc_id),
      date: String(existing.date),
      fat,
      snf,
    });
    if ('error' in priced) { res.status(400).json({ error: priced.error }); return; }
    nextRate = priced.rate;
  }

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

  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['fat_pct', 'snf_pct', 'quantity_litres', 'rejection_qty', 'rate_per_litre'] as const) {
    if (Number(existing[key] ?? 0) !== Number(extendedPatch[key] ?? 0)) {
      changes[key] = { from: existing[key], to: extendedPatch[key] };
    }
  }

  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: existing.bmc_id,
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
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .select()
    .single();

  if (error && isMissingSchemaError(error)) {
    res.json({ id: entryId, status: 'verified', note: 'Extended status column pending SQL migration' });
    return;
  }
  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  await writeAuditLog({
    dairy_unit_id: req.profile.dairy_unit_id,
    bmc_id: data.bmc_id,
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
router.post('/:id/correction-request', requireRole('admin', 'bmc'), async (req, res) => {
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
    .select('id, dairy_unit_id, bmc_id')
    .eq('id', entryId)
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .maybeSingle();

  if (!entry) { res.status(404).json({ error: 'Entry not found' }); return; }

  try {
    const reqRecord = await createCorrectionRequest({
      milk_entry_id: entry.id,
      dairy_unit_id: entry.dairy_unit_id,
      bmc_id: entry.bmc_id,
      requested_by: req.user.id,
      requested_by_name: req.profile.full_name ?? req.user.email ?? 'Staff',
      reason: reason.trim(),
      proposed_changes,
    });

    await writeAuditLog({
      dairy_unit_id: entry.dairy_unit_id,
      bmc_id: entry.bmc_id,
      entity_type: 'milk_entry',
      entity_id: entry.id,
      action: 'correction_request',
      changes: { reason: reason.trim(), proposed_changes },
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
    });

    res.status(201).json(reqRecord);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /milk/bulk — admin bulk upload validated entries from JSON rows or base64 Excel/CSV file
router.post('/bulk', requireRole('admin'), async (req, res) => {
  let rows = Array.isArray(req.body?.rows) ? (req.body.rows as Array<Record<string, unknown>>) : [];
  if (rows.length === 0 && typeof req.body?.fileBase64 === 'string' && req.body.fileBase64.trim()) {
    try {
      const base64Clean = req.body.fileBase64.includes(',') ? req.body.fileBase64.split(',')[1] : req.body.fileBase64;
      const buf = Buffer.from(base64Clean, 'base64');
      rows = await readFirstSheetRows(buf);
    } catch {
      res.status(400).json({ error: 'Could not read Excel/CSV file. Please use the provided template.' });
      return;
    }
  }
  if (rows.length === 0) {
    res.status(400).json({ error: 'No rows provided for bulk upload' });
    return;
  }

  const dairyUnitId = req.profile.dairy_unit_id;
  const [unitsRes, settings, rateHistory] = await Promise.all([
    supabase.from('bmcs').select('id, bmc_code').eq('dairy_unit_id', dairyUnitId),
    getZoneSettings(dairyUnitId),
    getSellingRateHistory(dairyUnitId),
  ]);

  const unitByCode = new Map<string, string>();
  for (const u of (unitsRes.data ?? [])) {
    unitByCode.set(String(u.bmc_code).trim().toUpperCase(), u.id);
  }

  let inserted = 0;
  const errors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2; // Excel row index (after header)
    const code = String(r.bmc_code ?? r['Unit Code'] ?? '').trim().toUpperCase();
    const unitId = unitByCode.get(code);
    if (!unitId) {
      errors.push({ row: rowNum, error: `Unknown unit code "${code}"` });
      continue;
    }

    const rawCell = r.date ?? r['Date'] ?? '';
    let isoDate = '';
    if (typeof rawCell === 'number' && Number.isFinite(rawCell)) {
      // Excel date serial (days since 1899-12-30)
      const d = new Date(Math.round((rawCell - 25569) * 86400 * 1000));
      if (!Number.isNaN(d.getTime())) isoDate = d.toISOString().slice(0, 10);
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

    const priced = await resolveRate({ dairyUnitId, bmcId: String(unitId), date: isoDate, fat, snf });
    if ('error' in priced) {
      errors.push({ row: rowNum, error: priced.error });
      continue;
    }
    const rate = priced.rate;
    const sellingRateApplied = getEffectiveSellingRate(isoDate, rateHistory);

    let { error } = await supabase.from('milk_entries').insert({
      bmc_id: unitId,
      dairy_unit_id: dairyUnitId,
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
        bmc_id: unitId,
        dairy_unit_id: dairyUnitId,
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
router.delete('/:id', requireRole('admin', 'bmc'), async (req, res) => {
  const entryId = String(req.params.id);
  const { data: existing } = await supabase
    .from('milk_entries')
    .select('id, bmc_id, dairy_unit_id, created_at, date, shift')
    .eq('id', entryId)
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .maybeSingle();

  if (!existing) { res.status(404).json({ error: 'Entry not found' }); return; }
  if (req.profile.role === 'bmc') {
    if (existing.bmc_id !== req.profile.bmc_id) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    const settings = await getZoneSettings(req.profile.dairy_unit_id);
    if (Date.now() - new Date(existing.created_at).getTime() > settings.edit_lock_hours * 3600 * 1000) {
      res.status(403).json({ error: 'Entry is locked and cannot be deleted' });
      return;
    }
  }

  const { error } = await supabase.from('milk_entries').delete().eq('id', entryId);
  if (error?.code === 'P0001') { res.status(400).json({ error: error.message }); return; }
  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

  await writeAuditLog({
    dairy_unit_id: existing.dairy_unit_id,
    bmc_id: existing.bmc_id,
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
