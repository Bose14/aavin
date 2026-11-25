import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateDDMMYYYY, formatLitres, formatShortDate } from '../lib/format';
import { CHART_COLORS } from '../lib/chartTheme';
import { ChartCardShell, TooltipRow } from './ChartPrimitives';

export interface DailyProcessDatum {
  date: string;
  dispatched_count: number;
  dispatched_litres: number;
  received_count: number;
  received_litres: number;
  transit_loss_litres: number;
  qc_rejected_count: number;
  avg_turnaround_min: number | null;
}

// ==========================================
// 1. User-Friendly Milk Volume Chart
// ==========================================

function VolumeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DailyProcessDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  const deliveryRate =
    item.dispatched_litres > 0
      ? ((item.received_litres / item.dispatched_litres) * 100).toFixed(1)
      : '100.0';

  return (
    <div className="chart-tooltip" style={{ padding: '10px 14px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div className="chart-tooltip-header" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>{formatDateDDMMYYYY(item.date)}</strong>
      </div>
      <TooltipRow
        color="#258bd6"
        label="Dispatched"
        value={`${formatLitres(item.dispatched_litres, 1)} (${item.dispatched_count} ${item.dispatched_count === 1 ? 'trip' : 'trips'})`}
      />
      <TooltipRow
        color="#10b981"
        label="Silo Received"
        value={formatLitres(item.received_litres, 1)}
        tone="positive"
      />
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
        <span style={{ color: '#64748b' }}>Delivery Rate:</span>
        <strong style={{ color: Number(deliveryRate) >= 99 ? '#059669' : '#d97706' }}>{deliveryRate}%</strong>
      </div>
    </div>
  );
}

export function MilkVolumeChart({
  data,
  title = 'Daily Milk Volume: Dispatched vs Received',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: DailyProcessDatum[];
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const totalDispatched = data.reduce((sum, d) => sum + (d.dispatched_litres || 0), 0);
  const totalReceived = data.reduce((sum, d) => sum + (d.received_litres || 0), 0);
  const totalTrips = data.reduce((sum, d) => sum + (d.dispatched_count || 0), 0);
  const deliveryPct = totalDispatched > 0 ? ((totalReceived / totalDispatched) * 100).toFixed(1) : '100.0';

  const isEmpty = data.length === 0 || totalDispatched === 0;

  const summaryStrip = !isEmpty ? (
    <div className="chart-summary-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', paddingBottom: '0.5rem', fontSize: '0.84rem' }}>
      <span>
        Total Dispatched: <strong style={{ color: 'var(--primary)' }}>{formatLitres(totalDispatched, 1)}</strong> ({totalTrips} {totalTrips === 1 ? 'trip' : 'trips'})
      </span>
      <span>
        Received in Silo: <strong style={{ color: '#059669' }}>{formatLitres(totalReceived, 1)}</strong>
      </span>
      <span>
        Delivery Success: <strong style={{ color: Number(deliveryPct) >= 99 ? '#059669' : '#d97706' }}>{deliveryPct}%</strong>
      </span>
    </div>
  ) : undefined;

  const legendItems = [
    { color: '#258bd6', label: 'Dispatched Milk (L)' },
    { color: '#10b981', label: 'Silo Received Milk (L)' },
  ];

  return (
    <ChartCardShell
      title={title}
      subtitle="Easy comparison of milk sent from BMC against milk received into plant silos"
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={isEmpty}
      emptyMessage="No tanker dispatches recorded in this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
    >
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k L` : `${v} L`)}
            />
            <Tooltip content={<VolumeTooltip />} />
            <Bar
              dataKey="dispatched_litres"
              name="Dispatched"
              fill="#258bd6"
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
            />
            <Bar
              dataKey="received_litres"
              name="Silo Received"
              fill="#10b981"
              radius={[6, 6, 0, 0]}
              maxBarSize={32}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

// ==========================================
// 2. User-Friendly Transit Loss Trend Chart
// ==========================================

function LossTooltip({
  active,
  payload,
  threshold,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DailyProcessDatum & { loss_pct: number } }>;
  threshold: number;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  const isHealthy = item.loss_pct <= threshold;

  return (
    <div className="chart-tooltip" style={{ padding: '10px 14px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <div className="chart-tooltip-header" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>{formatDateDDMMYYYY(item.date)}</strong>
      </div>
      <TooltipRow
        color={isHealthy ? '#10b981' : '#ef4444'}
        label="Transit Loss"
        value={`${formatLitres(item.transit_loss_litres, 1)} (${item.loss_pct.toFixed(2)}%)`}
        tone={isHealthy ? 'positive' : 'negative'}
      />
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f1f5f9', fontSize: '0.78rem' }}>
        Status:{' '}
        <strong style={{ color: isHealthy ? '#059669' : '#dc2626' }}>
          {isHealthy ? `✓ Normal (≤ ${threshold}%)` : `⚠️ High Loss (> ${threshold}%)`}
        </strong>
      </div>
    </div>
  );
}

export function TransitLossTrendChart({
  data,
  threshold = 0.5,
  title = 'Daily Transit Loss Trend',
}: {
  data: DailyProcessDatum[];
  threshold?: number;
  title?: string;
}) {
  const chartData = data.map((d) => {
    const pct = d.dispatched_litres > 0 ? (d.transit_loss_litres / d.dispatched_litres) * 100 : 0;
    return {
      ...d,
      loss_pct: +pct.toFixed(2),
    };
  });

  const totalDispatched = data.reduce((sum, d) => sum + (d.dispatched_litres || 0), 0);
  const totalLoss = data.reduce((sum, d) => sum + (d.transit_loss_litres || 0), 0);
  const avgLossPct = totalDispatched > 0 ? ((totalLoss / totalDispatched) * 100).toFixed(2) : '0.00';

  const isEmpty = data.length === 0 || totalDispatched === 0;

  const summaryStrip = !isEmpty ? (
    <div className="chart-summary-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', paddingBottom: '0.5rem', fontSize: '0.84rem' }}>
      <span>
        Net Transit Loss: <strong style={{ color: Number(avgLossPct) > threshold ? '#dc2626' : '#059669' }}>{formatLitres(totalLoss, 1)} ({avgLossPct}%)</strong>
      </span>
      <span>
        Safe Limit Benchmark: <strong style={{ color: '#059669' }}>&le; {threshold}%</strong>
      </span>
    </div>
  ) : undefined;

  const legendItems = [
    { color: '#10b981', label: `Normal Loss (≤ ${threshold}%)` },
    { color: '#ef4444', label: `High Loss (> ${threshold}%)` },
  ];

  return (
    <ChartCardShell
      title={title}
      subtitle={`Daily transit loss percentage with safe threshold guideline (${threshold}%)`}
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={isEmpty}
      emptyMessage="No transit loss recorded for this period."
    >
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 15, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              domain={[0, (max: number) => Math.max(1.0, Math.ceil(max * 1.25))]}
            />
            <Tooltip content={<LossTooltip threshold={threshold} />} />
            <ReferenceLine
              y={threshold}
              stroke="#d97706"
              strokeDasharray="4 4"
              label={{
                value: `Limit (${threshold}%)`,
                fill: '#b45309',
                fontSize: 11,
                position: 'insideTopLeft',
              }}
            />
            <Bar dataKey="loss_pct" name="Transit Loss %" maxBarSize={32} radius={[6, 6, 0, 0]}>
              {chartData.map((entry, index) => {
                const isSafe = entry.loss_pct <= threshold;
                return <Cell key={`loss-cell-${index}`} fill={isSafe ? '#10b981' : '#ef4444'} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}
