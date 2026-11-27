import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { bmcSchema } from '../schemas';
import { requireRole } from '../middleware/requireRole';
import { writeAuditLog } from '../lib/settingsStore';
import { idLookup } from '../lib/ids';
import { createUserAccount } from '../lib/userAccounts';

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
    .select('id, id_token, name, location, bmc_code, route_name, team_name, kind, code_no, cc_code, capacity_litres, milk_type, is_active, created_at, dairy_unit_id, dairy_units(name), bmc_opening_balances(balance_date, quantity_litres)')
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

  if (unitsRes.error) { console.error('[api]', req.method, req.originalUrl, unitsRes.error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }

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
    const ob = Array.isArray((u as any).bmc_opening_balances) ? (u as any).bmc_opening_balances[0] : (u as any).bmc_opening_balances;
    return {
      ...u,
      bmc_opening_balances: undefined,
      opening_balance: ob ? Number(ob.quantity_litres) : null,
      opening_balance_date: ob?.balance_date ?? null,
      users_count: userCounts[u.id] ?? 0,
      last_record_date: lastDate,
      submitted_today: lastDate === today,
    };
  });

  res.json(enriched);
});

// POST /bmcs — admin creates a BMC
router.post('/', requireRole('admin'), validateBody(bmcSchema), async (req, res) => {
  if (!req.profile.dairy_unit_id) {
    res.status(403).json({ error: 'Admin account is not assigned to a dairy unit' });
    return;
  }

  const rawBody = req.body as {
    name?: string; location?: string; bmc_code?: string;
    route_name?: string; team_name?: string; kind?: string; code_no?: number | string; milk_type?: string;
    cc_code?: number | string | null; capacity_litres?: number | string | null;
    opening_balance?: number | string | null; opening_balance_date?: string | null;
    first_user?: { full_name?: string; email?: string; phone?: string | null; shift?: string } | null;
  };
  const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
  const ccFromBody = optInt(rawBody.cc_code);
  const unitCode = typeof rawBody.bmc_code === 'string' && rawBody.bmc_code.trim()
    ? rawBody.bmc_code.trim()
    : (ccFromBody !== null ? String(ccFromBody) : '');
  const location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;

  if (!name || !unitCode) {
    res.status(400).json({ error: 'name and bmc_code required' });
    return;
  }
  const teamName = optText(rawBody.team_name);
  let bmcTeamId: number | null = null;
  if (teamName) {
    const { data: teamRow } = await supabase.from('bmc_teams').select('id')
      .eq('code', teamName).eq('dairy_unit_id', req.profile.dairy_unit_id).maybeSingle();
    bmcTeamId = (teamRow?.id as number | undefined) ?? null;
  }
  const { data, error } = await supabase
    .from('bmcs')
    .insert({
      name, location, bmc_code: unitCode, dairy_unit_id: req.profile.dairy_unit_id, bmc_team_id: bmcTeamId,
      route_name: optText(rawBody.route_name),
      team_name: teamName,
      kind: rawBody.kind === 'CC' ? 'CC' : 'BMC',
      code_no: optInt(rawBody.code_no),
      cc_code: numericCode(unitCode) ?? ccFromBody,
      capacity_litres: optNum(rawBody.capacity_litres),
      milk_type: String(rawBody.milk_type ?? '').toUpperCase() === 'BUFFALO' ? 'BUFFALO' : 'COW',
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `BMC code "${unitCode}" already exists` });
    } else {
      console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    return;
  }

  const createOpening = optNum(rawBody.opening_balance);
  if (createOpening !== null && createOpening >= 0) {
    const day = typeof rawBody.opening_balance_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawBody.opening_balance_date)
      ? rawBody.opening_balance_date : getTodayIso();
    await supabase.from('bmc_opening_balances').upsert({ bmc_id: data.id, balance_date: day, quantity_litres: createOpening }, { onConflict: 'bmc_id' });
  }

  // Optional first login for this BMC, created together with it: if it fails, the BMC is removed again
  let firstUser: { full_name: string; email: string; temp_password: string } | null = null;
  const fu = rawBody.first_user;
  if (fu && (fu.full_name?.trim() || fu.email?.trim())) {
    const created = await createUserAccount({
      dairyUnitId: req.profile.dairy_unit_id,
      input: { ...fu, team: 'BMC', bmc_id: String(data.id) },
      actor: { id: req.user.id, name: req.profile.full_name ?? req.user.email ?? 'Admin' },
    });
    if (!created.ok) {
      await supabase.from('bmc_opening_balances').delete().eq('bmc_id', data.id);
      await supabase.from('bmcs').delete().eq('id', data.id);
      res.status(created.status).json({ error: `BMC was not created — ${created.error}` });
      return;
    }
    firstUser = { full_name: created.user.full_name, email: created.user.email, temp_password: created.tempPassword };
  }

  await writeAuditLog({
    dairy_unit_id: req.profile.dairy_unit_id,
    bmc_id: data.id,
    entity_type: 'bmc',
    entity_id: data.id,
    action: 'create',
    changes: { name, bmc_code: unitCode, location, capacity_litres: optNum(rawBody.capacity_litres) },
    actor_id: req.user.id,
    actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
  });

  res.status(201).json({ ...data, first_user: firstUser });
});

/** The BMC code and the CC code are one number: a numeric code also fills cc_code (used in stock reports). */
function numericCode(code: string): number | null {
  return /^\d{1,9}$/.test(code) ? Number(code) : null;
}

function optText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function optInt(v: unknown): number | null {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isInteger(n) ? null : n;
}

// PATCH /bmcs/:id — admin updates BMC details (name, bmc_code, location) or active status. :id is an id or id_token
router.patch('/:id', requireRole('admin'), validateBody(bmcSchema), async (req, res) => {
  const lookup = idLookup(req.params.id);
  if (!lookup) { res.status(404).json({ error: 'BMC not found' }); return; }
  const rawBody = req.body as {
    name?: string; bmc_code?: string; location?: string | null; is_active?: boolean;
    route_name?: string | null; team_name?: string | null; kind?: string; code_no?: number | string | null; milk_type?: string;
    cc_code?: number | string | null; capacity_litres?: number | string | null;
    opening_balance?: number | string | null; opening_balance_date?: string | null;
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
    patch.cc_code = numericCode(trimmedCode);
  }
  if (rawBody.location !== undefined) {
    patch.location = typeof rawBody.location === 'string' && rawBody.location.trim() ? rawBody.location.trim() : null;
  }
  if (rawBody.route_name !== undefined) patch.route_name = optText(rawBody.route_name);
  if (rawBody.team_name !== undefined) patch.team_name = optText(rawBody.team_name);
  if (rawBody.kind !== undefined) patch.kind = rawBody.kind === 'CC' ? 'CC' : 'BMC';
  if (rawBody.code_no !== undefined) patch.code_no = optInt(rawBody.code_no);
  if (rawBody.cc_code !== undefined && rawBody.bmc_code === undefined) {
    // Only the CC code was sent: keep the BMC code identical to it
    const cc = optInt(rawBody.cc_code);
    patch.cc_code = cc;
    if (cc !== null) patch.bmc_code = String(cc);
  }
  if (rawBody.capacity_litres !== undefined) {
    const cap = optNum(rawBody.capacity_litres);
    if (cap !== null && cap < 0) { res.status(400).json({ error: 'Capacity cannot be negative' }); return; }
    patch.capacity_litres = cap;
  }
  if (rawBody.milk_type !== undefined) {
    const mt = String(rawBody.milk_type).toUpperCase();
    if (mt !== 'COW' && mt !== 'BUFFALO') { res.status(400).json({ error: 'Milk type must be cow or buffalo' }); return; }
    patch.milk_type = mt;
  }
  if (typeof rawBody.is_active === 'boolean') {
    patch.is_active = rawBody.is_active;
  }

  const openingBalance = rawBody.opening_balance !== undefined ? optNum(rawBody.opening_balance) : undefined;
  if (Object.keys(patch).length === 0 && openingBalance === undefined) {
    res.status(400).json({ error: 'No valid update fields provided' });
    return;
  }

  const target = supabase.from('bmcs');
  const scoped = (Object.keys(patch).length ? target.update(patch) : target.select())
    .eq(lookup.column, lookup.value)
    .eq('dairy_unit_id', req.profile.dairy_unit_id);
  const { data, error } = await scoped.select().single();
  if (!error && openingBalance !== undefined) {
    if (openingBalance === null) {
      await supabase.from('bmc_opening_balances').delete().eq('bmc_id', data.id);
    } else {
      const day = typeof rawBody.opening_balance_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawBody.opening_balance_date)
        ? rawBody.opening_balance_date : getTodayIso();
      const { error: obErr } = await supabase.from('bmc_opening_balances')
        .upsert({ bmc_id: data.id, balance_date: day, quantity_litres: openingBalance }, { onConflict: 'bmc_id' });
      if (obErr) { console.error('[api]', req.method, req.originalUrl, obErr.message); res.status(500).json({ error: 'Something went wrong. Please try again.' }); return; }
    }
    patch.opening_balance = openingBalance;
  }
  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: `BMC code "${String(patch.bmc_code)}" already exists` });
    } else {
      console.error('[api]', req.method, req.originalUrl, error.message); res.status(500).json({ error: 'Something went wrong. Please try again.' });
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
