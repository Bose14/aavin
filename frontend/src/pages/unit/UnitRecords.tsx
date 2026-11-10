import { useState, useEffect } from 'react';
import api from '../../lib/api';

interface MilkEntry {
  id: string; date: string; shift: string; fat_pct: number; snf_pct: number;
  quantity_litres: number; rejection_qty: number; rate_per_litre: number; temperature: number | null;
}

interface TankerRecord {
  id: string; date: string; tanker_number: string; quantity_dispatched: number; destination: string | null;
}

export default function UnitRecords() {
  const [tab, setTab] = useState<'milk' | 'tanker'>('milk');
  const [milk, setMilk] = useState<MilkEntry[]>([]);
  const [tanker, setTanker] = useState<TankerRecord[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString() ? `?${params}` : '';
    const [m, t] = await Promise.all([
      api.get(`/milk${qs}`),
      api.get(`/tanker${qs}`),
    ]);
    setMilk(m.data);
    setTanker(t.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const exportData = (type: 'milk' | 'tanker', format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ format });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    // Direct download via link (token is handled by bearer — use a form POST approach via anchor)
    window.open(`${import.meta.env.VITE_API_URL}/export/${type}?${params}`, '_blank');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Records</h1>
        <div className="header-actions">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={load} className="btn-secondary">Filter</button>
          <button onClick={() => exportData(tab, 'xlsx')} className="btn-secondary">Export Excel</button>
          <button onClick={() => exportData(tab, 'csv')} className="btn-secondary">Export CSV</button>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === 'milk' ? 'active' : ''}`} onClick={() => setTab('milk')}>Milk Entries</button>
        <button className={`tab ${tab === 'tanker' ? 'active' : ''}`} onClick={() => setTab('tanker')}>Tanker Dispatches</button>
      </div>

      {loading ? <p className="loading-text">Loading…</p> : tab === 'milk' ? (
        <div className="card table-card">
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Shift</th><th>Fat %</th><th>SNF %</th>
              <th>Qty (L)</th><th>Rejection (L)</th><th>Temp (°C)</th><th>Rate (₹/L)</th>
            </tr></thead>
            <tbody>
              {milk.length === 0 ? <tr><td colSpan={8} className="empty">No records found</td></tr>
                : milk.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td><span className={`badge ${r.shift}`}>{r.shift}</span></td>
                    <td>{r.fat_pct}</td><td>{r.snf_pct}</td>
                    <td>{r.quantity_litres}</td><td>{r.rejection_qty}</td>
                    <td>{r.temperature ?? '—'}</td><td>₹{r.rate_per_litre}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-card">
          <table className="data-table">
            <thead><tr>
              <th>Date</th><th>Tanker No.</th><th>Qty Dispatched (L)</th><th>Destination</th>
            </tr></thead>
            <tbody>
              {tanker.length === 0 ? <tr><td colSpan={4} className="empty">No records found</td></tr>
                : tanker.map(r => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td>{r.tanker_number}</td>
                    <td>{r.quantity_dispatched}</td><td>{r.destination ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
