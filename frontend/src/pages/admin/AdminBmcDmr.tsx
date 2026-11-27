import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedGet } from '../../lib/cachedGet';
import { getApiErrorMessage } from '../../lib/api';
import { getLocalTodayIso, triggerBlobDownload } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';

interface DmrRow {
  name: string; pending_qty: number;
  qty: number; lit_fat: number; lit_snf: number;
  ack_qty: number; ack_lit_fat: number; ack_lit_snf: number;
  diff_qty: number; diff_fat: number; diff_snf: number;
  kg30: number; kg30_lit: number; kg30_lit_fat: number; kg30_lit_snf: number;
  p032_fat: number; p032_snf: number; total_fat: number; total_snf: number;
  excess_fat: number; excess_snf: number;
}
interface DmrReport { rows: DmrRow[]; total: DmrRow }

type PeriodKey = '1-10' | '11-20' | '21-end' | 'custom';

const PERIODS: Array<{ key: Exclude<PeriodKey, 'custom'>; label: string }> = [
  { key: '1-10', label: '1 – 10' },
  { key: '11-20', label: '11 – 20' },
  { key: '21-end', label: '21 – end' },
];

const MAX_VIEW_DAYS = 31;
const MAX_DOWNLOAD_DAYS = 366;
const spanDays = (from: string, to: string) =>
  from && to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;

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

const GROUPS: Array<[string, number]> = [['DMR', 3], ['Acknowledgement', 3], ['Actual Diff', 3], ['Tanker Tender Norms', 8], ['Excess / Short', 2]];
const HEAD = ['QTY (L)', 'LIT FAT', 'LIT SNF', 'QTY (L)', 'LIT FAT', 'LIT SNF', 'QTY (L)', 'LIT FAT', 'LIT SNF', 'MILK KG', 'MILK LIT', 'LIT FAT', 'LIT SNF', '0.032 FAT', '0.032 SNF', 'TOTAL FAT', 'TOTAL SNF', 'LIT FAT', 'LIT SNF'];
const KEYS: Array<[keyof DmrRow, number]> = [
  ['qty', 0], ['lit_fat', 2], ['lit_snf', 2], ['ack_qty', 1], ['ack_lit_fat', 2], ['ack_lit_snf', 2],
  ['diff_qty', 1], ['diff_fat', 2], ['diff_snf', 2], ['kg30', 2], ['kg30_lit', 2], ['kg30_lit_fat', 2], ['kg30_lit_snf', 2],
  ['p032_fat', 2], ['p032_snf', 2], ['total_fat', 2], ['total_snf', 2], ['excess_fat', 2], ['excess_snf', 2],
];

const cell = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const, textAlign: 'right' as const };
const left = { ...cell, textAlign: 'left' as const };

export default function AdminBmcDmr() {
  const today = getLocalTodayIso();
  const [month, setMonth] = useState(() => previousMonth(today));
  const [period, setPeriod] = useState<PeriodKey>('1-10');
  const [customFrom, setCustomFrom] = useState(`${previousMonth(today)}-01`);
  const [customTo, setCustomTo] = useState(`${previousMonth(today)}-10`);
  const [report, setReport] = useState<DmrReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const range = useMemo(
    () => (period === 'custom' ? { from: customFrom, to: customTo } : periodRange(month, period)),
    [period, month, customFrom, customTo],
  );
  const span = spanDays(range.from, range.to);
  const invalid = !range.from || !range.to || range.from > range.to;
  const tooLongToView = !invalid && span > MAX_VIEW_DAYS;
  const tooLongToDownload = !invalid && span > MAX_DOWNLOAD_DAYS;

  const load = useCallback(async () => {
    if (invalid) return;
    if (tooLongToView) {
      setReport(null);
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await cachedGet<DmrReport>('/receipts/dmr', { from: range.from, to: range.to });
      setReport(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load the report.'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, invalid, tooLongToView]);

  useEffect(() => { void load(); }, [load]);

  const download = async (key: string, from: string, to: string) => {
    setBusy(key);
    setError('');
    try {
      await triggerBlobDownload('/receipts/dmr/xlsx', { from, to }, `BMC_DMR_Loss_${from}_to_${to}.xlsx`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not download the file.'));
    } finally {
      setBusy('');
    }
  };

  const input = { height: 32, padding: '2px 6px', fontSize: '0.85rem', borderRadius: 4, border: '1px solid #cbd5e1' };
  const pending = report?.total.pending_qty ?? 0;

  return (
    <Page>
      <PageHeader title="BMC DMR Loss Report" subtitle="Each BMC's sent and acknowledged milk for the period, the difference, the tender norms and the excess or short against them." />

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
              {busy === p.key ? 'Preparing…' : p.label}
            </button>
          );
        })}
        <button type="button" className="rp-pdf" disabled={!!busy || invalid || tooLongToDownload} onClick={() => void download('current', range.from, range.to)}>
          {busy === 'current' ? 'Preparing…' : 'This view'}
        </button>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Downloads can cover up to a year. The table below shows up to 31 days.</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {invalid && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>The From date must be on or before the To date.</p>}
      {tooLongToDownload && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Choose at most a year (366 days) at a time.</p>}
      {tooLongToView && !tooLongToDownload && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>This range is longer than 31 days, so the table is not shown. Use Download Excel above.</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && !error && !invalid && !tooLongToView && report && report.rows.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No BMC dispatches for {ddmmyyyy(range.from)} – {ddmmyyyy(range.to)}.</p>
      )}
      {!loading && pending > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmt(pending)} L sent in this period has not been acknowledged yet. It is in the DMR quantity but not in the difference or norms.</p>
      )}

      {!loading && report && report.rows.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--white)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ ...left, fontWeight: 600 }} rowSpan={2}>S.No</th>
                <th style={{ ...left, fontWeight: 600 }} rowSpan={2}>BMC</th>
                {GROUPS.map(([g, n]) => (
                  <th key={g} colSpan={n} style={{ ...cell, textAlign: 'center', fontWeight: 600 }}>{g}</th>
                ))}
              </tr>
              <tr style={{ background: 'var(--bg)' }}>
                {HEAD.map((h, i) => (
                  <th key={`${h}-${i}`} style={{ ...cell, fontWeight: 600, whiteSpace: 'normal' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.rows, report.total].map((r, idx) => {
                const isTotal = idx === report.rows.length;
                return (
                  <tr key={r.name} style={{ fontWeight: isTotal ? 700 : 400, background: isTotal ? 'var(--primary-light)' : undefined }}>
                    <td style={left}>{isTotal ? '' : idx + 1}</td>
                    <td style={left}>{r.name}</td>
                    {KEYS.map(([k, dp]) => {
                      const v = r[k] as number;
                      const neg = (k.startsWith('diff') || k.startsWith('excess')) && v < 0;
                      return <td key={k} style={{ ...cell, color: neg ? 'var(--danger)' : undefined }}>{fmt(v, dp)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!loading && report && report.rows.length > 0 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Excess / short = actual difference + tender norms (30 kg per tanker + 0.032%). A minus figure is a shortage beyond the norms.</p>
      )}
    </Page>
  );
}
