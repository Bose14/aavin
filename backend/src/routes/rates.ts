import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { supabase } from '../supabase';
import { writeAuditLog } from '../lib/settingsStore';
import {
  clearRateChartCache,
  getBmcMilkType,
  getChartById,
  getChartFor,
  parseChartInput,
} from '../lib/rateChart';

const router = Router();
router.use(authMiddleware);

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function fail(req: import('express').Request, res: import('express').Response, err: unknown) {
  console.error('[api]', req.method, req.originalUrl, (err as Error).message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// GET /rates/chart?bmc_id=&date= — the chart a BMC's milk is priced with on a date (used by Milk Entry)
router.get('/chart', requireRole('admin', 'bmc'), async (req, res) => {
  try {
    const dairyUnitId = req.profile.dairy_unit_id;
    const bmcId = req.profile.role === 'bmc' ? req.profile.bmc_id : (req.query.bmc_id as string | undefined);
    const date = String(req.query.date ?? todayIst());
    if (!bmcId || !/^\d+$/.test(String(bmcId))) { res.status(400).json({ error: 'bmc_id required' }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'A valid date is required' }); return; }

    const { data: own } = await supabase.from('bmcs').select('id').eq('id', String(bmcId)).eq('dairy_unit_id', dairyUnitId).maybeSingle();
    if (!own) { res.status(404).json({ error: 'BMC not found' }); return; }

    const milkType = await getBmcMilkType(String(bmcId));
    const chart = await getChartFor(dairyUnitId, milkType, date);
    res.json({
      milk_type: milkType,
      chart: chart && {
        id: chart.id,
        effective_from: chart.effective_from,
        fat_values: chart.fat_values,
        snf_values: chart.snf_values,
        rates: chart.rates,
      },
    });
  } catch (err) {
    fail(req, res, err);
  }
});

// GET /rates/charts — every version of the unit's charts
router.get('/charts', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('rate_charts')
      .select('id, milk_type, effective_from, name, created_by, created_at, rate_chart_cells(count)')
      .eq('dairy_unit_id', req.profile.dairy_unit_id)
      .order('effective_from', { ascending: false });
    if (error) throw new Error(error.message);
    const today = todayIst();
    const rows = (data ?? []).map((r: any) => ({
      id: String(r.id),
      milk_type: r.milk_type,
      effective_from: r.effective_from,
      name: r.name,
      created_at: r.created_at,
      cells: Number(r.rate_chart_cells?.[0]?.count ?? 0),
      is_future: r.effective_from > today,
      is_current: false,
    }));
    for (const type of ['COW', 'BUFFALO']) {
      const current = rows.find((r) => r.milk_type === type && !r.is_future);
      if (current) current.is_current = true;
    }
    res.json(rows);
  } catch (err) {
    fail(req, res, err);
  }
});

// GET /rates/charts/:id — one chart as a grid
router.get('/charts/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) { res.status(404).json({ error: 'Rate chart not found' }); return; }
    const chart = await getChartById(req.profile.dairy_unit_id, String(req.params.id));
    if (!chart) { res.status(404).json({ error: 'Rate chart not found' }); return; }
    res.json(chart);
  } catch (err) {
    fail(req, res, err);
  }
});

// POST /rates/charts — publish a new chart version (the old versions stay for past dates)
router.post('/charts', requireRole('admin'), async (req, res) => {
  try {
    const parsed = parseChartInput(req.body);
    if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return; }
    const c = parsed.chart;
    const dairyUnitId = req.profile.dairy_unit_id;

    const { data: id, error } = await supabase.rpc('publish_rate_chart', {
      p: { ...c, dairy_unit_id: Number(dairyUnitId), created_by: req.profile.full_name ?? req.user.email ?? 'Admin' },
    });
    if (error) {
      if (error.code === 'P0001') { res.status(400).json({ error: error.message }); return; }
      if (error.code === '23505') {
        res.status(409).json({ error: `A ${c.milk_type === 'COW' ? 'cow' : 'buffalo'} chart already starts on ${c.effective_from}. Pick another date, or delete that one first.` });
        return;
      }
      throw new Error(error.message);
    }
    clearRateChartCache();

    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      entity_type: 'rate_chart',
      entity_id: String(id),
      action: 'publish',
      changes: { milk_type: c.milk_type, effective_from: c.effective_from, fat_rows: c.fat_values.length, snf_columns: c.snf_values.length },
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    });
    res.status(201).json({ id: String(id) });
  } catch (err) {
    fail(req, res, err);
  }
});

// DELETE /rates/charts/:id — only a chart that has not started yet (a wrong upload can be undone)
router.delete('/charts/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!/^\d+$/.test(String(req.params.id))) { res.status(404).json({ error: 'Rate chart not found' }); return; }
    const dairyUnitId = req.profile.dairy_unit_id;
    const { data: row } = await supabase
      .from('rate_charts').select('id, milk_type, effective_from')
      .eq('id', String(req.params.id)).eq('dairy_unit_id', dairyUnitId).maybeSingle();
    if (!row) { res.status(404).json({ error: 'Rate chart not found' }); return; }
    if (String(row.effective_from) <= todayIst()) {
      res.status(400).json({ error: 'This chart has already started, so entries may be priced with it. Upload a new chart with a later date instead.' });
      return;
    }
    const { error } = await supabase.from('rate_charts').delete().eq('id', row.id);
    if (error) throw new Error(error.message);
    clearRateChartCache();
    await writeAuditLog({
      dairy_unit_id: dairyUnitId,
      entity_type: 'rate_chart',
      entity_id: String(row.id),
      action: 'delete',
      changes: { milk_type: row.milk_type, effective_from: row.effective_from },
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    });
    res.status(204).send();
  } catch (err) {
    fail(req, res, err);
  }
});

export default router;
