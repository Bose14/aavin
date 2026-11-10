import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';

interface Unit { id: string; name: string; location: string; unit_code: string; is_active: boolean; }

export default function AdminUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState({ name: '', location: '', unit_code: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const load = () => api.get('/units').then(r => setUnits(r.data));
  useEffect(() => { load(); }, []);

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      await api.post('/units', form);
      setSuccess(`Unit "${form.name}" created.`);
      setForm({ name: '', location: '', unit_code: '' });
      load();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed');
    }
    setLoading(false);
  };

  const toggleActive = async (u: Unit) => {
    await api.patch(`/units/${u.id}`, { is_active: !u.is_active });
    load();
  };

  return (
    <div className="page">
      <div className="page-header"><h1>Manage Units</h1></div>

      <div className="card form-card">
        <h2>Add New Unit</h2>
        <form onSubmit={handleCreate} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Unit Name</label>
              <input type="text" value={form.name} onChange={set('name')} placeholder="e.g. Velur Collection Centre" required />
            </div>
            <div className="form-group">
              <label>Unit Code</label>
              <input type="text" value={form.unit_code} onChange={set('unit_code')} placeholder="e.g. NMK-001" required />
            </div>
          </div>
          <div className="form-group">
            <label>Location <span className="hint">optional</span></label>
            <input type="text" value={form.location} onChange={set('location')} placeholder="Village / Taluk" />
          </div>
          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}
          <button type="submit" disabled={loading} className="btn-primary">{loading ? 'Creating…' : 'Create Unit'}</button>
        </form>
      </div>

      <div className="card table-card">
        <h2>All Units in Your Zone</h2>
        <table className="data-table">
          <thead><tr><th>Name</th><th>Code</th><th>Location</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {units.map(u => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.unit_code}</td><td>{u.location ?? '—'}</td>
                <td><span className={`badge ${u.is_active ? 'AM' : 'PM'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td><button className="btn-secondary" onClick={() => toggleActive(u)}>{u.is_active ? 'Deactivate' : 'Activate'}</button></td>
              </tr>
            ))}
            {units.length === 0 && <tr><td colSpan={5} className="empty">No units yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
