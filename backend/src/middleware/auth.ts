import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../supabase';
import type { UserProfile } from '../types/express';

const USER_COLUMNS =
  'id, id_token, auth_user_id, dairy_unit_id, team_id, bmc_id, full_name, email, phone, shift, sub_role, is_active, must_change_password, teams(code, active)';

const ROLE_BY_TEAM: Record<string, UserProfile['role']> = {
  ADMIN: 'admin',
  GATE: 'gate',
  QC: 'qc',
  UNLOADING: 'unloading',
  BMC: 'bmc',
};

async function loadProfile(authUserId: string) {
  let result = await supabase.from('users').select(USER_COLUMNS).eq('auth_user_id', authUserId).maybeSingle();

  // Retry once on a transient network/DB failure
  if (result.error) {
    result = await supabase.from('users').select(USER_COLUMNS).eq('auth_user_id', authUserId).maybeSingle();
  }
  return result;
}

async function verifyUserToken(token: string) {
  let result = await supabase.auth.getUser(token);

  const isTransient = (err: { status?: number } | null) =>
    err != null && (err.status === 0 || (err.status !== undefined && err.status >= 500));

  // Retry once on transient network/5xx errors from Supabase Auth
  if (isTransient(result.error)) {
    result = await supabase.auth.getUser(token);
  }

  return { result, transientFailure: isTransient(result.error) };
}

// A verified token + profile is reused for a short time so most requests skip the Supabase Auth
// call and the profile lookups. Cleared whenever users, teams or BMCs are changed (see index.ts).
const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 500;
const authCache = new Map<string, { user: Request['user']; profile: UserProfile; expires: number }>();

export function clearAuthCache(): void {
  authCache.clear();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const cached = authCache.get(token);
  if (cached) {
    if (cached.expires > Date.now()) {
      req.user = cached.user;
      req.profile = cached.profile;
      next();
      return;
    }
    authCache.delete(token);
  }

  const { result: { data: { user }, error }, transientFailure } = await verifyUserToken(token);
  if (transientFailure) {
    console.error('[authMiddleware] Auth verification unavailable:', error?.status, error?.message);
    res.status(503).json({ error: 'Authentication service temporarily unavailable — please try again' });
    return;
  }
  if (error || !user) {
    console.warn('[authMiddleware] Token rejected:', error?.status ?? 'no_status', error?.code ?? '', error?.message ?? 'no_user');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const { data: row, error: profileError } = await loadProfile(user.id);

  if (profileError) {
    console.error('[authMiddleware] User lookup failed for', user.id, profileError.message);
    res.status(500).json({ error: `Failed to verify user: ${profileError.message}` });
    return;
  }

  if (!row) {
    console.warn('[authMiddleware] No users row for auth user', user.id, user.email);
    res.status(403).json({ error: 'Your account is not set up. Contact your dairy unit administrator.' });
    return;
  }

  const { teams: team, ...rest } = row as unknown as Omit<UserProfile, 'role' | 'team_code'> & {
    teams: { code: UserProfile['team_code']; active: boolean } | null;
  };
  if (!team) {
    res.status(403).json({ error: 'Your account has no team assigned. Contact your dairy unit administrator.' });
    return;
  }

  if (rest.is_active === false) {
    res.status(403).json({ error: 'Your account has been deactivated. Contact your dairy unit administrator.' });
    return;
  }

  if (team.active === false && team.code !== 'ADMIN') {
    res.status(403).json({ error: 'Your team is currently deactivated. Contact your dairy unit administrator.' });
    return;
  }

  const profile: UserProfile = { ...rest, role: ROLE_BY_TEAM[team.code], team_code: team.code };

  // Block BMC users whose BMC has been deactivated
  if (profile.role === 'bmc' && profile.bmc_id) {
    const { data: bmcRow } = await supabase
      .from('bmcs')
      .select('is_active')
      .eq('id', profile.bmc_id)
      .maybeSingle();
    if (bmcRow && bmcRow.is_active === false) {
      res.status(403).json({ error: 'Your BMC is currently deactivated. Contact your dairy unit administrator.' });
      return;
    }
  }

  if (authCache.size >= AUTH_CACHE_MAX) authCache.clear();
  authCache.set(token, { user, profile, expires: Date.now() + AUTH_CACHE_TTL_MS });

  req.user = user;
  req.profile = profile;
  next();
}
