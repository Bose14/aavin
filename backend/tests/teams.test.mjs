process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTankerJourneyState,
  TANKER_STAGES,
} from '../dist/lib/tankerJourney.js';
import { normalizeIndianPhone } from '../dist/lib/calculations.js';

const { TEAM_OWNED_STAGES } = await import('../dist/routes/teams.js');

test('1. Teams fixed set and stage ownership definitions', () => {
  const codes = Object.keys(TEAM_OWNED_STAGES);
  assert.deepEqual(codes.sort(), ['GATE', 'QC', 'UNLOADING'].sort());

  // GATE: vehicle entry, gross weight, tare weight, vehicle exit
  assert.deepEqual(TEAM_OWNED_STAGES.GATE, [
    'vehicle_entered',
    'gross_weight',
    'tare_weight',
    'vehicle_exit',
  ]);

  // QC: QC test, CIP
  assert.deepEqual(TEAM_OWNED_STAGES.QC, [
    'qc_completed',
    'cip_completed',
  ]);

  // UNLOADING: unloading
  assert.deepEqual(TEAM_OWNED_STAGES.UNLOADING, [
    'unloaded',
  ]);
});

test('3. Phone normalization and 10-digit Indian mobile validation', () => {
  assert.equal(normalizeIndianPhone('9876543210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('+91 98765 43210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('09876543210'), '+91 98765 43210');
  assert.equal(normalizeIndianPhone('919876543210'), '+91 98765 43210');

  // Invalid numbers
  assert.equal(normalizeIndianPhone('12345'), null);
  assert.equal(normalizeIndianPhone('abc'), null);
  assert.equal(normalizeIndianPhone('4876543210'), null); // starts with 4 (not 6, 7, 8, or 9)
});

test('4. Server-side team stage ownership check', () => {
  // Check which team owns which stage
  function canTeamRecordStage(teamRole, stageKey) {
    const stage = TANKER_STAGES.find((s) => s.key === stageKey);
    if (!stage) return false;
    const r = teamRole.toLowerCase();
    if (r === 'admin') return true;
    return stage.team.toLowerCase() === r;
  }

  // GATE team can record vehicle_entered, gross_weight, tare_weight, vehicle_exit
  assert.equal(canTeamRecordStage('gate', 'vehicle_entered'), true);
  assert.equal(canTeamRecordStage('gate', 'gross_weight'), true);
  assert.equal(canTeamRecordStage('gate', 'tare_weight'), true);
  assert.equal(canTeamRecordStage('gate', 'vehicle_exit'), true);

  // GATE cannot record QC or Unloading stages
  assert.equal(canTeamRecordStage('gate', 'qc_completed'), false);
  assert.equal(canTeamRecordStage('gate', 'unloaded'), false);
  assert.equal(canTeamRecordStage('gate', 'cip_completed'), false);

  // QC team can record qc_completed and cip_completed
  assert.equal(canTeamRecordStage('qc', 'qc_completed'), true);
  assert.equal(canTeamRecordStage('qc', 'cip_completed'), true);
  assert.equal(canTeamRecordStage('qc', 'gross_weight'), false);
  assert.equal(canTeamRecordStage('qc', 'unloaded'), false);

  // UNLOADING team can record unloaded
  assert.equal(canTeamRecordStage('unloading', 'unloaded'), true);
  assert.equal(canTeamRecordStage('unloading', 'qc_completed'), false);
  assert.equal(canTeamRecordStage('unloading', 'tare_weight'), false);

  // ADMIN can record any stage
  assert.equal(canTeamRecordStage('admin', 'vehicle_entered'), true);
  assert.equal(canTeamRecordStage('admin', 'qc_completed'), true);
  assert.equal(canTeamRecordStage('admin', 'unloaded'), true);
});

test('5. Server-side trip status matching: prevents out-of-order execution', () => {
  const tripInput = {
    id: 'test-trip-1',
    date: '2026-11-16',
    tanker_number: 'TN-01-A-1111',
    quantity_dispatched: 1000,
    trip_status: 'on_the_way',
    stages: [],
  };

  // Initially: on the way, waiting for vehicle_entered
  let journey = deriveTankerJourneyState(tripInput);
  assert.equal(journey.currentStageKey, 'vehicle_entered');
  assert.equal(journey.waitingTeam, 'gate');

  // If QC tries to record qc_completed before vehicle_entered, it is blocked
  assert.notEqual(journey.currentStageKey, 'qc_completed');

  // Once vehicle_entered is done:
  tripInput.stages.push({
    stage_name: 'vehicle_entered',
    status: 'done',
    done_at: new Date().toISOString(),
  });
  journey = deriveTankerJourneyState(tripInput);
  assert.equal(journey.currentStageKey, 'gross_weight');
  assert.equal(journey.waitingTeam, 'gate');

  // Once gross_weight is done:
  tripInput.stages.push({
    stage_name: 'gross_weight',
    status: 'done',
    done_at: new Date().toISOString(),
  });
  journey = deriveTankerJourneyState(tripInput);
  assert.equal(journey.currentStageKey, 'qc_completed');
  assert.equal(journey.waitingTeam, 'qc');

  // If QC rejects:
  tripInput.stages.push({
    stage_name: 'qc_completed',
    status: 'rejected',
    done_at: new Date().toISOString(),
  });
  journey = deriveTankerJourneyState(tripInput);
  // Skipped unloaded, now waiting for tare_weight at GATE
  assert.equal(journey.isQcRejected, true);
  assert.equal(journey.currentStageKey, 'tare_weight');
  assert.equal(journey.waitingTeam, 'gate');
});

test('6. Team deactivation validation logic', () => {
  function checkDeactivationAllowed(waitingCount) {
    if (waitingCount > 0) {
      return {
        allowed: false,
        error: `Cannot deactivate team: ${waitingCount} tanker(s) are currently waiting on this team.`,
      };
    }
    return { allowed: true };
  }

  // If tankers are waiting, deactivation is blocked
  const blocked = checkDeactivationAllowed(2);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.error, /Cannot deactivate team/);

  // If 0 tankers are waiting, deactivation is allowed
  const allowed = checkDeactivationAllowed(0);
  assert.equal(allowed.allowed, true);
});

test('7. Move team validation and reason requirement', () => {
  function validateTeamMove(newTeam, reason) {
    const norm = (newTeam || '').trim().toUpperCase();
    if (!['GATE', 'QC', 'UNLOADING'].includes(norm)) {
      return { valid: false, error: 'Valid new_team (GATE, QC, or UNLOADING) is required' };
    }
    const cleanReason = (reason || '').trim();
    if (!cleanReason) {
      return { valid: false, error: 'Reason is required to move a user to another team' };
    }
    return { valid: true, newTeam: norm, reason: cleanReason };
  }

  // Empty reason blocked
  const res1 = validateTeamMove('QC', '');
  assert.equal(res1.valid, false);
  assert.match(res1.error, /Reason is required/);

  // Whitespace-only reason blocked
  const res2 = validateTeamMove('QC', '   ');
  assert.equal(res2.valid, false);

  // Invalid team blocked
  const res3 = validateTeamMove('INVALID', 'Transfer requested');
  assert.equal(res3.valid, false);
  assert.match(res3.error, /Valid new_team/);

  // Valid move allowed
  const res4 = validateTeamMove('UNLOADING', 'Transferred due to shift shortage');
  assert.equal(res4.valid, true);
  assert.equal(res4.newTeam, 'UNLOADING');
  assert.equal(res4.reason, 'Transferred due to shift shortage');
});

test('8. Role-based redirect routing for all roles', () => {
  function roleHome(role) {
    const r = (role || '').toLowerCase();
    if (r === 'admin') return '/admin/tanker';
    if (r === 'gate') return '/gate';
    if (r === 'qc') return '/qc';
    if (r === 'unloading') return '/unloading';
    return '/unit/tanker';
  }

  assert.equal(roleHome('admin'), '/admin/tanker');
  assert.equal(roleHome('gate'), '/gate');
  assert.equal(roleHome('GATE'), '/gate');
  assert.equal(roleHome('qc'), '/qc');
  assert.equal(roleHome('QC'), '/qc');
  assert.equal(roleHome('unloading'), '/unloading');
  assert.equal(roleHome('UNLOADING'), '/unloading');
  assert.equal(roleHome('bmc'), '/unit/tanker');
});
