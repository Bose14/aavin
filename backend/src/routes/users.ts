import crypto from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { supabase, formatAdminAuthError, serviceKeyIssue, buildServiceKeyError } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { normalizeIndianPhone } from '../lib/calculations';
import { isMissingSchemaError, writeAuditLog } from '../lib/settingsStore';

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

// GET /users — list users in the caller's zone
router.get('/', requireRole('admin', 'superadmin'), async (req, res) => {
  let query = supabase
    .from('profiles')
    .select('id, full_name, role, zone_id, unit_id, phone, created_at, units(name, unit_code), zones(name)')
    .order('created_at', { ascending: false });

  if (req.profile.role === 'admin') {
    query = query.eq('zone_id', req.profile.zone_id).eq('role', 'unit');
  } else {
    query = query.in('role', ['admin', 'unit']);
    const { zone_id } = req.query as { zone_id?: string };
    if (zone_id) query = query.eq('zone_id', zone_id);
  }

  const { data: profiles, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Enrich with extended metadata (email, sub_role, is_active, must_change_password) from Auth Admin API
  const authById = new Map<string, { email?: string; sub_role?: string; is_active?: boolean; must_change_password?: boolean }>();
  const { data: authUsersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  for (const au of (authUsersData?.users ?? [])) {
    authById.set(au.id, {
      email: au.email,
      sub_role: typeof au.user_metadata?.sub_role === 'string' ? au.user_metadata.sub_role : 'operator',
      is_active: au.user_metadata?.is_active !== false,
      must_change_password: Boolean(au.user_metadata?.must_change_password),
    });
  }

  const enriched = (profiles ?? []).map((p) => {
    const meta = authById.get(p.id);
    return {
      ...p,
      email: meta?.email ?? null,
      sub_role: meta?.sub_role ?? 'operator',
      is_active: meta?.is_active ?? true,
      must_change_password: meta?.must_change_password ?? false,
    };
  });

  res.json(enriched);
});

// POST /users/create — superadmin creates admin, admin creates unit user
router.post('/create', requireRole('admin', 'superadmin'), async (req, res) => {
  const {
    email: rawEmail,
    password: rawPassword,
    full_name: rawName,
    phone: rawPhone,
    role,
    sub_role = 'operator',
    zone_id,
    unit_id,
    force_password_change = true,
  } = req.body as {
    email?: string; password?: string; full_name?: string; phone?: string;
    role: string; sub_role?: 'operator' | 'supervisor'; zone_id: string; unit_id?: string;
    force_password_change?: boolean;
  };

  const email = (rawEmail ?? '').trim().toLowerCase();
  const full_name = (rawName ?? '').trim();

  if (req.profile.role === 'admin') {
    if (role !== 'unit') {
      res.status(403).json({ error: 'Admins can only create unit users' });
      return;
    }
    if (zone_id !== req.profile.zone_id) {
      res.status(403).json({ error: 'Cannot create users in another zone' });
      return;
    }
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id required for unit users' });
      return;
    }
  }

  if (req.profile.role === 'superadmin') {
    if (role === 'superadmin') {
      res.status(403).json({ error: 'Cannot create another superadmin' });
      return;
    }
    if (!['admin', 'unit'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
  }

  if (!email || !full_name || !zone_id || !role) {
    res.status(400).json({ error: 'email, full_name, zone_id and role are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }

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

  const normalizedSubRole = sub_role === 'supervisor' ? 'supervisor' : 'operator';
  const tempPassword = rawPassword && rawPassword.trim().length >= 8
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

  // Insert extended columns when available; fall back to core columns if patch_v2_ux.sql wasn't run yet
  let { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    role,
    zone_id,
    unit_id: unit_id ?? null,
    full_name,
    phone: normalizedPhone,
    email,
    sub_role: normalizedSubRole,
    is_active: true,
    must_change_password: force_password_change,
  });

  if (profileError && isMissingSchemaError(profileError)) {
    const fallbackRes = await supabase.from('profiles').insert({
      id: userId,
      role,
      zone_id,
      unit_id: unit_id ?? null,
      full_name,
      phone: normalizedPhone,
    });
    profileError = fallbackRes.error;
  }

  if (profileError) {
    await supabase.auth.admin.deleteUser(userId);
    res.status(500).json({ error: profileError.message });
    return;
  }

  await writeAuditLog({
    zone_id,
    unit_id: unit_id ?? null,
    entity_type: 'user',
    entity_id: userId,
    action: 'create',
    changes: { email, full_name, sub_role: normalizedSubRole, force_password_change },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json({
    id: userId,
    email,
    role,
    sub_role: normalizedSubRole,
    full_name,
    phone: normalizedPhone,
    must_change_password: force_password_change,
    temp_password: tempPassword,
  });
});

// PATCH /users/:id — edit user details, role (Operator/Supervisor), unit, or active status
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
  if (req.profile.role === 'admin' && (target.zone_id !== req.profile.zone_id || target.role !== 'unit')) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  const body = req.body as {
    full_name?: string;
    phone?: string | null;
    unit_id?: string | null;
    sub_role?: 'operator' | 'supervisor';
    is_active?: boolean;
  };

  const { data: existingAuth } = await supabase.auth.admin.getUserById(id);
  const currentMeta = existingAuth?.user?.user_metadata ?? {};
  const nextMeta = { ...currentMeta };

  const profilePatch: Record<string, unknown> = {};
  const extendedPatch: Record<string, unknown> = {};

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
  if (body.unit_id !== undefined && target.role === 'unit') {
    if (!body.unit_id) { res.status(400).json({ error: 'Unit is required for unit users' }); return; }
    profilePatch.unit_id = body.unit_id;
  }
  if (body.sub_role !== undefined) {
    const normalizedSub = body.sub_role === 'supervisor' ? 'supervisor' : 'operator';
    nextMeta.sub_role = normalizedSub;
    extendedPatch.sub_role = normalizedSub;
  }
  if (typeof body.is_active === 'boolean') {
    nextMeta.is_active = body.is_active;
    extendedPatch.is_active = body.is_active;
  }

  const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(id, {
    user_metadata: nextMeta,
  });
  if (authUpdateErr) {
    respondAdminAuthError(res, 'update', authUpdateErr);
    return;
  }

  const mergedPatch = { ...profilePatch, ...extendedPatch };
  if (Object.keys(mergedPatch).length > 0) {
    let { error: profErr } = await supabase.from('profiles').update(mergedPatch).eq('id', id);
    if (profErr && isMissingSchemaError(profErr) && Object.keys(profilePatch).length > 0) {
      const fallback = await supabase.from('profiles').update(profilePatch).eq('id', id);
      profErr = fallback.error;
    }
    if (profErr && !isMissingSchemaError(profErr)) {
      res.status(500).json({ error: profErr.message });
      return;
    }
  }

  await writeAuditLog({
    zone_id: target.zone_id,
    unit_id: (profilePatch.unit_id as string | undefined) ?? target.unit_id,
    entity_type: 'user',
    entity_id: id,
    action: typeof body.is_active === 'boolean' ? (body.is_active ? 'activate' : 'deactivate') : 'update',
    changes: mergedPatch,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json({ id, ...mergedPatch });
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
  if (req.profile.role === 'admin' && (target.zone_id !== req.profile.zone_id || target.role !== 'unit')) {
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

// DELETE /users/:id — admin deletes unit user, superadmin deletes admin/unit
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

  if (req.profile.role === 'admin') {
    if (target.zone_id !== req.profile.zone_id || target.role !== 'unit') {
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
