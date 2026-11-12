import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import {
  calcPeriodDelta,
  formatDateDDMMYYYY,
  formatFatSnf,
  formatINR,
  formatLitres,
  getLocalTodayIso,
} from '../../lib/format';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { DailyProfitLossChart, UnitProfitLossChart } from '../../components/ProfitLossChart';
import {
  MilkCollectionTrendChart,
  QualityTrendChart,
  UnitQuantityBarChart,
} from '../../components/CollectionCharts';
import {
  ChartSkeleton,
  ErrorBanner,
  StatsGridSkeleton,
  StatusBadge,
  TableSkeleton,
} from '../../components/UiPrimitives';

interface Stats {
  quantity: number;
  rejection: number;
  rejection_pct?: number;
  net_quantity: number;
  avg_fat: number;
  avg_snf: number;
  revenue: number | null;
  cost: number;
  rejection_loss?: number;
  profit: number | null;
}

interface AdminSummary {
  current: Stats;
  previous: Stats;
  selling_rate: number;
  date_range: { from: string; to: string };
  tanker_summary?: {
    total_dispatched: number;
    total_received: number;
    received_records_count: number;
    transit_loss: number;
    transit_loss_pct: number;
  };
  today_status?: {
    date: string;
    admin?: {
      total_active_units: number;
      units_reported: number;
      units_pending: Array<{ id: string; name: string; unit_code: string }>;
      units_flagged: Array<{ id: string; name: string; unit_code: string; reasons: string[] }>;
    } | null;
  };
}

interface TrendPoint {
  date: string;
  no_entry?: boolean;
  am_quantity?: number;
  pm_quantity?: number;
  quantity: number;
  net_quantity: number;
  rejection: number;
  avg_fat: number | null;
  avg_snf: number | null;
  revenue: number;
  cost: number;
  profit: number;
}

interface UnitPerformanceRow {
  unit_id: string;
  name: string;
  unit_code: string;
  location: string;
  is_active: boolean;
  entries_count: number;
  quantity: number;
  net_quantity: number;
  rejection: number;
  rejection_pct: number;
  avg_fat: number;
  avg_snf: number;
  revenue: number;
  cost: number;
  profit: number;
  cost_per_litre: number;
  profit_per_litre: number;
  health: 'ok' | 'warn' | 'danger' | 'inactive';
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings, currentSellingRate } = useZoneSettings();

  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'custom'>('week');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [unitsData, setUnitsData] = useState<UnitPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = { period };
      if (period === 'custom') {
        params.from = appliedCustom.from;
        params.to = appliedCustom.to;
      }
      const [s, tr, u] = await Promise.all([
        api.get<AdminSummary>('/analytics/summary', { params }),
        api.get<TrendPoint[]>('/analytics/trend', { params }),
        api.get<UnitPerformanceRow[]>('/analytics/units', { params }),
      ]);
      setSummary(s.data);
      setTrend(tr.data);
      setUnitsData(u.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load zone dashboard.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const c = summary?.current;
  const p = summary?.previous;
  const sellingRate = summary?.selling_rate ?? currentSellingRate;
  const adminToday = summary?.today_status?.admin;
  const tanker = summary?.tanker_summary;
  const rangeFrom = summary?.date_range?.from ?? '';
  const rangeTo = summary?.date_range?.to ?? '';

  const rejPct = c?.rejection_pct ?? (c && c.quantity > 0 ? +((c.rejection / c.quantity) * 100).toFixed(2) : 0);
  const rejTone = rejPct >= settings.rejection_danger_pct
    ? 'negative'
    : rejPct >= settings.rejection_warn_pct
      ? 'warning'
      : undefined;

  const openMilkRecords = (extra?: Record<string, string>) => {
    const qs = new URLSearchParams();
    if (rangeFrom) qs.set('from', rangeFrom);
    if (rangeTo) qs.set('to', rangeTo);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) qs.set(k, v);
    }
    navigate(`/admin/milk?${qs.toString()}`);
  };

  const unitColumns: DataColumn<UnitPerformanceRow>[] = [
    {
      key: 'name',
      header: 'Unit',
      sortValue: u => u.name,
      searchValue: u => `${u.name} ${u.unit_code} ${u.location}`,
      render: u => (
        <button
          type="button"
          className="btn-link"
          style={{ marginLeft: 0, textAlign: 'left', fontWeight: 600 }}
          onClick={() => openMilkRecords({ unit_id: u.unit_id })}
        >
          {u.name} <span className="unit-code">{u.unit_code}</span>
        </button>
      ),
      footerCell: <strong>Zone Totals ({unitsData.length})</strong>,
    },
    {
      key: 'health',
      header: 'Health',
      sortValue: u => u.health,
      render: u => {
        if (u.health === 'inactive') return <StatusBadge tone="grey">Inactive</StatusBadge>;
        if (u.health === 'danger') return <StatusBadge tone="red">Attention</StatusBadge>;
        if (u.health === 'warn') return <StatusBadge tone="amber">{u.entries_count === 0 ? 'No Data' : 'Warning'}</StatusBadge>;
        return <StatusBadge tone="green">OK</StatusBadge>;
      },
    },
    {
      key: 'quantity',
      header: 'Gross (L)',
      sortValue: u => u.quantity,
      render: u => formatLitres(u.quantity, 1),
      footerCell: <strong>{formatLitres(unitsData.reduce((s, u) => s + u.quantity, 0), 1)}</strong>,
    },
    {
      key: 'net_quantity',
      header: 'Net (L)',
      sortValue: u => u.net_quantity,
      render: u => formatLitres(u.net_quantity, 1),
      footerCell: <strong>{formatLitres(unitsData.reduce((s, u) => s + u.net_quantity, 0), 1)}</strong>,
    },
    {
      key: 'rejection_pct',
      header: 'Rej %',
      sortValue: u => u.rejection_pct,
      render: u => {
        const tone = u.rejection_pct >= settings.rejection_danger_pct
          ? 'red'
          : u.rejection_pct >= settings.rejection_warn_pct
            ? 'amber'
            : 'grey';
        return <StatusBadge tone={tone}>{u.rejection_pct.toFixed(1)}%</StatusBadge>;
      },
    },
    {
      key: 'avg_fat',
      header: 'Fat / SNF',
      sortValue: u => u.avg_snf,
      render: u => `${formatFatSnf(u.avg_fat)}% / ${formatFatSnf(u.avg_snf)}%`,
    },
    {
      key: 'cost_per_litre',
      header: 'Cost / L',
      sortValue: u => u.cost_per_litre,
      render: u => `₹${u.cost_per_litre.toFixed(2)}`,
    },
    {
      key: 'profit_per_litre',
      header: 'Profit / L',
      sortValue: u => u.profit_per_litre,
      render: u => (
        <span className={u.profit_per_litre >= 0 ? 'profit-pos' : 'profit-neg'}>
          {formatINR(u.profit_per_litre, { showPlus: u.profit_per_litre > 0 })}
        </span>
      ),
    },
    {
      key: 'profit',
      header: 'Net Profit / Loss',
      sortValue: u => u.profit,
      render: u => (
        <span className={u.profit >= 0 ? 'profit-pos' : 'profit-neg'}>
          {formatINR(u.profit, { showPlus: u.profit > 0 })}
        </span>
      ),
      footerCell: (
        <strong className={unitsData.reduce((s, u) => s + u.profit, 0) >= 0 ? 'profit-pos' : 'profit-neg'}>
          {formatINR(unitsData.reduce((s, u) => s + u.profit, 0))}
        </strong>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{profile?.zones?.name ?? 'Zone'} Dashboard</h1>
          <p className="page-subtitle">
            Zone-wide collection, quality &amp; financial overview
            {rangeFrom && rangeTo && (
              <> · <strong>{formatDateDDMMYYYY(rangeFrom)} to {formatDateDDMMYYYY(rangeTo)}</strong></>
            )}
          </p>
        </div>

        <div className="header-actions">
          <div className="period-tabs">
            {(['week', 'month', 'year', 'custom'] as const).map(pr => (
              <button
                key={pr}
                type="button"
                className={`tab ${period === pr ? 'active' : ''}`}
                onClick={() => setPeriod(pr)}
              >
                {t(pr)}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="custom-range-bar">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <span className="custom-range-sep">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
              >
                {t('apply')}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {adminToday && (
        <div className="card form-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h2 style={{ marginBottom: 0 }}>
              Today&apos;s Zone Status ({formatDateDDMMYYYY(summary?.today_status?.date)})
            </h2>
            <StatusBadge tone={adminToday.units_pending.length === 0 ? 'green' : 'amber'}>
              {adminToday.units_reported} / {adminToday.total_active_units} units reported
            </StatusBadge>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
              <strong style={{ fontSize: '0.82rem', color: '#92400e', display: 'block', marginBottom: 6 }}>
                Pending Today ({adminToday.units_pending.length})
              </strong>
              {adminToday.units_pending.length === 0 ? (
                <span style={{ fontSize: '0.82rem', color: '#047857' }}>All active units have submitted today!</span>
              ) : (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {adminToday.units_pending.map(u => (
                    <StatusBadge key={u.id} tone="amber">{u.name} ({u.unit_code})</StatusBadge>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.7rem 0.9rem' }}>
              <strong style={{ fontSize: '0.82rem', color: '#991b1b', display: 'block', marginBottom: 6 }}>
                Flagged Quality / High Rejection Today ({adminToday.units_flagged.length})
              </strong>
              {adminToday.units_flagged.length === 0 ? (
                <span style={{ fontSize: '0.82rem', color: '#047857' }}>No quality alerts today.</span>
              ) : (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {adminToday.units_flagged.map(u => (
                    <StatusBadge key={u.id} tone="red">
                      {u.name}: {u.reasons.join(', ')}
                    </StatusBadge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <>
          <StatsGridSkeleton count={8} />
          <ChartSkeleton height={260} />
          <TableSkeleton rows={5} cols={7} />
        </>
      ) : c ? (
        <>
          <div className="stats-grid">
            <StatCard
              label={t('totalCollected')}
              value={formatLitres(c.quantity, 1)}
              sub={calcPeriodDelta(c.quantity, p?.quantity ?? 0) ?? undefined}
              positive={p?.quantity ? c.quantity >= p.quantity : undefined}
              onClick={() => openMilkRecords()}
            />
            <StatCard
              label={t('netAccepted')}
              value={formatLitres(c.net_quantity, 1)}
              tooltip={t('tipNetQuantity')}
              onClick={() => openMilkRecords()}
            />
            <StatCard
              label={t('rejected')}
              value={`${formatLitres(c.rejection, 1)} (${rejPct.toFixed(1)}%)`}
              valueTone={rejTone}
              tooltip={t('tipRejectionPct')}
              onClick={() => openMilkRecords({ quality: 'flagged' })}
            />
            <StatCard
              label={t('avgFatSnf')}
              value={`${formatFatSnf(c.avg_fat)}% / ${formatFatSnf(c.avg_snf)}%`}
              tooltip={t('tipSnf')}
              sub="Qty-weighted average"
              onClick={() => openMilkRecords()}
            />
            <StatCard
              label={t('procurementCost')}
              value={formatINR(c.cost)}
              tooltip={t('tipProcurementCost')}
              onClick={() => openMilkRecords()}
            />
            <StatCard
              label={t('estRevenue')}
              value={formatINR(c.revenue ?? 0)}
              sub={`Rate: ₹${sellingRate}/L`}
              onClick={() => openMilkRecords()}
            />
            <StatCard
              label={(c.profit ?? 0) >= 0 ? t('netProfit') : t('netLoss')}
              value={formatINR(c.profit ?? 0, { showPlus: (c.profit ?? 0) > 0 })}
              valueTone={(c.profit ?? 0) >= 0 ? 'positive' : 'negative'}
              positive={(c.profit ?? 0) >= 0}
              sub={c.revenue ? `Margin: ${(((c.profit ?? 0) / c.revenue) * 100).toFixed(1)}%` : undefined}
              onClick={() => openMilkRecords()}
            />
            {tanker && (
              <>
                <StatCard
                  label="Total Dispatched"
                  value={formatLitres(tanker.total_dispatched, 1)}
                  onClick={() => navigate('/admin/tanker')}
                />
                <StatCard
                  label="Transit Loss"
                  value={`${formatLitres(tanker.transit_loss, 1)} (${tanker.transit_loss_pct.toFixed(1)}%)`}
                  valueTone={tanker.transit_loss > 0 ? 'negative' : 'positive'}
                  sub={tanker.received_records_count > 0 ? `${tanker.received_records_count} received tankers` : 'No receipts logged yet'}
                  onClick={() => navigate('/admin/tanker')}
                />
              </>
            )}
          </div>

          <MilkCollectionTrendChart
            data={trend}
            mode="admin"
            title="Zone Collection Trend (AM + PM)"
            emptyActionLabel="Go to Milk Records"
            onEmptyAction={() => navigate('/admin/milk')}
          />

          <QualityTrendChart
            data={trend}
            fatBenchmark={settings.fat_benchmark}
            snfBenchmark={settings.snf_benchmark}
          />

          <DailyProfitLossChart data={trend} sellingRate={sellingRate} />

          <UnitProfitLossChart
            data={unitsData.filter(u => u.entries_count > 0)}
            sellingRate={sellingRate}
          />

          <UnitQuantityBarChart
            data={unitsData.filter(u => u.entries_count > 0)}
          />

          <div className="card table-card">
            <h2>Unit Performance Breakdown</h2>
            <DataTable
              rows={unitsData}
              columns={unitColumns}
              getRowKey={u => u.unit_id}
              getRowClassName={u => u.health === 'danger' ? 'row-danger' : u.health === 'warn' ? 'row-warn' : ''}
              emptyMessage="No collection units created yet."
              emptyActionLabel="Manage Units"
              onEmptyAction={() => navigate('/admin/units')}
              showTotalsRow
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
