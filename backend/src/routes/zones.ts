import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /zones — all zones (id, id_token, name)
router.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('zones').select('id, id_token, name').order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
