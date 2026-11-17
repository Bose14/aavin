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
      .select('id, date, tanker_number, driver_name, seal_number, quantity_dispatched, trip_status, current_stage, waiting_team, stage_data, created_at')
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
    // 1. Fetch profiles for this zone
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, role, team_id, is_active')
      .eq('zone_id', zoneId)
      .in('role', ['gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING']);

    if (error || !profiles) {
      return counts;
    }

    // 2. Cross-reference with auth users for active state
    let inactiveAuthIds = new Set<string>();
    try {
      const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      for (const u of authData?.users ?? []) {
        if (u.user_metadata?.is_active === false) {
          inactiveAuthIds.add(u.id);
        }
      }
    } catch {
      // ignore
    }

    for (const p of profiles as Array<{ id: string; role: string; team_id?: string; is_active?: boolean }>) {
      if (p.is_active === false || inactiveAuthIds.has(p.id)) {
        continue;
      }
      const roleUpper = (p.role || '').toUpperCase();
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

// POST /teams/seed-users — seed one test user per team (gate_test, qc_test, unloading_test)
router.post('/seed-users', requireRole('admin', 'superadmin'), async (req, res) => {
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
  const defaultPassword = 'PlantUser@123';

  for (const tu of testUsers) {
    const teamObj = teamMap.get(tu.code);
    const teamId = teamObj?.id;

    // Check if auth user exists
    let existingUserId: string | null = null;
    const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const match = (authList?.users ?? []).find((u) => u.email === tu.email);
    if (match) {
      existingUserId = match.id;
    } else {
      const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
        email: tu.email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: {
          full_name: tu.full_name,
          username: tu.username,
          sub_role: 'operator',
          is_active: true,
          must_change_password: false,
        },
      });
      if (createErr) {
        console.warn(`[seed-users] Error creating auth user ${tu.email}:`, createErr.message);
        continue;
      }
      existingUserId = createData.user.id;
    }

    if (existingUserId) {
      // Upsert into profiles
      await supabase.from('profiles').upsert(
        {
          id: existingUserId,
          role: tu.role,
          zone_id: zoneId,
          full_name: tu.full_name,
          phone: tu.phone,
          team_id: teamId || null,
          shift: tu.shift,
          username: tu.username,
        },
        { onConflict: 'id' },
      );

      results.push({
        email: tu.email,
        username: tu.username,
        role: tu.role,
        team: tu.code,
        status: match ? 'already_existed' : 'created',
      });
    }
  }

  res.json({
    message: 'Test users seeded successfully',
    users: results,
    default_password: defaultPassword,
  });
});

export default router;
