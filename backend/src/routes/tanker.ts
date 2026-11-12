import { Router } from 'express';
import { supabase } from '../supabase';
import { requireRole } from '../middleware/requireRole';
import { authMiddleware } from '../middleware/auth';
import { isMissingSchemaError, writeAuditLog } from '../lib/settingsStore';

const router = Router();
router.use(authMiddleware);

const EXTENDED_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, driver_name, seal_number, dispatch_time,
  quantity_dispatched, destination, dispatch_fat_pct, dispatch_snf_pct,
  received_qty, receipt_time, received_fat_pct, received_snf_pct, received_by, created_at,
  units(name, unit_code)
`;

const BASE_TANKER_SELECT = `
  id, unit_id, zone_id, date, tanker_number, quantity_dispatched, destination, created_at,
  units(name, unit_code)
`;

function enrichTankerRow(row: Record<string, unknown>) {
  const dispatched = Number(row.quantity_dispatched ?? 0);
  const received = row.received_qty != null ? Number(row.received_qty) : null;
  const transitLoss = received != null ? +(dispatched - received).toFixed(2) : null;
  const transitLossPct = received != null && dispatched > 0
    ? +(((dispatched - received) / dispatched) * 100).toFixed(2)
    : null;
  const dispatchFat = row.dispatch_fat_pct != null ? Number(row.dispatch_fat_pct) : null;
  const dispatchSnf = row.dispatch_snf_pct != null ? Number(row.dispatch_snf_pct) : null;
  const receivedFat = row.received_fat_pct != null ? Number(row.received_fat_pct) : null;
  const receivedSnf = row.received_snf_pct != null ? Number(row.received_snf_pct) : null;

  return {
    ...row,
    transit_loss_qty: transitLoss,
    transit_loss_pct: transitLossPct,
    fat_diff: dispatchFat != null && receivedFat != null ? +(receivedFat - dispatchFat).toFixed(2) : null,
    snf_diff: dispatchSnf != null && receivedSnf != null ? +(receivedSnf - dispatchSnf).toFixed(2) : null,
    receipt_status: received != null ? 'received' : 'dispatched',
  };
}

async function computeAvailableStock(zoneId: string, unitId?: string | null) {
  let milkQ = supabase.from('milk_entries').select('quantity_litres, rejection_qty').eq('zone_id', zoneId);
  let tankerQ = supabase.from('tanker_dispatches').select('quantity_dispatched').eq('zone_id', zoneId);

  if (unitId) {
    milkQ = milkQ.eq('unit_id', unitId);
    tankerQ = tankerQ.eq('unit_id', unitId);
  }

  const [mRes, tRes] = await Promise.all([milkQ, tankerQ]);
  if (mRes.error || tRes.error) {
    throw new Error(mRes.error?.message || tRes.error?.message || 'Failed to compute stock');
  }

  const totalCollectedNet = (mRes.data ?? []).reduce(
    (sum, r) => sum + Math.max(0, Number(r.quantity_litres ?? 0) - Number(r.rejection_qty ?? 0)),
    0,
  );
  const totalDispatched = (tRes.data ?? []).reduce(
    (sum, r) => sum + Number(r.quantity_dispatched ?? 0),
    0,
  );
  const availableStock = Math.max(0, +(totalCollectedNet - totalDispatched).toFixed(2));

  return {
    collected_net_qty: +totalCollectedNet.toFixed(2),
    dispatched_qty: +totalDispatched.toFixed(2),
    available_stock_qty: availableStock,
    raw_balance_qty: +(totalCollectedNet - totalDispatched).toFixed(2),
  };
}

// GET /tanker/stock — available milk stock (collected net minus already dispatched)
router.get('/stock', async (req, res) => {
  try {
    const unitId = req.profile.role === 'unit' ? req.profile.unit_id : (req.query.unit_id as string | undefined);
    const stock = await computeAvailableStock(req.profile.zone_id, unitId);
    res.json(stock);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /tanker
router.get('/', async (req, res) => {
  const { from, to, unit_id } = req.query as Record<string, string>;

  const runQuery = (selectStr: string) => {
    let query = supabase
      .from('tanker_dispatches')
      .select(selectStr)
      .eq('zone_id', req.profile.zone_id)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
    else if (unit_id) query = query.eq('unit_id', unit_id);
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);
    return query;
  };

  let { data, error } = await runQuery(EXTENDED_TANKER_SELECT);
  if (error && isMissingSchemaError(error)) {
    const fb = await runQuery(BASE_TANKER_SELECT);
    data = fb.data;
    error = fb.error;
  }

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(((data ?? []) as unknown as Array<Record<string, unknown>>).map(enrichTankerRow));
});

// POST /tanker
router.post('/', async (req, res) => {
  const {
    date,
    tanker_number,
    driver_name,
    seal_number,
    dispatch_time,
    quantity_dispatched,
    destination,
    dispatch_fat_pct,
    dispatch_snf_pct,
  } = req.body as {
    date: string;
    tanker_number: string;
    driver_name?: string;
    seal_number?: string;
    dispatch_time?: string;
    quantity_dispatched: number;
    destination?: string;
    dispatch_fat_pct?: number;
    dispatch_snf_pct?: number;
  };

  if (!date || !tanker_number || !quantity_dispatched || Number(quantity_dispatched) <= 0) {
    res.status(400).json({ error: 'date, tanker_number and positive quantity_dispatched required' });
    return;
  }

  const unit_id = req.profile.role === 'unit' ? req.profile.unit_id : req.body.unit_id;
  if (!unit_id) { res.status(400).json({ error: 'unit_id required' }); return; }

  let stockWarning: string | null = null;
  try {
    const stock = await computeAvailableStock(req.profile.zone_id, unit_id);
    if (Number(quantity_dispatched) > stock.available_stock_qty) {
      stockWarning = `Dispatched quantity (${Number(quantity_dispatched).toFixed(1)} L) exceeds available stock (${stock.available_stock_qty.toFixed(1)} L).`;
    }
  } catch {
    // non-fatal check
  }

  const extendedInsert = {
    unit_id,
    zone_id: req.profile.zone_id,
    date,
    tanker_number: tanker_number.trim().toUpperCase(),
    driver_name: driver_name?.trim() || null,
    seal_number: seal_number?.trim() || null,
    dispatch_time: dispatch_time || null,
    quantity_dispatched: +Number(quantity_dispatched).toFixed(2),
    destination: destination?.trim() || null,
    dispatch_fat_pct: dispatch_fat_pct != null && String(dispatch_fat_pct) !== '' ? +Number(dispatch_fat_pct).toFixed(2) : null,
    dispatch_snf_pct: dispatch_snf_pct != null && String(dispatch_snf_pct) !== '' ? +Number(dispatch_snf_pct).toFixed(2) : null,
    created_by: req.user.id,
  };

  let { data, error } = await supabase.from('tanker_dispatches').insert(extendedInsert).select().single();
  if (error && isMissingSchemaError(error)) {
    const fb = await supabase
      .from('tanker_dispatches')
      .insert({
        unit_id,
        zone_id: req.profile.zone_id,
        date,
        tanker_number: tanker_number.trim().toUpperCase(),
        quantity_dispatched: +Number(quantity_dispatched).toFixed(2),
        destination: destination?.trim() || null,
        created_by: req.user.id,
      })
      .select()
      .single();
    data = fb.data;
    error = fb.error;
  }

  if (error) { res.status(500).json({ error: error.message }); return; }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id,
    entity_type: 'tanker_dispatch',
    entity_id: data.id,
    action: 'create',
    changes: {
      date,
      tanker_number: extendedInsert.tanker_number,
      quantity_dispatched: extendedInsert.quantity_dispatched,
      destination: extendedInsert.destination,
      driver_name: extendedInsert.driver_name,
      seal_number: extendedInsert.seal_number,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Staff',
  });

  res.status(201).json({ ...enrichTankerRow(data as Record<string, unknown>), stock_warning: stockWarning });
});

// PATCH /tanker/:id/receive — Admin logs dairy receipt quantity, time, fat & SNF to compute transit loss/gain
router.patch('/:id/receive', requireRole('admin'), async (req, res) => {
  const id = String(req.params.id);
  const { received_qty, receipt_time, received_fat_pct, received_snf_pct } = req.body as {
    received_qty?: number;
    receipt_time?: string;
    received_fat_pct?: number;
    received_snf_pct?: number;
  };

  if (received_qty == null || !Number.isFinite(Number(received_qty)) || Number(received_qty) < 0) {
    res.status(400).json({ error: 'Valid non-negative received_qty is required' });
    return;
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('tanker_dispatches')
    .select('*')
    .eq('id', id)
    .eq('zone_id', req.profile.zone_id)
    .maybeSingle();

  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return; }
  if (!existing) { res.status(404).json({ error: 'Tanker dispatch record not found' }); return; }

  const updateFields = {
    received_qty: +Number(received_qty).toFixed(2),
    receipt_time: receipt_time?.trim() || null,
    received_fat_pct: received_fat_pct != null && String(received_fat_pct) !== '' ? +Number(received_fat_pct).toFixed(2) : null,
    received_snf_pct: received_snf_pct != null && String(received_snf_pct) !== '' ? +Number(received_snf_pct).toFixed(2) : null,
    received_by: req.user.id,
  };

  const { data, error } = await supabase
    .from('tanker_dispatches')
    .update(updateFields)
    .eq('id', id)
    .eq('zone_id', req.profile.zone_id)
    .select('*, units(name, unit_code)')
    .single();

  if (error) {
    if (isMissingSchemaError(error)) {
      res.status(400).json({ error: 'Database schema update required: please run supabase/patch_v2_ux.sql in Supabase SQL Editor.' });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id: existing.unit_id,
    entity_type: 'tanker_dispatch',
    entity_id: id,
    action: 'record_receipt',
    changes: updateFields,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json(enrichTankerRow(data as Record<string, unknown>));
});

// DELETE /tanker/:id
router.delete('/:id', async (req, res) => {
  const id = String(req.params.id);
  let query = supabase.from('tanker_dispatches').delete().eq('id', id);
  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
