import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MilkCollectionTrendChart, QualityTrendChart } from '../../components/CollectionCharts';
import type { CollectionTrendDatum } from '../../components/CollectionCharts';
import { DailyProfitLossChart } from '../../components/ProfitLossChart';
import type { DailyProfitDatum } from '../../components/ProfitLossChart';
import { ChartSkeleton, ErrorBanner, StatsGridSkeleton, StatusBadge } from '../../components/UiPrimitives';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';

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

interface SummaryResponse {
  current: Stats;
  previous: Stats;
  selling_rate: number;
  date_range: { from: string; to: string };
  today_status: {
    date: string;
    am_done: boolean;
    pm_done: boolean;
    tanker_dispatched: boolean;
  };
}

interface TrendPoint extends CollectionTrendDatum, DailyProfitDatum {}

export default function UnitDashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings, currentSellingRate } = useZoneSettings();

  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'custom'>('week');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
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
      const [s, tr, tk] = await Promise.all([
        api.get<SummaryResponse>('/analytics/summary', { params }),
        api.get<TrendPoint[]>('/analytics/trend', { params }),
        api.get<any[]>('/tanker', { params: { status: 'all' } }).catch(() => ({ data: [] })),
      ]);
      setSummary(s.data);
      setTrend(tr.data);
      setTankers(tk.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load dashboard metrics. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const c = summary?.current;
  const p = summary?.previous;
  const effectiveSellingRate = summary?.selling_rate ?? currentSellingRate;
  const rangeFrom = summary?.date_range?.from ?? '';
  const rangeTo = summary?.date_range?.to ?? '';
  const profitEnabled = c != null && c.profit != null && c.revenue != null;

  const rejPct = c?.rejection_pct ?? (c && c.quantity > 0 ? +((c.rejection / c.quantity) * 100).toFixed(2) : 0);
  const rejTone = rejPct >= settings.rejection_danger_pct
    ? 'negative'
    : rejPct >= settings.rejection_warn_pct
      ? 'warning'
      : undefined;

  const openFilteredRecords = (extra?: Record<string, string>) => {
    const qs = new URLSearchParams();
    if (rangeFrom) qs.set('from', rangeFrom);
    if (rangeTo) qs.set('to', rangeTo);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) qs.set(k, v);
    }
    navigate(`/unit/records?${qs.toString()}`);
  };

  const profitSeries = useMemo(
    () =>
      trend.map(d => ({
        date: d.date,
        no_entry: d.no_entry,
        revenue: Number(d.revenue ?? 0),
        cost: Number(d.cost ?? 0),
        profit: Number(d.profit ?? 0),
      })),
    [trend],
  );

  const unitHeading = profile?.units
    ? `${profile.units.name} · ${profile.units.unit_code}`
    : profile?.full_name ?? 'Unit';

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{unitHeading}</h1>
          <p className="page-subtitle">
            {t('costTrendHint')}
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

      {summary?.today_status && (
        <div className="today-strip" aria-label={t('todayStatus')}>
          <span className="today-strip-title">
            {t('todayStatus')} ({formatDateDDMMYYYY(summary.today_status.date)})
          </span>
          <div className="today-strip-items">
            <span className="today-strip-item">
              <span>{t('amEntry')}:</span>
              <StatusBadge tone={summary.today_status.am_done ? 'green' : 'amber'}>
                {summary.today_status.am_done ? t('done') : t('pending')}
              </StatusBadge>
            </span>
            <span className="today-strip-item">
              <span>{t('pmEntry')}:</span>
              <StatusBadge tone={summary.today_status.pm_done ? 'green' : 'amber'}>
                {summary.today_status.pm_done ? t('done') : t('pending')}
              </StatusBadge>
            </span>
            <span className="today-strip-item">
              <span>{t('tankerDispatched')}:</span>
              <StatusBadge tone={summary.today_status.tanker_dispatched ? 'green' : 'grey'}>
                {summary.today_status.tanker_dispatched ? t('yes') : t('no')}
              </StatusBadge>
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary btn-sm today-strip-cta"
            onClick={() => navigate('/unit/milk-entry')}
          >
            + {t('navMilkEntry')}
          </button>
        </div>
      )}

      {loading ? (
        <>
          <StatsGridSkeleton count={6} />
          <ChartSkeleton height={260} />
          <ChartSkeleton height={240} />
        </>
      ) : c ? (
        <>
          <div className="stats-grid">
            <StatCard
              label={t('totalCollected')}
              value={formatLitres(c.quantity, 1)}
              sub={calcPeriodDelta(c.quantity, p?.quantity ?? 0) ?? undefined}
              positive={p?.quantity ? c.quantity >= p.quantity : undefined}
              onClick={() => openFilteredRecords()}
            />
            <StatCard
              label={t('netAccepted')}
              value={formatLitres(c.net_quantity, 1)}
              tooltip={t('tipNetQuantity')}
              onClick={() => openFilteredRecords()}
            />
            <StatCard
              label={t('rejected')}
              value={`${formatLitres(c.rejection, 1)} (${rejPct.toFixed(1)}%)`}
              valueTone={rejTone}
              tooltip={t('tipRejectionPct')}
              sub={
                rejPct >= settings.rejection_danger_pct
                  ? `Critical (≥ ${settings.rejection_danger_pct}%)`
                  : rejPct >= settings.rejection_warn_pct
                    ? `Warning (≥ ${settings.rejection_warn_pct}%)`
                    : 'Within limit'
              }
              positive={rejPct < settings.rejection_warn_pct ? true : false}
              onClick={() => openFilteredRecords({ quality: 'flagged' })}
            />
            <StatCard
              label={t('avgFatSnf')}
              value={`${formatFatSnf(c.avg_fat)}% / ${formatFatSnf(c.avg_snf)}%`}
              tooltip={t('tipSnf')}
              sub="Qty-weighted average"
              onClick={() => openFilteredRecords()}
            />
            <StatCard
              label={t('procurementCost')}
              value={formatINR(c.cost)}
              tooltip={t('tipProcurementCost')}
              sub={settings.rejection_payment_rule === 'gross' && c.rejection_loss
                ? `Incl. ${formatINR(c.rejection_loss)} rej loss`
                : 'Rule: NET accepted'}
              onClick={() => openFilteredRecords()}
            />
            {profitEnabled ? (
              <>
                <StatCard
                  label={t('estRevenue')}
                  value={formatINR(c.revenue ?? 0)}
                  sub={`Rate: ₹${effectiveSellingRate}/L`}
                  onClick={() => openFilteredRecords()}
                />
                <StatCard
                  label={(c.profit ?? 0) >= 0 ? t('netProfit') : t('netLoss')}
                  value={formatINR(c.profit ?? 0, { showPlus: (c.profit ?? 0) > 0 })}
                  valueTone={(c.profit ?? 0) >= 0 ? 'positive' : 'negative'}
                  positive={(c.profit ?? 0) >= 0}
                  sub={
                    c.revenue
                      ? `Margin: ${(((c.profit ?? 0) / c.revenue) * 100).toFixed(1)}%`
                      : undefined
                  }
                  onClick={() => openFilteredRecords()}
                />
              </>
            ) : null}
          </div>

          {/* Outward Tanker Dispatches & Live Plant Status */}
          <div
            className="card"
            style={{
              marginTop: '16px',
              marginBottom: '16px',
              padding: '16px 20px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🥛</span> Outward Tanker Dispatches &amp; Live Plant Status ({tankers.length})
                </h2>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                  Track your dispatched milk tankers, DC delivery challans, and real-time dairy reception stages
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/unit/tanker')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', height: '34px', padding: '0 14px', width: 'auto' }}
              >
                <span>+</span> Dispatch Tanker
              </button>
            </div>

            {tankers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                No tankers dispatched yet during this period.{' '}
                <button
                  type="button"
                  onClick={() => navigate('/unit/tanker')}
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
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Dossier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tankers.slice(0, 10).map((t) => {
                      const j = t.journey;
                      const isRej = j?.isQcRejected || t.qc_status === 'rejected';
                      const dc = t.dc_number || t.stage_data?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '—';
                      const comps = t.compartments || j?.compartments || t.stage_data?.compartments || [];
                      const compCount = comps.length > 0 ? comps.length : 1;

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
                            {formatDateDDMMYYYY(t.date)}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>
                            {t.tanker_number}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0284c7', fontWeight: 600 }}>
                            #{dc}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 600 }}>
                            {formatLitres(t.quantity_dispatched)}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569' }}>
                            {compCount} {compCount === 1 ? 'comp' : 'comps'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#334155' }}>
                            {t.driver_name || 'Driver'}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#475569' }}>
                            {t.destination || 'Salem Dairy'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {isRej ? (
                              <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                                QC REJECTED
                              </span>
                            ) : (
                              <span
                                style={{
                                  background: j?.stageColor?.badgeBg || '#e0f2fe',
                                  color: j?.stageColor?.badgeText || '#0369a1',
                                  border: `1px solid ${j?.stageColor?.border || '#bae6fd'}`,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  fontWeight: 600,
                                  fontSize: '0.72rem',
                                }}
                              >
                                {j?.tripStatusLabel || 'Dispatched'}
                              </span>
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

          <MilkCollectionTrendChart
            data={trend}
            mode="unit"
            emptyActionLabel={t('noDataAddFirst')}
            onEmptyAction={() => navigate('/unit/milk-entry')}
          />

          <QualityTrendChart
            data={trend}
            fatBenchmark={settings.fat_benchmark}
            snfBenchmark={settings.snf_benchmark}
            emptyActionLabel={t('noDataAddFirst')}
            onEmptyAction={() => navigate('/unit/milk-entry')}
          />

          {profitEnabled && (
            <DailyProfitLossChart
              data={profitSeries}
              sellingRate={effectiveSellingRate}
              emptyActionLabel={t('noDataAddFirst')}
              onEmptyAction={() => navigate('/unit/milk-entry')}
            />
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
