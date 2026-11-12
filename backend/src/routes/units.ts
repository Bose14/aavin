import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { writeAuditLog } from '../lib/settingsStore';

const router = Router();
router.use(authMiddleware);

function getTodayIso(): string {
  // Use IST (+05:30) calendar day consistently for village units in Tamil Nadu
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().split('T')[0];
}

// GET /units — list units in requester's zone with users_count, last_record_date, and submitted_today
router.get('/', async (req, res) => {
  const zoneId = req.profile.zone_id;
  const [unitsRes, profilesRes, entriesRes] = await Promise.all([
    supabase
      .from('units')
      .select('id, name, location, unit_code, is_active, created_at')
      .eq('zone_id', zoneId)
      .order('name'),
    supabase
      .from('profiles')
      .select('unit_id')
      .eq('zone_id', zoneId)
      .eq('role', 'unit'),
    supabase
      .from('milk_entries')
      .select('unit_id, date')
      .eq('zone_id', zoneId)
      .order('date', { ascending: false }),
  ]);

  if (unitsRes.error) { res.status(500).json({ error: unitsRes.error.message }); return; }

  const userCounts: Record<string, number> = {};
  for (const p of (profilesRes.data ?? [])) {
    if (p.unit_id) userCounts[p.unit_id] = (userCounts[p.unit_id] ?? 0) + 1;
  }

  const lastDateByUnit: Record<string, string> = {};
  for (const e of (entriesRes.data ?? [])) {
    if (e.unit_id && !lastDateByUnit[e.unit_id]) {
      lastDateByUnit[e.unit_id] = e.date;
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

// POST /units — admin creates a unit
router.post('/', requireRole('admin'), async (req, res) => {
  if (!req.profile.zone_id) {
    res.status(403).json({ error: 'Admin account is not assigned to a zone' });
    return;
  }

  const rawBody = req.body as { name?: string; location?: string; unit_code?: string };
  const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
  const unitCode = typeof rawBody.unit_code === 'string' ? rawBody.unit_code.trim() : '';
  const location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;

  if (!name || !unitCode) {
    res.status(400).json({ error: 'name and unit_code required' });
    return;
  }
  const { data, error } = await supabase
    .from('units')
    .insert({ name, location, unit_code: unitCode, zone_id: req.profile.zone_id })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Unit code "${unitCode}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id: data.id,
    entity_type: 'unit',
    entity_id: data.id,
    action: 'create',
    changes: { name, unit_code: unitCode, location },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json(data);
});

// PATCH /units/:id — admin updates unit details (name, unit_code, location) or active status
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const unitId = String(req.params.id);
  const rawBody = req.body as {
    name?: string; unit_code?: string; location?: string | null; is_active?: boolean;
  };

  const patch: Record<string, unknown> = {};
  if (rawBody.name !== undefined) {
    const trimmed = String(rawBody.name).trim();
    if (!trimmed) { res.status(400).json({ error: 'Unit name cannot be empty' }); return; }
    patch.name = trimmed;
  }
  if (rawBody.unit_code !== undefined) {
    const trimmedCode = String(rawBody.unit_code).trim();
    if (!trimmedCode) { res.status(400).json({ error: 'Unit code cannot be empty' }); return; }
    patch.unit_code = trimmedCode;
  }
  if (rawBody.location !== undefined) {
    patch.location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;
  }
  if (typeof rawBody.is_active === 'boolean') {
    patch.is_active = rawBody.is_active;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'No valid update fields provided' });
    return;
  }

  const { data, error } = await supabase
    .from('units')
    .update(patch)
    .eq('id', unitId)
    .eq('zone_id', req.profile.zone_id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `Unit code "${String(patch.unit_code)}" already exists` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  await writeAuditLog({
    zone_id: req.profile.zone_id,
    unit_id: unitId,
    entity_type: 'unit',
    entity_id: unitId,
    action: rawBody.is_active === false ? 'deactivate' : rawBody.is_active === true ? 'activate' : 'update',
    changes: patch,
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.json(data);
});

export default router;
