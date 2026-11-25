import crypto from 'node:crypto';
import { Router } from 'express';
import type { Response } from 'express';
import { supabase, formatAdminAuthError } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { createUserSchema, updateUserSchema } from '../schemas';
import { requireRole } from '../middleware/requireRole';
import { normalizeIndianPhone } from '../lib/calculations';
import { writeAuditLog } from '../lib/settingsStore';
import { idLookup } from '../lib/ids';

const router = Router();
router.use(authMiddleware);

const SHIFTS = ['Morning', 'Evening', 'General'] as const;
const TEAM_CODES = ['ADMIN', 'GATE', 'QC', 'UNLOADING', 'BMC'] as const;
type TeamCode = (typeof TEAM_CODES)[number];

const USER_SELECT =
  'id, id_token, auth_user_id, dairy_unit_id, team_id, bmc_id, full_name, email, phone, shift, sub_role, ' +
  'is_active, must_change_password, created_at, updated_at, ' +
  'teams(id, id_token, code, name), bmcs(id, id_token, name, bmc_code)';

interface UserRow {
  id: string;
  id_token: string;
  auth_user_id: string;
  dairy_unit_id: string;
  team_id: string;
  bmc_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  shift: string;
  sub_role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
  teams: { id: string; id_token: string; code: TeamCode; name: string } | null;
  bmcs: { id: string; id_token: string; name: string; bmc_code: string } | null;
}

/** Shapes a database row for the API: `team` and `bmc` objects, and a derived `role`. */
function shapeUser(row: UserRow) {
  const { teams, bmcs, ...rest } = row;
  return {
    ...rest,
    role: teams ? teams.code.toLowerCase() : null,
    team: teams,
    bmc: bmcs,
  };
}

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

function actorName(req: { profile: { full_name: string | null }; user: { email?: string } }): string {
  return req.profile.full_name ?? req.user.email ?? 'Admin';
}

/** Loads one user from the caller's dairy unit by numeric id or id_token. */
async function findUserInDairyUnit(idOrToken: string, dairyUnitId: string): Promise<UserRow | null> {
  const lookup = idLookup(idOrToken);
  if (!lookup) return null;
  const { data } = await supabase
    .from('users')
    .select(USER_SELECT)
    .eq(lookup.column, lookup.value)
    .eq('dairy_unit_id', dairyUnitId)
    .maybeSingle();
  return (data as unknown as UserRow | null) ?? null;
}

/** Resolves a team from a code (GATE) or an id / id_token. */
async function resolveTeam(input: { team?: string; team_id?: string }) {
  let query = supabase.from('teams').select('id, id_token, code, name, active');
  if (input.team) {
    const code = input.team.trim().toUpperCase();
    if (!(TEAM_CODES as readonly string[]).includes(code)) return null;
    query = query.eq('code', code);
  } else if (input.team_id) {
    const lookup = idLookup(input.team_id);
    if (!lookup) return null;
    query = query.eq(lookup.column, lookup.value);
  } else {
    return null;
  }
  const { data } = await query.maybeSingle();
  return (data as { id: string; id_token: string; code: TeamCode; name: string; active: boolean } | null) ?? null;
}

/** Resolves a BMC (by id or id_token) that belongs to the given dairy unit. */
async function resolveBmcInDairyUnit(idOrToken: string, dairyUnitId: string) {
  const lookup = idLookup(idOrToken);
  if (!lookup) return null;
  const { data } = await supabase
    .from('bmcs')
    .select('id, id_token, name, is_active')
    .eq(lookup.column, lookup.value)
    .eq('dairy_unit_id', dairyUnitId)
    .maybeSingle();
  return (data as { id: string; id_token: string; name: string; is_active: boolean } | null) ?? null;
}

/** True when the dairy unit would still have an active admin after `excludeUserId` stops being one. */
async function hasAnotherActiveAdmin(dairyUnitId: string, excludeUserId: string): Promise<boolean> {
  const { data: adminTeam } = await supabase.from('teams').select('id').eq('code', 'ADMIN').maybeSingle();
  if (!adminTeam) return false;
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('dairy_unit_id', dairyUnitId)
    .eq('team_id', adminTeam.id)
    .eq('is_active', true)
    .neq('id', excludeUserId);
  return (count ?? 0) > 0;
}

function uniqueViolationMessage(err: { code?: string; message?: string }): string | null {
  if (err.code !== '23505') return null;
  const msg = err.message ?? '';
  if (msg.includes('uq_users_email')) return 'A user with this email already exists';
  if (msg.includes('uq_users_dairy_unit_phone')) return 'This phone number is already assigned to another user in the dairy unit';
  return 'A user with these details already exists';
}

// POST /users/complete-password-change — clears must_change_password after the user sets a new password
router.post('/complete-password-change', async (req, res) => {
  const meta = { ...(req.user.user_metadata ?? {}), must_change_password: false };
  const { error: authErr } = await supabase.auth.admin.updateUserById(req.user.id, { user_metadata: meta });
  if (authErr) {
    respondAdminAuthError(res, 'complete-password-change', authErr);
    return;
  }
  const { error } = await supabase
    .from('users')
    .update({ must_change_password: false })
    .eq('auth_user_id', req.user.id);
  if (error) console.warn('[users/complete-password-change] update warning:', error.message);
  res.json({ ok: true });
});

// GET /users — users in the admin's dairy unit. Filters: team, bmc_id, status, search, limit, offset
// Any signed-in user may rename themselves.
router.patch('/me/profile', async (req, res) => {
  const fullName = typeof req.body?.full_name === 'string' ? req.body.full_name.trim() : '';
  if (!fullName) return res.status(400).json({ error: 'full_name is required' });
  const { error } = await supabase.from('users').update({ full_name: fullName }).eq('id', req.profile!.id);
  if (error) { console.error('[api]', req.method, req.originalUrl, error.message); return res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
  return res.json({ ok: true });
});

router.get('/', requireRole('admin'), async (req, res) => {
  const { team, bmc_id, status, search, limit, offset } = req.query as Record<string, string | undefined>;

  let query = supabase
    .from('users')
    .select(USER_SELECT)
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .order('created_at', { ascending: false });

  if (team) {
    const teamRow = await resolveTeam({ team });
    if (!teamRow) { res.json([]); return; }
    query = query.eq('team_id', teamRow.id);
  }

  if (bmc_id) {
    const lookup = idLookup(bmc_id);
    if (!lookup) { res.json([]); return; }
    if (lookup.column === 'id') {
      query = query.eq('bmc_id', lookup.value);
    } else {
      const { data: bmcRow } = await supabase.from('bmcs').select('id').eq('id_token', lookup.value).maybeSingle();
      if (!bmcRow) { res.json([]); return; }
      query = query.eq('bmc_id', bmcRow.id);
    }
  }

  if (status === 'active') query = query.eq('is_active', true);
  if (status === 'inactive') query = query.eq('is_active', false);

  if (search && search.trim()) {
    const q = search.trim().replace(/[%,()*\\]/g, ' ').trim();
    if (q) {
      query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,id_token.ilike.%${q}%`);
    }
  }

  const pageSize = Math.min(Math.max(Number(limit) || 500, 1), 1000);
  const from = Math.max(Number(offset) || 0, 0);
  query = query.range(from, from + pageSize - 1);

  const { data, error } = await query;
  if (error) {
    console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return;
  }

  res.json(((data ?? []) as unknown as UserRow[]).map(shapeUser));
});

// POST /users — the ONE way to create a user (any team; BMC users also need a BMC)
router.post('/', requireRole('admin'), validateBody(createUserSchema), async (req, res) => {
  const body = req.body as {
    full_name?: string;
    email?: string;
    phone?: string;
    team?: string;
    team_id?: string;
    bmc_id?: string;
    shift?: string;
    sub_role?: string;
    password?: string;
    force_password_change?: boolean;
  };

  const dairyUnitId = req.profile.dairy_unit_id;
  const fullName = (body.full_name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const shift = SHIFTS.includes(body.shift as (typeof SHIFTS)[number]) ? (body.shift as string) : 'General';
  const subRole = body.sub_role === 'supervisor' ? 'supervisor' : 'operator';
  const forcePasswordChange = body.force_password_change !== false;

  if (!fullName || !email) {
    res.status(400).json({ error: 'Full name and email are required' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: 'Enter a valid email address' });
    return;
  }

  const team = await resolveTeam({ team: body.team, team_id: body.team_id });
  if (!team) {
    res.status(400).json({ error: 'A valid team is required (ADMIN, GATE, QC, UNLOADING or BMC)' });
    return;
  }

  let bmcId: string | null = null;
  if (team.code === 'BMC') {
    if (!body.bmc_id) {
      res.status(400).json({ error: 'Select a BMC for BMC users' });
      return;
    }
    const bmc = await resolveBmcInDairyUnit(body.bmc_id, dairyUnitId);
    if (!bmc) {
      res.status(400).json({ error: 'BMC not found in your dairy unit' });
      return;
    }
    bmcId = bmc.id;
  }

  let phone: string | null = null;
  if (body.phone && body.phone.trim()) {
    phone = normalizeIndianPhone(body.phone);
    if (!phone) {
      res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (+91)' });
      return;
    }
  }

  const tempPassword = body.password && body.password.trim().length >= 8 ? body.password.trim() : generateTempPassword();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      is_active: true,
      must_change_password: forcePasswordChange,
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

  const { data: inserted, error: insertError } = await supabase
    .from('users')
    .insert({
      auth_user_id: authData.user.id,
      dairy_unit_id: dairyUnitId,
      team_id: team.id,
      bmc_id: bmcId,
      full_name: fullName,
      email,
      phone,
      shift,
      sub_role: subRole,
      is_active: true,
      must_change_password: forcePasswordChange,
    })
    .select(USER_SELECT)
    .single();

  if (insertError || !inserted) {
    // Do not leave an orphan login behind
    await supabase.auth.admin.deleteUser(authData.user.id);
    const friendly = insertError ? uniqueViolationMessage(insertError) : null;
    res.status(friendly ? 409 : 500).json({ error: friendly ?? insertError?.message ?? 'Failed to create user' });
    return;
  }

  const created = inserted as unknown as UserRow;
  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: bmcId,
    entity_type: 'user',
    entity_id: created.id,
    action: 'create',
    changes: { email, full_name: fullName, team: team.code, bmc_id: bmcId, shift, sub_role: subRole },
    actor_id: req.user.id,
    actor_name: actorName(req),
  });

  res.status(201).json({ ...shapeUser(created), temp_password: tempPassword });
});

// PATCH /users/:id — edit details, change team / BMC, activate or deactivate. :id is an id or id_token
router.patch('/:id', requireRole('admin'), validateBody(updateUserSchema), async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;
  const target = await findUserInDairyUnit(String(req.params.id), dairyUnitId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const body = req.body as {
    full_name?: string;
    phone?: string | null;
    shift?: string;
    sub_role?: string;
    is_active?: boolean;
    team?: string;
    team_id?: string;
    bmc_id?: string | null;
    reason?: string;
  };

  const isSelf = target.id === req.profile.id;
  const patch: Record<string, unknown> = {};

  if (body.full_name !== undefined) {
    const trimmed = body.full_name.trim();
    if (!trimmed) { res.status(400).json({ error: 'Full name cannot be empty' }); return; }
    patch.full_name = trimmed;
  }

  if (body.phone !== undefined) {
    if (!body.phone || !body.phone.trim()) {
      patch.phone = null;
    } else {
      const normalized = normalizeIndianPhone(body.phone);
      if (!normalized) {
        res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (+91)' });
        return;
      }
      patch.phone = normalized;
    }
  }

  if (body.shift !== undefined && SHIFTS.includes(body.shift as (typeof SHIFTS)[number])) {
    patch.shift = body.shift;
  }
  if (body.sub_role !== undefined) {
    patch.sub_role = body.sub_role === 'supervisor' ? 'supervisor' : 'operator';
  }
  if (typeof body.is_active === 'boolean') {
    patch.is_active = body.is_active;
  }

  // Team / BMC change
  const wantsTeamChange = body.team !== undefined || body.team_id !== undefined;
  let nextTeamCode: TeamCode = target.teams?.code ?? 'BMC';
  if (wantsTeamChange || body.bmc_id !== undefined) {
    let nextTeamId = target.team_id;
    if (wantsTeamChange) {
      const team = await resolveTeam({ team: body.team, team_id: body.team_id });
      if (!team) { res.status(400).json({ error: 'A valid team is required' }); return; }
      nextTeamId = team.id;
      nextTeamCode = team.code;
    }

    let nextBmcId: string | null = null;
    if (nextTeamCode === 'BMC') {
      const bmcInput = body.bmc_id !== undefined ? body.bmc_id : target.bmc_id;
      if (!bmcInput) { res.status(400).json({ error: 'Select a BMC for BMC users' }); return; }
      const bmc = await resolveBmcInDairyUnit(String(bmcInput), dairyUnitId);
      if (!bmc) { res.status(400).json({ error: 'BMC not found in your dairy unit' }); return; }
      nextBmcId = bmc.id;
    }

    if (nextTeamId !== target.team_id) patch.team_id = nextTeamId;
    if (nextBmcId !== target.bmc_id) patch.bmc_id = nextBmcId;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No valid update fields provided' });
    return;
  }

  // Moving a user to another team needs a reason (kept in the audit log)
  if (patch.team_id !== undefined && !(body.reason ?? '').trim()) {
    res.status(400).json({ error: 'Reason is required to move a user to another team' });
    return;
  }

  // Guard rails: never lock the dairy unit out of administration
  const losesAdmin =
    target.teams?.code === 'ADMIN' && (patch.is_active === false || (patch.team_id !== undefined && nextTeamCode !== 'ADMIN'));
  if (isSelf && (patch.is_active === false || patch.team_id !== undefined)) {
    res.status(400).json({ error: 'You cannot deactivate yourself or change your own team' });
    return;
  }
  if (losesAdmin && !(await hasAnotherActiveAdmin(dairyUnitId, target.id))) {
    res.status(400).json({ error: 'The dairy unit needs at least one active admin' });
    return;
  }

  const { data: updated, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', target.id)
    .select(USER_SELECT)
    .single();

  if (error || !updated) {
    const friendly = error ? uniqueViolationMessage(error) : null;
    res.status(friendly ? 409 : 500).json({ error: friendly ?? error?.message ?? 'Failed to update user' });
    return;
  }

  // Keep the login metadata in step for the fields the app reads from it
  const metaPatch: Record<string, unknown> = {};
  if (patch.full_name !== undefined) metaPatch.full_name = patch.full_name;
  if (patch.is_active !== undefined) metaPatch.is_active = patch.is_active;
  if (Object.keys(metaPatch).length > 0) {
    const { data: existingAuth } = await supabase.auth.admin.getUserById(target.auth_user_id);
    const { error: metaErr } = await supabase.auth.admin.updateUserById(target.auth_user_id, {
      user_metadata: { ...(existingAuth?.user?.user_metadata ?? {}), ...metaPatch },
    });
    if (metaErr) console.warn('[users/update] metadata sync warning:', metaErr.message);
  }

  const result = updated as unknown as UserRow;
  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: result.bmc_id,
    entity_type: 'user',
    entity_id: result.id,
    action:
      typeof body.is_active === 'boolean'
        ? body.is_active ? 'activate' : 'deactivate'
        : patch.team_id !== undefined ? 'change_team' : 'update',
    changes: { ...patch, ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}) },
    actor_id: req.user.id,
    actor_name: actorName(req),
  });

  res.json(shapeUser(result));
});

// POST /users/:id/reset-password — temporary password + forced change on next login
router.post('/:id/reset-password', requireRole('admin'), async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;
  const target = await findUserInDairyUnit(String(req.params.id), dairyUnitId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const { data: existingAuth } = await supabase.auth.admin.getUserById(target.auth_user_id);
  const tempPassword = generateTempPassword();

  const { error: resetErr } = await supabase.auth.admin.updateUserById(target.auth_user_id, {
    password: tempPassword,
    user_metadata: { ...(existingAuth?.user?.user_metadata ?? {}), must_change_password: true },
  });
  if (resetErr) {
    respondAdminAuthError(res, 'reset-password', resetErr);
    return;
  }

  await supabase.from('users').update({ must_change_password: true }).eq('id', target.id);

  let resetLink: string | null = null;
  if (target.email) {
    const { data: linkData } = await supabase.auth.admin.generateLink({ type: 'recovery', email: target.email });
    resetLink = linkData?.properties?.action_link ?? null;
  }

  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: target.bmc_id,
    entity_type: 'user',
    entity_id: target.id,
    action: 'reset_password',
    changes: { must_change_password: true },
    actor_id: req.user.id,
    actor_name: actorName(req),
  });

  res.json({
    id: target.id,
    id_token: target.id_token,
    email: target.email,
    temp_password: tempPassword,
    reset_link: resetLink,
    must_change_password: true,
  });
});

// DELETE /users/:id — removes the user and their login
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;
  const target = await findUserInDairyUnit(String(req.params.id), dairyUnitId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.id === req.profile.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }
  if (target.teams?.code === 'ADMIN' && !(await hasAnotherActiveAdmin(dairyUnitId, target.id))) {
    res.status(400).json({ error: 'The dairy unit needs at least one active admin' });
    return;
  }

  // Deleting the login cascades to the users row
  const { error: deleteError } = await supabase.auth.admin.deleteUser(target.auth_user_id);
  if (deleteError) {
    respondAdminAuthError(res, 'delete', deleteError);
    return;
  }

  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: target.bmc_id,
    entity_type: 'user',
    entity_id: target.id,
    action: 'delete',
    changes: { full_name: target.full_name, email: target.email, team: target.teams?.code },
    actor_id: req.user.id,
    actor_name: actorName(req),
  });

  res.status(204).send();
});

export default router;
