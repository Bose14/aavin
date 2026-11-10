import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /milk?from=YYYY-MM-DD&to=YYYY-MM-DD&unit_id=...
router.get('/', async (req, res) => {
  const { from, to, unit_id } = req.query as Record<string, string>;
  let query = supabase
    .from('milk_entries')
    .select(`
      id, date, shift, fat_pct, snf_pct, quantity_litres,
      rejection_qty, temperature, rate_per_litre, created_at,
      units(name, unit_code)
    `)
    .eq('zone_id', req.profile.zone_id)
    .order('date', { ascending: false })
    .order('shift', { ascending: true });

  // Units can only see their own data
  if (req.profile.role === 'unit') {
    query = query.eq('unit_id', req.profile.unit_id!);
  } else if (unit_id) {
    query = query.eq('unit_id', unit_id);
  }

  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// POST /milk — unit submits daily entry
router.post('/', async (req, res) => {
  const {
    date, shift, fat_pct, snf_pct, quantity_litres,
    rejection_qty = 0, temperature, rate_per_litre
  } = req.body as {
    date: string; shift: 'AM' | 'PM';
    fat_pct: number; snf_pct: number;
    quantity_litres: number; rejection_qty?: number;
    temperature?: number; rate_per_litre: number;
  };

  if (!date || !shift || fat_pct == null || snf_pct == null || !quantity_litres || !rate_per_litre) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // Unit user must have a unit_id
  const unit_id = req.profile.role === 'unit' ? req.profile.unit_id : req.body.unit_id;
  if (!unit_id) { res.status(400).json({ error: 'unit_id required' }); return; }

  const { data, error } = await supabase
    .from('milk_entries')
    .insert({
      unit_id,
      zone_id: req.profile.zone_id,
      date, shift, fat_pct, snf_pct,
      quantity_litres, rejection_qty, temperature,
      rate_per_litre,
      created_by: req.user.id
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Entry for ${shift} shift on ${date} already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }
  res.status(201).json(data);
});

// PATCH /milk/:id — update an entry (same day only, unit owns it)
router.patch('/:id', async (req, res) => {
  const updates = req.body as Partial<{
    fat_pct: number; snf_pct: number; quantity_litres: number;
    rejection_qty: number; temperature: number; rate_per_litre: number;
  }>;

  let query = supabase.from('milk_entries').update(updates).eq('id', req.params.id);
  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { data, error } = await query.select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// DELETE /milk/:id
router.delete('/:id', async (req, res) => {
  let query = supabase.from('milk_entries').delete().eq('id', req.params.id);
  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
