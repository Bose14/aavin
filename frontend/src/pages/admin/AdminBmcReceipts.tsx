import { useCallback, useEffect, useState } from 'react';
import { cachedGet } from '../../lib/cachedGet';
import { getApiErrorMessage } from '../../lib/api';
import { getLocalTodayIso, triggerBlobDownload } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';

interface ReceiptRow {
  sno: number | null;
  date: string;
  team: string;
  cc_code: number | null;
  name: string;
  capacity: number;
  ob: number;
  am: number;
  pm: number;
  total: number;
  to_send: number;
  cb: number;
  loaded: number;
  act_cb: number;
  diff: number;
  util: number;
  flag: '' | 'CB';
}
interface ReceiptDay { date: string; rows: ReceiptRow[]; total: ReceiptRow }

const nf = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const HEAD = ['S.NO', 'Date', 'Team', 'CC Code', 'BMC', 'Capacity (Lts)', 'O/B', 'AM', 'PM', 'Total', 'To be sent', 'C/B (book)', 'Loaded Qty', 'ACT-CB', 'Diff', 'Cap. %', ''];

const cell = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const, textAlign: 'right' as const };
const left = { ...cell, textAlign: 'left' as const };

export default function AdminBmcReceipts() {
  const today = getLocalTodayIso();
  const [from, setFrom] = useState(() => addDays(today, -6));
  const [to, setTo] = useState(today);
  const [days, setDays] = useState<ReceiptDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const invalid = !from || !to || from > to;

  const load = useCallback(async () => {
    if (invalid) return;
    setLoading(true);
    setError('');
    try {
      const res = await cachedGet<{ days: ReceiptDay[] }>('/receipts/bmc', { from, to });
      setDays(res.data.days ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the report.'));
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, invalid]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      await triggerBlobDownload('/receipts/bmc/xlsx', { from, to }, `BMC_Receipts_${from}_to_${to}.xlsx`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not download the file.'));
    } finally {
      setDownloading(false);
    }
  };

  const input = { height: 32, padding: '2px 6px', fontSize: '0.85rem', borderRadius: 4, border: '1px solid #cbd5e1' };

  return (
    <Page>
      <PageHeader title="BMC Receipts" subtitle="Milk collected (AM / PM), what the tanker took and the balance left at each BMC, day by day." />

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', margin: '12px 0' }}>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          From
          <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} style={input} />
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          To
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} style={input} />
        </label>
        <button type="button" className="rp-pdf" onClick={download} disabled={invalid || downloading || loading}>
          {downloading ? 'Preparing…' : 'Download Excel'}
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Up to 62 days at a time.</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {invalid && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>The From date must be on or before the To date.</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && !error && !invalid && days.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No BMCs with a CC code to report.</p>}

      {!loading && days.map((day) => (
        <section key={day.date} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 6px' }}>{ddmmyyyy(day.date)}</h3>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--white)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  {HEAD.map((h, i) => (
                    <th key={i} style={{ ...cell, textAlign: i >= 5 ? 'right' : 'left', fontWeight: 600, whiteSpace: 'normal' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...day.rows, day.total].map((r) => {
                  const isTotal = r.name === 'TOTAL';
                  const flagged = r.flag === 'CB';
                  return (
                    <tr key={`${r.date}-${r.cc_code ?? 'total'}`} style={{ fontWeight: isTotal ? 700 : 400, background: isTotal ? 'var(--primary-light)' : flagged ? '#fef2f2' : undefined }}>
                      <td style={left}>{r.sno ?? ''}</td>
                      <td style={left}>{ddmmyyyy(r.date)}</td>
                      <td style={left}>{r.team}</td>
                      <td style={left}>{r.cc_code ?? ''}</td>
                      <td style={left}>{r.name}</td>
                      <td style={cell}>{nf(r.capacity)}</td>
                      <td style={cell}>{nf(r.ob)}</td>
                      <td style={cell}>{nf(r.am)}</td>
                      <td style={cell}>{nf(r.pm)}</td>
                      <td style={cell}>{nf(r.total)}</td>
                      <td style={cell}>{nf(r.to_send)}</td>
                      <td style={cell}>{nf(r.cb)}</td>
                      <td style={cell}>{nf(r.loaded)}</td>
                      <td style={cell}>{nf(r.act_cb)}</td>
                      <td style={{ ...cell, color: r.diff !== 0 ? 'var(--danger)' : undefined }}>{nf(r.diff)}</td>
                      <td style={cell}>{r.util}</td>
                      <td style={{ ...cell, color: 'var(--danger)', fontWeight: 700 }}>{r.flag}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </Page>
  );
}
