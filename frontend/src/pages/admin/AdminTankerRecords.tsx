import { useState, useEffect } from 'react';
import api from '../../lib/api';

interface TankerRecord {
  id: string; date: string; tanker_number: string; quantity_dispatched: number;
  destination: string | null; units: { name: string; unit_code: string } | null;
}
interface Unit { id: string; name: string; }

export default function AdminTankerRecords() {
  const [records, setRecords] = useState<TankerRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    const p = new URLSearchParams();
    if (unitId) p.set('unit_id', unitId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api.get(`/tanker${p.toString() ? `?${p}` : ''}`).then(r => setRecords(r.data));
  };

  useEffect(() => { api.get('/units').then(r => setUnits(r.data)); load(); }, []);

  const exportData = (fmt: string) => {
    const p = new URLSearchParams({ format: fmt });
    if (unitId) p.set('unit_id', unitId);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    window.open(`${import.meta.env.VITE_API_URL}/export/tanker?${p}`, '_blank');
  };

  const total = records.reduce((s, r) => s + Number(r.quantity_dispatched), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tanker Records</h1>
          {records.length > 0 && <p className="page-subtitle">Total dispatched: <strong>{total.toFixed(2)} L</strong></p>}
        </div>
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
            <th>Date</th><th>Unit</th><th>Tanker No.</th><th>Qty Dispatched (L)</th><th>Destination</th>
          </tr></thead>
          <tbody>
            {records.map(r => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.units?.name} <span className="unit-code">{r.units?.unit_code}</span></td>
                <td>{r.tanker_number}</td>
                <td>{r.quantity_dispatched}</td>
                <td>{r.destination ?? '—'}</td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={5} className="empty">No records</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
