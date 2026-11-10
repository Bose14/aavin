import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /tanker
router.get('/', async (req, res) => {
  const { from, to, unit_id } = req.query as Record<string, string>;
  let query = supabase
    .from('tanker_dispatches')
    .select(`
      id, date, tanker_number, quantity_dispatched, destination, created_at,
      units(name, unit_code)
    `)
    .eq('zone_id', req.profile.zone_id)
    .order('date', { ascending: false });

  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else if (unit_id) query = query.eq('unit_id', unit_id);
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// POST /tanker
router.post('/', async (req, res) => {
  const { date, tanker_number, quantity_dispatched, destination } = req.body as {
    date: string; tanker_number: string; quantity_dispatched: number; destination?: string;
  };

  if (!date || !tanker_number || !quantity_dispatched) {
    res.status(400).json({ error: 'date, tanker_number and quantity_dispatched required' });
    return;
  }

  const unit_id = req.profile.role === 'unit' ? req.profile.unit_id : req.body.unit_id;
  if (!unit_id) { res.status(400).json({ error: 'unit_id required' }); return; }

  const { data, error } = await supabase
    .from('tanker_dispatches')
    .insert({
      unit_id,
      zone_id: req.profile.zone_id,
      date, tanker_number, quantity_dispatched, destination,
      created_by: req.user.id
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// DELETE /tanker/:id
router.delete('/:id', async (req, res) => {
  let query = supabase.from('tanker_dispatches').delete().eq('id', req.params.id);
  if (req.profile.role === 'unit') query = query.eq('unit_id', req.profile.unit_id!);
  else query = query.eq('zone_id', req.profile.zone_id);

  const { error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
