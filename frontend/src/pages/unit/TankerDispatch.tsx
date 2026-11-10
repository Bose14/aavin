import { useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';

export default function TankerDispatch() {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({ date: today, tanker_number: '', quantity_dispatched: '', destination: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      await api.post('/tanker', {
        ...form,
        quantity_dispatched: parseFloat(form.quantity_dispatched),
      });
      setSuccess(`Tanker ${form.tanker_number} dispatch recorded for ${form.date}.`);
      setForm(f => ({ ...f, tanker_number: '', quantity_dispatched: '', destination: '' }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save';
      setError(msg);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Tanker Dispatch</h1>
        <p className="page-subtitle">Record milk dispatched via tanker</p>
      </div>
      <div className="card form-card">
        <form onSubmit={handleSubmit} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={form.date} onChange={set('date')} max={today} required />
            </div>
            <div className="form-group">
              <label>Tanker Number</label>
              <input type="text" value={form.tanker_number} onChange={set('tanker_number')} placeholder="e.g. TN33AB1234" required />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Quantity Dispatched (Litres)</label>
              <input type="number" step="0.01" min="0" value={form.quantity_dispatched} onChange={set('quantity_dispatched')} placeholder="e.g. 1200.00" required />
            </div>
            <div className="form-group">
              <label>Destination <span className="hint">optional</span></label>
              <input type="text" value={form.destination} onChange={set('destination')} placeholder="e.g. Namakkal Dairy" />
            </div>
          </div>
          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Saving…' : 'Record Dispatch'}
          </button>
        </form>
      </div>
    </div>
  );
}
