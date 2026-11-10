import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase';

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, zone_id, unit_id, full_name')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    res.status(403).json({ error: 'Profile not found — complete registration first' });
    return;
  }

  req.user = user;
  req.profile = profile;
  next();
}
