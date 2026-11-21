import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { writeAuditLog } from '../lib/settingsStore';
import { idLookup } from '../lib/ids';

const router = Router();
router.use(authMiddleware);

function getTodayIso(): string {
  // Use IST (+05:30) calendar day consistently for village units in Tamil Nadu
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().split('T')[0];
}

// GET /bmcs — list BMCs in requester's dairy unit with users_count, last_record_date, and submitted_today
router.get('/', async (req, res) => {
  const dairyUnitId = req.profile.dairy_unit_id;

  let unitsQuery = supabase
    .from('bmcs')
    .select('id, id_token, name, location, bmc_code, route_name, team_name, kind, code_no, is_active, created_at, dairy_unit_id, dairy_units(name)')
    .order('name');
  let profilesQuery = supabase
    .from('users')
    .select('bmc_id')
    .not('bmc_id', 'is', null);
  let entriesQuery = supabase
    .from('milk_entries')
    .select('bmc_id, date')
    .order('date', { ascending: false });

  if (dairyUnitId) {
    unitsQuery = unitsQuery.eq('dairy_unit_id', dairyUnitId);
    profilesQuery = profilesQuery.eq('dairy_unit_id', dairyUnitId);
    entriesQuery = entriesQuery.eq('dairy_unit_id', dairyUnitId);
  }

  const [unitsRes, profilesRes, entriesRes] = await Promise.all([
    unitsQuery,
    profilesQuery,
    entriesQuery,
  ]);

  if (unitsRes.error) { res.status(500).json({ error: unitsRes.error.message }); return; }

  const userCounts: Record<string, number> = {};
  for (const p of (profilesRes.data ?? [])) {
    if (p.bmc_id) userCounts[p.bmc_id] = (userCounts[p.bmc_id] ?? 0) + 1;
  }

  const lastDateByUnit: Record<string, string> = {};
  for (const e of (entriesRes.data ?? [])) {
    if (e.bmc_id && !lastDateByUnit[e.bmc_id]) {
      lastDateByUnit[e.bmc_id] = e.date;
    }
  }

  const today = getTodayIso();
  const enriched = (unitsRes.data ?? []).map((u) => {
    const lastDate = lastDateByUnit[u.id] ?? null;
    return {
      ...u,
      users_count: userCounts[u.id] ?? 0,
      last_record_date: lastDate,
      submitted_today: lastDate === today,
    };
  });

  res.json(enriched);
});

// POST /bmcs — admin creates a BMC
router.post('/', requireRole('admin'), async (req, res) => {
  if (!req.profile.dairy_unit_id) {
    res.status(403).json({ error: 'Admin account is not assigned to a dairy unit' });
    return;
  }

  const rawBody = req.body as {
    name?: string; location?: string; bmc_code?: string;
    route_name?: string; team_name?: string; kind?: string; code_no?: number | string;
  };
  const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
  const unitCode = typeof rawBody.bmc_code === 'string' ? rawBody.bmc_code.trim() : '';
  const location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;

  if (!name || !unitCode) {
    res.status(400).json({ error: 'name and bmc_code required' });
    return;
  }
  const { data, error } = await supabase
    .from('bmcs')
    .insert({
      name, location, bmc_code: unitCode, dairy_unit_id: req.profile.dairy_unit_id,
      route_name: optText(rawBody.route_name),
      team_name: optText(rawBody.team_name),
      kind: rawBody.kind === 'CC' ? 'CC' : 'BMC',
      code_no: optInt(rawBody.code_no),
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `BMC code "${unitCode}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  await writeAuditLog({
    dairy_unit_id: req.profile.dairy_unit_id,
    bmc_id: data.id,
    entity_type: 'bmc',
    entity_id: data.id,
    action: 'create',
    changes: { name, bmc_code: unitCode, location },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json(data);
});

function optText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function optInt(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isInteger(n) ? null : n;
}

// PATCH /bmcs/:id — admin updates BMC details (name, bmc_code, location) or active status. :id is an id or id_token
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const lookup = idLookup(req.params.id);
  if (!lookup) { res.status(404).json({ error: 'BMC not found' }); return; }
  const rawBody = req.body as {
    name?: string; bmc_code?: string; location?: string | null; is_active?: boolean;
    route_name?: string | null; team_name?: string | null; kind?: string; code_no?: number | string | null;
  };

  const patch: Record<string, unknown> = {};
  if (rawBody.name !== undefined) {
    const trimmed = String(rawBody.name).trim();
    if (!trimmed) { res.status(400).json({ error: 'BMC name cannot be empty' }); return; }
    patch.name = trimmed;
  }
  if (rawBody.bmc_code !== undefined) {
    const trimmedCode = String(rawBody.bmc_code).trim();
    if (!trimmedCode) { res.status(400).json({ error: 'BMC code cannot be empty' }); return; }
    patch.bmc_code = trimmedCode;
  }
  if (rawBody.location !== undefined) {
    patch.location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;
  }
  if (rawBody.route_name !== undefined) patch.route_name = optText(rawBody.route_name);
  if (rawBody.team_name !== undefined) patch.team_name = optText(rawBody.team_name);
  if (rawBody.kind !== undefined) patch.kind = rawBody.kind === 'CC' ? 'CC' : 'BMC';
  if (rawBody.code_no !== undefined) patch.code_no = optInt(rawBody.code_no);
  if (typeof rawBody.is_active === 'boolean') {
    patch.is_active = rawBody.is_active;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No valid update fields provided' });
    return;
  }

  const { data, error } = await supabase
    .from('bmcs')
    .update(patch)
    .eq(lookup.column, lookup.value)
    .eq('dairy_unit_id', req.profile.dairy_unit_id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `BMC code "${String(patch.bmc_code)}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  await writeAuditLog({
    dairy_unit_id: req.profile.dairy_unit_id,
    bmc_id: data.id,
    entity_type: 'bmc',
    entity_id: data.id,
    action: rawBody.is_active === false ? 'deactivate' : rawBody.is_active === true ? 'activate' : 'update',
    changes: patch,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json(data);
});

export default router;
