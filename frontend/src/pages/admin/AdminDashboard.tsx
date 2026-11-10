import { useState, useEffect } from 'react';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

interface UnitStat {
  unit_id: string; name: string; unit_code: string;
  quantity: number; net_quantity: number; rejection: number;
  avg_fat: number; avg_snf: number; revenue: number; cost: number; profit: number;
}

interface TrendPoint {
  date: string; quantity: number; net_quantity: number; profit: number; avg_fat: number; avg_snf: number;
}

interface Summary {
  current: { quantity: number; net_quantity: number; rejection: number; avg_fat: number; avg_snf: number; revenue: number; cost: number; profit: number };
  previous: { quantity: number; profit: number };
}

const PERIODS = ['week', 'month', 'year'] as const;

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className={`stat-sub ${positive === true ? 'up' : positive === false ? 'down' : ''}`}>{sub}</p>}
    </div>
  );
}

function pct(curr: number, prev: number) {
  if (!prev) return null;
  const change = ((curr - prev) / prev * 100).toFixed(1);
  return `${curr >= prev ? '▲' : '▼'} ${Math.abs(parseFloat(change))}% vs last period`;
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [unitStats, setUnitStats] = useState<UnitStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/analytics/summary?period=${period}`),
      api.get(`/analytics/trend?period=${period}`),
      api.get('/analytics/units'),
    ]).then(([s, t, u]) => {
      setSummary(s.data);
      setTrend(t.data);
      setUnitStats(u.data);
    }).finally(() => setLoading(false));
  }, [period]);

  const c = summary?.current;
  const p = summary?.previous;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Admin Dashboard</h1>
          <p className="page-subtitle">Zone overview — {profile?.full_name}</p>
        </div>
        <div className="period-tabs">
          {PERIODS.map(per => (
            <button key={per} className={`tab ${period === per ? 'active' : ''}`} onClick={() => setPeriod(per)}>
              {per.charAt(0).toUpperCase() + per.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? <div className="loading">Loading…</div> : (
        <>
          <div className="stats-grid">
            <StatCard label="Total Collected" value={`${c?.quantity ?? 0} L`} sub={pct(c?.quantity ?? 0, p?.quantity ?? 0) ?? undefined} positive={(c?.quantity ?? 0) >= (p?.quantity ?? 0)} />
            <StatCard label="Net Quantity" value={`${c?.net_quantity ?? 0} L`} />
            <StatCard label="Avg Fat %" value={`${c?.avg_fat ?? 0}%`} />
            <StatCard label="Avg SNF %" value={`${c?.avg_snf ?? 0}%`} />
            <StatCard label="Total Revenue" value={`₹${c?.revenue?.toLocaleString('en-IN') ?? 0}`} />
            <StatCard label="Total Cost" value={`₹${c?.cost?.toLocaleString('en-IN') ?? 0}`} />
            <StatCard label="Total Profit" value={`₹${c?.profit?.toLocaleString('en-IN') ?? 0}`} sub={pct(c?.profit ?? 0, p?.profit ?? 0) ?? undefined} positive={(c?.profit ?? 0) > 0} />
            <StatCard label="Rejection" value={`${c?.rejection ?? 0} L`} />
          </div>

          {/* Zone trend */}
          <div className="card chart-card">
            <h2>Zone Collection Trend</h2>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="quantity" name="Quantity (L)" stroke="#4f46e5" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="net_quantity" name="Net (L)" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Unit performance */}
          <div className="card chart-card">
            <h2>Unit-wise Quantity (this period)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={unitStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip />
                <Legend />
                <Bar dataKey="quantity" name="Quantity (L)" fill="#4f46e5" radius={[0, 4, 4, 0]} />
                <Bar dataKey="rejection" name="Rejection (L)" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Profit by unit */}
          <div className="card chart-card">
            <h2>Unit-wise Profit / Loss (₹)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={unitStats} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v) => typeof v === 'number' ? `₹${v.toLocaleString('en-IN')}` : v} />
                <Bar dataKey="profit" name="Profit (₹)" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Unit table */}
          <div className="card table-card">
            <h2>Unit Performance Table</h2>
            <table className="data-table">
              <thead><tr>
                <th>Unit</th><th>Code</th><th>Qty (L)</th><th>Net (L)</th>
                <th>Rej (L)</th><th>Fat %</th><th>SNF %</th><th>Revenue (₹)</th><th>Profit (₹)</th>
              </tr></thead>
              <tbody>
                {unitStats.map(u => (
                  <tr key={u.unit_id}>
                    <td>{u.name}</td><td>{u.unit_code}</td>
                    <td>{u.quantity}</td><td>{u.net_quantity}</td><td>{u.rejection}</td>
                    <td>{u.avg_fat}</td><td>{u.avg_snf}</td>
                    <td>₹{u.revenue.toLocaleString('en-IN')}</td>
                    <td className={u.profit >= 0 ? 'profit-pos' : 'profit-neg'}>
                      ₹{u.profit.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
                {unitStats.length === 0 && <tr><td colSpan={9} className="empty">No data for this period</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
