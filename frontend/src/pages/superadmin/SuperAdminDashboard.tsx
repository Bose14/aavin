import { useState, useEffect, useCallback, useMemo } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { createZone } from '../../lib/zones';
import { useZones } from '../../hooks/useZones';
import ZoneSelect from '../../components/ZoneSelect';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge } from '../../components/UiPrimitives';
import { formatDateDDMMYYYY, normalizeIndianPhone } from '../../lib/format';

interface AdminUser {
  id: string;
  full_name: string | null;
  role: 'superadmin' | 'admin' | 'unit';
  phone: string | null;
  email: string | null;
  zone_id: string | null;
  unit_id: string | null;
  is_active?: boolean;
  must_change_password?: boolean;
  created_at: string;
  zones: { name: string } | null;
  units: { name: string; unit_code: string } | null;
}

function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function SuperAdminDashboard() {
  const { zones, loading: zonesLoading, error: zonesError, reload: reloadZones } = useZones();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersError, setUsersError] = useState('');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', zone_id: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterZone, setFilterZone] = useState('');
  const [filterRole, setFilterRole] = useState<'ALL' | 'admin' | 'unit'>('ALL');

  const [showAddZone, setShowAddZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [zoneMsg, setZoneMsg] = useState('');
  const [zoneErr, setZoneErr] = useState('');
  const [addingZone, setAddingZone] = useState(false);

  // Edit Admin modal
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editZoneId, setEditZoneId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Reset Password modal
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetTempPwd, setResetTempPwd] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Toggle active confirmation
  const [toggleTarget, setToggleTarget] = useState<AdminUser | null>(null);
  const [toggling, setToggling] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = useCallback(() => {
    const qs = filterZone ? `?zone_id=${filterZone}` : '';
    api.get<AdminUser[]>(`/users${qs}`)
      .then(r => {
        setUsers(r.data);
        setUsersError('');
      })
      .catch((err: unknown) => {
        setUsersError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to load users');
      });
  }, [filterZone]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (form.phone.trim()) {
      const normalized = normalizeIndianPhone(form.phone);
      if (!normalized) {
        setError('Phone must be a valid 10-digit Indian mobile number (+91).');
        return;
      }
    }

    setLoading(true);
    try {
      const res = await api.post('/users/create', { ...form, role: 'admin' });
      const zoneName = zones.find(z => z.id === form.zone_id)?.name ?? '';
      setSuccess(`Admin "${res.data.full_name}" created${zoneName ? ` for zone ${zoneName}` : ''}.`);
      setForm({ email: '', password: '', full_name: '', phone: '', zone_id: '' });
      loadUsers();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed');
    }
    setLoading(false);
  };

  const handleAddZone = async (e: FormEvent) => {
    e.preventDefault();
    setZoneErr(''); setZoneMsg('');
    const trimmed = newZoneName.trim();
    if (!trimmed) return;
    setAddingZone(true);
    try {
      const created = await createZone(trimmed);
      await reloadZones();
      setForm(prev => ({ ...prev, zone_id: created.id }));
      setNewZoneName('');
      setZoneMsg(`Zone "${created.name}" added successfully.`);
      setShowAddZone(false);
    } catch (err: unknown) {
      setZoneErr((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to add zone');
    }
    setAddingZone(false);
  };

  const openEditModal = (u: AdminUser) => {
    setEditTarget(u);
    setEditName(u.full_name ?? '');
    setEditPhone(u.phone ?? '');
    setEditZoneId(u.zone_id ?? '');
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    if (editPhone.trim() && !normalizeIndianPhone(editPhone)) {
      setEditError('Phone must be a valid 10-digit Indian mobile number (+91).');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      await api.patch(`/users/${editTarget.id}`, {
        full_name: editName.trim(),
        phone: editPhone.trim() ? normalizeIndianPhone(editPhone) : null,
        zone_id: editZoneId || undefined,
      });
      setEditTarget(null);
      loadUsers();
    } catch (err: unknown) {
      setEditError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  };

  const openResetModal = (u: AdminUser) => {
    setResetTarget(u);
    setResetTempPwd(genPassword());
    setResetLink(null);
    setCopySuccess(false);
  };

  const handleExecuteReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const res = await api.post<{ temp_password?: string; reset_link?: string | null }>(
        `/users/${resetTarget.id}/reset-password`,
      );
      if (res.data.temp_password) setResetTempPwd(res.data.temp_password);
      if (res.data.reset_link) setResetLink(res.data.reset_link);
      loadUsers();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Password reset failed');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleActive = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await api.patch(`/users/${toggleTarget.id}`, {
        is_active: toggleTarget.is_active === false ? true : false,
      });
      setToggleTarget(null);
      loadUsers();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update user status');
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      loadUsers();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (filterRole === 'ALL') return users;
    return users.filter(u => u.role === filterRole);
  }, [users, filterRole]);

  const columns: DataColumn<AdminUser>[] = [
    {
      key: 'name',
      header: 'Name & Email',
      sortValue: u => u.full_name ?? '',
      searchValue: u => `${u.full_name ?? ''} ${u.email ?? ''} ${u.phone ?? ''}`,
      render: u => (
        <div>
          <strong style={{ display: 'block', fontSize: '0.88rem' }}>{u.full_name || 'Unnamed'}</strong>
          {u.email && <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{u.email}</span>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: u => u.role,
      render: u => (
        <span className={`role-badge ${u.role}`}>
          {u.role === 'admin' ? 'Zone Admin' : u.role === 'unit' ? 'Unit User' : u.role}
        </span>
      ),
    },
    {
      key: 'zone',
      header: 'Zone / Unit',
      sortValue: u => u.zones?.name ?? '',
      render: u => (
        <div>
          <span>{u.zones?.name || '—'}</span>
          {u.units && (
            <span style={{ display: 'block', fontSize: '0.74rem', color: '#64748b' }}>
              {u.units.name} ({u.units.unit_code})
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Phone',
      sortValue: u => u.phone ?? '',
      render: u => (u.phone ? normalizeIndianPhone(u.phone) ?? u.phone : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: u => (u.is_active === false ? 0 : 1),
      render: u => (
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge tone={u.is_active === false ? 'grey' : 'green'}>
            {u.is_active === false ? 'Inactive' : 'Active'}
          </StatusBadge>
          {u.must_change_password && (
            <StatusBadge tone="amber">Pending First Login</StatusBadge>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortValue: u => u.created_at,
      render: u => formatDateDDMMYYYY(u.created_at.slice(0, 10)),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: u => (
        <div className="action-row">
          <button type="button" className="btn-secondary btn-sm" onClick={() => openEditModal(u)}>
            Edit
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openResetModal(u)}>
            Reset Password
          </button>
          <button
            type="button"
            className={u.is_active === false ? 'btn-secondary btn-sm' : 'btn-danger btn-sm'}
            onClick={() => setToggleTarget(u)}
          >
            {u.is_active === false ? 'Activate' : 'Deactivate'}
          </button>
          <button
            type="button"
            className="btn-danger btn-sm"
            onClick={() => setDeleteTarget(u)}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Super Admin</h1>
          <p className="page-subtitle">Manage zone administrators and users across all Aavin zones</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => { setShowAddZone(s => !s); setZoneErr(''); setZoneMsg(''); }}
          >
            {showAddZone ? 'Close Add Zone' : '+ Add Zone'}
          </button>
        </div>
      </div>

      {showAddZone && (
        <div className="card form-card">
          <h2>Add New Zone</h2>
          <form onSubmit={handleAddZone} className="entry-form">
            <div className="form-row" style={{ alignItems: 'end' }}>
              <div className="form-group">
                <label>Zone Name</label>
                <input
                  type="text"
                  value={newZoneName}
                  onChange={e => setNewZoneName(e.target.value)}
                  placeholder="e.g. Namakkal"
                  required
                />
              </div>
              <div>
                <button type="submit" disabled={addingZone} className="btn-primary" style={{ width: 'auto' }}>
                  {addingZone ? 'Adding…' : 'Save Zone'}
                </button>
              </div>
            </div>
            {zoneErr && <p className="auth-error">{zoneErr}</p>}
          </form>
        </div>
      )}

      {zoneMsg && <p className="auth-success" style={{ marginBottom: '1rem' }}>{zoneMsg}</p>}

      <div className="card form-card">
        <h2>Create New Zone Admin</h2>
        <form onSubmit={handleCreate} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={form.full_name} onChange={set('full_name')} placeholder="Admin's full name" required />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 XXXXX XXXXX" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={set('email')} placeholder="admin@aavin.gov.in" required />
            </div>
            <div className="form-group">
              <label>Zone</label>
              <ZoneSelect
                value={form.zone_id}
                onChange={set('zone_id')}
                zones={zones}
                loading={zonesLoading}
                error={zonesError}
                onRetry={reloadZones}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label>
              Password{' '}
              <button type="button" className="btn-link" onClick={() => setForm(f => ({ ...f, password: genPassword() }))}>
                generate
              </button>
            </label>
            <input type="text" value={form.password} onChange={set('password')} placeholder="Set a secure password" required minLength={8} />
            <span className="hint">The admin will be prompted to set their permanent password upon first login.</span>
          </div>
          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}
          <button type="submit" disabled={loading} className="btn-primary" style={{ width: 'auto' }}>
            {loading ? 'Creating…' : 'Create Admin'}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem 0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>All Admins &amp; Unit Users ({filteredUsers.length})</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={filterRole}
              onChange={e => setFilterRole(e.target.value as 'ALL' | 'admin' | 'unit')}
              aria-label="Filter by role"
              style={{ minHeight: 38, padding: '0.35rem 0.65rem', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '0.85rem' }}
            >
              <option value="ALL">All Roles</option>
              <option value="admin">Zone Admins</option>
              <option value="unit">Unit Users</option>
            </select>
            <ZoneSelect
              value={filterZone}
              onChange={e => setFilterZone(e.target.value)}
              zones={zones}
              loading={zonesLoading}
              error={zonesError}
              onRetry={reloadZones}
              placeholder="All Zones"
              style={{ minHeight: 38, padding: '0.35rem 0.65rem', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '0.85rem' }}
            />
          </div>
        </div>

        {usersError && <ErrorBanner message={usersError} onRetry={loadUsers} />}

        <DataTable
          rows={filteredUsers}
          columns={columns}
          getRowKey={u => u.id}
          searchPlaceholder="Search by name, email, phone, or zone…"
          emptyMessage="No users found for this filter."
        />
      </div>

      {/* Edit Admin Modal */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Edit User — {editTarget.full_name}</h3>
            <div className="entry-form" style={{ marginTop: '0.85rem' }}>
              <div className="form-group">
                <label>Full Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="9876543210" />
              </div>
              {editTarget.role === 'admin' && (
                <div className="form-group">
                  <label>Assigned Zone</label>
                  <ZoneSelect
                    value={editZoneId}
                    onChange={e => setEditZoneId(e.target.value)}
                    zones={zones}
                    loading={zonesLoading}
                    error={zonesError}
                    onRetry={reloadZones}
                    required
                  />
                </div>
              )}
              {editError && <p className="auth-error">{editError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
                <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Reset Password — {resetTarget.full_name}</h3>
            <p className="modal-body-text">
              Generate a temporary password and require {resetTarget.full_name} to choose a permanent password on next login.
            </p>
            <div className="entry-form">
              <div className="form-group">
                <label>Temporary Password</label>
                <input type="text" readOnly value={resetTempPwd} style={{ background: '#f8fafc', fontWeight: 600 }} />
              </div>
              {resetLink && (
                <div className="form-group">
                  <label>Direct Password Setup Link</label>
                  <input type="text" readOnly value={resetLink} style={{ background: '#f8fafc', fontSize: '0.8rem' }} />
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setResetTarget(null)}>Close</button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void navigator.clipboard.writeText(resetLink || resetTempPwd);
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 3000);
                  }}
                >
                  {copySuccess ? 'Copied!' : 'Copy Credentials'}
                </button>
                <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={resetting} onClick={() => void handleExecuteReset()}>
                  {resetting ? 'Applying…' : 'Confirm Reset'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate/Activate Confirm */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={`${toggleTarget?.is_active === false ? 'Activate' : 'Deactivate'} ${toggleTarget?.full_name}?`}
        message={
          toggleTarget?.is_active === false
            ? `Re-activate ${toggleTarget?.full_name}? They will be able to log in again.`
            : `Deactivate ${toggleTarget?.full_name}? They will be blocked from logging in immediately. Existing records are kept.`
        }
        confirmLabel={toggleTarget?.is_active === false ? 'Activate User' : 'Deactivate User'}
        danger={toggleTarget?.is_active !== false}
        loading={toggling}
        onConfirm={() => void handleToggleActive()}
        onCancel={() => setToggleTarget(null)}
      />

      {/* Delete User Confirm */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete User — ${deleteTarget?.full_name}?`}
        message={`Are you sure you want to permanently delete "${deleteTarget?.full_name}"? This action cannot be undone.`}
        confirmLabel="Delete User"
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
