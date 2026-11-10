import { useState, useEffect } from 'react';
import api from '../../lib/api';

interface MilkEntry {
  id: string; date: string; shift: string; fat_pct: number; snf_pct: number;
  quantity_litres: number; rejection_qty: number; rate_per_litre: number;
  units: { name: string; unit_code: string } | null;
}
interface Unit { id: string; name: string; }

export default function AdminMilkRecords() {
  const [records, setRecords] = useState<MilkEntry[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    const p = new URLSearchParams();
    if (unitId) p.set('unit_id', unitId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api.get(`/milk${p.toString() ? `?${p}` : ''}`).then(r => setRecords(r.data));
  };

  useEffect(() => { api.get('/units').then(r => setUnits(r.data)); load(); }, []);

  const exportData = (fmt: string) => {
    const p = new URLSearchParams({ format: fmt });
    if (unitId) p.set('unit_id', unitId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    window.open(`${import.meta.env.VITE_API_URL}/export/milk?${p}`, '_blank');
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Milk Records</h1>
        <div className="header-actions">
          <select value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">All Units</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
          <button onClick={load} className="btn-secondary">Filter</button>
          <button onClick={() => exportData('xlsx')} className="btn-secondary">Excel</button>
          <button onClick={() => exportData('csv')} className="btn-secondary">CSV</button>
        </div>
      </div>
      <div className="card table-card">
        <table className="data-table">
          <thead><tr>
            <th>Date</th><th>Unit</th><th>Shift</th><th>Fat %</th><th>SNF %</th>
            <th>Qty (L)</th><th>Rejection (L)</th><th>Rate (₹/L)</th>
          </tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.units?.name} <span className="unit-code">{r.units?.unit_code}</span></td>
                <td><span className={`badge ${r.shift}`}>{r.shift}</span></td>
                <td>{r.fat_pct}</td><td>{r.snf_pct}</td>
                <td>{r.quantity_litres}</td><td>{r.rejection_qty}</td>
                <td>₹{r.rate_per_litre}</td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={8} className="empty">No records</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
