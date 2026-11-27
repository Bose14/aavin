import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedGet } from '../../lib/cachedGet';
import { getApiErrorMessage } from '../../lib/api';
import { getLocalTodayIso, triggerBlobDownload } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';

interface AckRow {
  is_total: boolean;
  date: string;
  shift: string;
  route: string;
  code: number | null;
  name: string;
  tanker: string;
  inv_no: string;
  qty: number; fat: number; snf: number; kg: number;
  acked: boolean;
  ack_qty: number | null; ack_fat: number | null; ack_snf: number | null; ack_kg: number | null;
  qty_diff: number | null; diff_fat_kg: number | null; diff_snf_kg: number | null;
  loss_fat: number | null; loss_snf: number | null;
}
interface AckDay { date: string; rows: AckRow[] }

type PeriodKey = '1-10' | '11-20' | '21-end' | 'custom';

const PERIODS: Array<{ key: Exclude<PeriodKey, 'custom'>; label: string }> = [
  { key: '1-10', label: '1 – 10' },
  { key: '11-20', label: '11 – 20' },
  { key: '21-end', label: '21 – end' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const periodRange = (month: string, key: Exclude<PeriodKey, 'custom'>) => {
  if (key === '1-10') return { from: `${month}-01`, to: `${month}-10` };
  if (key === '11-20') return { from: `${month}-11`, to: `${month}-20` };
  return { from: `${month}-21`, to: `${month}-${pad(lastDay(month))}` };
};
const previousMonth = (today: string) => {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
};

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmt = (v: number | null, dp = 0) => (v == null ? '' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

const HEAD = ['Shift', 'Route', 'Code', 'BMC / CC', 'Tanker', 'Inv no.', 'Sent L', 'Fat %', 'SNF %', 'Sent kg', 'Ack L', 'Ack Fat %', 'Ack SNF %', 'Ack kg', 'Qty diff L', 'Fat diff kg', 'SNF diff kg', 'Net loss Fat', 'Net loss SNF'];

const cell = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const, textAlign: 'right' as const };
const left = { ...cell, textAlign: 'left' as const };

export default function AdminMilkAck() {
  const today = getLocalTodayIso();
  const [month, setMonth] = useState(() => previousMonth(today));
  const [period, setPeriod] = useState<PeriodKey>('1-10');
  const [customFrom, setCustomFrom] = useState(`${previousMonth(today)}-01`);
  const [customTo, setCustomTo] = useState(`${previousMonth(today)}-10`);
  const [days, setDays] = useState<AckDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const range = useMemo(
    () => (period === 'custom' ? { from: customFrom, to: customTo } : periodRange(month, period)),
    [period, month, customFrom, customTo],
  );
  const invalid = !range.from || !range.to || range.from > range.to;

  const load = useCallback(async () => {
    if (invalid) return;
    setLoading(true);
    setError('');
    try {
      const res = await cachedGet<{ days: AckDay[] }>('/receipts/ack', { from: range.from, to: range.to });
      setDays(res.data.days ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the report.'));
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, invalid]);

  useEffect(() => { void load(); }, [load]);

  const download = async (key: string, from: string, to: string) => {
    setBusy(key);
    setError('');
    try {
      await triggerBlobDownload('/receipts/ack/xlsx', { from, to }, `Milk_Ack_${from}_to_${to}.xlsx`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not download the file.'));
    } finally {
      setBusy('');
    }
  };

  const input = { height: 32, padding: '2px 6px', fontSize: '0.85rem', borderRadius: 4, border: '1px solid #cbd5e1' };

  return (
    <Page>
      <PageHeader title="Milk Ack Report" subtitle="What each BMC sent on the tanker, what the union acknowledged, and the loss against the allowed norms." />

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', margin: '12px 0 8px' }}>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Month
          <input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} style={input} />
        </label>
        {PERIODS.map((p) => (
          <button key={p.key} type="button" className={`rp-chip${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
        <button type="button" className={`rp-chip${period === 'custom' ? ' active' : ''}`} onClick={() => setPeriod('custom')}>Custom</button>
        {period === 'custom' && (
          <>
            <input type="date" value={customFrom} max={customTo || today} onChange={(e) => setCustomFrom(e.target.value)} style={input} aria-label="From" />
            <input type="date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} style={input} aria-label="To" />
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 12px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Download Excel:</span>
        {PERIODS.map((p) => {
          const r = periodRange(month, p.key);
          return (
            <button key={p.key} type="button" className="rp-pdf" disabled={!!busy} onClick={() => void download(p.key, r.from, r.to)}>
              {busy === p.key ? 'Preparing…' : `${p.label}`}
            </button>
          );
        })}
        <button type="button" className="rp-pdf" disabled={!!busy || invalid} onClick={() => void download('current', range.from, range.to)}>
          {busy === 'current' ? 'Preparing…' : 'This view'}
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Custom range up to 62 days.</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {invalid && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>The From date must be on or before the To date.</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && !error && !invalid && days.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No tanker dispatches for {ddmmyyyy(range.from)} – {ddmmyyyy(range.to)}.</p>}

      {!loading && days.map((day) => (
        <section key={day.date} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 6px' }}>{ddmmyyyy(day.date)}</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--white)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {HEAD.map((h, i) => (
                    <th key={h} style={{ ...cell, textAlign: i >= 6 ? 'right' : 'left', fontWeight: 600, whiteSpace: 'normal' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {day.rows.map((r, idx) => (
                  <tr key={`${r.date}-${idx}`} style={{ fontWeight: r.is_total ? 700 : 400, background: r.is_total ? 'var(--primary-light)' : undefined }}>
                    <td style={left}>{r.shift}</td>
                    <td style={left}>{r.route}</td>
                    <td style={left}>{r.code ?? ''}</td>
                    <td style={left}>{r.name}</td>
                    <td style={left}>{r.tanker}</td>
                    <td style={left}>{r.inv_no}</td>
                    <td style={cell}>{fmt(r.qty)}</td>
                    <td style={cell}>{fmt(r.fat, 2)}</td>
                    <td style={cell}>{fmt(r.snf, 2)}</td>
                    <td style={cell}>{fmt(r.kg)}</td>
                    <td style={cell}>{fmt(r.ack_qty)}</td>
                    <td style={cell}>{fmt(r.ack_fat, 2)}</td>
                    <td style={cell}>{fmt(r.ack_snf, 2)}</td>
                    <td style={cell}>{fmt(r.ack_kg)}</td>
                    <td style={{ ...cell, color: (r.qty_diff ?? 0) < 0 ? 'var(--danger)' : undefined }}>{fmt(r.qty_diff, 1)}</td>
                    <td style={cell}>{fmt(r.diff_fat_kg, 1)}</td>
                    <td style={cell}>{fmt(r.diff_snf_kg, 1)}</td>
                    <td style={{ ...cell, color: (r.loss_fat ?? 0) < 0 ? 'var(--danger)' : undefined }}>{fmt(r.loss_fat, 1)}</td>
                    <td style={{ ...cell, color: (r.loss_snf ?? 0) < 0 ? 'var(--danger)' : undefined }}>{fmt(r.loss_snf, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!loading && days.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>The Excel file carries every column of the MILK ACK sheet (kg, specific gravity, norms and loss).</p>
      )}
    </Page>
  );
}
