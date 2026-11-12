import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

const router = Router();
router.use(authMiddleware);

// GET /units — list units in requester's zone
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('units')
    .select('id, name, location, unit_code, is_active')
    .eq('zone_id', req.profile.zone_id)
    .order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// POST /units — admin creates a unit
router.post('/', requireRole('admin'), async (req, res) => {
  if (!req.profile.zone_id) {
    res.status(403).json({ error: 'Admin account is not assigned to a zone' });
    return;
  }

  const rawBody = req.body as { name?: string; location?: string; unit_code?: string };
  const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
  const unitCode = typeof rawBody.unit_code === 'string' ? rawBody.unit_code.trim() : '';
  const location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;

  if (!name || !unitCode) {
    res.status(400).json({ error: 'name and unit_code required' });
    return;
  }
  const { data, error } = await supabase
    .from('units')
    .insert({ name, location, unit_code: unitCode, zone_id: req.profile.zone_id })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Unit code "${unitCode}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }
  res.status(201).json(data);
});

// PATCH /units/:id — admin updates a unit
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const { name, location, is_active } = req.body as {
    name?: string; location?: string; is_active?: boolean;
  };
  const { data, error } = await supabase
    .from('units')
    .update({ name, location, is_active })
    .eq('id', req.params.id)
    .eq('zone_id', req.profile.zone_id)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
