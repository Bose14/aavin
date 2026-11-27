import crypto from 'node:crypto';
import { supabase, formatAdminAuthError } from '../supabase';
import { normalizeIndianPhone } from './calculations';
import { writeAuditLog } from './settingsStore';
import { idLookup } from './ids';

export const SHIFTS = ['Morning', 'Evening', 'General'] as const;
export const TEAM_CODES = ['ADMIN', 'GATE', 'QC', 'UNLOADING', 'BMC'] as const;
export type TeamCode = (typeof TEAM_CODES)[number];

export const USER_SELECT =
  'id, id_token, auth_user_id, dairy_unit_id, team_id, bmc_id, full_name, email, phone, shift, sub_role, ' +
  'is_active, must_change_password, created_at, updated_at, ' +
  'teams(id, id_token, code, name), bmcs(id, id_token, name, bmc_code)';

/** Resolves a team from a code (GATE) or an id / id_token. */
export async function resolveTeam(input: { team?: string; team_id?: string }) {
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
export async function resolveBmcInDairyUnit(idOrToken: string, dairyUnitId: string) {
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

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 12 }, () => chars[crypto.randomInt(chars.length)]).join('');
}

export interface NewUserInput {
  full_name?: string;
  email?: string;
  phone?: string | null;
  team?: string;
  team_id?: string;
  bmc_id?: string;
  shift?: string;
  sub_role?: string;
  password?: string;
  force_password_change?: boolean;
}

export type CreateUserResult =
  | { ok: true; user: { id: string; auth_user_id: string; email: string; full_name: string }; tempPassword: string }
  | { ok: false; status: number; error: string };

function uniqueViolation(err: { code?: string; message?: string }): string | null {
  if (err.code !== '23505') return null;
  const msg = err.message ?? '';
  if (msg.includes('uq_users_email')) return 'A user with this email already exists';
  if (msg.includes('uq_users_dairy_unit_phone')) return 'This phone number is already assigned to another user in the dairy unit';
  return 'A user with these details already exists';
}

/** Creates the login and the users row together; removes the login again if the row cannot be saved. */
export async function createUserAccount(opts: {
  dairyUnitId: string;
  input: NewUserInput;
  actor: { id: string; name: string };
}): Promise<CreateUserResult> {
  const { dairyUnitId, input: body, actor } = opts;
  const fullName = (body.full_name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const shift = SHIFTS.includes(body.shift as (typeof SHIFTS)[number]) ? (body.shift as string) : 'General';
  const subRole = body.sub_role === 'supervisor' ? 'supervisor' : 'operator';
  const forcePasswordChange = body.force_password_change !== false;

  if (!fullName || !email) return { ok: false, status: 400, error: 'Full name and email are required' };
  if (!isValidEmail(email)) return { ok: false, status: 400, error: 'Enter a valid email address' };

  const team = await resolveTeam({ team: body.team, team_id: body.team_id });
  if (!team) return { ok: false, status: 400, error: 'A valid team is required (ADMIN, GATE, QC, UNLOADING or BMC)' };

  let bmcId: string | null = null;
  if (team.code === 'BMC') {
    if (!body.bmc_id) return { ok: false, status: 400, error: 'Select a BMC for BMC users' };
    const bmc = await resolveBmcInDairyUnit(body.bmc_id, dairyUnitId);
    if (!bmc) return { ok: false, status: 400, error: 'BMC not found in your dairy unit' };
    bmcId = bmc.id;
  }

  let phone: string | null = null;
  if (body.phone && body.phone.trim()) {
    phone = normalizeIndianPhone(body.phone);
    if (!phone) return { ok: false, status: 400, error: 'Phone must be a valid 10-digit Indian mobile number (+91)' };
  }

  const tempPassword = body.password && body.password.trim().length >= 8 ? body.password.trim() : generateTempPassword();

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, is_active: true, must_change_password: forcePasswordChange },
  });
  if (authError) {
    if (authError.message.toLowerCase().includes('already') || authError.code === 'email_exists') {
      return { ok: false, status: 409, error: `An account with email "${email}" already exists` };
    }
    const formatted = formatAdminAuthError(authError);
    if (formatted.status >= 500) console.error('[users/create] Admin auth error:', authError.code ?? '', authError.message);
    return { ok: false, status: formatted.status, error: formatted.error };
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
    await supabase.auth.admin.deleteUser(authData.user.id);
    const friendly = insertError ? uniqueViolation(insertError) : null;
    return { ok: false, status: friendly ? 409 : 500, error: friendly ?? insertError?.message ?? 'Failed to create user' };
  }

  const created = inserted as unknown as { id: string; auth_user_id: string; email: string; full_name: string };
  await writeAuditLog({
    dairy_unit_id: dairyUnitId,
    bmc_id: bmcId,
    entity_type: 'user',
    entity_id: created.id,
    action: 'create',
    changes: { email, full_name: fullName, team: team.code, bmc_id: bmcId, shift, sub_role: subRole },
    actor_id: actor.id,
    actor_name: actor.name,
  });

  return { ok: true, user: created, tempPassword };
}
