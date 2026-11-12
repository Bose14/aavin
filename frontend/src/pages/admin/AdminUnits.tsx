import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import api, { getApiErrorMessage } from '../../lib/api';

interface Unit { id: string; name: string; location: string; unit_code: string; is_active: boolean; }

export default function AdminUnits() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState({ name: '', location: '', unit_code: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.get('/units')
      .then(r => {
        setUnits(r.data);
        setLoadError('');
      })
      .catch((err: unknown) => setLoadError(getApiErrorMessage(err, 'Failed to load units')));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (f: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res = await api.post('/units', {
        name: form.name.trim(),
        unit_code: form.unit_code.trim(),
        location: form.location.trim(),
      });
      setSuccess(`Unit "${res.data.name}" created.`);
      setForm({ name: '', location: '', unit_code: '' });
      load();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create unit'));
    }
    setLoading(false);
  };

  const toggleActive = async (u: Unit) => {
    setLoadError('');
    try {
      await api.patch(`/units/${u.id}`, { is_active: !u.is_active });
      load();
    } catch (err: unknown) {
      setLoadError(getApiErrorMessage(err, 'Failed to update unit'));
    }
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
        {loadError && <p className="auth-error" style={{ padding: '0 1.5rem 0.75rem' }}>{loadError}</p>}
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
