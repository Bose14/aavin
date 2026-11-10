import { useState, useEffect } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

interface Summary {
  current: { quantity: number; net_quantity: number; rejection: number; avg_fat: number; avg_snf: number; revenue: number; cost: number; profit: number };
  previous: { quantity: number; net_quantity: number; profit: number };
  selling_rate: number;
}

interface TrendPoint {
  date: string; quantity: number; net_quantity: number; rejection: number;
  avg_fat: number; avg_snf: number; revenue: number; cost: number; profit: number;
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

export default function UnitDashboard() {
  const { profile } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/analytics/summary?period=${period}`),
      api.get(`/analytics/trend?period=${period}`),
    ]).then(([s, t]) => {
      setSummary(s.data);
      setTrend(t.data);
    }).finally(() => setLoading(false));
  }, [period]);

  const c = summary?.current;
  const p = summary?.previous;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="page-subtitle">{profile?.full_name} — Unit Overview</p>
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
          {/* Stats row */}
          <div className="stats-grid">
            <StatCard label="Total Collected" value={`${c?.quantity ?? 0} L`} sub={pct(c?.quantity ?? 0, p?.quantity ?? 0) ?? undefined} positive={(c?.quantity ?? 0) >= (p?.quantity ?? 0)} />
            <StatCard label="Net (after rejection)" value={`${c?.net_quantity ?? 0} L`} />
            <StatCard label="Avg Fat %" value={`${c?.avg_fat ?? 0}%`} />
            <StatCard label="Avg SNF %" value={`${c?.avg_snf ?? 0}%`} />
            <StatCard label="Revenue" value={`₹${c?.revenue?.toLocaleString('en-IN') ?? 0}`} />
            <StatCard label="Procurement Cost" value={`₹${c?.cost?.toLocaleString('en-IN') ?? 0}`} />
            <StatCard label="Profit / Loss" value={`₹${c?.profit?.toLocaleString('en-IN') ?? 0}`} sub={pct(c?.profit ?? 0, p?.profit ?? 0) ?? undefined} positive={(c?.profit ?? 0) > 0} />
            <StatCard label="Rejection" value={`${c?.rejection ?? 0} L`} />
          </div>

          {/* Quantity trend */}
          <div className="card chart-card">
            <h2>Milk Collection Trend</h2>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend}>
                <defs>
                  <linearGradient id="qty" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="quantity" name="Quantity (L)" stroke="#4f46e5" fill="url(#qty)" />
                <Area type="monotone" dataKey="rejection" name="Rejection (L)" stroke="#ef4444" fill="none" strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Fat & SNF trend */}
          <div className="card chart-card">
            <h2>Fat % & SNF % Trend</h2>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="avg_fat" name="Fat %" stroke="#f59e0b" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="avg_snf" name="SNF %" stroke="#10b981" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Profit/Loss */}
          <div className="card chart-card">
            <h2>Profit / Loss (₹)</h2>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => typeof v === 'number' ? `₹${v.toLocaleString('en-IN')}` : v} />
                <Legend />
                <Bar dataKey="revenue" name="Revenue (₹)" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cost" name="Cost (₹)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Profit (₹)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
