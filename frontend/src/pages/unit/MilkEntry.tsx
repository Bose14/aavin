import { useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';

export default function MilkEntry() {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    date: today,
    shift: 'AM',
    fat_pct: '',
    snf_pct: '',
    quantity_litres: '',
    rejection_qty: '0',
    temperature: '',
    rate_per_litre: '',
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  // Auto-calculate rate based on fat% and SNF% (Aavin formula)
  const calcRate = () => {
    const fat = parseFloat(form.fat_pct);
    const snf = parseFloat(form.snf_pct);
    if (!isNaN(fat) && !isNaN(snf)) {
      const rate = +(fat * 0.75 + snf * 0.45 + 2.0).toFixed(2);
      setForm(f => ({ ...f, rate_per_litre: String(rate) }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      await api.post('/milk', {
        ...form,
        fat_pct: parseFloat(form.fat_pct),
        snf_pct: parseFloat(form.snf_pct),
        quantity_litres: parseFloat(form.quantity_litres),
        rejection_qty: parseFloat(form.rejection_qty) || 0,
        temperature: form.temperature ? parseFloat(form.temperature) : undefined,
        rate_per_litre: parseFloat(form.rate_per_litre),
      });
      setSuccess(`${form.shift} shift entry for ${form.date} saved successfully!`);
      setForm(f => ({ ...f, fat_pct: '', snf_pct: '', quantity_litres: '', rejection_qty: '0', temperature: '', rate_per_litre: '' }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save entry';
      setError(msg);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Milk Entry</h1>
        <p className="page-subtitle">Enter daily milk collection data</p>
      </div>
      <div className="card form-card">
        <form onSubmit={handleSubmit} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Date</label>
              <input type="date" value={form.date} onChange={set('date')} max={today} required />
            </div>
            <div className="form-group">
              <label>Shift</label>
              <select value={form.shift} onChange={set('shift')} required>
                <option value="AM">Morning (AM)</option>
                <option value="PM">Evening (PM)</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Fat % <span className="hint">(3.5–8.5)</span></label>
              <input type="number" step="0.01" min="0" max="15" value={form.fat_pct} onChange={set('fat_pct')} onBlur={calcRate} placeholder="e.g. 4.20" required />
            </div>
            <div className="form-group">
              <label>SNF % <span className="hint">(8.0–9.5)</span></label>
              <input type="number" step="0.01" min="0" max="15" value={form.snf_pct} onChange={set('snf_pct')} onBlur={calcRate} placeholder="e.g. 8.50" required />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Quantity (Litres)</label>
              <input type="number" step="0.01" min="0" value={form.quantity_litres} onChange={set('quantity_litres')} placeholder="e.g. 250.00" required />
            </div>
            <div className="form-group">
              <label>Rejection (Litres)</label>
              <input type="number" step="0.01" min="0" value={form.rejection_qty} onChange={set('rejection_qty')} placeholder="0.00" />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Temperature (°C) <span className="hint">optional</span></label>
              <input type="number" step="0.1" value={form.temperature} onChange={set('temperature')} placeholder="e.g. 4.5" />
            </div>
            <div className="form-group">
              <label>Rate (₹/L) <span className="hint">auto-calculated</span></label>
              <input type="number" step="0.01" min="0" value={form.rate_per_litre} onChange={set('rate_per_litre')} placeholder="e.g. 28.50" required />
            </div>
          </div>

          {form.quantity_litres && form.rate_per_litre && (
            <div className="calc-preview">
              <span>Procurement Cost: <strong>₹{(parseFloat(form.quantity_litres) * parseFloat(form.rate_per_litre)).toFixed(2)}</strong></span>
              <span>Net Qty: <strong>{(parseFloat(form.quantity_litres) - (parseFloat(form.rejection_qty) || 0)).toFixed(2)} L</strong></span>
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}
          {success && <p className="auth-success">{success}</p>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Saving…' : 'Submit Entry'}
          </button>
        </form>
      </div>
    </div>
  );
}
