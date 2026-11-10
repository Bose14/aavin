import { Router } from 'express';
import { supabase } from '../supabase';

const router = Router();

// Public — needed for registration dropdown
router.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('zones').select('id, name').order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
