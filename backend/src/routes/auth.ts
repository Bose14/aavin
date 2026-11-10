import { Router, Request, Response } from 'express';
import { supabase } from '../supabase';

const router = Router();

// Verify a JWT token from the frontend
router.post('/verify', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: 'Token required' });
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  res.json({ user: data.user });
});

export default router;
