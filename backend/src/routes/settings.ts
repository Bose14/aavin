import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import {
  addSellingRateRule,
  getSellingRateHistory,
  getZoneSettings,
  listAuditLogs,
  saveZoneSettings,
  writeAuditLog,
} from '../lib/settingsStore';

const router = Router();
router.use(authMiddleware);

// GET /settings — zone settings & effective-dated selling rate schedule
router.get('/', async (req, res) => {
  try {
    const zoneId = req.profile.zone_id;
    const [settings, selling_rate_history] = await Promise.all([
      getZoneSettings(zoneId),
      getSellingRateHistory(zoneId),
    ]);
    res.json({ settings, selling_rate_history });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /settings — admin updates zone settings
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    const zoneId = req.profile.zone_id;
    const body = req.body as Record<string, unknown>;
    const updated = await saveZoneSettings(zoneId, {
      fat_min: body.fat_min != null ? Number(body.fat_min) : undefined,
      fat_max: body.fat_max != null ? Number(body.fat_max) : undefined,
      fat_benchmark: body.fat_benchmark != null ? Number(body.fat_benchmark) : undefined,
      snf_min: body.snf_min != null ? Number(body.snf_min) : undefined,
      snf_max: body.snf_max != null ? Number(body.snf_max) : undefined,
      snf_benchmark: body.snf_benchmark != null ? Number(body.snf_benchmark) : undefined,
      rejection_warn_pct: body.rejection_warn_pct != null ? Number(body.rejection_warn_pct) : undefined,
      rejection_danger_pct: body.rejection_danger_pct != null ? Number(body.rejection_danger_pct) : undefined,
      rate_base: body.rate_base != null ? Number(body.rate_base) : undefined,
      rate_fat_coeff: body.rate_fat_coeff != null ? Number(body.rate_fat_coeff) : undefined,
      rate_snf_coeff: body.rate_snf_coeff != null ? Number(body.rate_snf_coeff) : undefined,
      rejection_payment_rule: body.rejection_payment_rule === 'gross' ? 'gross' : body.rejection_payment_rule === 'net' ? 'net' : undefined,
      edit_lock_hours: body.edit_lock_hours != null ? Math.max(1, Number(body.edit_lock_hours)) : undefined,
      show_unit_profit: typeof body.show_unit_profit === 'boolean' ? body.show_unit_profit : undefined,
      destinations: Array.isArray(body.destinations)
        ? body.destinations.map((s) => String(s).trim()).filter(Boolean)
        : undefined,
      locations: Array.isArray(body.locations)
        ? body.locations.map((s) => String(s).trim()).filter(Boolean)
        : undefined,
    });

    await writeAuditLog({
      zone_id: zoneId,
      entity_type: 'zone_settings',
      action: 'update',
      changes: body,
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /settings/selling-rates — add or update an effective-dated selling rate
router.post('/selling-rates', requireRole('admin'), async (req, res) => {
  try {
    const { rate_per_litre, effective_from, notes } = req.body as {
      rate_per_litre?: number;
      effective_from?: string;
      notes?: string;
    };
    const rate = Number(rate_per_litre);
    if (!Number.isFinite(rate) || rate <= 0 || !effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
      res.status(400).json({ error: 'Valid positive rate_per_litre and effective_from (YYYY-MM-DD) required' });
      return;
    }

    const rule = await addSellingRateRule(
      req.profile.zone_id,
      +rate.toFixed(2),
      effective_from,
      notes?.trim(),
      req.user.id,
    );

    await writeAuditLog({
      zone_id: req.profile.zone_id,
      entity_type: 'selling_rate',
      entity_id: rule.id,
      action: 'set_rate',
      changes: { rate_per_litre: rate, effective_from, notes },
      actor_id: req.user.id,
      actor_name: req.profile.full_name ?? req.user.email ?? 'Admin',
    });

    const history = await getSellingRateHistory(req.profile.zone_id);
    res.status(201).json({ rule, history });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /settings/audit-logs?entity_type=...&entity_id=...
router.get('/audit-logs', async (req, res) => {
  try {
    const { entity_type, entity_id } = req.query as Record<string, string>;
    const logs = await listAuditLogs(req.profile.zone_id, entity_type, entity_id);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;

