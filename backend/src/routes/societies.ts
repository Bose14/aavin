import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { idLookup } from '../lib/ids';

const router = Router();
router.use(authMiddleware);

/** The BMC whose societies the caller may use: own BMC for BMC staff, any BMC of the unit for admins. */
async function resolveBmcId(req: any): Promise<string | null> {
  if (req.profile.role === 'bmc') return req.profile.bmc_id ?? null;
  const lookup = idLookup(req.query?.bmc_id ?? req.body?.bmc_id);
  if (!lookup) return null;
  const { data } = await supabase
    .from('bmcs')
    .select('id')
    .eq(lookup.column, lookup.value)
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .maybeSingle();
  return data ? String(data.id) : null;
}

// GET /societies?bmc_id=  — societies a BMC collects from
router.get('/', async (req, res) => {
  try {
    const bmcId = await resolveBmcId(req);
    if (!bmcId) { res.status(400).json({ error: 'bmc_id required' }); return; }
    const { data, error } = await supabase
      .from('societies')
      .select('id, id_token, bmc_id, code, name, sort_order, is_active')
      .eq('bmc_id', bmcId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /societies — add a society to a BMC
router.post('/', requireRole('admin', 'bmc'), async (req, res) => {
  try {
    const bmcId = await resolveBmcId(req);
    if (!bmcId) { res.status(400).json({ error: 'bmc_id required' }); return; }
    const code = String(req.body?.code ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    if (!code || !name) { res.status(400).json({ error: 'Society code and name are required' }); return; }
    if (code.length > 20 || name.length > 80) { res.status(400).json({ error: 'Society code or name is too long' }); return; }

    const { data: last } = await supabase
      .from('societies').select('sort_order').eq('bmc_id', bmcId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle();

    const { data, error } = await supabase
      .from('societies')
      .insert({ bmc_id: bmcId, code, name, sort_order: Number(last?.sort_order ?? -1) + 1 })
      .select('id, id_token, bmc_id, code, name, sort_order, is_active')
      .single();
    if (error) {
      if (error.code === '23505') { res.status(409).json({ error: 'This society code already exists for the BMC' }); return; }
      throw error;
    }
    res.status(201).json(data);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PATCH /societies/:id — rename or switch off (admin)
router.patch('/:id', requireRole('admin'), async (req, res) => {
  try {
    const lookup = idLookup(req.params.id);
    if (!lookup) { res.status(400).json({ error: 'Invalid society id' }); return; }
    const { data: society } = await supabase
      .from('societies').select('id, bmc_id, bmcs(dairy_unit_id)').eq(lookup.column, lookup.value).maybeSingle();
    const unit = (society as any)?.bmcs?.dairy_unit_id;
    if (!society || String(unit) !== String(req.profile.dairy_unit_id)) {
      res.status(404).json({ error: 'Society not found' }); return;
    }
    const patch: Record<string, unknown> = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 80) { res.status(400).json({ error: 'Invalid society name' }); return; }
      patch.name = name;
    }
    if (req.body?.is_active != null) patch.is_active = Boolean(req.body.is_active);
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }
    const { data, error } = await supabase
      .from('societies').update(patch).eq('id', society.id)
      .select('id, id_token, bmc_id, code, name, sort_order, is_active').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[api]', req.method, req.originalUrl, (err as Error).message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

export default router;
