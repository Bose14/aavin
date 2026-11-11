import type { Request, Response, NextFunction } from 'express';
import { supabase, createUserScopedClient } from '../supabase';

const PROFILE_COLUMNS = 'id, role, zone_id, unit_id, full_name';

async function loadProfile(userId: string, token: string) {
  let result = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  // Retry once on transient network/DB failure
  if (result.error) {
    result = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
  }

  // Fallback to user-scoped JWT client in case RLS filtered an un-elevated key
  if (!result.error && !result.data) {
    const userClient = createUserScopedClient(token);
    result = await userClient
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .maybeSingle();
  }

  return result;
}

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

  const { data: profile, error: profileError } = await loadProfile(user.id, token);

  if (profileError) {
    console.error('[authMiddleware] Profile lookup failed for user', user.id, profileError.message);
    res.status(500).json({ error: `Failed to verify profile: ${profileError.message}` });
    return;
  }

  if (!profile) {
    console.warn('[authMiddleware] No profile row found for user', user.id, user.email);
    res.status(403).json({ error: 'Profile not found — complete registration first' });
    return;
  }

  req.user = user;
  req.profile = profile;
  next();
}
