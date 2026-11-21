import { Router } from 'express';
import { fetchTrips } from '../lib/tripStore';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  getTeamsFromDb,
  getTeamByCode,
  updateTeamStatusInDb,
  getZoneSettings,
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
 * Computes waiting tanker count per team in a dairy unit.
 */
async function computeWaitingTankersPerTeam(dairyUnitId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    GATE: 0,
    QC: 0,
    UNLOADING: 0,
  };

  try {
    const { rows: tripRows, stages: stagesMap } = await fetchTrips({ dairyUnitId, openOnly: true });
    const rows = tripRows as Array<Record<string, unknown>>;
    const settings = await getZoneSettings(dairyUnitId);

    for (const row of rows) {
      const tripId = String(row.id);
      const stages = (stagesMap[tripId] ?? []) as StageRecordItem[];

      const stagesMapObj: Record<string, any> = {};
      for (const s of stages) {
        if (s.stage_name && s.stage_data && typeof s.stage_data === 'object') {
          stagesMapObj[s.stage_name] = s.stage_data;
        }
      }

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
        stage_data: {
          ...((row.stage_data as Record<string, unknown>) || {}),
          ...stagesMapObj,
        },
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
 * Computes active user count per team in a dairy unit.
 */
async function computeActiveUsersPerTeam(dairyUnitId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = { ADMIN: 0, GATE: 0, QC: 0, UNLOADING: 0, BMC: 0 };

  const { data, error } = await supabase
    .from('users')
    .select('teams(code)')
    .eq('dairy_unit_id', dairyUnitId)
    .eq('is_active', true);

  if (error) {
    console.warn('[computeActiveUsersPerTeam] Error:', error.message);
    return counts;
  }

  for (const row of (data ?? []) as unknown as Array<{ teams: { code: string } | null }>) {
    const code = row.teams?.code;
    if (code && counts[code] !== undefined) counts[code] += 1;
  }
  return counts;
}

// GET /teams — list all 3 teams with owned stages, user counts, and waiting tanker counts
router.get('/', async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;

  try {
    const [teams, waitingCounts, activeCounts] = await Promise.all([
      getTeamsFromDb(),
      computeWaitingTankersPerTeam(dairyUnitId),
      computeActiveUsersPerTeam(dairyUnitId),
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
    console.error('[api]', req.method, req.originalUrl, (err as Error).message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PATCH /teams/:code/status — activate or deactivate team
router.patch('/:code/status', requireRole('admin'), async (req, res) => {
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

  const dairyUnitId = req.profile.dairy_unit_id;
  const team = await getTeamByCode(code);
  if (!team) {
    res.status(404).json({ error: `Team ${code} not found` });
    return;
  }

  // Deactivation blocker: if tankers are currently waiting on this team
  if (!active) {
    const waitingCounts = await computeWaitingTankersPerTeam(dairyUnitId);
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
    dairy_unit_id: dairyUnitId,
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
    computeWaitingTankersPerTeam(dairyUnitId),
    computeActiveUsersPerTeam(dairyUnitId),
  ]);

  res.json({
    ...updated,
    owned_stages: TEAM_OWNED_STAGES[code] || [],
    description: TEAM_DESCRIPTIONS[code] || '',
    active_user_count: activeCounts[code] || 0,
    waiting_tankers_count: waitingCounts[code] || 0,
  });
});

export default router;
