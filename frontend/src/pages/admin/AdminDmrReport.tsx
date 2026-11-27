import { useCallback, useEffect, useMemo, useState } from 'react';
import { cachedGet } from '../../lib/cachedGet';
import { getApiErrorMessage } from '../../lib/api';
import { getLocalTodayIso, triggerBlobDownload } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';
import { MAX_DOWNLOAD_DAYS, MAX_VIEW_DAYS, PERIODS, periodRange, previousMonth, spanDays } from '../../lib/reportPeriods';
import type { PeriodKey } from '../../lib/reportPeriods';

interface DmrRow {
  team: string; code: number | null; name: string;
  qty: number; lit_fat: number; lit_snf: number; fat_pct: number; snf_pct: number; sg: number;
  kg: number; kg_fat: number; kg_snf: number;
  inv_qty: number; inv_lit_fat: number; inv_lit_snf: number; inv_fat_pct: number; inv_snf_pct: number;
  diff_qty: number; diff_fat: number; diff_snf: number; estimated_qty: number;
}
interface DmrReport { rows: DmrRow[]; total: DmrRow }

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmt = (v: number | null, dp = 0) => (v == null ? '' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp }));

const GROUPS: Array<[string, number]> = [['DMR', 9], ['INVOICE / Spt.Ack', 5], ['DIFF', 3]];
const HEAD = ['QTY LIT', 'FAT LIT', 'SNF LIT', 'FAT%', 'SNF%', 'SP.G', 'QTY KG', 'FAT KG', 'SNF KG', 'QTY LIT', 'FAT LIT', 'SNF LIT', 'FAT%', 'SNF%', 'QTY LIT', 'FAT LIT', 'SNF LIT'];
const KEYS: Array<[keyof DmrRow, number]> = [
  ['qty', 0], ['lit_fat', 3], ['lit_snf', 3], ['fat_pct', 2], ['snf_pct', 2], ['sg', 4], ['kg', 1], ['kg_fat', 3], ['kg_snf', 3],
  ['inv_qty', 0], ['inv_lit_fat', 3], ['inv_lit_snf', 3], ['inv_fat_pct', 2], ['inv_snf_pct', 2],
  ['diff_qty', 0], ['diff_fat', 2], ['diff_snf', 2],
];

const cell = { padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' as const, textAlign: 'right' as const };
const left = { ...cell, textAlign: 'left' as const };

export default function AdminDmrReport() {
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
      const res = await cachedGet<DmrReport>('/receipts/dmr-sheet', { from: range.from, to: range.to });
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
      await triggerBlobDownload('/receipts/dmr-sheet/xlsx', { from, to }, `DMR_${from}_to_${to}.xlsx`);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not download the file.'));
    } finally {
      setBusy('');
    }
  };

  const input = { height: 32, padding: '2px 6px', fontSize: '0.85rem', borderRadius: 4, border: '1px solid #cbd5e1' };
  const estimated = report?.total.estimated_qty ?? 0;

  return (
    <Page>
      <PageHeader title="DMR Report" subtitle="Each BMC's DMR fat and SNF next to the invoice / spot acknowledgement figures, and the difference." />

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
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Downloads can cover up to a year. The table below shows up to 31 days (not shown for Full year).</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {invalid && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>The From date must be on or before the To date.</p>}
      {tooLongToDownload && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Choose at most a year (366 days) at a time.</p>}
      {tooLongToView && !tooLongToDownload && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>This range is longer than 31 days, so the table is not shown. Use Download Excel above.</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {!loading && !error && !invalid && !tooLongToView && report && report.rows.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No BMC dispatches for {ddmmyyyy(range.from)} – {ddmmyyyy(range.to)}.</p>
      )}
      {!loading && estimated > 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmt(estimated)} L in this period has no BMC fat/SNF record yet, so the invoice figures are used for it (no difference).</p>
      )}

      {!loading && report && report.rows.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--white)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ ...left, fontWeight: 600 }} rowSpan={2}>S.No</th>
                <th style={{ ...left, fontWeight: 600 }} rowSpan={2}>Team</th>
                <th style={{ ...left, fontWeight: 600 }} rowSpan={2}>Code</th>
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
                  <tr key={`${r.code ?? ''}-${r.name}`} style={{ fontWeight: isTotal ? 700 : 400, background: isTotal ? 'var(--primary-light)' : undefined }}>
                    <td style={left}>{isTotal ? '' : idx + 1}</td>
                    <td style={left}>{r.team}</td>
                    <td style={left}>{r.code ?? ''}</td>
                    <td style={left}>{r.name}</td>
                    {KEYS.map(([k, dp]) => {
                      const v = r[k] as number;
                      const neg = (k.startsWith('diff')) && v < 0;
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
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Diff = invoice / spot acknowledgement minus DMR. SP.G = 1 + 4 x (SNF - 0.2 x Fat - 0.36) / 1000, and kg = litres x SP.G.</p>
      )}
    </Page>
  );
}
