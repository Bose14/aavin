import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

interface Unit { id: string; name: string; unit_code: string; }
interface UnitUser {
  id: string; full_name: string | null; phone: string | null; created_at: string;
  units: { name: string; unit_code: string } | null;
}

export default function AdminUsers() {
  const { profile } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<UnitUser[]>([]);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', unit_id: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const loadUnits = () => api.get('/units').then(r => setUnits(r.data));
  const loadUsers = () => api.get('/users').then(r => setUsers(r.data));

  useEffect(() => { loadUnits(); loadUsers(); }, []);

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const generatedPassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res = await api.post('/users/create', {
        ...form,
        role: 'unit',
        zone_id: profile?.zone_id,
      });
      setSuccess(`Unit user "${res.data.full_name}" created.`);
      setForm({ email: '', password: '', full_name: '', phone: '', unit_id: '' });
      loadUsers();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed');
    }
    setLoading(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${id}`);
      loadUsers();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Manage Users</h1>
          <p className="page-subtitle">Create login accounts for village unit staff</p>
        </div>
      </div>

      <div className="card form-card">
        <h2>Create Unit User</h2>
        <form onSubmit={handleCreate} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={form.full_name} onChange={set('full_name')} placeholder="Staff member's name" required />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+91 XXXXX XXXXX" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={set('email')} placeholder="user@aavin.gov.in" required />
            </div>
            <div className="form-group">
              <label>Assign to Unit</label>
              <select value={form.unit_id} onChange={set('unit_id')} required>
                <option value="">Select unit…</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.unit_code})</option>)}
              </select>
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
            <span className="hint">Share this password with the user securely.</span>
          </div>
          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}
          <button type="submit" disabled={loading} className="btn-primary" style={{ width: 'auto' }}>
            {loading ? 'Creating…' : 'Create User'}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <h2>Unit Users in Your Zone</h2>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Unit</th><th>Phone</th><th>Created</th><th>Action</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.full_name ?? '—'}</td>
                <td>{u.units?.name ?? '—'} <span className="unit-code">{u.units?.unit_code}</span></td>
                <td>{u.phone ?? '—'}</td>
                <td>{new Date(u.created_at).toLocaleDateString('en-IN')}</td>
                <td>
                  <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={() => handleDelete(u.id, u.full_name ?? u.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} className="empty">No unit users yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
