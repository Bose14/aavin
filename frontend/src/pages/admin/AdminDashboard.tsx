import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
import { formatDateDDMMYYYY, formatLitres, getLocalTodayIso } from '../../lib/format';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ErrorBanner, StatsGridSkeleton, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';
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

interface BmcScorecardRow {
  bmc_id: string;
  name: string;
  bmc_code: string;
  dispatched_count: number;
  dispatched_litres: number;
  received_litres: number;
  transit_loss_litres: number;
  transit_loss_pct: number;
  health: 'ok' | 'warn' | 'danger';
}

interface ProcessAnalyticsResponse {
  period: string;
  date_range: { from: string; to: string };
  kpis: ProcessKPIs;
  bmc_performance: BmcScorecardRow[];
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

interface MilkRow { bmc_id: string; quantity_litres: number; rejection_qty?: number | null; bmcs?: { name: string; bmc_code: string } | null }

type Row = BmcScorecardRow & { collected_litres: number };

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { settings } = useDairyUnitSettings();

  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today');
  const [customFrom, setCustomFrom] = useState(() => getLocalTodayIso());
  const [customTo, setCustomTo] = useState(() => getLocalTodayIso());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: getLocalTodayIso(), to: getLocalTodayIso() }));

  const [data, setData] = useState<ProcessAnalyticsResponse | null>(null);
  const [collectedByBmc, setCollectedByBmc] = useState<Record<string, number>>({});
  const [bmcInfo, setBmcInfo] = useState<Record<string, { name: string; bmc_code: string }>>({});
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
      const res = await api.get<ProcessAnalyticsResponse>('/analytics/process', { params });
      setData(res.data);
      // Milk collected at the BMCs over the same dates (net of rejections)
      const milk = await api.get<MilkRow[]>('/milk', { params: { from: res.data.date_range.from, to: res.data.date_range.to } });
      const byBmc: Record<string, number> = {};
      const info: Record<string, { name: string; bmc_code: string }> = {};
      for (const m of milk.data || []) {
        const net = Number(m.quantity_litres) - Number(m.rejection_qty ?? 0);
        byBmc[m.bmc_id] = (byBmc[m.bmc_id] ?? 0) + net;
        if (m.bmcs) info[m.bmc_id] = m.bmcs;
      }
      setCollectedByBmc(byBmc);
      setBmcInfo(info);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, [period, appliedCustom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, Row>();
    for (const b of data.bmc_performance) byId.set(String(b.bmc_id), { ...b, collected_litres: collectedByBmc[b.bmc_id] ?? 0 });
    // BMCs that collected milk but have not dispatched yet in this period
    for (const [id, litres] of Object.entries(collectedByBmc)) {
      if (byId.has(id)) continue;
      const info = bmcInfo[id];
      byId.set(id, {
        bmc_id: id, name: info?.name ?? 'BMC', bmc_code: info?.bmc_code ?? '', dispatched_count: 0, dispatched_litres: 0,
        received_litres: 0, transit_loss_litres: 0, transit_loss_pct: 0, health: 'ok', collected_litres: litres,
      });
    }
    return [...byId.values()].sort((a, b) => b.collected_litres - a.collected_litres || a.name.localeCompare(b.name));
  }, [data, collectedByBmc, bmcInfo]);

  const totalCollected = Object.values(collectedByBmc).reduce((s, v) => s + v, 0);
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);

  const columns: DataColumn<Row>[] = [
    {
      key: 'name',
      header: 'Collection Unit (BMC)',
      sortValue: (b) => b.name,
      searchValue: (b) => `${b.name} ${b.bmc_code}`,
      render: (b) => (
        <button type="button" className="btn-link" style={{ marginLeft: 0, textAlign: 'left', fontWeight: 600 }} onClick={() => navigate(`/admin/tanker?bmc_id=${b.bmc_id}`)}>
          {b.name} <span className="unit-code">{b.bmc_code}</span>
        </button>
      ),
      footerCell: <strong>Total ({rows.length})</strong>,
    },
    { key: 'collected', header: 'Collected (L)', align: 'right', sortValue: (b) => b.collected_litres, render: (b) => formatLitres(b.collected_litres, 1), footerCell: <strong>{formatLitres(sum((r) => r.collected_litres), 1)}</strong> },
    { key: 'trips', header: 'Tankers', align: 'right', sortValue: (b) => b.dispatched_count, render: (b) => b.dispatched_count, footerCell: <strong>{sum((r) => r.dispatched_count)}</strong> },
    { key: 'dispatched', header: 'Dispatched (L)', align: 'right', sortValue: (b) => b.dispatched_litres, render: (b) => formatLitres(b.dispatched_litres, 1), footerCell: <strong>{formatLitres(sum((r) => r.dispatched_litres), 1)}</strong> },
    { key: 'received', header: 'Received (L)', align: 'right', sortValue: (b) => b.received_litres, render: (b) => (b.received_litres > 0 ? formatLitres(b.received_litres, 1) : '-'), footerCell: <strong>{formatLitres(sum((r) => r.received_litres), 1)}</strong> },
    {
      key: 'loss',
      header: 'Transit Loss',
      align: 'right',
      sortValue: (b) => b.transit_loss_pct,
      render: (b) => {
        if (b.dispatched_litres === 0 || b.received_litres === 0) return '-';
        const tone = b.transit_loss_pct >= (settings.transit_loss_danger_pct ?? 2.0) ? 'red' : b.transit_loss_pct >= (settings.transit_loss_warn_pct ?? 1.0) ? 'amber' : 'green';
        return <StatusBadge tone={tone}>{b.transit_loss_litres > 0 ? `-${formatLitres(b.transit_loss_litres, 1)}` : '0 L'} ({b.transit_loss_pct}%)</StatusBadge>;
      },
    },
  ];

  const rangeFrom = data?.date_range?.from;
  const rangeTo = data?.date_range?.to;

  return (
    <Page>
      <PageHeader
        title={<>{profile?.dairy_units?.name ?? 'Dairy Plant'} Analytics</>}
        subtitle={rangeFrom && rangeTo ? <>{formatDateDDMMYYYY(rangeFrom)} to {formatDateDDMMYYYY(rangeTo)}</> : undefined}
      >
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div className="period-tabs" style={{ background: '#f1f5f9', padding: '3px', borderRadius: 8, display: 'flex', gap: '2px' }}>
            {(['today', 'week', 'month', 'year', 'custom'] as const).map((pr) => (
              <button
                key={pr}
                type="button"
                className={`tab ${period === pr ? 'active' : ''}`}
                onClick={() => setPeriod(pr)}
                style={{
                  border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: '0.82rem', fontWeight: period === pr ? 700 : 500, cursor: 'pointer',
                  backgroundColor: period === pr ? '#0284c7' : 'transparent', color: period === pr ? '#ffffff' : '#475569',
                }}
              >
                {pr === 'today' ? 'Today' : t(pr as any)}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="custom-range-bar" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ height: 32, padding: '2px 6px', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #cbd5e1' }} />
              <span className="custom-range-sep" style={{ fontSize: '0.78rem', color: '#64748b' }}>to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ height: 32, padding: '2px 6px', fontSize: '0.8rem', borderRadius: 4, border: '1px solid #cbd5e1' }} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setAppliedCustom({ from: customFrom, to: customTo })} style={{ height: 32, padding: '0 8px', fontSize: '0.8rem' }}>
                {t('apply')}
              </button>
            </div>
          )}
        </div>
      </PageHeader>

      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {loading ? (
        <>
          <StatsGridSkeleton count={4} />
          <TableSkeleton rows={4} cols={6} />
        </>
      ) : data ? (
        <>
          <div className="stats-grid">
            <StatCard label="Total Litres Collected" value={formatLitres(totalCollected, 1)} sub="At the BMCs (net of rejections)" onClick={() => navigate('/admin/milk')} />
            <StatCard label="Dispatched from BMCs" value={formatLitres(data.kpis.total_dispatched_litres, 1)} sub={`${data.kpis.total_dispatched_count} tankers`} onClick={() => navigate('/admin/tanker')} />
            <StatCard
              label="Received at Dairy"
              value={formatLitres(data.kpis.completed_litres, 1)}
              sub={`${data.kpis.completed_count} tankers completed`}
              positive={data.kpis.completed_count > 0}
              onClick={() => navigate('/admin/tanker?tab=processed')}
            />
            <StatCard
              label="Transit Loss"
              value={`${formatLitres(data.kpis.transit_loss_litres, 1)} (${data.kpis.transit_loss_pct}%)`}
              valueTone={data.kpis.transit_loss_tone === 'red' ? 'negative' : data.kpis.transit_loss_tone === 'amber' ? 'warning' : 'positive'}
              sub={data.kpis.completed_count > 0 ? `Across ${data.kpis.completed_count} received trips` : 'Waiting for receipts'}
              onClick={() => navigate('/admin/tanker')}
            />
          </div>

          <MilkVolumeChart
            data={data.daily_trend}
            title="Daily Milk Volume: Dispatched vs Received"
            emptyActionLabel="Go to Tanker Records"
            onEmptyAction={() => navigate('/admin/tanker')}
          />

          <DataTable
            rows={rows}
            columns={columns}
            getRowKey={(b) => b.bmc_id}
            getRowClassName={(b) => (b.health === 'danger' ? 'row-danger' : b.health === 'warn' ? 'row-warn' : '')}
            searchPlaceholder="Search BMC name or code…"
            emptyMessage="No collections or dispatches recorded for this period."
            pageSize={25}
            pageSizeOptions={[25, 50, 100]}
            showTotalsRow
          />
        </>
      ) : null}
    </Page>
  );
}
