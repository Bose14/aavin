import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /dairy-units — all dairy units (id, id_token, name)
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('dairy_units').select('id, id_token, name').order('name');
  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }
  res.json(data);
});

export default router;
