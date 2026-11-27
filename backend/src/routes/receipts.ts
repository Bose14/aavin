import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { buildReceiptsWorkbook, loadReceiptDays, validateRange } from '../lib/bmcReceiptsData';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

const fail = (res: import('express').Response, req: import('express').Request, err: unknown) => {
  console.error('[api]', req.method, req.originalUrl, (err as Error).message);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

// GET /receipts/bmc?from=YYYY-MM-DD&to=YYYY-MM-DD — BMC Receipts report, one block per day
router.get('/bmc', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const bad = validateRange(from, to);
  if (bad) { res.status(400).json({ error: bad }); return; }
  try {
    res.json({ days: await loadReceiptDays(req.profile.dairy_unit_id, from!, to!) });
  } catch (err) {
    fail(res, req, err);
  }
});

// GET /receipts/bmc/xlsx?from=&to= — the same report as an Excel file
router.get('/bmc/xlsx', async (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const bad = validateRange(from, to);
  if (bad) { res.status(400).json({ error: bad }); return; }
  try {
    const dairyUnitId = req.profile.dairy_unit_id;
    const [days, unit] = await Promise.all([
      loadReceiptDays(dairyUnitId, from!, to!),
      supabase.from('dairy_units').select('name').eq('id', dairyUnitId).maybeSingle(),
    ]);
    const title = `${String(unit.data?.name ?? '').toUpperCase()} UNION - BMC RECEIPTS ${from} TO ${to}`;
    const file = await buildReceiptsWorkbook(days, title);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BMC_Receipts_${from}_to_${to}.xlsx"`);
    res.send(file);
  } catch (err) {
    fail(res, req, err);
  }
});

export default router;
