import crypto from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { supabase, formatAdminAuthError, serviceKeyIssue, buildServiceKeyError } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { normalizeIndianPhone } from '../lib/calculations';
import {
  isMissingSchemaError,
  isCheckConstraintError,
  insertProfileResiliently,
  writeAuditLog,
  getTeamByCode,
  getTeamsFromDb,
} from '../lib/settingsStore';
import { generateNextTeamUserId } from './teams';

const router = Router();
router.use(authMiddleware);

function respondAdminAuthError(res: Response, action: string, err: { message: string; code?: string }) {
  const formatted = formatAdminAuthError(err);
  if (formatted.status >= 500) {
    console.error(`[users/${action}] Admin auth error:`, err.code ?? '', err.message);
  }
  res.status(formatted.status).json({ error: formatted.error });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 12 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

// POST /users/complete-password-change — clears must_change_password after user updates password
router.post('/complete-password-change', async (req, res) => {
  const meta = { ...(req.user.user_metadata ?? {}), must_change_password: false };
  const { error: authErr } = await supabase.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
  if (authErr) {
    respondAdminAuthError(res, 'complete-password-change', authErr);
    return;
  }
  const { error: profErr } = await supabase
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', req.user.id);
  if (profErr && !isMissingSchemaError(profErr)) {
    console.warn('[users/complete-password-change] Profile update warning:', profErr.message);
  }
  res.json({ ok: true });
});

// GET /users — list users in the caller's zone (unit staff + plant team users)
router.get('/', requireRole('admin', 'superadmin'), async (req, res) => {
  const { team, unit_id, status, search, zone_id: queryZoneId } = req.query as {
    team?: string;
    unit_id?: string;
    status?: string;
    search?: string;
    zone_id?: string;
  };

  const allowedRoles = ['unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'];
  if (req.profile.role === 'superadmin') {
    allowedRoles.push('admin');
  }

  const extendedSelect = 'id, full_name, role, zone_id, unit_id, team_id, shift, username, phone, created_at, units(name, unit_code), zones(name)';
  const baseSelect = 'id, full_name, role, zone_id, unit_id, phone, created_at, units(name, unit_code), zones(name)';

  let query = supabase.from('profiles').select(extendedSelect).order('created_at', { ascending: false });

  if (req.profile.role === 'admin') {
    query = query.eq('zone_id', req.profile.zone_id).in('role', allowedRoles);
  } else {
    query = query.in('role', allowedRoles);
    if (queryZoneId) query = query.eq('zone_id', queryZoneId);
  }

  let profiles: any[] | null = null;
  let error: any = null;
  const initialRes = await query;
  profiles = initialRes.data as any;
  error = initialRes.error;

  if (error && (error.message?.includes('column') || error.code === '42703')) {
    let fallbackQuery = supabase.from('profiles').select(baseSelect).order('created_at', { ascending: false });
    if (req.profile.role === 'admin') {
      fallbackQuery = fallbackQuery.eq('zone_id', req.profile.zone_id).in('role', allowedRoles);
    } else {
      fallbackQuery = fallbackQuery.in('role', allowedRoles);
      if (queryZoneId) fallbackQuery = fallbackQuery.eq('zone_id', queryZoneId);
    }
    const fbRes = await fallbackQuery;
    profiles = fbRes.data as any;
    error = fbRes.error;
  }

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Enrich with extended metadata (email, sub_role, is_active, must_change_password, team, shift, username) from Auth Admin API
  const authById = new Map<string, {
    email?: string;
    sub_role?: string;
    is_active?: boolean;
    must_change_password?: boolean;
    team?: string;
    shift?: string;
    username?: string;
    last_sign_in_at?: string;
  }>();

  try {
    const { data: authUsersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const au of (authUsersData?.users ?? [])) {
      authById.set(au.id, {
        email: au.email,
        sub_role: typeof au.user_metadata?.sub_role === 'string' ? au.user_metadata.sub_role : 'operator',
        is_active: au.user_metadata?.is_active !== false,
        must_change_password: Boolean(au.user_metadata?.must_change_password),
        team: au.user_metadata?.team,
        shift: au.user_metadata?.shift,
        username: au.user_metadata?.username,
        last_sign_in_at: au.last_sign_in_at,
      });
    }
  } catch (err) {
    console.warn('[users/list] Failed to fetch auth list:', err);
  }

  const allTeams = await getTeamsFromDb();
  const teamByCode = new Map(allTeams.map((t) => [t.code.toUpperCase(), t]));
  const teamById = new Map(allTeams.map((t) => [t.id, t]));

  let enriched = (profiles ?? []).map((p: any) => {
    const meta = authById.get(p.id);
    const roleUpper = (p.role || '').toUpperCase();
    let teamObj = p.team_id ? teamById.get(p.team_id) : undefined;
    if (!teamObj && meta?.team) {
      teamObj = teamByCode.get(String(meta.team).toUpperCase());
    }
    if (!teamObj && ['GATE', 'QC', 'UNLOADING'].includes(roleUpper)) {
      teamObj = teamByCode.get(roleUpper);
    }

    const effectiveRole = teamObj ? teamObj.code.toLowerCase() : (p.role || '').toLowerCase();

    return {
      ...p,
      role: effectiveRole,
      email: meta?.email ?? p.email ?? null,
      sub_role: meta?.sub_role ?? p.sub_role ?? 'operator',
      is_active: meta?.is_active ?? p.is_active ?? true,
      must_change_password: meta?.must_change_password ?? p.must_change_password ?? false,
      shift: p.shift || meta?.shift || 'General',
      username: p.username || meta?.username || null,
      last_sign_in_at: meta?.last_sign_in_at || null,
      team: teamObj ? { id: teamObj.id, code: teamObj.code, name: teamObj.name } : null,
    };
  });

  // Filter in memory for optional parameters
  if (team) {
    const tUpper = team.trim().toUpperCase();
    enriched = enriched.filter((u) => {
      const uRole = (u.role || '').toUpperCase();
      return uRole === tUpper || u.team?.code === tUpper;
    });
  }

  if (unit_id) {
    enriched = enriched.filter((u) => u.unit_id === unit_id);
  }

  if (status) {
    const sLower = status.trim().toLowerCase();
    if (sLower === 'active') {
      enriched = enriched.filter((u) => u.is_active !== false);
    } else if (sLower === 'inactive') {
      enriched = enriched.filter((u) => u.is_active === false);
    }
  }

  if (search) {
    const q = search.trim().toLowerCase();
    enriched = enriched.filter((u) => {
      const matchName = (u.full_name || '').toLowerCase().includes(q);
      const matchEmail = (u.email || '').toLowerCase().includes(q);
      const matchPhone = (u.phone || '').toLowerCase().includes(q);
      const matchUser = (u.username || '').toLowerCase().includes(q);
      const matchUnit = (u.units?.name || '').toLowerCase().includes(q);
      const matchTeam = (u.team?.name || '').toLowerCase().includes(q);
      return matchName || matchEmail || matchPhone || matchUser || matchUnit || matchTeam;
    });
  }

  res.json(enriched);
});

// POST /users/create — admin creates unit user or plant team user
router.post('/create', requireRole('admin', 'superadmin'), async (req, res) => {
  const {
    email: rawEmail,
    password: rawPassword,
    full_name: rawName,
    phone: rawPhone,
    user_type, // 'unit' | 'plant'
    team: rawTeam, // 'GATE' | 'QC' | 'UNLOADING'
    shift: rawShift = 'General',
    username: rawUsername,
    role: rawRole,
    sub_role = 'operator',
    zone_id: rawZoneId,
    unit_id,
    force_password_change = true,
  } = req.body as {
    email?: string;
    password?: string;
    full_name?: string;
    phone?: string;
    user_type?: 'unit' | 'plant';
    team?: string;
    shift?: 'Morning' | 'Evening' | 'General';
    username?: string;
    role?: string;
    sub_role?: 'operator' | 'supervisor';
    zone_id?: string;
    unit_id?: string;
    force_password_change?: boolean;
  };

  const email = (rawEmail ?? '').trim().toLowerCase();
  const full_name = (rawName ?? '').trim();
  let username = rawUsername ? rawUsername.trim().toUpperCase() : null;
  const shift = ['Morning', 'Evening', 'General'].includes(rawShift) ? rawShift : 'General';
  const zone_id = rawZoneId || req.profile.zone_id;

  // Determine user role and team
  const isPlant = user_type === 'plant' || Boolean(rawTeam) || ['gate', 'qc', 'unloading'].includes((rawRole || '').toLowerCase());
  let targetRole = 'unit';
  let targetTeamCode: string | null = null;
  let targetTeamId: string | null = null;

  if (isPlant) {
    targetTeamCode = (rawTeam || rawRole || '').trim().toUpperCase();
    if (!['GATE', 'QC', 'UNLOADING'].includes(targetTeamCode)) {
      res.status(400).json({ error: 'Valid team (GATE, QC, or UNLOADING) is required for plant users' });
      return;
    }
    targetRole = targetTeamCode.toLowerCase();
    const teamObj = await getTeamByCode(targetTeamCode);
    targetTeamId = teamObj?.id ?? null;
    if (!username) {
      username = await generateNextTeamUserId(zone_id, targetTeamCode);
    }
  } else {
    targetRole = (rawRole || 'unit').toLowerCase();
  }

  if (req.profile.role === 'admin') {
    if (!['unit', 'gate', 'qc', 'unloading'].includes(targetRole)) {
      res.status(403).json({ error: 'Admins can only create Unit staff or Plant team users (GATE, QC, UNLOADING)' });
      return;
    }
    if (zone_id !== req.profile.zone_id) {
      res.status(403).json({ error: 'Cannot create users in another zone' });
      return;
    }
    if (targetRole === 'unit' && !unit_id) {
      res.status(400).json({ error: 'unit_id required for unit users' });
      return;
    }
  }

  if (req.profile.role === 'superadmin') {
    if (targetRole === 'superadmin') {
      res.status(403).json({ error: 'Cannot create another superadmin' });
      return;
    }
  }

  if (!email || !full_name || !zone_id) {
    res.status(400).json({ error: 'email, full_name, and zone_id are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }

  // Validate phone: 10 digits Indian mobile (+91)
  let normalizedPhone: string | null = null;
  if (rawPhone && rawPhone.trim()) {
    normalizedPhone = normalizeIndianPhone(rawPhone);
    if (!normalizedPhone) {
      res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (+91)' });
      return;
    }
    const { data: dupPhone } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('zone_id', zone_id)
      .eq('phone', normalizedPhone)
      .limit(1);
    if (dupPhone && dupPhone.length > 0) {
      res.status(409).json({ error: `Phone ${normalizedPhone} is already assigned to ${dupPhone[0].full_name ?? 'another user'}` });
      return;
    }
  }

  // Validate username uniqueness in zone if provided
  if (username) {
    const { data: dupUser } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('zone_id', zone_id)
      .ilike('username', username)
      .limit(1);
    if (dupUser && dupUser.length > 0) {
      res.status(409).json({ error: `Unique User ID "${username}" is already taken in this zone` });
      return;
    }
  }

  const normalizedSubRole = sub_role === 'supervisor' ? 'supervisor' : 'operator';
  const tempPassword = rawPassword && rawPassword.trim().length >= 6
    ? rawPassword.trim()
    : generateTempPassword();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name,
      sub_role: normalizedSubRole,
      is_active: true,
      must_change_password: force_password_change,
      team: targetTeamCode,
      shift,
      username,
    },
  });

  if (authError) {
    if (authError.message.toLowerCase().includes('already') || authError.code === 'email_exists') {
      res.status(409).json({ error: `An account with email "${email}" already exists` });
      return;
    }
    respondAdminAuthError(res, 'create', authError);
    return;
  }

  const userId = authData.user.id;

  // Insert into profiles with resilient schema and check constraint fallback
  const { error: profileError } = await insertProfileResiliently({
    id: userId,
    role: targetRole,
    zone_id,
    unit_id: targetRole === 'unit' ? unit_id : null,
    full_name,
    phone: normalizedPhone,
    team_id: targetTeamId,
    shift,
    username,
    email,
    sub_role: normalizedSubRole,
    is_active: true,
    must_change_password: force_password_change,
  });

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId);
    res.status(500).json({ error: profileError.message });
    return;
  }

  await writeAuditLog({
    zone_id,
    unit_id: targetRole === 'unit' ? unit_id : null,
    entity_type: 'user',
    entity_id: userId,
    action: 'create',
    changes: {
      email,
      full_name,
      role: targetRole,
      team: targetTeamCode,
      shift,
      username,
      sub_role: normalizedSubRole,
      force_password_change,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json({
    id: userId,
    email,
    role: targetRole,
    team: targetTeamCode,
    shift,
    username,
    sub_role: normalizedSubRole,
    full_name,
    phone: normalizedPhone,
    must_change_password: force_password_change,
    temp_password: tempPassword,
  });
});

// POST /users/:id/move-team — move plant team user to another team (mandatory reason, audit-logged)
router.post('/:id/move-team', requireRole('admin', 'superadmin'), async (req, res) => {
  const id = String(req.params.id);
  const { new_team, reason } = req.body as { new_team?: string; reason?: string };

  const normNewTeam = (new_team || '').trim().toUpperCase();
  if (!['GATE', 'QC', 'UNLOADING'].includes(normNewTeam)) {
    res.status(400).json({ error: 'Valid new_team (GATE, QC, or UNLOADING) is required' });
    return;
  }

  const cleanReason = (reason ?? '').trim();
  if (!cleanReason) {
    res.status(400).json({ error: 'Reason is required to move a user to another team' });
    return;
  }

  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, zone_id, full_name, team_id')
    .eq('id', id)
    .maybeSingle();

  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (req.profile.role === 'admin' && target.zone_id !== req.profile.zone_id) {
    res.status(403).json({ error: 'Cannot move users in another zone' });
    return;
  }

  const nextRole = normNewTeam.toLowerCase();
  const teamObj = await getTeamByCode(normNewTeam);
  const nextTeamId = teamObj?.id ?? null;
  const oldTeam = (target.role ?? '').toUpperCase();

  // Update profile
  let { error: updateErr } = await supabase
    .from('profiles')
    .update({
      role: nextRole,
      team_id: nextTeamId,
    })
    .eq('id', id);

  if (updateErr && isMissingSchemaError(updateErr)) {
    const fb = await supabase.from('profiles').update({ role: nextRole }).eq('id', id);
    updateErr = fb.error;
  }

  // If check constraint rejected the new plant role, keep role as-is or set team_id
  if (updateErr && isCheckConstraintError(updateErr)) {
    console.warn('[move-team] Database check constraint rejected role update, updating team_id only:', updateErr.message);
    const fbConstraint = await supabase.from('profiles').update({ team_id: nextTeamId }).eq('id', id);
    if (!fbConstraint.error || isMissingSchemaError(fbConstraint.error)) {
      updateErr = null;
    }
  }

  if (updateErr) {
    res.status(500).json({ error: updateErr.message });
    return;
  }

  // Update Auth user metadata
  const { data: authUser } = await supabase.auth.admin.getUserById(id);
  if (authUser?.user) {
    await supabase.auth.admin.updateUserById(id, {
      user_metadata: {
        ...(authUser.user.user_metadata ?? {}),
        team: normNewTeam,
        role: nextRole,
      },
    });
  }

  await writeAuditLog({
    zone_id: target.zone_id,
    entity_type: 'user',
    entity_id: id,
    action: 'move_team',
    changes: {
      user_id: id,
      user_name: target.full_name,
      old_team: oldTeam,
      new_team: normNewTeam,
      reason: cleanReason,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json({
    id,
    role: nextRole,
    team_id: nextTeamId,
    team: normNewTeam,
    message: `User ${target.full_name ?? id} moved to ${normNewTeam} team successfully`,
  });
});

// PATCH /users/:id — edit user details, shift, username, unit, or active status
router.patch('/:id', requireRole('admin', 'superadmin'), async (req, res) => {
  const id = String(req.params.id);
  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, zone_id, unit_id, full_name, phone')
    .eq('id', id)
    .maybeSingle();

  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const allowedRoles = ['unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'];
  if (req.profile.role === 'admin' && (target.zone_id !== req.profile.zone_id || !allowedRoles.includes(target.role))) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  const body = req.body as {
    full_name?: string;
    phone?: string | null;
    unit_id?: string | null;
    shift?: 'Morning' | 'Evening' | 'General';
    username?: string | null;
    sub_role?: 'operator' | 'supervisor';
    is_active?: boolean;
  };

  const { data: existingAuth } = await supabase.auth.admin.getUserById(id);
  const currentMeta = existingAuth?.user?.user_metadata ?? {};
  const nextMeta = { ...currentMeta };

  const profilePatch: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    const trimmed = body.full_name.trim();
    if (!trimmed) { res.status(400).json({ error: 'Full name cannot be empty' }); return; }
    profilePatch.full_name = trimmed;
    nextMeta.full_name = trimmed;
  }

  if (body.phone !== undefined) {
    if (!body.phone || !body.phone.trim()) {
      profilePatch.phone = null;
    } else {
      const normalized = normalizeIndianPhone(body.phone);
      if (!normalized) {
        res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (+91)' });
        return;
      }
      const { data: dupPhone } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('zone_id', target.zone_id)
        .eq('phone', normalized)
        .neq('id', id)
        .limit(1);
      if (dupPhone && dupPhone.length > 0) {
        res.status(409).json({ error: `Phone ${normalized} is already assigned to another user` });
        return;
      }
      profilePatch.phone = normalized;
    }
  }

  if (body.shift !== undefined) {
    if (['Morning', 'Evening', 'General'].includes(body.shift)) {
      profilePatch.shift = body.shift;
      nextMeta.shift = body.shift;
    }
  }

  if (body.username !== undefined) {
    const uClean = body.username ? body.username.trim().toUpperCase() : null;
    if (uClean) {
      const { data: dupUser } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('zone_id', target.zone_id)
        .ilike('username', uClean)
        .neq('id', id)
        .limit(1);
      if (dupUser && dupUser.length > 0) {
        res.status(409).json({ error: `Unique User ID "${uClean}" is already taken` });
        return;
      }
    }
    profilePatch.username = uClean;
    nextMeta.username = uClean;
  }

  if (body.unit_id !== undefined && target.role === 'unit') {
    if (!body.unit_id) { res.status(400).json({ error: 'Unit is required for unit users' }); return; }
    profilePatch.unit_id = body.unit_id;
  }

  if (body.sub_role !== undefined) {
    const normalizedSub = body.sub_role === 'supervisor' ? 'supervisor' : 'operator';
    nextMeta.sub_role = normalizedSub;
    profilePatch.sub_role = normalizedSub;
  }

  if (typeof body.is_active === 'boolean') {
    nextMeta.is_active = body.is_active;
    profilePatch.is_active = body.is_active;
  }

  const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(id, {
    user_metadata: nextMeta,
  });
  if (authUpdateErr) {
    respondAdminAuthError(res, 'update', authUpdateErr);
    return;
  }

  if (Object.keys(profilePatch).length > 0) {
    let { error: profErr } = await supabase.from('profiles').update(profilePatch).eq('id', id);
    if (profErr && isMissingSchemaError(profErr)) {
      // Retry without extended columns
      const safePatch = { ...profilePatch };
      delete safePatch.shift;
      delete safePatch.username;
      delete safePatch.sub_role;
      delete safePatch.is_active;
      if (Object.keys(safePatch).length > 0) {
        await supabase.from('profiles').update(safePatch).eq('id', id);
      }
    }
  }

  await writeAuditLog({
    zone_id: target.zone_id,
    unit_id: (profilePatch.unit_id as string | undefined) ?? target.unit_id,
    entity_type: 'user',
    entity_id: id,
    action: typeof body.is_active === 'boolean' ? (body.is_active ? 'activate' : 'deactivate') : 'update',
    changes: profilePatch,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json({ id, ...profilePatch });
});

// POST /users/:id/reset-password — set temporary password & force change on next login + optional recovery link
router.post('/:id/reset-password', requireRole('admin', 'superadmin'), async (req, res) => {
  const id = String(req.params.id);
  const { data: target } = await supabase
    .from('profiles')
    .select('role, zone_id, unit_id, full_name')
    .eq('id', id)
    .maybeSingle();

  if (!target) { res.status(404).json({ error: 'User not found' }); return; }
  const allowedRoles = ['unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'];
  if (req.profile.role === 'admin' && (target.zone_id !== req.profile.zone_id || !allowedRoles.includes(target.role))) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  const { data: existingAuth } = await supabase.auth.admin.getUserById(id);
  const email = existingAuth?.user?.email;
  const tempPassword = generateTempPassword();

  const { error: resetErr } = await supabase.auth.admin.updateUserById(id, {
    password: tempPassword,
    user_metadata: {
      ...(existingAuth?.user?.user_metadata ?? {}),
      must_change_password: true,
    },
  });
  if (resetErr) {
    respondAdminAuthError(res, 'reset-password', resetErr);
    return;
  }

  await supabase.from('profiles').update({ must_change_password: true }).eq('id', id);

  let resetLink: string | null = null;
  if (email) {
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    resetLink = linkData?.properties?.action_link ?? null;
  }

  await writeAuditLog({
    zone_id: target.zone_id,
    unit_id: target.unit_id,
    entity_type: 'user',
    entity_id: id,
    action: 'reset_password',
    changes: { must_change_password: true },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json({
    id,
    email,
    temp_password: tempPassword,
    reset_link: resetLink,
    must_change_password: true,
  });
});

// DELETE /users/:id — admin deletes unit or plant team user
router.delete('/:id', requireRole('admin', 'superadmin'), async (req, res) => {
  const id = req.params.id as string;

  const { data: target } = await supabase
    .from('profiles')
    .select('role, zone_id, unit_id, full_name')
    .eq('id', id)
    .single();

  if (!target) {
    if (serviceKeyIssue) {
      res.status(500).json({ error: buildServiceKeyError() });
      return;
    }
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (target.role === 'superadmin') {
    res.status(403).json({ error: 'Cannot delete a superadmin' });
    return;
  }

  const allowedRoles = ['unit', 'gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'];
  if (req.profile.role === 'admin') {
    if (target.zone_id !== req.profile.zone_id || !allowedRoles.includes(target.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
  if (deleteError) {
    respondAdminAuthError(res, 'delete', deleteError);
    return;
  }

  await writeAuditLog({
    zone_id: target.zone_id,
    unit_id: target.unit_id,
    entity_type: 'user',
    entity_id: id,
    action: 'delete',
    changes: { full_name: target.full_name },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(204).send();
});

export default router;
