import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import {
  calcRateFromChart,
  formatDateDDMMYYYY,
  formatINR,
  getLocalTodayIso,
} from '../../lib/format';
import type { ZoneSettings } from '../../lib/format';
import { ErrorBanner, StatusBadge } from '../../components/UiPrimitives';

export default function AdminSettings() {
  const { settings, sellingRates, loading, reload } = useZoneSettings();

  const [form, setForm] = useState<ZoneSettings>(settings);
  const [destText, setDestText] = useState(settings.destinations.join(', '));
  const [locText, setLocText] = useState(settings.locations.join(', '));

  const [newSellRate, setNewSellRate] = useState('52');
  const [effectiveFrom, setEffectiveFrom] = useState(() => getLocalTodayIso());
  const [rateNote, setRateNote] = useState('');

  const [simFat, setSimFat] = useState('4.50');
  const [simSnf, setSimSnf] = useState('8.40');

  const [savingSettings, setSavingSettings] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setForm(settings);
    setDestText(settings.destinations.join(', '));
    setLocText(settings.locations.join(', '));
    if (sellingRates.length > 0) {
      setNewSellRate(String(sellingRates[0].rate_per_litre));
    }
  }, [settings, sellingRates]);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSavingSettings(true);
    try {
      const payload: ZoneSettings = {
        ...form,
        destinations: destText.split(',').map(s => s.trim()).filter(Boolean),
        locations: locText.split(',').map(s => s.trim()).filter(Boolean),
      };
      await api.put('/settings', payload);
      await reload();
      setSuccessMsg('Zone configuration and thresholds saved.');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddSellingRate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSavingRate(true);
    try {
      await api.post('/settings/selling-rates', {
        rate_per_litre: parseFloat(newSellRate),
        effective_from: effectiveFrom,
        note: rateNote.trim() || undefined,
      });
      setRateNote('');
      await reload();
      setSuccessMsg(`Selling rate ₹${parseFloat(newSellRate).toFixed(2)}/L scheduled effective ${formatDateDDMMYYYY(effectiveFrom)}. Past entries remain unchanged.`);
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to add selling rate');
    } finally {
      setSavingRate(false);
    }
  };

  const simulatedRate = calcRateFromChart(
    parseFloat(simFat || '0') || 0,
    parseFloat(simSnf || '0') || 0,
    form,
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Zone Settings &amp; Assumptions</h1>
          <p className="page-subtitle">Configure rate charts, effective-dated selling rates, rejection payment rules &amp; thresholds</p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      {successMsg && <div className="success-banner"><span>{successMsg}</span></div>}

      {/* Effective-Dated Selling Rate */}
      <div className="card form-card">
        <h2>Selling Rate Schedule (Effective-Dated)</h2>
        <p className="chart-subtitle" style={{ marginBottom: '1rem' }}>
          Changing the selling rate adds a new rule from an effective date so historical profit/loss numbers are never rewritten.
        </p>

        <form onSubmit={handleAddSellingRate} className="entry-form" style={{ marginBottom: '1.25rem' }}>
          <div className="form-row">
            <div className="form-group">
              <label>New Selling Rate (₹ / Litre)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="1"
                value={newSellRate}
                onChange={e => setNewSellRate(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Effective From <span className="hint">({formatDateDDMMYYYY(effectiveFrom)})</span></label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Revision Note <span className="hint">(optional)</span></label>
              <input
                type="text"
                value={rateNote}
                onChange={e => setRateNote(e.target.value)}
                placeholder="e.g. Aavin G.O. seasonal revision"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" disabled={savingRate || loading} className="btn-primary">
                {savingRate ? 'Adding…' : 'Schedule Selling Rate'}
              </button>
            </div>
          </div>
        </form>

        <table className="data-table">
          <thead>
            <tr>
              <th>Effective Date</th>
              <th>Selling Rate (₹/L)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {sellingRates.map((sr, i) => (
              <tr key={sr.id ?? `${sr.effective_from}-${i}`}>
                <td>{formatDateDDMMYYYY(sr.effective_from)}</td>
                <td><strong>{formatINR(sr.rate_per_litre)}/L</strong></td>
                <td>{sr.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Zone Rules Form */}
      <form onSubmit={handleSaveSettings} className="card form-card">
        <h2>Rate Chart, Rejection Rules &amp; Quality Thresholds</h2>
        <div className="entry-form">
          <div className="procurement-section">
            <div className="form-section-header">
              <div>
                <h2 style={{ marginBottom: 2 }}>Fat / SNF Rate Chart Formula</h2>
                <p className="chart-subtitle">Rate (₹/L) = Base + (Fat % × Fat Coeff) + (SNF % × SNF Coeff)</p>
              </div>
              <StatusBadge tone="indigo">
                Simulator ({simFat || '0'}% Fat, {simSnf || '0'}% SNF) = ₹{simulatedRate.toFixed(2)}/L
              </StatusBadge>
            </div>
            <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <div className="form-group">
                <label>Base (₹)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.rate_base}
                  onChange={e => setForm({ ...form, rate_base: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="form-group">
                <label>Fat Coefficient</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.rate_fat_coeff}
                  onChange={e => setForm({ ...form, rate_fat_coeff: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="form-group">
                <label>SNF Coefficient</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.rate_snf_coeff}
                  onChange={e => setForm({ ...form, rate_snf_coeff: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="form-group">
                <label>Test Fat / SNF</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" step="0.1" value={simFat} onChange={e => setSimFat(e.target.value)} aria-label="Simulator Fat" />
                  <input type="number" step="0.1" value={simSnf} onChange={e => setSimSnf(e.target.value)} aria-label="Simulator SNF" />
                </div>
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Rejection Payment Rule</label>
              <select
                value={form.rejection_payment_rule}
                onChange={e => setForm({ ...form, rejection_payment_rule: e.target.value as 'net' | 'gross' })}
              >
                <option value="net">NET quantity only (rejected milk not paid)</option>
                <option value="gross">GROSS quantity paid (track rejection loss separately)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Entry Edit Lock Window (hours)</label>
              <input
                type="number"
                min="1"
                max="168"
                value={form.edit_lock_hours}
                onChange={e => setForm({ ...form, edit_lock_hours: parseInt(e.target.value, 10) || 24 })}
              />
            </div>
          </div>

          <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="form-group">
              <label>Fat Min / Max / Benchmark (%)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" step="0.1" value={form.fat_min} onChange={e => setForm({ ...form, fat_min: parseFloat(e.target.value) || 3.5 })} />
                <input type="number" step="0.1" value={form.fat_max} onChange={e => setForm({ ...form, fat_max: parseFloat(e.target.value) || 8.5 })} />
                <input type="number" step="0.1" value={form.fat_benchmark} onChange={e => setForm({ ...form, fat_benchmark: parseFloat(e.target.value) || 4.0 })} />
              </div>
            </div>
            <div className="form-group">
              <label>SNF Min / Max / Benchmark (%)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" step="0.1" value={form.snf_min} onChange={e => setForm({ ...form, snf_min: parseFloat(e.target.value) || 8.0 })} />
                <input type="number" step="0.1" value={form.snf_max} onChange={e => setForm({ ...form, snf_max: parseFloat(e.target.value) || 9.5 })} />
                <input type="number" step="0.1" value={form.snf_benchmark} onChange={e => setForm({ ...form, snf_benchmark: parseFloat(e.target.value) || 8.2 })} />
              </div>
            </div>
            <div className="form-group">
              <label>Rejection Warning / Danger (%)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" step="0.5" value={form.rejection_warn_pct} onChange={e => setForm({ ...form, rejection_warn_pct: parseFloat(e.target.value) || 5 })} />
                <input type="number" step="0.5" value={form.rejection_danger_pct} onChange={e => setForm({ ...form, rejection_danger_pct: parseFloat(e.target.value) || 10 })} />
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Tanker Destinations <span className="hint">(comma-separated)</span></label>
              <input value={destText} onChange={e => setDestText(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Zone Taluks / Villages <span className="hint">(comma-separated)</span></label>
              <input value={locText} onChange={e => setLocText(e.target.value)} />
            </div>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.show_unit_profit}
              onChange={e => setForm({ ...form, show_unit_profit: e.target.checked })}
            />
            Allow Unit staff to view Est. Revenue &amp; Projected Profit / Loss
          </label>

          <button type="submit" disabled={savingSettings} className="btn-primary">
            {savingSettings ? 'Saving Settings…' : 'Save Zone Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
