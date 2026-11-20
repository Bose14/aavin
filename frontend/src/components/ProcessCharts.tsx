import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateDDMMYYYY, formatFatSnf, formatLitres, formatShortDate } from '../lib/format';
import { CHART_COLORS } from '../lib/chartTheme';
import { ChartCardShell, TooltipRow } from './ChartPrimitives';

export interface DailyProcessTrendDatum {
  date: string;
  dispatched_count: number;
  dispatched_litres: number;
  received_count: number;
  received_litres: number;
  transit_loss_litres: number;
  qc_rejected_count: number;
  avg_turnaround_min: number | null;
}

export interface ProcessPipelineStageDatum {
  key: string;
  title: string;
  team: string;
  team_label: string;
  active_count: number;
  delayed_count: number;
  color: string;
}

export interface QualityReconciliationDatum {
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

export interface BmcPerformanceDatum {
  unit_id: string;
  name: string;
  unit_code: string;
  dispatched_litres: number;
  received_litres: number;
  transit_loss_litres: number;
  transit_loss_pct: number;
  qc_rejected_count: number;
  avg_turnaround_min: number | null;
}

// ==========================================
// 1. Process Volume & Reception Trend Chart
// ==========================================

function VolumeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DailyProcessTrendDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  const lossPct =
    item.dispatched_litres > 0
      ? ((item.transit_loss_litres / item.dispatched_litres) * 100).toFixed(2)
      : '0.00';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
      </div>
      <TooltipRow
        color="#3b82f6"
        label="Dispatched Volume"
        value={`${formatLitres(item.dispatched_litres, 1)} (${item.dispatched_count} trips)`}
      />
      <TooltipRow
        color="#10b981"
        label="Silo Received"
        value={`${formatLitres(item.received_litres, 1)} (${item.received_count} trips)`}
        tone="positive"
      />
      <TooltipRow
        color="#ef4444"
        label="Transit Loss"
        value={`${formatLitres(item.transit_loss_litres, 1)} (${lossPct}%)`}
        tone={item.transit_loss_litres > 0 ? 'negative' : undefined}
      />
      {item.avg_turnaround_min != null && (
        <TooltipRow
          color="#8b5cf6"
          label="Avg Turnaround"
          value={`${item.avg_turnaround_min} mins`}
        />
      )}
    </div>
  );
}

export function ProcessVolumeTrendChart({
  data,
  title = 'Milk Dispatch vs Silo Reception Volume Trend',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: DailyProcessTrendDatum[];
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const totalDispatched = data.reduce((sum, d) => sum + (d.dispatched_litres || 0), 0);
  const totalReceived = data.reduce((sum, d) => sum + (d.received_litres || 0), 0);
  const totalLoss = data.reduce((sum, d) => sum + (d.transit_loss_litres || 0), 0);
  const lossPct = totalDispatched > 0 ? (totalLoss / totalDispatched) * 100 : 0;

  const isEmpty = data.length === 0 || totalDispatched === 0;

  const summaryStrip = !isEmpty ? (
    <div className="chart-summary-strip" style={{ flexWrap: 'wrap', gap: '1rem', paddingBottom: '0.5rem' }}>
      <span>
        Dispatched: <strong>{formatLitres(totalDispatched, 1)}</strong>
      </span>
      <span>
        Received: <strong style={{ color: '#047857' }}>{formatLitres(totalReceived, 1)}</strong>
      </span>
      <span>
        Net Loss:{' '}
        <strong style={{ color: lossPct >= 0.5 ? '#dc2626' : '#475569' }}>
          {totalLoss > 0 ? `-${formatLitres(totalLoss, 1)}` : '0 L'} ({lossPct.toFixed(2)}%)
        </strong>
      </span>
    </div>
  ) : undefined;

  const legendItems = [
    { color: '#3b82f6', label: 'Dispatched Litres' },
    { color: '#10b981', label: 'Silo Received Litres' },
    { color: '#ef4444', label: 'Transit Loss (L)', dashed: true },
  ];

  return (
    <ChartCardShell
      title={title}
      subtitle="Daily comparison of milk volume dispatched from collection centers against silo reception"
      tooltip="Tracks outward tanker milk quantities against dairy silo metered quantities to monitor transit yield."
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={isEmpty}
      emptyMessage="No tanker dispatches recorded for this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
    >
      <div style={{ width: '100%', height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
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
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
            />
            <Tooltip content={<VolumeTooltip />} />
            <Bar dataKey="dispatched_litres" name="Dispatched" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Bar dataKey="received_litres" name="Received" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={36} />
            <Line
              type="monotone"
              dataKey="transit_loss_litres"
              name="Transit Loss"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={{ r: 3, fill: '#ef4444' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

// ==========================================
// 2. Transit Loss % & Turnaround Trend Chart
// ==========================================

function LossTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DailyProcessTrendDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  const lossPct =
    item.dispatched_litres > 0
      ? ((item.transit_loss_litres / item.dispatched_litres) * 100).toFixed(2)
      : '0.00';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
      </div>
      <TooltipRow
        color={Number(lossPct) >= 0.5 ? '#dc2626' : '#166534'}
        label="Transit Loss %"
        value={`${lossPct}% (${formatLitres(item.transit_loss_litres, 1)})`}
        tone={Number(lossPct) >= 0.5 ? 'negative' : 'positive'}
      />
      <TooltipRow
        color="#8b5cf6"
        label="Avg Turnaround"
        value={item.avg_turnaround_min != null ? `${item.avg_turnaround_min} mins` : 'N/A'}
      />
      <TooltipRow
        color="#3b82f6"
        label="Total Trips"
        value={`${item.dispatched_count} outward`}
      />
    </div>
  );
}

export function ProcessTransitLossChart({
  data,
  warnThreshold = 0.5,
  dangerThreshold = 1.0,
}: {
  data: DailyProcessTrendDatum[];
  warnThreshold?: number;
  dangerThreshold?: number;
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
  const overallLossPct = totalDispatched > 0 ? (totalLoss / totalDispatched) * 100 : 0;

  const turnaroundEntries = data.filter((d) => d.avg_turnaround_min != null && d.avg_turnaround_min > 0);
  const avgTurnaround =
    turnaroundEntries.length > 0
      ? Math.round(turnaroundEntries.reduce((s, d) => s + (d.avg_turnaround_min || 0), 0) / turnaroundEntries.length)
      : null;

  const isEmpty = data.length === 0 || totalDispatched === 0;

  const summaryStrip = !isEmpty ? (
    <div className="chart-summary-strip" style={{ flexWrap: 'wrap', gap: '1rem', paddingBottom: '0.5rem' }}>
      <span>
        Avg Loss:{' '}
        <strong style={{ color: overallLossPct >= warnThreshold ? '#dc2626' : '#166534' }}>
          {overallLossPct.toFixed(2)}%
        </strong>
      </span>
      <span>
        Warning Limit: <strong>&ge; {warnThreshold}%</strong>
      </span>
      {avgTurnaround != null && (
        <span>
          Avg Turnaround: <strong>{avgTurnaround} mins</strong>
        </span>
      )}
    </div>
  ) : undefined;

  const legendItems = [
    { color: '#10b981', label: `Loss Normal (<${warnThreshold}%)` },
    { color: '#f59e0b', label: `Loss Warning (${warnThreshold}-${dangerThreshold}%)` },
    { color: '#ef4444', label: `Loss Danger (≥${dangerThreshold}%)` },
    { color: '#8b5cf6', label: 'Avg Turnaround (min)' },
  ];

  return (
    <ChartCardShell
      title="Daily Transit Loss &amp; Turnaround Cycle Time"
      subtitle="Transit loss rate percentage against regulatory benchmarks and door-to-door plant duration"
      tooltip="Highlights high loss days and delays across the transport route."
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={isEmpty}
      emptyMessage="No trip loss data recorded for this period."
    >
      <div style={{ width: '100%', height: 270 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 5, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              yAxisId="loss"
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              domain={[0, (max: number) => Math.max(1.5, Math.ceil(max * 1.2))]}
            />
            <YAxis
              yAxisId="time"
              orientation="right"
              stroke="#8b5cf6"
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => `${v}m`}
              domain={[0, 'auto']}
            />
            <Tooltip content={<LossTooltip />} />
            <ReferenceLine
              yAxisId="loss"
              y={warnThreshold}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{ value: `Warn ${warnThreshold}%`, fill: '#d97706', fontSize: 10, position: 'insideTopLeft' }}
            />
            <ReferenceLine
              yAxisId="loss"
              y={dangerThreshold}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{ value: `Danger ${dangerThreshold}%`, fill: '#dc2626', fontSize: 10, position: 'insideTopLeft' }}
            />
            <Bar yAxisId="loss" dataKey="loss_pct" name="Transit Loss %" maxBarSize={32} radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => {
                const color =
                  entry.loss_pct >= dangerThreshold
                    ? '#ef4444'
                    : entry.loss_pct >= warnThreshold
                    ? '#f59e0b'
                    : '#10b981';
                return <Cell key={`loss-cell-${index}`} fill={color} />;
              })}
            </Bar>
            <Line
              yAxisId="time"
              type="monotone"
              dataKey="avg_turnaround_min"
              name="Turnaround Time"
              stroke="#8b5cf6"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#8b5cf6' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

// ==========================================
// 3. Process Stage Queue & Bottleneck Chart
// ==========================================

export function ProcessPipelineBarChart({
  pipeline,
}: {
  pipeline: ProcessPipelineStageDatum[];
}) {
  const chartData = pipeline.map((st) => ({
    name: st.title,
    team: st.team_label,
    on_time: Math.max(0, st.active_count - st.delayed_count),
    delayed: st.delayed_count,
    total: st.active_count,
    color: st.color,
  }));

  const totalActive = pipeline.reduce((sum, st) => sum + st.active_count, 0);
  const totalDelayed = pipeline.reduce((sum, st) => sum + st.delayed_count, 0);

  const summaryStrip = (
    <div className="chart-summary-strip" style={{ flexWrap: 'wrap', gap: '1rem', paddingBottom: '0.5rem' }}>
      <span>
        Total In-Plant: <strong style={{ color: '#0284c7' }}>{totalActive} tankers</strong>
      </span>
      <span>
        On-Time: <strong style={{ color: '#16a34a' }}>{totalActive - totalDelayed}</strong>
      </span>
      <span>
        SLA Delayed: <strong style={{ color: totalDelayed > 0 ? '#dc2626' : '#16a34a' }}>{totalDelayed}</strong>
      </span>
    </div>
  );

  const legendItems = [
    { color: '#0284c7', label: 'On-Time Tankers' },
    { color: '#ef4444', label: 'SLA Delayed Tankers' },
  ];

  return (
    <ChartCardShell
      title="Live Stage Queue &amp; Bottleneck Analysis (7 Stages)"
      subtitle="Real-time distribution of tankers across plant stages, highlighting queue buildups and SLA delays"
      tooltip="Shows how many tankers are currently waiting or being serviced at each stage."
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={false}
      emptyMessage="No tankers currently in plant."
    >
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} horizontal={false} />
            <XAxis type="number" stroke={CHART_COLORS.axis} fontSize={12} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              stroke={CHART_COLORS.axis}
              fontSize={11}
              tickLine={false}
              width={85}
            />
            <Tooltip
              formatter={(value, name) => [
                `${value} tankers`,
                name === 'on_time' ? 'On-Time' : 'SLA Delayed',
              ]}
            />
            <Bar dataKey="on_time" name="On-Time" stackId="a" fill="#0284c7" radius={[0, 0, 0, 0]} maxBarSize={22} />
            <Bar dataKey="delayed" name="SLA Delayed" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

// ==========================================
// 4. Quality Reconciliation Bar Chart
// ==========================================

export function QualityReconciliationChart({
  reconciliation,
}: {
  reconciliation: QualityReconciliationDatum;
}) {
  const chartData = [
    {
      metric: 'Milk Fat %',
      dispatched: reconciliation.avg_dispatch_fat,
      received: reconciliation.avg_received_fat,
      variance: reconciliation.fat_variance,
    },
    {
      metric: 'Milk SNF %',
      dispatched: reconciliation.avg_dispatch_snf,
      received: reconciliation.avg_received_snf,
      variance: reconciliation.snf_variance,
    },
  ];

  const summaryStrip = (
    <div className="chart-summary-strip" style={{ flexWrap: 'wrap', gap: '1.25rem', paddingBottom: '0.5rem' }}>
      <span>
        Fat Variance:{' '}
        <strong style={{ color: reconciliation.fat_variance < -0.1 ? '#dc2626' : '#16a34a' }}>
          {reconciliation.fat_variance > 0 ? `+${reconciliation.fat_variance}%` : `${reconciliation.fat_variance}%`}
        </strong>
      </span>
      <span>
        SNF Variance:{' '}
        <strong style={{ color: reconciliation.snf_variance < -0.1 ? '#dc2626' : '#16a34a' }}>
          {reconciliation.snf_variance > 0 ? `+${reconciliation.snf_variance}%` : `${reconciliation.snf_variance}%`}
        </strong>
      </span>
      <span>
        Arrival Temp:{' '}
        <strong style={{ color: '#0369a1' }}>
          {reconciliation.avg_temperature != null ? `${reconciliation.avg_temperature}°C` : 'N/A'}
        </strong>{' '}
        ({reconciliation.temp_compliant_pct}% compliant)
      </span>
      <span>
        Organoleptic:{' '}
        <strong style={{ color: '#166534' }}>
          {reconciliation.organoleptic_satisfied_pct}% Satisfied
        </strong>
      </span>
    </div>
  );

  const legendItems = [
    { color: '#6366f1', label: 'BMC Dispatched Quality' },
    { color: '#10b981', label: 'Plant Received Quality' },
  ];

  return (
    <ChartCardShell
      title="Chemical Quality Reconciliation (BMC Dispatch vs Dairy Silo)"
      subtitle="Comparing weighted Fat % and SNF % declared at BMC against dairy laboratory test results"
      tooltip="Variance represents discrepancies between BMC test certificate and plant reception lab results."
      summaryStrip={summaryStrip}
      legendItems={legendItems}
      isEmpty={reconciliation.avg_dispatch_fat === 0 && reconciliation.avg_received_fat === 0}
      emptyMessage="No quality test results recorded for this period."
    >
      <div style={{ width: '100%', height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="metric" stroke={CHART_COLORS.axis} fontSize={12} tickLine={false} />
            <YAxis
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              domain={[0, (max: number) => Math.ceil(max * 1.15)]}
            />
            <Tooltip
              formatter={(value, name) => [
                `${formatFatSnf(Number(value))}%`,
                name === 'dispatched' ? 'BMC Dispatched' : 'Plant Received',
              ]}
            />
            <Bar dataKey="dispatched" name="BMC Dispatched" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={44} />
            <Bar dataKey="received" name="Plant Received" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={44} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

// ==========================================
// 5. BMC Volume & Loss Comparison Chart (Admin)
// ==========================================

export function BmcVolumeComparisonChart({
  data,
}: {
  data: BmcPerformanceDatum[];
}) {
  const chartData = data
    .filter((b) => b.dispatched_litres > 0)
    .map((b) => ({
      name: b.name,
      code: b.unit_code,
      dispatched: b.dispatched_litres,
      received: b.received_litres,
      loss: b.transit_loss_litres,
      loss_pct: b.transit_loss_pct,
    }));

  const isEmpty = chartData.length === 0;

  const legendItems = [
    { color: '#3b82f6', label: 'Dispatched (L)' },
    { color: '#10b981', label: 'Silo Received (L)' },
    { color: '#ef4444', label: 'Transit Loss (L)' },
  ];

  return (
    <ChartCardShell
      title="Source BMC Dispatch &amp; Reception Volume Comparison"
      subtitle="Dispatched milk volume, dairy silo receipt, and transit loss by collection center"
      tooltip="Visualizes milk yield performance across all connected BMC collection centers."
      legendItems={legendItems}
      isEmpty={isEmpty}
      emptyMessage="No tanker dispatches recorded for collection centers in this period."
    >
      <div style={{ width: '100%', height: 270 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
            <XAxis dataKey="name" stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} />
            <YAxis
              stroke={CHART_COLORS.axis}
              fontSize={12}
              tickLine={false}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
            />
            <Tooltip
              formatter={(value, name) => [
                `${formatLitres(Number(value), 1)}`,
                name === 'dispatched' ? 'Dispatched' : name === 'received' ? 'Silo Received' : 'Transit Loss',
              ]}
            />
            <Bar dataKey="dispatched" name="Dispatched" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Bar dataKey="received" name="Received" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
            <Bar dataKey="loss" name="Loss" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}
