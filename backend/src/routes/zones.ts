import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

const router = Router();

// Public — needed for registration & zone dropdowns
router.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('zones').select('id, name').order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Superadmin — add a new zone
router.post('/', authMiddleware, requireRole('superadmin'), async (req, res) => {
  const rawName = (req.body as { name?: string })?.name;
  const name = typeof rawName === 'string' ? rawName.trim() : '';

  if (!name) {
    res.status(400).json({ error: 'Zone name is required' });
    return;
  }

  const { data, error } = await supabase
    .from('zones')
    .insert({ name })
    .select('id, name')
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Zone "${name}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(201).json(data);
});

export default router;
