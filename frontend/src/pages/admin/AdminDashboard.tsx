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

// ==========================================
// Process Analytics Interfaces
// ==========================================

interface ProcessKPIs {
  total_dispatched_count: number;
  total_dispatched_litres: number;
  active_in_plant_count: number;
  completed_count: number;
  completed_litres: number;
  qc_rejected_count: number;
  qc_rejected_litres: number;
  transit_loss_litres: number;
  transit_loss_pct: number;
  transit_loss_tone: 'green' | 'amber' | 'red';
  avg_plant_turnaround_min: number | null;
  sla_delayed_count: number;
  sla_compliance_pct: number;
}

interface ProcessPipelineStage {
  key: string;
  title: string;
  team: string;
  team_label: string;
  active_count: number;
  delayed_count: number;
  color: string;
  desc: string;
}

interface TeamPerformance {
  gate: {
    name: string;
    active_queue: number;
    total_ops: number;
    avg_gross_min: number | null;
    avg_tare_min: number | null;
    delayed_count: number;
  };
  qc: {
    name: string;
    active_queue: number;
    total_inspected: number;
    accepted_count: number;
    rejected_count: number;
    rejection_rate_pct: number;
    avg_test_min: number | null;
    cip_cleanings_count: number;
    delayed_count: number;
    rejection_reasons: Array<{ reason: string; count: number }>;
  };
  unloading: {
    name: string;
    active_queue: number;
    total_unloaded: number;
    total_volume_litres: number;
    avg_unload_min: number | null;
    delayed_count: number;
  };
}

interface QualityReconciliation {
  avg_dispatch_fat: number;
  avg_received_fat: number;
  fat_variance: number;
  avg_dispatch_snf: number;
  avg_received_snf: number;
  snf_variance: number;
  avg_temperature: number | null;
  temp_compliant_pct: number;
  organoleptic_satisfied_pct: number;
}

interface BmcScorecardRow {
  unit_id: string;
  name: string;
  unit_code: string;
  dispatched_count: number;
  dispatched_litres: number;
  received_litres: number;
  transit_loss_litres: number;
  transit_loss_pct: number;
  qc_rejected_count: number;
  avg_turnaround_min: number | null;
  avg_fat_diff: number;
  avg_snf_diff: number;
  health: 'ok' | 'warn' | 'danger';
}

interface ActiveInPlantTanker {
  id: string;
  tanker_number: string;
  dc_number: string;
  bmc_name: string;
  bmc_code: string;
  current_stage_key: string;
  current_stage_title: string;
  stage_color: string;
  waiting_team: string;
  waiting_team_label: string;
  waiting_since_minutes: number;
  is_over_limit: boolean;
  dispatched_litres: number;
  compartments_count: number;
  driver_name: string;
}

interface ProcessAnalyticsResponse {
  period: string;
  date_range: { from: string; to: string };
  kpis: ProcessKPIs;
  pipeline: ProcessPipelineStage[];
  team_performance: TeamPerformance;
  quality_reconciliation: QualityReconciliation;
  bmc_performance: BmcScorecardRow[];
  active_tankers: ActiveInPlantTanker[];
  daily_trend: Array<{
    date: string;
    dispatched_count: number;
    dispatched_litres: number;
    received_count: number;
    received_litres: number;
    transit_loss_litres: number;
    qc_rejected_count: number;
    avg_turnaround_min: number | null;
  }>;
}

// ==========================================
// Procurement Analytics Interfaces (Legacy)
// ==========================================

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

  // Active view: 'process' (primary) or 'procurement' (secondary)
  const [viewMode, setViewMode] = useState<'process' | 'procurement'>('process');

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  // Process data state
  const [processData, setProcessData] = useState<ProcessAnalyticsResponse | null>(null);

  // Procurement data state
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

      if (viewMode === 'process') {
        const res = await api.get<ProcessAnalyticsResponse>('/analytics/process', { params });
        setProcessData(res.data);
      } else {
        const [s, tr, u] = await Promise.all([
          api.get<AdminSummary>('/analytics/summary', { params }),
          api.get<TrendPoint[]>('/analytics/trend', { params }),
          api.get<UnitPerformanceRow[]>('/analytics/units', { params }),
        ]);
        setSummary(s.data);
        setTrend(tr.data);
        setUnitsData(u.data);
      }
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load analytics data.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom, viewMode]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Date range label
  const rangeFrom = viewMode === 'process'
    ? processData?.date_range?.from
    : summary?.date_range?.from;
  const rangeTo = viewMode === 'process'
    ? processData?.date_range?.to
    : summary?.date_range?.to;

  // Format minutes to hours/mins
  const formatDuration = (mins: number | null | undefined) => {
    if (mins == null) return 'N/A';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  // Columns for BMC Process Scorecard table
  const bmcProcessColumns: DataColumn<BmcScorecardRow>[] = [
    {
      key: 'name',
      header: 'Collection Unit (BMC)',
      sortValue: (b) => b.name,
      searchValue: (b) => `${b.name} ${b.unit_code}`,
      render: (b) => (
        <button
          type="button"
          className="btn-link"
          style={{ marginLeft: 0, textAlign: 'left', fontWeight: 600 }}
          onClick={() => navigate(`/admin/tanker?unit_id=${b.unit_id}`)}
        >
          {b.name} <span className="unit-code">{b.unit_code}</span>
        </button>
      ),
      footerCell: <strong>Total Units ({processData?.bmc_performance.length || 0})</strong>,
    },
    {
      key: 'health',
      header: 'Health',
      sortValue: (b) => b.health,
      render: (b) => {
        if (b.health === 'danger') return <StatusBadge tone="red">Attention</StatusBadge>;
        if (b.health === 'warn') return <StatusBadge tone="amber">Watch</StatusBadge>;
        return <StatusBadge tone="green">Good</StatusBadge>;
      },
    },
    {
      key: 'dispatched_count',
      header: 'Tankers Dispatched',
      sortValue: (b) => b.dispatched_count,
      render: (b) => b.dispatched_count,
      footerCell: (
        <strong>
          {processData?.bmc_performance.reduce((s, b) => s + b.dispatched_count, 0) || 0}
        </strong>
      ),
    },
    {
      key: 'dispatched_litres',
      header: 'Dispatched (L)',
      sortValue: (b) => b.dispatched_litres,
      render: (b) => formatLitres(b.dispatched_litres, 1),
      footerCell: (
        <strong>
          {formatLitres(
            processData?.bmc_performance.reduce((s, b) => s + b.dispatched_litres, 0) || 0,
            1,
          )}
        </strong>
      ),
    },
    {
      key: 'received_litres',
      header: 'Received at Silo (L)',
      sortValue: (b) => b.received_litres,
      render: (b) => (b.received_litres > 0 ? formatLitres(b.received_litres, 1) : '-'),
      footerCell: (
        <strong>
          {formatLitres(
            processData?.bmc_performance.reduce((s, b) => s + b.received_litres, 0) || 0,
            1,
          )}
        </strong>
      ),
    },
    {
      key: 'transit_loss_pct',
      header: 'Transit Loss',
      sortValue: (b) => b.transit_loss_pct,
      render: (b) => {
        if (b.dispatched_litres === 0 || b.received_litres === 0) return '-';
        const tone = b.transit_loss_pct >= (settings.transit_loss_danger_pct ?? 2.0)
          ? 'red'
          : b.transit_loss_pct >= (settings.transit_loss_warn_pct ?? 1.0)
          ? 'amber'
          : 'green';
        return (
          <StatusBadge tone={tone}>
            {b.transit_loss_litres > 0 ? `-${formatLitres(b.transit_loss_litres, 1)}` : '0 L'}{' '}
            ({b.transit_loss_pct}%)
          </StatusBadge>
        );
      },
    },
    {
      key: 'qc_rejected_count',
      header: 'QC Rejections',
      sortValue: (b) => b.qc_rejected_count,
      render: (b) => (
        <span style={{ color: b.qc_rejected_count > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
          {b.qc_rejected_count}
        </span>
      ),
      footerCell: (
        <strong style={{ color: '#dc2626' }}>
          {processData?.bmc_performance.reduce((s, b) => s + b.qc_rejected_count, 0) || 0}
        </strong>
      ),
    },
    {
      key: 'avg_turnaround_min',
      header: 'Avg Turnaround',
      sortValue: (b) => b.avg_turnaround_min || 0,
      render: (b) => formatDuration(b.avg_turnaround_min),
    },
    {
      key: 'avg_fat_diff',
      header: 'Fat Variance',
      sortValue: (b) => b.avg_fat_diff,
      render: (b) => (
        <span style={{ color: b.avg_fat_diff < -0.1 ? '#dc2626' : '#475569', fontWeight: 600 }}>
          {b.avg_fat_diff > 0 ? `+${b.avg_fat_diff}%` : `${b.avg_fat_diff}%`}
        </span>
      ),
    },
  ];

  // Columns for Live In-Plant Tankers Table
  const activeTankersColumns: DataColumn<ActiveInPlantTanker>[] = [
    {
      key: 'tanker_number',
      header: 'Tanker / DC No',
      sortValue: (t) => t.tanker_number,
      render: (t) => (
        <div>
          <button
            type="button"
            className="btn-link"
            style={{ marginLeft: 0, textAlign: 'left', fontWeight: 700 }}
            onClick={() => navigate(`/admin/tanker?search=${t.tanker_number}`)}
          >
            {t.tanker_number}
          </button>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
            DC #{t.dc_number || '-'} · {t.compartments_count} Comp
          </div>
        </div>
      ),
    },
    {
      key: 'bmc_name',
      header: 'Source BMC',
      sortValue: (t) => t.bmc_name,
      render: (t) => (
        <div>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>{t.bmc_name}</span>
          {t.bmc_code && <span className="unit-code" style={{ marginLeft: 6 }}>{t.bmc_code}</span>}
        </div>
      ),
    },
    {
      key: 'dispatched_litres',
      header: 'Volume (L)',
      sortValue: (t) => t.dispatched_litres,
      render: (t) => formatLitres(t.dispatched_litres, 1),
    },
    {
      key: 'current_stage_title',
      header: 'Current Stage',
      sortValue: (t) => t.current_stage_title,
      render: (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: t.stage_color }} />
          <span style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.85rem' }}>
            {t.current_stage_title}
          </span>
        </div>
      ),
    },
    {
      key: 'waiting_team_label',
      header: 'Waiting Team',
      sortValue: (t) => t.waiting_team_label,
      render: (t) => (
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: '0.78rem',
            fontWeight: 700,
            backgroundColor:
              t.waiting_team === 'gate'
                ? '#e0f2fe'
                : t.waiting_team === 'qc'
                ? '#fef3c7'
                : t.waiting_team === 'unloading'
                ? '#dcfce7'
                : '#f1f5f9',
            color:
              t.waiting_team === 'gate'
                ? '#0369a1'
                : t.waiting_team === 'qc'
                ? '#92400e'
                : t.waiting_team === 'unloading'
                ? '#166534'
                : '#475569',
          }}
        >
          {t.waiting_team_label || t.waiting_team?.toUpperCase() || '-'}
        </span>
      ),
    },
    {
      key: 'waiting_since_minutes',
      header: 'Waiting Since',
      sortValue: (t) => t.waiting_since_minutes,
      render: (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: t.is_over_limit ? 800 : 500, color: t.is_over_limit ? '#dc2626' : '#1e293b' }}>
            {formatDuration(t.waiting_since_minutes)}
          </span>
          {t.is_over_limit && (
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#ffffff',
                backgroundColor: '#ef4444',
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              DELAYED
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'driver_name',
      header: 'Driver',
      sortValue: (t) => t.driver_name,
      render: (t) => <span style={{ color: '#475569', fontSize: '0.85rem' }}>{t.driver_name || '-'}</span>,
    },
  ];

  // Procurement View (Legacy Columns)
  const c = summary?.current;
  const p = summary?.previous;
  const sellingRate = summary?.selling_rate ?? currentSellingRate;
  const adminToday = summary?.today_status?.admin;
  const rejPct = c?.rejection_pct ?? (c && c.quantity > 0 ? +((c.rejection / c.quantity) * 100).toFixed(2) : 0);
  const rejTone = rejPct >= settings.rejection_danger_pct
    ? 'negative'
    : rejPct >= settings.rejection_warn_pct
      ? 'warning'
      : undefined;

  const unitColumns: DataColumn<UnitPerformanceRow>[] = [
    {
      key: 'name',
      header: 'Unit',
      sortValue: (u) => u.name,
      searchValue: (u) => `${u.name} ${u.unit_code} ${u.location}`,
      render: (u) => (
        <button
          type="button"
          className="btn-link"
          style={{ marginLeft: 0, textAlign: 'left', fontWeight: 600 }}
          onClick={() => navigate(`/admin/milk?unit_id=${u.unit_id}`)}
        >
          {u.name} <span className="unit-code">{u.unit_code}</span>
        </button>
      ),
      footerCell: <strong>Zone Totals ({unitsData.length})</strong>,
    },
    {
      key: 'health',
      header: 'Health',
      sortValue: (u) => u.health,
      render: (u) => {
        if (u.health === 'inactive') return <StatusBadge tone="grey">Inactive</StatusBadge>;
        if (u.health === 'danger') return <StatusBadge tone="red">Attention</StatusBadge>;
        if (u.health === 'warn') return <StatusBadge tone="amber">{u.entries_count === 0 ? 'No Data' : 'Warning'}</StatusBadge>;
        return <StatusBadge tone="green">OK</StatusBadge>;
      },
    },
    {
      key: 'quantity',
      header: 'Gross (L)',
      sortValue: (u) => u.quantity,
      render: (u) => formatLitres(u.quantity, 1),
      footerCell: <strong>{formatLitres(unitsData.reduce((s, u) => s + u.quantity, 0), 1)}</strong>,
    },
    {
      key: 'net_quantity',
      header: 'Net (L)',
      sortValue: (u) => u.net_quantity,
      render: (u) => formatLitres(u.net_quantity, 1),
      footerCell: <strong>{formatLitres(unitsData.reduce((s, u) => s + u.net_quantity, 0), 1)}</strong>,
    },
    {
      key: 'avg_fat',
      header: 'Fat / SNF',
      sortValue: (u) => u.avg_snf,
      render: (u) => `${formatFatSnf(u.avg_fat)}% / ${formatFatSnf(u.avg_snf)}%`,
    },
    {
      key: 'profit',
      header: 'Net Profit / Loss',
      sortValue: (u) => u.profit,
      render: (u) => (
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
      {/* Top Header */}
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1>{profile?.zones?.name ?? 'Dairy Plant'} {t('navAnalytics')}</h1>
          <p className="page-subtitle">
            {viewMode === 'process'
              ? 'Plant reception, weighbridge, quality testing, and unloading process intelligence'
              : 'Zone-wide BMC milk collection, quality & financial overview'}
            {rangeFrom && rangeTo && (
              <> · <strong>{formatDateDDMMYYYY(rangeFrom)} to {formatDateDDMMYYYY(rangeTo)}</strong></>
            )}
          </p>
        </div>

        <div className="header-actions">
          <div className="period-tabs">
            {(['today', 'week', 'month', 'year', 'custom'] as const).map((pr) => (
              <button
                key={pr}
                type="button"
                className={`tab ${period === pr ? 'active' : ''}`}
                onClick={() => setPeriod(pr)}
              >
                {pr === 'today' ? 'Today' : t(pr as any)}
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

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={fetchData}
            title="Refresh analytics data"
            style={{ marginLeft: 4 }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* View Mode Switcher */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '1.25rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '0.65rem',
        }}
      >
        <button
          type="button"
          onClick={() => setViewMode('process')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: viewMode === 'process' ? '2px solid #0284c7' : '1px solid #cbd5e1',
            backgroundColor: viewMode === 'process' ? '#e0f2fe' : '#ffffff',
            color: viewMode === 'process' ? '#0369a1' : '#475569',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🏭 Plant Process &amp; Tanker Operations</span>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('procurement')}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: viewMode === 'procurement' ? '2px solid #0284c7' : '1px solid #cbd5e1',
            backgroundColor: viewMode === 'procurement' ? '#e0f2fe' : '#ffffff',
            color: viewMode === 'procurement' ? '#0369a1' : '#475569',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🥛 BMC Milk Procurement Records</span>
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* ======================================================== */}
      {/* 1. PROCESS ANALYTICS VIEW                                */}
      {/* ======================================================== */}
      {viewMode === 'process' && (
        <>
          {loading ? (
            <>
              <StatsGridSkeleton count={8} />
              <ChartSkeleton height={200} />
              <TableSkeleton rows={4} cols={6} />
            </>
          ) : processData ? (
            <>
              {/* SLA Delayed Bottleneck Banner */}
              {processData.kpis.sla_delayed_count > 0 ? (
                <div
                  style={{
                    backgroundColor: '#fef2f2',
                    border: '1px solid #f87171',
                    borderRadius: 8,
                    padding: '12px 16px',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.4rem' }}>⚠️</span>
                    <div>
                      <strong style={{ color: '#991b1b', fontSize: '0.92rem' }}>
                        {processData.kpis.sla_delayed_count}{' '}
                        {processData.kpis.sla_delayed_count === 1 ? 'Tanker has' : 'Tankers have'} exceeded SLA waiting time limits
                      </strong>
                      <div style={{ color: '#7f1d1d', fontSize: '0.82rem' }}>
                        Attention needed in plant stages to resolve bottlenecks and prevent milk temperature &amp; transit loss spikes.
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    style={{ borderColor: '#ef4444', color: '#b91c1c', fontWeight: 700 }}
                    onClick={() => navigate('/admin/tanker?delayed=true')}
                  >
                    View Delayed Tankers &rarr;
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #86efac',
                    borderRadius: 8,
                    padding: '10px 16px',
                    marginBottom: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#166534', fontSize: '0.85rem' }}>
                    <span>✅</span>
                    <strong>All active plant operations within configured SLA limits.</strong>
                    <span>({processData.kpis.active_in_plant_count} tankers currently active on-site)</span>
                  </div>
                  <button
                    type="button"
                    className="btn-link btn-sm"
                    style={{ color: '#15803d', fontWeight: 600 }}
                    onClick={() => navigate('/admin/tanker')}
                  >
                    Open Tanker Register &rarr;
                  </button>
                </div>
              )}

              {/* Live Process Funnel / Pipeline Stepper */}
              <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#1e293b' }}>
                      Live Plant Process Flow &amp; Stage Queues
                    </h2>
                    <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Click any stage to filter tankers in the Tanker Register
                    </span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#0369a1', fontWeight: 600 }}>
                    Total: {processData.kpis.total_dispatched_count} Tankers Dispatched
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {processData.pipeline.map((st) => (
                    <div
                      key={st.key}
                      onClick={() => navigate(`/admin/tanker?stage=${st.key}`)}
                      style={{
                        border: st.delayed_count > 0 ? '1.5px solid #ef4444' : '1px solid #e2e8f0',
                        borderRadius: 8,
                        padding: '10px',
                        backgroundColor: st.active_count > 0 ? '#f8fafc' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'transform 0.15s, box-shadow 0.15s',
                        display: 'flex',
                        flexDirection: 'column',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: st.color }} />
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                          {st.team}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b', marginBottom: '6px' }}>
                        {st.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: 'auto' }}>
                        <span style={{ fontSize: '1.35rem', fontWeight: 800, color: st.active_count > 0 ? '#0284c7' : '#94a3b8' }}>
                          {st.active_count}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>in stage</span>
                      </div>
                      {st.delayed_count > 0 && (
                        <div
                          style={{
                            marginTop: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            color: '#dc2626',
                            backgroundColor: '#fee2e2',
                            padding: '1px 5px',
                            borderRadius: 4,
                            alignSelf: 'flex-start',
                          }}
                        >
                          ⚠️ {st.delayed_count} delayed
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Main Process KPIs Grid */}
              <div className="stats-grid" style={{ marginBottom: '1.5rem' }}>
                <StatCard
                  label="Total Dispatched from BMCs"
                  value={formatLitres(processData.kpis.total_dispatched_litres, 1)}
                  sub={`${processData.kpis.total_dispatched_count} Tankers Dispatched`}
                  onClick={() => navigate('/admin/tanker')}
                />
                <StatCard
                  label="Active In-Plant"
                  value={`${processData.kpis.active_in_plant_count} Tankers`}
                  valueTone={processData.kpis.active_in_plant_count > 0 ? 'warning' : undefined}
                  sub="Inside dairy plant currently"
                  onClick={() => navigate('/admin/tanker?tab=waiting')}
                />
                <StatCard
                  label="Received at Dairy Silos"
                  value={formatLitres(processData.kpis.completed_litres, 1)}
                  sub={`${processData.kpis.completed_count} Tankers Processed`}
                  positive={processData.kpis.completed_count > 0}
                  onClick={() => navigate('/admin/tanker?tab=processed')}
                />
                <StatCard
                  label="Transit Loss"
                  value={`${formatLitres(processData.kpis.transit_loss_litres, 1)} (${processData.kpis.transit_loss_pct}%)`}
                  valueTone={processData.kpis.transit_loss_tone === 'red' ? 'negative' : processData.kpis.transit_loss_tone === 'amber' ? 'warning' : 'positive'}
                  sub={processData.kpis.completed_count > 0 ? `Across ${processData.kpis.completed_count} received trips` : 'Waiting for receipts'}
                  onClick={() => navigate('/admin/tanker')}
                />
                <StatCard
                  label="QC Acceptance Rate"
                  value={`${processData.team_performance.qc.total_inspected > 0 ? (100 - processData.team_performance.qc.rejection_rate_pct).toFixed(1) : 100}% Accepted`}
                  valueTone={processData.kpis.qc_rejected_count > 0 ? 'warning' : 'positive'}
                  sub={processData.kpis.qc_rejected_count > 0 ? `${processData.kpis.qc_rejected_count} rejected (${formatLitres(processData.kpis.qc_rejected_litres, 1)})` : 'Zero rejections'}
                  onClick={() => navigate('/admin/tanker?stage=qc_rejected')}
                />
                <StatCard
                  label="Avg Plant Turnaround"
                  value={formatDuration(processData.kpis.avg_plant_turnaround_min)}
                  sub="From Gate Entry to Gate Out"
                  onClick={() => navigate('/admin/tanker')}
                />
                <StatCard
                  label="SLA Compliance"
                  value={`${processData.kpis.sla_compliance_pct}% On-Time`}
                  valueTone={processData.kpis.sla_compliance_pct < 85 ? 'negative' : 'positive'}
                  sub={processData.kpis.sla_delayed_count > 0 ? `${processData.kpis.sla_delayed_count} stage delays logged` : 'Zero delays across all teams'}
                  onClick={() => navigate('/admin/tanker?delayed=true')}
                />
              </div>

              {/* Team Efficiency & Process Quality Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {/* 1. Gate Operations Performance */}
                <div className="card" style={{ padding: '1rem 1.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '1.2rem' }}>🚪</span>
                      <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>Gate Operations Team</strong>
                    </div>
                    <StatusBadge tone={processData.team_performance.gate.active_queue > 0 ? 'amber' : 'green'}>
                      {processData.team_performance.gate.active_queue} in queue
                    </StatusBadge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.82rem' }}>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Total Gate Ops</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0369a1' }}>
                        {processData.team_performance.gate.total_ops}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Avg Gross Weighing</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e293b' }}>
                        {formatDuration(processData.team_performance.gate.avg_gross_min)}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Avg Tare Weighing</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e293b' }}>
                        {formatDuration(processData.team_performance.gate.avg_tare_min)}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>SLA Delayed</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: processData.team_performance.gate.delayed_count > 0 ? '#dc2626' : '#16a34a' }}>
                        {processData.team_performance.gate.delayed_count}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. QC Lab Team Performance */}
                <div className="card" style={{ padding: '1rem 1.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '1.2rem' }}>🧪</span>
                      <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>Quality Control (QC) Lab</strong>
                    </div>
                    <StatusBadge tone={processData.team_performance.qc.active_queue > 0 ? 'amber' : 'green'}>
                      {processData.team_performance.qc.active_queue} in queue
                    </StatusBadge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.82rem' }}>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Inspected / Passed</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#16a34a' }}>
                        {processData.team_performance.qc.accepted_count} / {processData.team_performance.qc.total_inspected}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Avg Testing Time</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e293b' }}>
                        {formatDuration(processData.team_performance.qc.avg_test_min)}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>CIP Sanitizations</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0369a1' }}>
                        {processData.team_performance.qc.cip_cleanings_count}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>QC Rejections</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: processData.team_performance.qc.rejected_count > 0 ? '#dc2626' : '#16a34a' }}>
                        {processData.team_performance.qc.rejected_count}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Unloading Bay Performance */}
                <div className="card" style={{ padding: '1rem 1.2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '1.2rem' }}>🥛</span>
                      <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>Milk Unloading Bay</strong>
                    </div>
                    <StatusBadge tone={processData.team_performance.unloading.active_queue > 0 ? 'amber' : 'green'}>
                      {processData.team_performance.unloading.active_queue} in queue
                    </StatusBadge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.82rem' }}>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Tankers Unloaded</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0369a1' }}>
                        {processData.team_performance.unloading.total_unloaded}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Volume into Silos</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#166534' }}>
                        {formatLitres(processData.team_performance.unloading.total_volume_litres, 1)}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>Avg Unloading Time</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#1e293b' }}>
                        {formatDuration(processData.team_performance.unloading.avg_unload_min)}
                      </div>
                    </div>
                    <div style={{ background: '#f8fafc', padding: '8px', borderRadius: 6 }}>
                      <div style={{ color: '#64748b' }}>SLA Delayed</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: processData.team_performance.unloading.delayed_count > 0 ? '#dc2626' : '#16a34a' }}>
                        {processData.team_performance.unloading.delayed_count}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quality Reconciliation Card */}
              <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 1rem 0', color: '#1e293b' }}>
                  🧪 Process Quality &amp; Chemical Reconciliation (BMC vs Plant Receipt)
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', backgroundColor: '#f8fafc' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>FAT Reconciliation</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
                      {processData.quality_reconciliation.avg_dispatch_fat}% &rarr; {processData.quality_reconciliation.avg_received_fat}%
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: processData.quality_reconciliation.fat_variance < -0.1 ? '#dc2626' : '#16a34a', marginTop: 2 }}>
                      Variance: {processData.quality_reconciliation.fat_variance > 0 ? `+${processData.quality_reconciliation.fat_variance}%` : `${processData.quality_reconciliation.fat_variance}%`}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', backgroundColor: '#f8fafc' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>SNF Reconciliation</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
                      {processData.quality_reconciliation.avg_dispatch_snf}% &rarr; {processData.quality_reconciliation.avg_received_snf}%
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: processData.quality_reconciliation.snf_variance < -0.1 ? '#dc2626' : '#16a34a', marginTop: 2 }}>
                      Variance: {processData.quality_reconciliation.snf_variance > 0 ? `+${processData.quality_reconciliation.snf_variance}%` : `${processData.quality_reconciliation.snf_variance}%`}
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', backgroundColor: '#f8fafc' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Arrival Milk Temp</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0369a1' }}>
                      {processData.quality_reconciliation.avg_temperature != null ? `${processData.quality_reconciliation.avg_temperature}°C` : 'N/A'}
                    </div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', marginTop: 2 }}>
                      {processData.quality_reconciliation.temp_compliant_pct}% within &le; 4.5°C benchmark
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', backgroundColor: '#f8fafc' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Organoleptic Pass Rate</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#166534' }}>
                      {processData.quality_reconciliation.organoleptic_satisfied_pct}% Satisfied
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                      Taste, smell, and visual appearance
                    </div>
                  </div>
                </div>

                {processData.team_performance.qc.rejection_reasons.length > 0 && (
                  <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                    <strong style={{ fontSize: '0.82rem', color: '#991b1b', display: 'block', marginBottom: 6 }}>
                      QC Rejection Reasons Logged in Period:
                    </strong>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {processData.team_performance.qc.rejection_reasons.map((r, i) => (
                        <span
                          key={i}
                          style={{
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            padding: '3px 8px',
                            borderRadius: 4,
                            fontSize: '0.78rem',
                            fontWeight: 600,
                          }}
                        >
                          {r.reason} ({r.count})
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Live In-Plant Tankers Monitor Table */}
              <div className="card table-card" style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b' }}>
                      Live Plant Floor: Tankers Inside Dairy ({processData.active_tankers.length})
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Real-time tracker of all vehicles currently navigating plant stages
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-link btn-sm"
                    onClick={() => navigate('/admin/tanker?tab=waiting')}
                  >
                    View All in Tanker Register &rarr;
                  </button>
                </div>

                <DataTable
                  rows={processData.active_tankers}
                  columns={activeTankersColumns}
                  getRowKey={(t) => t.id}
                  getRowClassName={(t) => (t.is_over_limit ? 'row-danger' : '')}
                  emptyMessage="No tankers currently waiting in plant. Plant floor is clear!"
                />
              </div>

              {/* Source BMC Process Scorecard Table */}
              <div className="card table-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: 6 }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b' }}>
                      Source BMC Process &amp; Transit Performance Scorecard
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Volume dispatched vs received, transit loss, quality variances and turnaround by collection center
                    </span>
                  </div>
                </div>

                <DataTable
                  rows={processData.bmc_performance}
                  columns={bmcProcessColumns}
                  getRowKey={(b) => b.unit_id}
                  getRowClassName={(b) => (b.health === 'danger' ? 'row-danger' : b.health === 'warn' ? 'row-warn' : '')}
                  emptyMessage="No tanker dispatches recorded for this period."
                  showTotalsRow
                />
              </div>
            </>
          ) : null}
        </>
      )}

      {/* ======================================================== */}
      {/* 2. PROCUREMENT ANALYTICS VIEW (LEGACY COMPATIBILITY)     */}
      {/* ======================================================== */}
      {viewMode === 'procurement' && (
        <>
          {adminToday && (
            <div className="card form-card" style={{ marginBottom: '1.25rem' }}>
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
                      {adminToday.units_pending.map((u) => (
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
                      {adminToday.units_flagged.map((u) => (
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
                  onClick={() => navigate('/admin/milk')}
                />
                <StatCard
                  label={t('netAccepted')}
                  value={formatLitres(c.net_quantity, 1)}
                  tooltip={t('tipNetQuantity')}
                  onClick={() => navigate('/admin/milk')}
                />
                <StatCard
                  label={t('rejected')}
                  value={`${formatLitres(c.rejection, 1)} (${rejPct.toFixed(1)}%)`}
                  valueTone={rejTone}
                  tooltip={t('tipRejectionPct')}
                  onClick={() => navigate('/admin/milk?quality=flagged')}
                />
                <StatCard
                  label={t('avgFatSnf')}
                  value={`${formatFatSnf(c.avg_fat)}% / ${formatFatSnf(c.avg_snf)}%`}
                  tooltip={t('tipSnf')}
                  sub="Qty-weighted average"
                  onClick={() => navigate('/admin/milk')}
                />
                <StatCard
                  label={t('procurementCost')}
                  value={formatINR(c.cost)}
                  tooltip={t('tipProcurementCost')}
                  onClick={() => navigate('/admin/milk')}
                />
                <StatCard
                  label={t('estRevenue')}
                  value={formatINR(c.revenue ?? 0)}
                  sub={`Rate: ₹${sellingRate}/L`}
                  onClick={() => navigate('/admin/milk')}
                />
                <StatCard
                  label={(c.profit ?? 0) >= 0 ? t('netProfit') : t('netLoss')}
                  value={formatINR(c.profit ?? 0, { showPlus: (c.profit ?? 0) > 0 })}
                  valueTone={(c.profit ?? 0) >= 0 ? 'positive' : 'negative'}
                  positive={(c.profit ?? 0) >= 0}
                  sub={c.revenue ? `Margin: ${(((c.profit ?? 0) / c.revenue) * 100).toFixed(1)}%` : undefined}
                  onClick={() => navigate('/admin/milk')}
                />
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
                data={unitsData.filter((u) => u.entries_count > 0)}
                sellingRate={sellingRate}
              />

              <UnitQuantityBarChart
                data={unitsData.filter((u) => u.entries_count > 0)}
              />

              <div className="card table-card">
                <h2>Unit Performance Breakdown</h2>
                <DataTable
                  rows={unitsData}
                  columns={unitColumns}
                  getRowKey={(u) => u.unit_id}
                  getRowClassName={(u) => (u.health === 'danger' ? 'row-danger' : u.health === 'warn' ? 'row-warn' : '')}
                  emptyMessage="No collection units created yet."
                  emptyActionLabel="Manage Units"
                  onEmptyAction={() => navigate('/admin/units')}
                  showTotalsRow
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
