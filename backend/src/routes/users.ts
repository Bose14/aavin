import { Router } from 'express';
import { supabase } from '../supabase';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';

const router = Router();
router.use(authMiddleware);

// GET /users — list users in the caller's zone
router.get('/', requireRole('admin', 'superadmin'), async (req, res) => {
  let query = supabase
    .from('profiles')
    .select('id, full_name, role, zone_id, unit_id, phone, created_at, units(name, unit_code)')
    .order('created_at', { ascending: false });

  if (req.profile.role === 'admin') {
    // Admin only sees unit users in their zone
    query = query.eq('zone_id', req.profile.zone_id).eq('role', 'unit');
  } else {
    // Superadmin sees all admins (not superadmins)
    query = query.in('role', ['admin', 'unit']);
    const { zone_id } = req.query as { zone_id?: string };
    if (zone_id) query = query.eq('zone_id', zone_id);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// POST /users/create — superadmin creates admin, admin creates unit user
router.post('/create', requireRole('admin', 'superadmin'), async (req, res) => {
  const { email, password, full_name, phone, role, zone_id, unit_id } = req.body as {
    email: string; password: string; full_name: string; phone?: string;
    role: string; zone_id: string; unit_id?: string;
  };

  // Role-based permission checks
  if (req.profile.role === 'admin') {
    if (role !== 'unit') {
      res.status(403).json({ error: 'Admins can only create unit users' });
      return;
    }
    if (zone_id !== req.profile.zone_id) {
      res.status(403).json({ error: 'Cannot create users in another zone' });
      return;
    }
    if (!unit_id) {
      res.status(400).json({ error: 'unit_id required for unit users' });
      return;
    }
  }

  if (req.profile.role === 'superadmin') {
    if (role === 'superadmin') {
      res.status(403).json({ error: 'Cannot create another superadmin' });
      return;
    }
    if (!['admin', 'unit'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }
  }

  if (!email || !password || !full_name || !zone_id || !role) {
    res.status(400).json({ error: 'email, password, full_name, zone_id and role are required' });
    return;
  }

  // Create auth user — email_confirm: true bypasses confirmation email
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError) {
    res.status(400).json({ error: authError.message });
    return;
  }

  const userId = authData.user.id;

  // Create profile row
  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    role,
    zone_id,
    unit_id: unit_id ?? null,
    full_name,
    phone: phone ?? null,
  });

  if (profileError) {
    // Rollback auth user
    await supabase.auth.admin.deleteUser(userId);
    res.status(500).json({ error: profileError.message });
    return;
  }

  res.status(201).json({ id: userId, email, role, full_name });
});

// DELETE /users/:id — admin deletes unit user, superadmin deletes admin/unit
router.delete('/:id', requireRole('admin', 'superadmin'), async (req, res) => {
  const { id } = req.params;

  // Fetch the target profile
  const { data: target } = await supabase
    .from('profiles')
    .select('role, zone_id')
    .eq('id', id)
    .single();

  if (!target) { res.status(404).json({ error: 'User not found' }); return; }

  if (target.role === 'superadmin') {
    res.status(403).json({ error: 'Cannot delete a superadmin' });
    return;
  }

  if (req.profile.role === 'admin') {
    if (target.zone_id !== req.profile.zone_id || target.role !== 'unit') {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
  }

  await supabase.auth.admin.deleteUser(id);
  res.status(204).send();
});

export default router;
