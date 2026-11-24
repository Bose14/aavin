import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { getLocalTodayIso } from '../../lib/format';
import { ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';

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

interface Row { id: string; bmc: string; shift: 'AM' | 'PM'; litres: number; fat: number; snf: number; ltFat: number; ltSnf: number }
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

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<Row[]>(
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

  const sum = (list: typeof rows) => ({
    litres: list.reduce((acc, r) => acc + r.litres, 0),
    ltFat: list.reduce((acc, r) => acc + r.ltFat, 0),
    ltSnf: list.reduce((acc, r) => acc + r.ltSnf, 0),
  });
  const net = sum(rows);
  const avg = (t: { litres: number; ltFat: number; ltSnf: number }) =>
    t.litres > 0 ? { fat: (t.ltFat / t.litres) * 100, snf: (t.ltSnf / t.litres) * 100 } : null;
  const netAvg = avg(net);

  const columns: DataColumn<Row>[] = [
    { key: 'bmc', header: 'BMC', render: r => r.bmc, sortValue: r => r.bmc, footerCell: <strong>Net Total</strong>, pageFooterCell: () => <strong>Page Total</strong> },
    {
      key: 'shift', header: 'Shift', align: 'center', sortValue: r => r.shift,
      render: r => <StatusBadge tone={r.shift === 'AM' ? 'green' : 'amber'}>{r.shift === 'AM' ? 'Morning' : 'Evening'}</StatusBadge>,
    },
    { key: 'litres', header: 'Litres', align: 'right', sortValue: r => r.litres, render: r => nf(r.litres), footerCell: <strong>{nf(net.litres)}</strong>, pageFooterCell: p => <strong>{nf(sum(p as Row[]).litres)}</strong> },
    { key: 'fat', header: 'Fat %', align: 'right', sortValue: r => r.fat, render: r => trim(r.fat), footerCell: <strong>{netAvg ? trim(netAvg.fat) : '–'}</strong>, pageFooterCell: p => { const a = avg(sum(p as Row[])); return <strong>{a ? trim(a.fat) : '–'}</strong>; } },
    { key: 'snf', header: 'SNF %', align: 'right', sortValue: r => r.snf, render: r => trim(r.snf), footerCell: <strong>{netAvg ? trim(netAvg.snf) : '–'}</strong>, pageFooterCell: p => { const a = avg(sum(p as Row[])); return <strong>{a ? trim(a.snf) : '–'}</strong>; } },
    { key: 'ltFat', header: 'Lt Fat', align: 'right', sortValue: r => r.ltFat, render: r => nf(r.ltFat), footerCell: <strong>{nf(net.ltFat)}</strong>, pageFooterCell: p => <strong>{nf(sum(p as Row[]).ltFat)}</strong> },
    { key: 'ltSnf', header: 'Lt SNF', align: 'right', sortValue: r => r.ltSnf, render: r => nf(r.ltSnf), footerCell: <strong>{nf(net.ltSnf)}</strong>, pageFooterCell: p => <strong>{nf(sum(p as Row[]).ltSnf)}</strong> },
  ];

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
        <DataTable
          rows={rows}
          columns={columns}
          getRowKey={r => r.id}
          searchable={false}
          pageSize={100}
          pageSizeOptions={[25, 50, 100]}
          showTotalsRow
          emptyMessage="No milk entries for this date."
        />
      )}
    </div>
  );
}
