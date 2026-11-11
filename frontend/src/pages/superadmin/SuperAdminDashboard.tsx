import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { createZone } from '../../lib/zones';
import { useZones } from '../../hooks/useZones';
import ZoneSelect from '../../components/ZoneSelect';

interface AdminUser {
  id: string;
  full_name: string | null;
  role: string;
  phone: string | null;
  created_at: string;
  zones: { name: string } | null;
}

export default function SuperAdminDashboard() {
  const { zones, loading: zonesLoading, error: zonesError, reload: reloadZones } = useZones();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', zone_id: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterZone, setFilterZone] = useState('');

  const [showAddZone, setShowAddZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [zoneMsg, setZoneMsg] = useState('');
  const [zoneErr, setZoneErr] = useState('');
  const [addingZone, setAddingZone] = useState(false);

  const loadUsers = useCallback(() => {
    const qs = filterZone ? `?zone_id=${filterZone}` : '';
    api.get<AdminUser[]>(`/users${qs}`).then(r => setUsers(r.data)).catch(() => {});
  }, [filterZone]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
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
      setZoneMsg(`Zone "${created.name}" added.`);
      setShowAddZone(false);
    } catch (err: unknown) {
      setZoneErr((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to add zone');
    }
    setAddingZone(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${id}`);
      loadUsers();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to delete');
    }
  };

  const generatedPassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Super Admin</h1>
          <p className="page-subtitle">Manage zone admins across all zones</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setShowAddZone(s => !s); setZoneErr(''); setZoneMsg(''); }}
        >
          {showAddZone ? 'Close Add Zone' : '+ Add Zone'}
        </button>
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
        <h2>Create New Admin</h2>
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
              Password
              <button type="button" className="btn-link" onClick={() => setForm(f => ({ ...f, password: generatedPassword() }))}>
                generate
              </button>
            </label>
            <input type="text" value={form.password} onChange={set('password')} placeholder="Set a secure password" required minLength={8} />
            <span className="hint">Share this password with the admin securely after creation.</span>
          </div>
          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}
          <button type="submit" disabled={loading} className="btn-primary" style={{ width: 'auto' }}>
            {loading ? 'Creating…' : 'Create Admin'}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem 0.75rem' }}>
          <h2 style={{ margin: 0 }}>All Admins & Unit Users</h2>
          <ZoneSelect
            value={filterZone}
            onChange={e => setFilterZone(e.target.value)}
            zones={zones}
            loading={zonesLoading}
            error={zonesError}
            onRetry={reloadZones}
            placeholder="All Zones"
            style={{ padding: '0.4rem 0.6rem', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '0.875rem' }}
          />
        </div>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Role</th><th>Zone</th><th>Phone</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.full_name ?? '—'}</td>
                <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                <td>{u.zones?.name ?? '—'}</td>
                <td>{u.phone ?? '—'}</td>
                <td>{new Date(u.created_at).toLocaleDateString('en-IN')}</td>
                <td>
                  <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={() => handleDelete(u.id, u.full_name ?? u.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="empty">No users found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
