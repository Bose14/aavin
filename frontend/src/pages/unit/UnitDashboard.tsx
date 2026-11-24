import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { formatDateDDMMYYYY, formatLitres, getLocalTodayIso } from '../../lib/format';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ErrorBanner, StatsGridSkeleton, TableSkeleton } from '../../components/UiPrimitives';
import { MilkVolumeChart } from '../../components/ProcessCharts';
import { Page, PageHeader } from '../../components/PageLayout';

interface ProcessKPIs {
  total_dispatched_count: number;
  total_dispatched_litres: number;
  completed_count: number;
  completed_litres: number;
  transit_loss_litres: number;
  transit_loss_pct: number;
  transit_loss_tone: 'green' | 'amber' | 'red';
}

interface DailyTrend {
  date: string;
  dispatched_count: number;
  dispatched_litres: number;
  received_count: number;
  received_litres: number;
  transit_loss_litres: number;
  qc_rejected_count: number;
  avg_turnaround_min: number | null;
}

interface ProcessAnalyticsResponse {
  period: string;
  date_range: { from: string; to: string };
  kpis: ProcessKPIs;
  daily_trend: DailyTrend[];
}

interface StockSummary {
  collected_net_qty: number;
  dispatched_qty: number;
  available_stock_qty: number;
}

interface MilkRow { date: string; quantity_litres: number; rejection_qty?: number | null }

type DayRow = DailyTrend & { collected_litres: number };

export default function UnitDashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  const [data, setData] = useState<ProcessAnalyticsResponse | null>(null);
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [collectedByDay, setCollectedByDay] = useState<Record<string, number>>({});
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
      const [procRes, stockRes] = await Promise.all([
        api.get<ProcessAnalyticsResponse>('/analytics/process', { params }),
        api.get<StockSummary>('/tanker/stock').catch(() => ({ data: null })),
      ]);
      setData(procRes.data);
      setStock(stockRes.data);
      const milk = await api.get<MilkRow[]>('/milk', { params: { from: procRes.data.date_range.from, to: procRes.data.date_range.to } });
      const byDay: Record<string, number> = {};
      for (const m of milk.data || []) {
        byDay[m.date] = (byDay[m.date] ?? 0) + Number(m.quantity_litres) - Number(m.rejection_qty ?? 0);
      }
      setCollectedByDay(byDay);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const rangeFrom = data?.date_range?.from;
  const rangeTo = data?.date_range?.to;
  const unitHeading = profile?.bmcs ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code}` : profile?.full_name ?? 'BMC Unit';
  const totalCollected = Object.values(collectedByDay).reduce((s, v) => s + v, 0);

  const rows: DayRow[] = useMemo(() => {
    if (!data) return [];
    const byDate = new Map<string, DayRow>();
    for (const d of data.daily_trend) byDate.set(d.date, { ...d, collected_litres: collectedByDay[d.date] ?? 0 });
    for (const [date, litres] of Object.entries(collectedByDay)) {
      if (!byDate.has(date)) {
        byDate.set(date, { date, dispatched_count: 0, dispatched_litres: 0, received_count: 0, received_litres: 0, transit_loss_litres: 0, qc_rejected_count: 0, avg_turnaround_min: null, collected_litres: litres });
      }
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [data, collectedByDay]);

  const sum = (f: (r: DayRow) => number) => rows.reduce((s, r) => s + f(r), 0);

  const columns: DataColumn<DayRow>[] = [
    { key: 'date', header: 'Date', sortValue: (d) => d.date, render: (d) => <strong>{formatDateDDMMYYYY(d.date)}</strong>, footerCell: <strong>Total</strong> },
    { key: 'collected', header: 'Collected (L)', align: 'right', sortValue: (d) => d.collected_litres, render: (d) => formatLitres(d.collected_litres, 1), footerCell: <strong>{formatLitres(sum((r) => r.collected_litres), 1)}</strong> },
    { key: 'dispatched', header: 'Dispatched (L)', align: 'right', sortValue: (d) => d.dispatched_litres, render: (d) => <>{formatLitres(d.dispatched_litres, 1)} <span style={{ fontSize: '0.75rem', color: '#64748b' }}>({d.dispatched_count} trips)</span></>, footerCell: <strong>{formatLitres(sum((r) => r.dispatched_litres), 1)}</strong> },
    { key: 'received', header: 'Received at Dairy (L)', align: 'right', sortValue: (d) => d.received_litres, render: (d) => (d.received_litres > 0 ? formatLitres(d.received_litres, 1) : '-'), footerCell: <strong>{formatLitres(sum((r) => r.received_litres), 1)}</strong> },
    {
      key: 'loss', header: 'Transit Loss', align: 'right', sortValue: (d) => d.transit_loss_litres,
      render: (d) => {
        const pct = d.dispatched_litres > 0 ? (d.transit_loss_litres / d.dispatched_litres) * 100 : 0;
        return <span style={{ color: pct >= 0.5 ? '#dc2626' : '#475569', fontWeight: 600 }}>{d.transit_loss_litres > 0 ? `-${formatLitres(d.transit_loss_litres, 1)}` : '0.0 L'} <span style={{ fontSize: '0.75rem' }}>({pct.toFixed(2)}%)</span></span>;
      },
      footerCell: <strong>{formatLitres(sum((r) => r.transit_loss_litres), 1)}</strong>,
    },
  ];

  return (
    <Page>
      <PageHeader
        title={<>{unitHeading} Analytics</>}
        subtitle={rangeFrom && rangeTo ? <>{formatDateDDMMYYYY(rangeFrom)} to {formatDateDDMMYYYY(rangeTo)}</> : undefined}
      >
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
      </PageHeader>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {loading ? (
        <>
          <StatsGridSkeleton count={4} />
          <TableSkeleton rows={4} cols={5} />
        </>
      ) : data ? (
        <>
          <div className="stats-grid">
            <StatCard label="Total Litres Collected" value={formatLitres(totalCollected, 1)} sub="Milk entered in this period" onClick={() => navigate('/bmc/milk-entry')} />
            <StatCard label="Dispatched" value={formatLitres(data.kpis.total_dispatched_litres, 1)} sub={`${data.kpis.total_dispatched_count} tankers`} onClick={() => navigate('/bmc/records')} />
            <StatCard
              label="Available to Dispatch"
              value={formatLitres(stock?.available_stock_qty ?? 0, 1)}
              positive={(stock?.available_stock_qty ?? 0) > 0}
              sub="Collected minus dispatched (all time)"
              onClick={() => navigate('/bmc/tanker')}
            />
            <StatCard
              label="Transit Loss"
              value={`${formatLitres(data.kpis.transit_loss_litres, 1)} (${data.kpis.transit_loss_pct}%)`}
              valueTone={data.kpis.transit_loss_tone === 'red' ? 'negative' : data.kpis.transit_loss_tone === 'amber' ? 'warning' : 'positive'}
              sub={data.kpis.completed_count > 0 ? `Across ${data.kpis.completed_count} received trips` : 'Waiting for receipts'}
              onClick={() => navigate('/bmc/records')}
            />
          </div>

          <MilkVolumeChart
            data={data.daily_trend}
            title="Daily Milk Volume: Dispatched vs Received"
            emptyActionLabel="Dispatch Tanker"
            onEmptyAction={() => navigate('/bmc/tanker')}
          />

          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(d) => d.date}
            searchable={false}
            pageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyMessage="No milk collected or dispatched in this period."
            showTotalsRow
          />
        </>
      ) : null}
    </Page>
  );
}
