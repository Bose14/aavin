import { useCallback, useEffect, useState } from 'react';
import api, { getApiErrorMessage } from '../../lib/api';
import { getLocalTodayIso } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';

interface Norm { id: number; effective_from: string; kg_per_tanker: number; pct: number }

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const cell = { padding: '6px 10px', borderBottom: '1px solid var(--border)', textAlign: 'left' as const };
const input = { height: 32, padding: '2px 6px', fontSize: '0.85rem', borderRadius: 4, border: '1px solid #cbd5e1' };

export default function AdminNorms() {
  const today = getLocalTodayIso();
  const [norms, setNorms] = useState<Norm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(today);
  const [kg, setKg] = useState('30');
  const [pct, setPct] = useState('0.032');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ norms: Norm[] }>('/receipts/norms');
      setNorms(res.data.norms);
      const latest = res.data.norms[0];
      if (latest) { setKg(String(latest.kg_per_tanker)); setPct(String(latest.pct)); }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the norms.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.post<{ norms: Norm[] }>('/receipts/norms', { effective_from: from, kg_per_tanker: Number(kg), pct: Number(pct) });
      setNorms(res.data.norms);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save the norms.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: Norm) => {
    if (!window.confirm(`Remove the norms effective from ${ddmmyyyy(n.effective_from)}?`)) return;
    setError('');
    try {
      const res = await api.delete<{ norms: Norm[] }>(`/receipts/norms/${n.id}`);
      setNorms(res.data.norms);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not remove the norms.'));
    }
  };

  const valid = Boolean(from) && kg !== '' && pct !== '' && Number(kg) >= 0 && Number(pct) >= 0;

  return (
    <Page>
      <PageHeader title="Norms" subtitle="Allowed transit loss used by the Milk Ack and BMC DMR Loss reports: kg of milk per tanker (shared by litres) plus a percentage of the litres sent." />
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Effective from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Kg per tanker
          <input type="number" min={0} step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} style={{ ...input, width: 110 }} />
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Percentage of litres sent (%)
          <input type="number" min={0} step="0.001" value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...input, width: 140 }} />
        </label>
        <button type="button" className="rp-pdf" disabled={saving || !valid} onClick={() => void save()}>{saving ? 'Saving…' : 'Save norms'}</button>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 12px' }}>
        New norms apply to reports from the effective date onwards; earlier dates keep the norms they had. Saving on a date that already has norms replaces them.
      </p>

      {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--white)', maxWidth: 560 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={cell}>Effective from</th><th style={cell}>Kg per tanker</th><th style={cell}>Percentage (%)</th><th style={cell} />
              </tr>
            </thead>
            <tbody>
              {norms.map((n) => (
                <tr key={n.id}>
                  <td style={cell}>{n.effective_from <= '2000-01-01' ? 'Start (default)' : ddmmyyyy(n.effective_from)}</td>
                  <td style={cell}>{n.kg_per_tanker}</td>
                  <td style={cell}>{n.pct}</td>
                  <td style={cell}>{norms.length > 1 && <button type="button" className="rp-pdf" onClick={() => void remove(n)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
