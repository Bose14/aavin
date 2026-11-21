import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  formatLitres,
  getLocalTodayIso,
} from '../../lib/format';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import {
  ErrorBanner,
  StatsGridSkeleton,
  TableSkeleton,
} from '../../components/UiPrimitives';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';
import {
  MilkVolumeChart,
  TransitLossTrendChart,
} from '../../components/ProcessCharts';

// ==========================================
// BMC Process Analytics Interfaces
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
  quality_reconciliation: QualityReconciliation;
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

export default function UnitDashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings } = useDairyUnitSettings();

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  const [processData, setProcessData] = useState<ProcessAnalyticsResponse | null>(null);
  const [tankers, setTankers] = useState<any[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      const [procRes, tkRes] = await Promise.all([
        api.get<ProcessAnalyticsResponse>('/analytics/process', { params }),
        api.get<any[]>('/tanker', { params: { status: 'all' } }).catch(() => ({ data: [] })),
      ]);
      setProcessData(procRes.data);
      setTankers(tkRes.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load process analytics.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const rangeFrom = processData?.date_range?.from;
  const rangeTo = processData?.date_range?.to;

  const formatDuration = (mins: number | null | undefined) => {
    if (mins == null) return 'N/A';
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const kpis = processData?.kpis;
  const totalCompleted = (kpis?.completed_count ?? 0) + (kpis?.qc_rejected_count ?? 0);
  const qcAcceptanceRate =
    totalCompleted > 0
      ? (((kpis?.completed_count ?? 0) / totalCompleted) * 100).toFixed(1)
      : '100.0';

  const unitHeading = profile?.bmcs
    ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code}`
    : profile?.full_name ?? 'BMC Unit';

  // Delayed tankers alert check
  const delayedActiveTankers = processData?.active_tankers.filter((t) => t.is_over_limit) ?? [];

  // Daily trend columns
  const dailyColumns: DataColumn<{
    date: string;
    dispatched_count: number;
    dispatched_litres: number;
    received_count: number;
    received_litres: number;
    transit_loss_litres: number;
    qc_rejected_count: number;
    avg_turnaround_min: number | null;
  }>[] = [
    {
      key: 'date',
      header: 'Date',
      sortValue: (d) => d.date,
      render: (d) => <span style={{ fontWeight: 600 }}>{formatDateDDMMYYYY(d.date)}</span>,
    },
    {
      key: 'dispatched_litres',
      header: 'Dispatched (L)',
      sortValue: (d) => d.dispatched_litres,
      render: (d) => (
        <span>
          <strong>{formatLitres(d.dispatched_litres, 1)}</strong>{' '}
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>({d.dispatched_count} trips)</span>
        </span>
      ),
    },
    {
      key: 'received_litres',
      header: 'Silo Received (L)',
      sortValue: (d) => d.received_litres,
      render: (d) => (
        <span style={{ color: '#047857', fontWeight: 600 }}>
          {formatLitres(d.received_litres, 1)}
        </span>
      ),
    },
    {
      key: 'transit_loss_litres',
      header: 'Transit Loss',
      sortValue: (d) => d.transit_loss_litres,
      render: (d) => {
        const loss = d.transit_loss_litres;
        const pct = d.dispatched_litres > 0 ? (loss / d.dispatched_litres) * 100 : 0;
        const isHigh = pct >= 0.5;
        return (
          <span style={{ color: isHigh ? '#dc2626' : '#475569', fontWeight: 600 }}>
            {loss > 0 ? `-${formatLitres(loss, 1)}` : '0.0 L'}{' '}
            <span style={{ fontSize: '0.75rem' }}>({pct.toFixed(2)}%)</span>
          </span>
        );
      },
    },
    {
      key: 'qc_rejected_count',
      header: 'QC Rejected',
      sortValue: (d) => d.qc_rejected_count,
      render: (d) =>
        d.qc_rejected_count > 0 ? (
          <span style={{ color: '#dc2626', fontWeight: 700 }}>{d.qc_rejected_count} trips</span>
        ) : (
          <span style={{ color: '#16a34a', fontWeight: 600 }}>0</span>
        ),
    },
    {
      key: 'avg_turnaround_min',
      header: 'Avg Turnaround',
      sortValue: (d) => d.avg_turnaround_min ?? 0,
      render: (d) => <span>{formatDuration(d.avg_turnaround_min)}</span>,
    },
  ];

  return (
    <div className="page">
      {/* Top Header */}
      <div className="page-header" style={{ marginBottom: '1.25rem', paddingBottom: '0.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span style={{ fontSize: '1.4rem' }}>🥛</span>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
              {unitHeading} Process Analytics
            </h1>
          </div>
          {rangeFrom && rangeTo && (
            <div style={{ margin: '2px 0 0 0', fontSize: '0.86rem', color: '#64748b' }}>
              <strong style={{ color: '#334155' }}>
                {formatDateDDMMYYYY(rangeFrom)} to {formatDateDDMMYYYY(rangeTo)}
              </strong>
            </div>
          )}
        </div>

        {/* Period Selector Tabs */}
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="period-tabs">
            {(['today', 'week', 'month', 'year', 'custom'] as const).map((pr) => (
              <button
                key={pr}
                type="button"
                className={`tab ${period === pr ? 'active' : ''}`}
                onClick={() => setPeriod(pr)}
              >
                {pr === 'today' ? 'Today' : t(pr)}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="custom-range-bar">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={{ height: 32, fontSize: '0.8rem' }}
              />
              <span className="custom-range-sep">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={{ height: 32, fontSize: '0.8rem' }}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}
                style={{ height: 32, fontSize: '0.8rem' }}
              >
                {t('apply')}
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/bmc/tanker')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px', padding: '0 14px' }}
          >
            <span>+</span> Dispatch Tanker
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* Delay Alert Banner */}
      {delayedActiveTankers.length > 0 && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(220, 38, 38, 0.1)',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong style={{ color: '#991b1b', fontSize: '0.92rem' }}>
              SLA Delay Alert ({delayedActiveTankers.length} {delayedActiveTankers.length === 1 ? 'tanker' : 'tankers'} delayed):
            </strong>
            <div style={{ fontSize: '0.84rem', color: '#7f1d1d', marginTop: 2 }}>
              {delayedActiveTankers.map((t) => (
                <span key={t.id} style={{ marginRight: 16 }}>
                  • <strong>{t.tanker_number}</strong> (DC #{t.dc_number}): waiting at{' '}
                  <strong style={{ textDecoration: 'underline' }}>{t.current_stage_title}</strong> for{' '}
                  <strong>{t.waiting_team_label}</strong> team ({formatDuration(t.waiting_since_minutes)})
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('/bmc/records?status=waiting')}
            style={{ fontSize: '0.78rem', height: 28, padding: '0 10px', whiteSpace: 'nowrap' }}
          >
            Track in Records &rarr;
          </button>
        </div>
      )}

      {loading ? (
        <>
          <StatsGridSkeleton count={7} />
          <TableSkeleton rows={4} cols={7} />
        </>
      ) : processData ? (
        <>
          {/* 1. Dairy Journey Pipeline Stepper (7 Stages) */}
          <div
            className="card"
            style={{
              padding: '14px 18px',
              marginBottom: '1.25rem',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              backgroundColor: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔄</span> Live Dairy Plant Reception Pipeline (7 Stages)
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  Real-time progression of tankers dispatched by {unitHeading}
                </span>
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                Active in Plant: <strong style={{ color: '#0284c7' }}>{processData.kpis.active_in_plant_count}</strong>
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
              }}
            >
              {processData.pipeline.map((stage, idx) => {
                const isActive = stage.active_count > 0;
                const hasDelay = stage.delayed_count > 0;
                return (
                  <div
                    key={stage.key}
                    style={{
                      border: `1.5px solid ${hasDelay ? '#ef4444' : isActive ? stage.color : '#e2e8f0'}`,
                      backgroundColor: hasDelay ? '#fef2f2' : isActive ? '#f0f9ff' : '#f8fafc',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      minHeight: 88,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>
                          STEP {idx + 1}
                        </span>
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            backgroundColor: '#e2e8f0',
                            color: '#475569',
                          }}
                        >
                          {stage.team_label}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b', lineHeight: 1.25 }}>
                        {stage.title}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                      <span
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 800,
                          color: hasDelay ? '#dc2626' : isActive ? '#0369a1' : '#94a3b8',
                        }}
                      >
                        {stage.active_count}
                      </span>
                      {hasDelay && (
                        <span
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 800,
                            color: '#ffffff',
                            backgroundColor: '#ef4444',
                            padding: '1px 5px',
                            borderRadius: 4,
                          }}
                        >
                          {stage.delayed_count} DELAYED
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Process KPIs Grid */}
          <div className="stats-grid" style={{ marginBottom: '1.25rem' }}>
            <StatCard
              label="Total Dispatched"
              value={formatLitres(processData.kpis.total_dispatched_litres, 1)}
              sub={`${processData.kpis.total_dispatched_count} outward trips`}
              onClick={() => navigate('/bmc/records')}
            />
            <StatCard
              label="Active in Plant"
              value={`${processData.kpis.active_in_plant_count} tankers`}
              sub="Navigating dairy stages"
              valueTone={processData.kpis.active_in_plant_count > 0 ? 'warning' : undefined}
              onClick={() => navigate('/bmc/records?status=waiting')}
            />
            <StatCard
              label="Received in Silos"
              value={formatLitres(processData.kpis.completed_litres, 1)}
              sub={`${processData.kpis.completed_count} trips completed`}
              positive={processData.kpis.completed_count > 0}
              onClick={() => navigate('/bmc/records?status=processed')}
            />
            <StatCard
              label="Transit Loss"
              value={`${formatLitres(processData.kpis.transit_loss_litres, 1)} (${processData.kpis.transit_loss_pct.toFixed(2)}%)`}
              valueTone={
                processData.kpis.transit_loss_tone === 'green'
                  ? 'positive'
                  : processData.kpis.transit_loss_tone === 'amber'
                  ? 'warning'
                  : 'negative'
              }
              sub={
                processData.kpis.transit_loss_tone === 'green'
                  ? 'Within threshold (≤ 0.5%)'
                  : 'Attention needed'
              }
              positive={processData.kpis.transit_loss_tone === 'green'}
              onClick={() => navigate('/bmc/records')}
            />
            <StatCard
              label="QC Acceptance"
              value={`${qcAcceptanceRate}%`}
              sub={`${processData.kpis.qc_rejected_count} rejected`}
              valueTone={processData.kpis.qc_rejected_count > 0 ? 'negative' : 'positive'}
              positive={processData.kpis.qc_rejected_count === 0}
              onClick={() => navigate('/bmc/records?status=rejected')}
            />
            <StatCard
              label="Avg Turnaround"
              value={formatDuration(processData.kpis.avg_plant_turnaround_min)}
              sub="Gate In to Gate Out"
              onClick={() => navigate('/bmc/records')}
            />
            <StatCard
              label="SLA Compliance"
              value={`${processData.kpis.sla_compliance_pct}%`}
              sub={`${processData.kpis.sla_delayed_count} delayed stages`}
              valueTone={processData.kpis.sla_compliance_pct >= 90 ? 'positive' : 'warning'}
              positive={processData.kpis.sla_compliance_pct >= 90}
              onClick={() => navigate('/bmc/records')}
            />
          </div>

          {/* 3. Process Quality & Chemical Reconciliation Card */}
          <div
            className="card"
            style={{
              marginBottom: '1.25rem',
              padding: '1.15rem 1.25rem',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              backgroundColor: '#ffffff',
            }}
          >
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: '0 0 0.9rem 0', color: '#1e293b' }}>
              🧪 Process Quality &amp; Chemical Reconciliation (BMC vs Plant Receipt)
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px' }}>
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', backgroundColor: '#f8fafc' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>FAT Reconciliation</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                  {processData.quality_reconciliation.avg_dispatch_fat}% &rarr; {processData.quality_reconciliation.avg_received_fat}%
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: processData.quality_reconciliation.fat_variance < -0.1 ? '#dc2626' : '#16a34a',
                    marginTop: 4,
                  }}
                >
                  Variance: {processData.quality_reconciliation.fat_variance > 0 ? `+${processData.quality_reconciliation.fat_variance}%` : `${processData.quality_reconciliation.fat_variance}%`}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', backgroundColor: '#f8fafc' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>SNF Reconciliation</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                  {processData.quality_reconciliation.avg_dispatch_snf}% &rarr; {processData.quality_reconciliation.avg_received_snf}%
                </div>
                <div
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: processData.quality_reconciliation.snf_variance < -0.1 ? '#dc2626' : '#16a34a',
                    marginTop: 4,
                  }}
                >
                  Variance: {processData.quality_reconciliation.snf_variance > 0 ? `+${processData.quality_reconciliation.snf_variance}%` : `${processData.quality_reconciliation.snf_variance}%`}
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', backgroundColor: '#f8fafc' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Arrival Milk Temp</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0369a1' }}>
                  {processData.quality_reconciliation.avg_temperature != null ? `${processData.quality_reconciliation.avg_temperature}°C` : 'N/A'}
                </div>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#16a34a', marginTop: 4 }}>
                  {processData.quality_reconciliation.temp_compliant_pct}% within &le; 4.5°C benchmark
                </div>
              </div>

              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', backgroundColor: '#f8fafc' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 4 }}>Organoleptic Pass Rate</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#166534' }}>
                  {processData.quality_reconciliation.organoleptic_satisfied_pct}% Satisfied
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>
                  Appearance, flavor, and sediment test
                </div>
              </div>
            </div>
          </div>

          {/* Graphical Analytics (Clean & User-Friendly) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
            <MilkVolumeChart
              data={processData.daily_trend}
              title="Daily Milk Volume: Dispatched vs Received"
              emptyActionLabel="Dispatch Tanker"
              onEmptyAction={() => navigate('/bmc/tanker')}
            />

            <TransitLossTrendChart
              data={processData.daily_trend}
              threshold={settings.transit_loss_warn_pct ?? 0.5}
              title="Daily Transit Loss Trend & Threshold"
            />
          </div>

          {/* 4. Outward Tanker Dispatches & Live Plant Status */}
          <div
            className="card"
            style={{
              marginBottom: '1.25rem',
              padding: '16px 20px',
              backgroundColor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🥛</span> Outward Tanker Dispatches &amp; Live Plant Status ({tankers.length})
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate('/bmc/records')}
                style={{ fontSize: '0.8rem', fontWeight: 600 }}
              >
                View Full Audit Register &rarr;
              </button>
            </div>

            {tankers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                No outward tankers dispatched yet during this period.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/bmc/tanker')}
                  style={{ background: 'none', border: 'none', color: '#0284c7', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  Create first tanker dispatch
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                      <th style={{ padding: '8px 10px' }}>Date</th>
                      <th style={{ padding: '8px 10px' }}>Tanker / Lorry</th>
                      <th style={{ padding: '8px 10px' }}>DC No</th>
                      <th style={{ padding: '8px 10px' }}>Dispatched Litres</th>
                      <th style={{ padding: '8px 10px' }}>Compartments</th>
                      <th style={{ padding: '8px 10px' }}>Driver</th>
                      <th style={{ padding: '8px 10px' }}>Destination</th>
                      <th style={{ padding: '8px 10px' }}>Plant Stage</th>
                      <th style={{ padding: '8px 10px' }}>Dairy Received</th>
                      <th style={{ padding: '8px 10px' }}>Transit Loss</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Dossier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tankers.slice(0, 15).map((t) => {
                      const j = t.journey;
                      const isRej = j?.isQcRejected || t.qc_status === 'rejected';
                      const dc = t.dc_number || t.stage_data?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '—';
                      const comps = t.compartments || j?.compartments || t.stage_data?.compartments || [];
                      const compCount = comps.length > 0 ? comps.length : 1;
                      const calc = j?.calculated;

                      return (
                        <tr
                          key={t.id}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            setSelectedTrip(t);
                            setDrawerOpen(true);
                          }}
                        >
                          <td style={{ padding: '8px 10px', color: '#64748b' }}>
                            {t.created_at ? formatDateTimeDDMMYYYY(t.created_at) : formatDateDDMMYYYY(t.date)}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>
                            {t.tanker_number}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0284c7', fontWeight: 600 }}>
                            #{dc}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>
                            {formatLitres(t.quantity_dispatched, 1)}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569' }}>
                            <span
                              style={{
                                backgroundColor: '#f1f5f9',
                                color: '#334155',
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontWeight: 600,
                                fontSize: '0.72rem',
                              }}
                            >
                              {compCount} {compCount === 1 ? 'Comp' : 'Comps'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px', color: '#334155' }}>
                            {t.driver_name || 'Driver'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569' }}>
                            {t.destination || 'Namakkal Dairy'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {isRej ? (
                              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 7px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                                QC REJECTED
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: j?.stageColor?.badgeBg || '#e0f2fe',
                                  color: j?.stageColor?.badgeText || '#0369a1',
                                  border: `1px solid ${j?.stageColor?.border || '#bae6fd'}`,
                                  padding: '2px 7px',
                                  borderRadius: 4,
                                  fontWeight: 600,
                                  fontSize: '0.72rem',
                                }}
                              >
                                {j?.tripStatusLabel || 'Dispatched'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#047857', fontWeight: 600 }}>
                            {t.received_qty != null
                              ? formatLitres(t.received_qty, 1)
                              : calc?.received_litres != null
                              ? formatLitres(calc.received_litres, 1)
                              : '—'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {calc?.transit_loss_litres != null ? (
                              <span
                                style={{
                                  color: calc.transit_loss_pct > 0.5 ? '#dc2626' : '#475569',
                                  fontWeight: 600,
                                }}
                              >
                                {calc.transit_loss_litres > 0 ? `-${formatLitres(calc.transit_loss_litres, 1)}` : '0.0 L'}{' '}
                                <span style={{ fontSize: '0.72rem' }}>
                                  ({calc.transit_loss_pct?.toFixed(2)}%)
                                </span>
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '0.75rem', height: '28px', padding: '0 10px', width: 'auto' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedTrip(t);
                                setDrawerOpen(true);
                              }}
                            >
                              View Dossier
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 5. Daily Activity & Trend Breakdown */}
          {processData.daily_trend && processData.daily_trend.length > 0 && (
            <div className="card table-card" style={{ borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: '1.5rem' }}>
              <div style={{ padding: '1rem 1.25rem 0.5rem' }}>
                <h2 style={{ margin: 0, padding: 0, fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>
                  📅 Daily Process Activity &amp; Loss Breakdown
                </h2>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  Daily comparison of outward dispatch volume against plant silo receipt and transit loss
                </span>
              </div>

              <DataTable
                rows={processData.daily_trend}
                columns={dailyColumns}
                getRowKey={(d) => d.date}
                emptyMessage="No daily activity recorded for this period."
              />
            </div>
          )}
        </>
      ) : null}

      {/* Tanker Dossier Drawer for BMC staff */}
      <TankerDetailDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        trip={selectedTrip}
        onTripUpdated={fetchData}
        isAdmin={false}
      />
    </div>
  );
}
