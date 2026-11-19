import crypto from 'node:crypto';
import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  getTeamsFromDb,
  getTeamByCode,
  updateTeamStatusInDb,
  getZoneSettings,
  getTankerStagesForTrips,
  writeAuditLog,
  isMissingSchemaError,
  isCheckConstraintError,
  insertProfileResiliently,
} from '../lib/settingsStore';
import { deriveTankerJourneyState } from '../lib/tankerJourney';
import type { StageRecordItem, TankerTripInput } from '../lib/tankerJourney';

const router = Router();
router.use(authMiddleware);

export const TEAM_OWNED_STAGES: Record<string, string[]> = {
  GATE: ['vehicle_entered', 'gross_weight', 'tare_weight', 'vehicle_exit'],
  QC: ['qc_completed', 'cip_completed'],
  UNLOADING: ['unloaded'],
};

export const TEAM_DESCRIPTIONS: Record<string, string> = {
  GATE: 'Vehicle Entry, Gross Weight, Tare Weight, Vehicle Exit (Gate pass & weighbridge operations)',
  QC: 'QC Test, CIP Completed (Milk lab quality inspection, fat/SNF verification & tanker sanitization)',
  UNLOADING: 'Unloaded (Bay allocation, silo reception & unloading quantity tracking)',
};

/**
 * Computes waiting tanker count per team in a zone.
 */
async function computeWaitingTankersPerTeam(zoneId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    GATE: 0,
    QC: 0,
    UNLOADING: 0,
  };

  try {
    const { data, error } = await supabase
      .from('tanker_dispatches')
      .select('*')
      .eq('zone_id', zoneId)
      .neq('trip_status', 'exited');

    if (error || !data) {
      return counts;
    }

    const rows = data as Array<Record<string, unknown>>;
    const tripIds = rows.map((r) => String(r.id));
    const [stagesMap, settings] = await Promise.all([
      getTankerStagesForTrips(tripIds),
      getZoneSettings(zoneId),
    ]);

    for (const row of rows) {
      const tripId = String(row.id);
      const stages = (stagesMap[tripId] ?? []) as StageRecordItem[];
      const tripInput: TankerTripInput = {
        id: tripId,
        date: String(row.date),
        tanker_number: String(row.tanker_number ?? ''),
        driver_name: (row.driver_name as string) || null,
        seal_number: (row.seal_number as string) || null,
        quantity_dispatched: Number(row.quantity_dispatched || 0),
        trip_status: row.trip_status as any,
        current_stage: row.current_stage as any,
        waiting_team: row.waiting_team as any,
        stage_data: (row.stage_data as Record<string, unknown>) || {},
        stages,
        created_at: (row.created_at as string) || undefined,
      };

      const journey = deriveTankerJourneyState(tripInput, settings);
      if (journey.tripStatus !== 'exited' && journey.waitingTeam) {
        const teamKey = journey.waitingTeam.toUpperCase();
        if (counts[teamKey] !== undefined) {
          counts[teamKey] += 1;
        }
      }
    }
  } catch (err) {
    console.warn('[computeWaitingTankersPerTeam] Error:', err);
  }

  return counts;
}

/**
 * Computes active user count per team in a zone.
 */
async function computeActiveUsersPerTeam(zoneId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    GATE: 0,
    QC: 0,
    UNLOADING: 0,
  };

  try {
    // 1. Fetch profiles for this zone with resilient fallback
    const initialRes = await supabase
      .from('profiles')
      .select('id, role, team_id, is_active')
      .eq('zone_id', zoneId);

    let profiles: any[] | null = initialRes.data as any;
    let error: any = initialRes.error;

    if (error && isMissingSchemaError(error)) {
      const fbRes = await supabase
        .from('profiles')
        .select('id, role')
        .eq('zone_id', zoneId);
      profiles = fbRes.data as any;
      error = fbRes.error;
    }

    if (error || !profiles) {
      return counts;
    }

    // 2. Cross-reference with auth users for active state and team metadata
    let inactiveAuthIds = new Set<string>();
    const teamByAuthId = new Map<string, string>();
    try {
      const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      for (const u of authData?.users ?? []) {
        if (u.user_metadata?.is_active === false) {
          inactiveAuthIds.add(u.id);
        }
        if (u.user_metadata?.team) {
          teamByAuthId.set(u.id, String(u.user_metadata.team).toUpperCase());
        }
      }
    } catch {
      // ignore
    }

    for (const p of profiles as Array<{ id: string; role: string; team_id?: string; is_active?: boolean }>) {
      if (p.is_active === false || inactiveAuthIds.has(p.id)) {
        continue;
      }
      const roleUpper = teamByAuthId.get(p.id) || (p.role || '').toUpperCase();
      if (counts[roleUpper] !== undefined) {
        counts[roleUpper] += 1;
      }
    }
  } catch (err) {
    console.warn('[computeActiveUsersPerTeam] Error:', err);
  }

  return counts;
}

// GET /teams — list all 3 teams with owned stages, user counts, and waiting tanker counts
router.get('/', async (req, res) => {
  const zoneId = req.profile.zone_id;

  try {
    const [teams, waitingCounts, activeCounts] = await Promise.all([
      getTeamsFromDb(),
      computeWaitingTankersPerTeam(zoneId),
      computeActiveUsersPerTeam(zoneId),
    ]);

    const enriched = teams.map((team) => {
      const code = team.code.toUpperCase();
      return {
        ...team,
        owned_stages: TEAM_OWNED_STAGES[code] || [],
        description: TEAM_DESCRIPTIONS[code] || '',
        active_user_count: activeCounts[code] || 0,
        waiting_tankers_count: waitingCounts[code] || 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export function getTeamPrefix(teamCode?: string): string {
  const code = (teamCode || '').toUpperCase();
  if (code === 'GATE') return 'GT';
  if (code === 'QC') return 'QC';
  if (code === 'UNLOADING') return 'UL';
  return 'IT';
}

export async function generateNextTeamUserId(zoneId: string, teamCode?: string): Promise<string> {
  const prefix = getTeamPrefix(teamCode);

  try {
    const { data } = await supabase
      .from('profiles')
      .select('username')
      .eq('zone_id', zoneId);

    let maxNum = 0;
    for (const row of data ?? []) {
      const u = String(row.username || '').toUpperCase();
      const match = u.match(new RegExp(`^AV_${prefix}_(\\d+)$`)) || u.match(/^AV_[A-Z0-9]+_(\\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    }

    const nextNum = maxNum + 1;
    const padded = String(nextNum).padStart(3, '0');
    return `AV_${prefix}_${padded}`;
  } catch (err) {
    console.warn('[generateNextTeamUserId] Error:', err);
    return `AV_${prefix}_001`;
  }
}

// GET /teams/next-user-id?team=GATE — get next available unique operator ID (e.g. AV_IT_001)
router.get('/next-user-id', requireRole('admin', 'superadmin'), async (req, res) => {
  const zoneId = req.profile.zone_id;
  const teamCode = String(req.query.team || '').trim().toUpperCase();
  const nextId = await generateNextTeamUserId(zoneId, teamCode || undefined);
  res.json({
    next_user_id: nextId,
    prefix: getTeamPrefix(teamCode),
    example: 'AV_IT_001',
  });
});

// GET /teams/users — list all plant team users for this zone
router.get('/users', requireRole('admin', 'superadmin'), async (req, res) => {
  const zoneId = req.profile.zone_id;
  const { team, status, search } = req.query as Record<string, string>;

  try {
    const initialRes = await supabase
      .from('profiles')
      .select('id, full_name, role, zone_id, team_id, shift, username, phone, created_at')
      .eq('zone_id', zoneId)
      .order('created_at', { ascending: false });

    let profiles: any[] | null = initialRes.data as any;
    let error: any = initialRes.error;

    if (error && isMissingSchemaError(error)) {
      const fbRes = await supabase
        .from('profiles')
        .select('id, full_name, role, zone_id, phone, created_at')
        .eq('zone_id', zoneId)
        .order('created_at', { ascending: false });
      profiles = fbRes.data as any;
      error = fbRes.error;
    }

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const allTeams = await getTeamsFromDb();
    const teamByCode = new Map(allTeams.map((t) => [t.code.toUpperCase(), t]));
    const teamById = new Map(allTeams.map((t) => [t.id, t]));

    // Fetch auth metadata
    const authById = new Map<string, { email?: string; is_active?: boolean; last_sign_in_at?: string; shift?: string; username?: string; team?: string }>();
    try {
      const { data: authUsersData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      for (const au of authUsersData?.users ?? []) {
        authById.set(au.id, {
          email: au.email,
          is_active: au.user_metadata?.is_active !== false,
          last_sign_in_at: au.last_sign_in_at,
          shift: au.user_metadata?.shift,
          username: au.user_metadata?.username,
          team: au.user_metadata?.team,
        });
      }
    } catch (e) {
      console.warn('[teams/users] listUsers fallback:', e);
    }

    let list = (profiles ?? [])
      .map((p: any) => {
        const roleUpper = (p.role || '').toUpperCase();
        const meta = authById.get(p.id);
        const metaTeam = (meta?.team || '').toUpperCase();
        let teamObj = p.team_id ? teamById.get(p.team_id) : undefined;
        if (!teamObj && metaTeam) {
          teamObj = teamByCode.get(metaTeam);
        }
        if (!teamObj && ['GATE', 'QC', 'UNLOADING'].includes(roleUpper)) {
          teamObj = teamByCode.get(roleUpper);
        }

        const effectiveRole = teamObj ? teamObj.code.toLowerCase() : (p.role || '').toLowerCase();

        return {
          id: p.id,
          full_name: p.full_name || '',
          username: p.username || meta?.username || null,
          email: meta?.email || null,
          phone: p.phone || null,
          role: effectiveRole,
          team_id: teamObj?.id || p.team_id || null,
          team: teamObj ? { id: teamObj.id, code: teamObj.code, name: teamObj.name } : null,
          shift: p.shift || meta?.shift || 'General',
          is_active: meta?.is_active ?? (p.is_active !== false),
          created_at: p.created_at,
          last_sign_in_at: meta?.last_sign_in_at || null,
        };
      })
      .filter((u) => u.team != null || ['gate', 'qc', 'unloading'].includes(u.role));

    if (team) {
      const tUpper = team.trim().toUpperCase();
      list = list.filter((u) => u.team?.code === tUpper || u.role.toUpperCase() === tUpper);
    }

    if (status) {
      const sLower = status.trim().toLowerCase();
      if (sLower === 'active') list = list.filter((u) => u.is_active);
      else if (sLower === 'inactive') list = list.filter((u) => !u.is_active);
    }

    if (search) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q)
      );
    }

    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /teams/users — create a plant team user directly with structured User ID
router.post('/users', requireRole('admin', 'superadmin'), async (req, res) => {
  const zoneId = req.profile.zone_id;
  const {
    full_name: rawName,
    email: rawEmail,
    phone: rawPhone,
    team: rawTeam,
    shift: rawShift = 'General',
    username: rawUsername,
    password: rawPassword,
    force_password_change = true,
  } = req.body as {
    full_name?: string;
    email?: string;
    phone?: string;
    team?: string;
    shift?: 'Morning' | 'Evening' | 'General';
    username?: string;
    password?: string;
    force_password_change?: boolean;
  };

  const email = (rawEmail ?? '').trim().toLowerCase();
  const full_name = (rawName ?? '').trim();
  const teamCode = (rawTeam || '').trim().toUpperCase();

  if (!['GATE', 'QC', 'UNLOADING'].includes(teamCode)) {
    res.status(400).json({ error: 'Valid team (GATE, QC, or UNLOADING) is required' });
    return;
  }

  if (!email || !full_name) {
    res.status(400).json({ error: 'Full name and email are required' });
    return;
  }

  // Auto-generate or format Unique User ID (e.g. AV_IT_001, AV_GT_001)
  let username = rawUsername ? rawUsername.trim().toUpperCase() : null;
  if (!username) {
    username = await generateNextTeamUserId(zoneId, teamCode);
  }

  // Validate username uniqueness
  try {
    const { data: dupUser, error: dupErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('zone_id', zoneId)
      .ilike('username', username)
      .limit(1);
    if (!dupErr && dupUser && dupUser.length > 0) {
      res.status(409).json({ error: `Unique User ID "${username}" is already taken in this zone` });
      return;
    }
  } catch {
    // Ignore schema cache errors during lookup
  }

  // Validate phone if provided
  let normalizedPhone: string | null = null;
  if (rawPhone && rawPhone.trim()) {
    const { normalizeIndianPhone } = await import('../lib/calculations');
    normalizedPhone = normalizeIndianPhone(rawPhone);
    if (!normalizedPhone) {
      res.status(400).json({ error: 'Phone must be a valid 10-digit Indian mobile number (+91)' });
      return;
    }
  }

  const shift = ['Morning', 'Evening', 'General'].includes(rawShift) ? rawShift : 'General';
  const role = teamCode.toLowerCase();
  const teamObj = await getTeamByCode(teamCode);

  const tempPassword = rawPassword && rawPassword.trim().length >= 6
    ? rawPassword.trim()
    : 'Aavin123';

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name,
      sub_role: 'operator',
      is_active: true,
      must_change_password: force_password_change,
      team: teamCode,
      shift,
      username,
    },
  });

  if (authError) {
    res.status(400).json({ error: authError.message });
    return;
  }

  const userId = authData.user.id;
  const { error: pErr } = await insertProfileResiliently({
    id: userId,
    role,
    zone_id: zoneId,
    full_name,
    phone: normalizedPhone,
    team_id: teamObj?.id || null,
    shift,
    username,
    email,
    sub_role: 'operator',
    is_active: true,
    must_change_password: force_password_change,
    user_type: 'internal',
  });

  if (pErr) {
    await supabase.auth.admin.deleteUser(userId);
    res.status(500).json({ error: pErr.message });
    return;
  }

  await writeAuditLog({
    zone_id: zoneId,
    entity_type: 'user',
    entity_id: userId,
    action: 'create',
    changes: {
      full_name,
      email,
      role,
      team: teamCode,
      shift,
      username,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json({
    id: userId,
    full_name,
    username,
    email,
    phone: normalizedPhone,
    team: teamObj ? { id: teamObj.id, code: teamObj.code, name: teamObj.name } : null,
    shift,
    role,
    temp_password: tempPassword,
    message: `Team operator ${full_name} (${username}) created successfully`,
  });
});

// PATCH /teams/:code/status — activate or deactivate team
router.patch('/:code/status', requireRole('admin', 'superadmin'), async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!['GATE', 'QC', 'UNLOADING'].includes(code)) {
    res.status(400).json({ error: `Invalid team code: ${code}. Must be GATE, QC, or UNLOADING.` });
    return;
  }

  const { active } = req.body as { active: boolean };
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'active boolean field is required' });
    return;
  }

  const zoneId = req.profile.zone_id;
  const team = await getTeamByCode(code);
  if (!team) {
    res.status(404).json({ error: `Team ${code} not found` });
    return;
  }

  // Deactivation blocker: if tankers are currently waiting on this team
  if (!active) {
    const waitingCounts = await computeWaitingTankersPerTeam(zoneId);
    const waiting = waitingCounts[code] || 0;
    if (waiting > 0) {
      res.status(400).json({
        error: `Cannot deactivate ${team.name}: ${waiting} tanker(s) are currently waiting on this team. Process or reassign waiting tankers first.`,
        waiting_tankers_count: waiting,
      });
      return;
    }
  }

  const updated = await updateTeamStatusInDb(code, active);

  await writeAuditLog({
    zone_id: zoneId,
    entity_type: 'team',
    entity_id: team.id,
    action: active ? 'activate' : 'deactivate',
    changes: {
      team_code: code,
      team_name: team.name,
      previous_status: team.active,
      new_status: active,
    },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  const [waitingCounts, activeCounts] = await Promise.all([
    computeWaitingTankersPerTeam(zoneId),
    computeActiveUsersPerTeam(zoneId),
  ]);

  res.json({
    ...updated,
    owned_stages: TEAM_OWNED_STAGES[code] || [],
    description: TEAM_DESCRIPTIONS[code] || '',
    active_user_count: activeCounts[code] || 0,
    waiting_tankers_count: waitingCounts[code] || 0,
  });
});

// POST /teams/seed-users — seed one test user per team; blocked in production
router.post('/seed-users', requireRole('admin', 'superadmin'), async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Seed endpoint is disabled in production' });
    return;
  }

  function genSeedPassword(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    return Array.from({ length: 12 }, () => chars[crypto.randomInt(chars.length)]).join('');
  }

  const zoneId = req.profile.zone_id;
  const teams = await getTeamsFromDb();
  const teamMap = new Map(teams.map((t) => [t.code.toUpperCase(), t]));

  const testUsers = [
    {
      code: 'GATE',
      email: 'gate_test@aavin.internal',
      username: 'gate_test',
      full_name: 'Gate Operator (Test)',
      phone: '+919876543201',
      shift: 'Morning',
      role: 'gate',
    },
    {
      code: 'QC',
      email: 'qc_test@aavin.internal',
      username: 'qc_test',
      full_name: 'QC Chemist (Test)',
      phone: '+919876543202',
      shift: 'General',
      role: 'qc',
    },
    {
      code: 'UNLOADING',
      email: 'unloading_test@aavin.internal',
      username: 'unloading_test',
      full_name: 'Unloading Bay Lead (Test)',
      phone: '+919876543203',
      shift: 'Morning',
      role: 'unloading',
    },
  ];

  const results: any[] = [];

  // Fetch auth users once (outside loop) to avoid N×listUsers calls
  const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const authByEmail = new Map((authList?.users ?? []).map((u) => [u.email ?? '', u]));

  for (const tu of testUsers) {
    const teamObj = teamMap.get(tu.code);
    const teamId = teamObj?.id;
    const existingAuth = authByEmail.get(tu.email);

    let existingUserId: string | null = null;
    let seedPassword: string | null = null;

    if (existingAuth) {
      existingUserId = existingAuth.id;
    } else {
      seedPassword = genSeedPassword();
      const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
        email: tu.email,
        password: seedPassword,
        email_confirm: true,
        user_metadata: {
          full_name: tu.full_name,
          username: tu.username,
          sub_role: 'operator',
          is_active: true,
          must_change_password: true,
        },
      });
      if (createErr) {
        console.warn(`[seed-users] Error creating auth user ${tu.email}:`, createErr.message);
        continue;
      }
      existingUserId = createData.user.id;
    }

    if (existingUserId) {
      const { error: pErr } = await insertProfileResiliently({
        id: existingUserId,
        role: tu.role,
        zone_id: zoneId,
        full_name: tu.full_name,
        phone: tu.phone,
        team_id: teamId || null,
        shift: tu.shift,
        username: tu.username,
        email: tu.email,
        sub_role: 'operator',
        is_active: true,
        must_change_password: !existingAuth,
      });
      if (pErr) {
        console.warn(`[seed-users] Profile save note for ${tu.email}:`, pErr.message);
      }

      results.push({
        email: tu.email,
        username: tu.username,
        role: tu.role,
        team: tu.code,
        status: existingAuth ? 'already_existed' : 'created',
        ...(seedPassword ? { temp_password: seedPassword } : {}),
      });
    }
  }

  res.json({
    message: 'Test users seeded successfully',
    users: results,
  });
});

export default router;
