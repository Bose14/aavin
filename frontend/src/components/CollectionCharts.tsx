import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDateDDMMYYYY, formatFatSnf, formatLitres, formatShortDate } from '../lib/format';
import { CHART_COLORS } from '../lib/chartTheme';
import { ChartCardShell, TooltipRow, useChartSlotSelection } from './ChartPrimitives';

export interface CollectionTrendDatum {
  date: string;
  no_entry?: boolean;
  am_quantity?: number;
  pm_quantity?: number;
  quantity: number;
  net_quantity: number;
  rejection?: number;
  avg_fat: number | null;
  avg_snf: number | null;
}

export interface UnitQuantityDatum {
  unit_id: string;
  name: string;
  unit_code: string;
  quantity: number;
  net_quantity: number;
  rejection: number;
}

function CollectionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CollectionTrendDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  if (item.no_entry || item.quantity === 0) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-header">
          <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>No entry recorded for this day</p>
      </div>
    );
  }

  const rejected = item.rejection ?? Math.max(0, +(item.quantity - item.net_quantity).toFixed(2));
  const rejPct = item.quantity > 0 ? ((rejected / item.quantity) * 100).toFixed(1) : '0.0';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
      </div>
      {(item.am_quantity != null || item.pm_quantity != null) && (
        <>
          <TooltipRow color={CHART_COLORS.primary} label="Morning (AM)" value={formatLitres(item.am_quantity ?? 0)} />
          <TooltipRow color="#0ea5e9" label="Evening (PM)" value={formatLitres(item.pm_quantity ?? 0)} />
        </>
      )}
      <TooltipRow color={CHART_COLORS.primary} label="Total Collected" value={formatLitres(item.quantity)} />
      <TooltipRow color={CHART_COLORS.profit} label="Net Accepted" value={formatLitres(item.net_quantity)} tone="positive" />
      <TooltipRow color={CHART_COLORS.loss} label="Rejected" value={`${formatLitres(rejected)} (${rejPct}%)`} tone={rejected > 0 ? 'negative' : undefined} />
    </div>
  );
}

function QualityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: CollectionTrendDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  if (item.no_entry || item.avg_fat == null || item.avg_snf == null) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-header">
          <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>No entry</p>
      </div>
    );
  }

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
      </div>
      <TooltipRow color={CHART_COLORS.amber} label="Fat %" value={formatFatSnf(item.avg_fat, true)} />
      <TooltipRow color={CHART_COLORS.profit} label="SNF %" value={formatFatSnf(item.avg_snf, true)} />
    </div>
  );
}

function UnitQuantityTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: UnitQuantityDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  const rejPct = item.quantity > 0 ? ((item.rejection / item.quantity) * 100).toFixed(1) : '0.0';

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{item.name}</span>
        {item.unit_code && <span className="chart-tooltip-sub">{item.unit_code}</span>}
      </div>
      <TooltipRow color={CHART_COLORS.primary} label="Collected" value={formatLitres(item.quantity)} />
      <TooltipRow color={CHART_COLORS.profit} label="Net Accepted" value={formatLitres(item.net_quantity)} tone="positive" />
      <TooltipRow color={CHART_COLORS.loss} label="Rejected" value={`${formatLitres(item.rejection)} (${rejPct}%)`} tone={item.rejection > 0 ? 'negative' : undefined} />
    </div>
  );
}

/** Stacked AM/PM daily collection bars; missing calendar dates remain empty gaps ("No entry"). */
export function MilkCollectionTrendChart({
  data,
  mode = 'unit',
  title = 'Milk Collection Trend (AM + PM)',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: CollectionTrendDatum[];
  mode?: 'unit' | 'admin';
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const hasAnyEntries = data.some(d => !d.no_entry && d.quantity > 0);
  const totalQty = data.reduce((sum, d) => sum + d.quantity, 0);
  const totalRej = data.reduce((sum, d) => sum + (d.rejection ?? Math.max(0, d.quantity - d.net_quantity)), 0);
  const rejPct = totalQty > 0 ? ((totalRej / totalQty) * 100).toFixed(1) : '0.0';

  const normalized = data.map(d => {
    const am = d.am_quantity ?? d.quantity;
    const pm = d.pm_quantity ?? 0;
    return { ...d, am_quantity: am, pm_quantity: pm };
  });

  const {
    selectedKey: selectedDate,
    clearSelection,
    containerProps,
  } = useChartSlotSelection({
    data: normalized,
    getKey: d => d.date,
    layout: 'horizontal',
    marginLeft: 56, // left: 4 + YAxis width: 52
    marginRight: 12,
    marginTop: 8,
    marginBottom: 24,
  });

  return (
    <ChartCardShell
      title={title}
      subtitle={
        mode === 'unit'
          ? 'Daily Morning (AM) + Evening (PM) stacked collection bars · blank days indicate No entry'
          : 'Zone-wide daily Morning (AM) + Evening (PM) stacked collection · blank days indicate No entry'
      }
      badge={
        hasAnyEntries ? (
          <span className="chart-badge neutral">
            {formatLitres(totalQty)} total · {rejPct}% rej
          </span>
        ) : undefined
      }
      isEmpty={!hasAnyEntries}
      emptyMessage="No collection entries recorded for this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
      onDismiss={clearSelection}
      legendItems={[
        { color: CHART_COLORS.primary, label: 'Morning (AM)' },
        { color: '#0ea5e9', label: 'Evening (PM)' },
        { color: CHART_COLORS.loss, label: 'Rejection (L)' },
      ]}
    >
      <div {...containerProps}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={normalized}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
            barGap={4}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              axisLine={false}
              tickLine={false}
              tick={(props: any) => {
                const { x = 0, y = 0, payload } = props;
                const val = payload?.value ?? '';
                const isSelected = selectedDate === val;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      x={0}
                      y={0}
                      dy={8}
                      textAnchor="middle"
                      fill={isSelected ? '#4f46e5' : CHART_COLORS.axis}
                      fontWeight={isSelected ? 700 : 500}
                      fontSize={isSelected ? 13 : 11}
                      style={{ cursor: 'pointer' }}
                    >
                      {formatShortDate(val)}
                    </text>
                  </g>
                );
              }}
              dy={6}
            />
            <YAxis
              tickFormatter={(v: number) => `${Math.round(v)} L`}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              width={52}
            />
            <Tooltip
              content={<CollectionTooltip />}
              cursor={{ fill: CHART_COLORS.cursor }}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: 'none' }}
            />
            <Bar dataKey="am_quantity" stackId="shift" name="Morning (AM)" fill={CHART_COLORS.primary} maxBarSize={32} radius={[0, 0, 0, 0]}>
              {normalized.map(entry => (
                <Cell
                  key={entry.date}
                  fill={CHART_COLORS.primary}
                  opacity={selectedDate ? (selectedDate === entry.date ? 1 : 0.28) : 1}
                  stroke={selectedDate === entry.date ? '#312e81' : undefined}
                  strokeWidth={selectedDate === entry.date ? 2 : 0}
                  cursor="pointer"
                />
              ))}
            </Bar>
            <Bar dataKey="pm_quantity" stackId="shift" name="Evening (PM)" fill="#0ea5e9" maxBarSize={32} radius={[6, 6, 0, 0]}>
              {normalized.map(entry => (
                <Cell
                  key={entry.date}
                  fill="#0ea5e9"
                  opacity={selectedDate ? (selectedDate === entry.date ? 1 : 0.28) : 1}
                  stroke={selectedDate === entry.date ? '#0369a1' : undefined}
                  strokeWidth={selectedDate === entry.date ? 2 : 0}
                  cursor="pointer"
                />
              ))}
            </Bar>
            <Bar dataKey="rejection" name="Rejection (L)" fill={CHART_COLORS.loss} maxBarSize={14} radius={[4, 4, 0, 0]}>
              {normalized.map(entry => (
                <Cell
                  key={entry.date}
                  fill={CHART_COLORS.loss}
                  opacity={selectedDate ? (selectedDate === entry.date ? 1 : 0.28) : 1}
                  stroke={selectedDate === entry.date ? '#991b1b' : undefined}
                  strokeWidth={selectedDate === entry.date ? 1.5 : 0}
                  cursor="pointer"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

/** Daily Fat % and SNF % trend without interpolating across missing days, using clean [4, 6, 8, 10] ticks. */
export function QualityTrendChart({
  data,
  fatBenchmark = 4.0,
  snfBenchmark = 8.2,
  title = 'Fat % & SNF % Quality Trend',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: CollectionTrendDatum[];
  fatBenchmark?: number;
  snfBenchmark?: number;
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const validRows = data.filter(d => !d.no_entry && d.avg_fat != null && d.avg_snf != null && d.quantity > 0);
  const totalQty = validRows.reduce((s, d) => s + d.quantity, 0);
  const weightedFat = totalQty > 0 ? validRows.reduce((s, d) => s + d.quantity * Number(d.avg_fat), 0) / totalQty : 0;
  const weightedSnf = totalQty > 0 ? validRows.reduce((s, d) => s + d.quantity * Number(d.avg_snf), 0) / totalQty : 0;

  const {
    selectedKey: selectedDate,
    clearSelection,
    containerProps,
  } = useChartSlotSelection({
    data,
    getKey: d => d.date,
    layout: 'horizontal',
    marginLeft: 46, // left: 4 + YAxis width: 42
    marginRight: 12,
    marginTop: 8,
    marginBottom: 24,
  });

  return (
    <ChartCardShell
      title={title}
      subtitle={`Quantity-weighted daily averages · benchmarks: Fat ≥ ${formatFatSnf(fatBenchmark)}% & SNF ≥ ${formatFatSnf(snfBenchmark)}%`}
      badge={
        validRows.length > 0 ? (
          <span className="chart-badge neutral">
            Avg Fat {formatFatSnf(weightedFat, true)} · SNF {formatFatSnf(weightedSnf, true)}
          </span>
        ) : undefined
      }
      isEmpty={validRows.length === 0}
      emptyMessage="No quality readings recorded for this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
      onDismiss={clearSelection}
      legendItems={[
        { color: CHART_COLORS.amber, label: 'Fat %' },
        { color: CHART_COLORS.profit, label: 'SNF %' },
        { color: '#f59e0b', label: `Fat Min (${formatFatSnf(fatBenchmark)}%)`, dashed: true },
        { color: '#10b981', label: `SNF Min (${formatFatSnf(snfBenchmark)}%)`, dashed: true },
      ]}
    >
      <div {...containerProps}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              axisLine={false}
              tickLine={false}
              tick={(props: any) => {
                const { x = 0, y = 0, payload } = props;
                const val = payload?.value ?? '';
                const isSelected = selectedDate === val;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      x={0}
                      y={0}
                      dy={8}
                      textAnchor="middle"
                      fill={isSelected ? '#4f46e5' : CHART_COLORS.axis}
                      fontWeight={isSelected ? 700 : 500}
                      fontSize={isSelected ? 13 : 11}
                      style={{ cursor: 'pointer' }}
                    >
                      {formatShortDate(val)}
                    </text>
                  </g>
                );
              }}
              dy={6}
            />
            <YAxis
              domain={[3, 10]}
              ticks={[4, 6, 8, 10]}
              tickFormatter={(v: number) => `${v}%`}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              width={42}
            />
            <ReferenceLine y={fatBenchmark} stroke="#f59e0b" strokeDasharray="4 4" />
            <ReferenceLine y={snfBenchmark} stroke="#10b981" strokeDasharray="4 4" />
            {selectedDate && (
              <ReferenceLine x={selectedDate} stroke="#4f46e5" strokeWidth={2} strokeDasharray="3 3" />
            )}
            <Tooltip
              content={<QualityTooltip />}
              cursor={{ stroke: '#94a3b8', strokeWidth: 1.5, strokeDasharray: '3 3' }}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: 'none' }}
            />
            <Line
              type="monotone"
              dataKey="avg_fat"
              name="Fat %"
              stroke={CHART_COLORS.amber}
              strokeWidth={2.2}
              connectNulls={false}
              dot={{ r: 3.5, strokeWidth: 2, fill: '#ffffff' }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="avg_snf"
              name="SNF %"
              stroke={CHART_COLORS.profit}
              strokeWidth={2.2}
              connectNulls={false}
              dot={{ r: 3.5, strokeWidth: 2, fill: '#ffffff' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}

/** Horizontal comparison bar chart of collected vs rejected milk per unit. */
export function UnitQuantityBarChart({
  data,
  title = 'Unit-wise Quantity (this period)',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: UnitQuantityDatum[];
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const totalQty = data.reduce((sum, u) => sum + u.quantity, 0);
  const chartHeight = Math.max(220, data.length * 48);

  const {
    selectedKey: selectedUnitId,
    clearSelection,
    containerProps,
  } = useChartSlotSelection({
    data,
    getKey: d => d.unit_id,
    layout: 'vertical',
    marginLeft: 94, // left: 4 + YAxis width: 90
    marginRight: 16,
    marginTop: 6,
    marginBottom: 24,
  });

  return (
    <ChartCardShell
      title={title}
      subtitle="Gross collected volume vs rejected volume by collection unit"
      badge={
        data.length > 0 ? (
          <span className="chart-badge neutral">
            {data.length} {data.length === 1 ? 'unit' : 'units'} · {formatLitres(totalQty)}
          </span>
        ) : undefined
      }
      isEmpty={data.length === 0}
      emptyMessage="No unit collection data for this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
      onDismiss={clearSelection}
      legendItems={[
        { color: CHART_COLORS.primary, label: 'Collected (L)' },
        { color: CHART_COLORS.loss, label: 'Rejected (L)' },
      ]}
    >
      <div {...containerProps}>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            barGap={4}
            margin={{ top: 6, right: 16, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_COLORS.grid} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => `${Math.round(v)} L`}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            />
            <YAxis
              dataKey="name"
              type="category"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: CHART_COLORS.slate }}
              width={90}
            />
            <Tooltip
              content={<UnitQuantityTooltip />}
              cursor={{ fill: CHART_COLORS.cursor }}
              isAnimationActive={false}
              wrapperStyle={{ pointerEvents: 'none' }}
            />
            <Bar dataKey="quantity" name="Collected (L)" fill={CHART_COLORS.primary} radius={[0, 6, 6, 0]} maxBarSize={20}>
              {data.map(entry => (
                <Cell
                  key={entry.unit_id}
                  fill={CHART_COLORS.primary}
                  opacity={selectedUnitId ? (selectedUnitId === entry.unit_id ? 1 : 0.28) : 1}
                  stroke={selectedUnitId === entry.unit_id ? '#312e81' : undefined}
                  strokeWidth={selectedUnitId === entry.unit_id ? 2 : 0}
                  cursor="pointer"
                />
              ))}
            </Bar>
            <Bar dataKey="rejection" name="Rejected (L)" fill={CHART_COLORS.loss} radius={[0, 6, 6, 0]} maxBarSize={20}>
              {data.map(entry => (
                <Cell
                  key={entry.unit_id}
                  fill={CHART_COLORS.loss}
                  opacity={selectedUnitId ? (selectedUnitId === entry.unit_id ? 1 : 0.28) : 1}
                  stroke={selectedUnitId === entry.unit_id ? '#991b1b' : undefined}
                  strokeWidth={selectedUnitId === entry.unit_id ? 1.5 : 0}
                  cursor="pointer"
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCardShell>
  );
}
