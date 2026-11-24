import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { getLocalTodayIso } from '../../lib/format';
import { ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface BmcOption { id: string; name: string; kind?: string }
interface Entry {
  id: string;
  bmc_id: string;
  date: string;
  shift: 'AM' | 'PM';
  quantity_litres: number;
  fat_pct: number;
  snf_pct: number;
  bmcs?: { name: string } | null;
}

const PAGE_SIZES = [25, 50, 100];
const nf = (v: number, d = 2) => v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const trim = (v: number) => String(Math.round(v * 100) / 100);

export default function AdminBmcReport() {
  const { profile } = useAuth();
  const unitName = profile?.dairy_units?.name ?? 'Dairy unit';

  const [bmcs, setBmcs] = useState<BmcOption[]>([]);
  const [bmcId, setBmcId] = useState('');
  const [date, setDate] = useState(getLocalTodayIso());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.get<BmcOption[]>('/bmcs')
      .then(res => setBmcs((res.data || []).filter(b => (b.kind ?? 'BMC') === 'BMC')))
      .catch(() => setError('Could not load BMCs.'));
  }, []);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get<Entry[]>('/milk', { params: { from: date, to: date, ...(bmcId ? { bmc_id: bmcId } : {}) } });
      setEntries(res.data || []);
    } catch {
      setError('Could not load the report.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [date, bmcId]);

  useEffect(() => { void load(); setPage(1); }, [load]);

  const rows = useMemo(
    () => [...entries]
      .map(e => {
        const litres = Number(e.quantity_litres);
        return {
          id: e.id,
          bmc: e.bmcs?.name ?? '—',
          shift: e.shift,
          litres,
          fat: Number(e.fat_pct),
          snf: Number(e.snf_pct),
          ltFat: (litres * Number(e.fat_pct)) / 100,
          ltSnf: (litres * Number(e.snf_pct)) / 100,
        };
      })
      .sort((a, b) => a.bmc.localeCompare(b.bmc) || (a.shift === b.shift ? 0 : a.shift === 'AM' ? -1 : 1)),
    [entries],
  );

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  const sum = (list: typeof rows) => ({
    litres: list.reduce((s, r) => s + r.litres, 0),
    ltFat: list.reduce((s, r) => s + r.ltFat, 0),
    ltSnf: list.reduce((s, r) => s + r.ltSnf, 0),
  });
  const pageTotal = sum(shown);
  const netTotal = sum(rows);
  const avg = (t: { litres: number; ltFat: number; ltSnf: number }) =>
    t.litres > 0 ? { fat: (t.ltFat / t.litres) * 100, snf: (t.ltSnf / t.litres) * 100 } : null;

  const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'right', fontWeight: 700, borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '10px 12px', textAlign: 'right', borderBottom: '1px solid #eef2f7', borderRight: '1px solid #eef2f7', whiteSpace: 'nowrap' };
  const tl: React.CSSProperties = { textAlign: 'left' };

  return (
    <div className="page">
      <div className="page-header"><h1>Detailed BMC Report</h1></div>

      <div className="bmcr-filters">
        <label>
          <span>Select Union</span>
          <select value="unit" disabled><option value="unit">{unitName}</option></select>
        </label>
        <label>
          <span>Select BMC</span>
          <select value={bmcId} onChange={e => setBmcId(e.target.value)}>
            <option value="">-- All --</option>
            {bmcs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label>
          <span>Select Date</span>
          <input type="date" value={date} max={getLocalTodayIso()} onChange={e => setDate(e.target.value)} />
        </label>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : (
        <div className="bmcr-wrap">
          <table className="bmcr-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92rem' }}>
            <thead>
              <tr>
                <th style={{ ...th, ...tl }}>BMC</th>
                <th style={{ ...th, textAlign: 'center' }}>Shift</th>
                <th style={th}>Litres</th>
                <th style={th}>Fat %</th>
                <th style={th}>SNF %</th>
                <th style={th}>Lt Fat</th>
                <th style={th}>Lt SNF</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={7} style={{ ...td, ...tl, textAlign: 'center', padding: 28, color: '#64748b' }}>No milk entries for this date.</td></tr>
              )}
              {shown.map(r => (
                <tr key={r.id}>
                  <td style={{ ...td, ...tl }}>{r.bmc}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <StatusBadge tone={r.shift === 'AM' ? 'green' : 'amber'}>{r.shift === 'AM' ? 'Morning' : 'Evening'}</StatusBadge>
                  </td>
                  <td style={td}>{nf(r.litres)}</td>
                  <td style={td}>{trim(r.fat)}</td>
                  <td style={td}>{trim(r.snf)}</td>
                  <td style={td}>{nf(r.ltFat)}</td>
                  <td style={td}>{nf(r.ltSnf)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[{ label: 'Page Total', t: pageTotal }, { label: 'Net Total', t: netTotal }].map(({ label, t }) => {
                const a = avg(t);
                return (
                  <tr key={label} style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td colSpan={2} style={{ ...td, background: '#f8fafc' }}>{label}</td>
                    <td style={{ ...td, background: '#f8fafc' }}>{nf(t.litres)}</td>
                    <td style={{ ...td, background: '#f8fafc' }}>{a ? trim(a.fat) : '–'}</td>
                    <td style={{ ...td, background: '#f8fafc' }}>{a ? trim(a.snf) : '–'}</td>
                    <td style={{ ...td, background: '#f8fafc' }}>{nf(t.ltFat)}</td>
                    <td style={{ ...td, background: '#f8fafc' }}>{nf(t.ltSnf)}</td>
                  </tr>
                );
              })}
            </tfoot>
          </table>
        </div>
      )}

      <div className="bmcr-pager">
        <div className="bmcr-pager-nav">
          <button type="button" disabled={current <= 1} onClick={() => setPage(1)} aria-label="First page">«</button>
          <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page">‹</button>
          <span>Go to:</span>
          <input type="number" min={1} max={pages} value={current} onChange={e => setPage(Math.min(pages, Math.max(1, Number(e.target.value) || 1)))} />
          <span>/ {pages}</span>
          <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page">›</button>
          <button type="button" disabled={current >= pages} onClick={() => setPage(pages)} aria-label="Last page">»</button>
        </div>
        <label className="bmcr-show">
          <span>Show</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="bmcr-count">
          {rows.length === 0 ? 'No records' : `Showing ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, rows.length)} of ${rows.length} records`}
        </span>
      </div>
    </div>
  );
}
