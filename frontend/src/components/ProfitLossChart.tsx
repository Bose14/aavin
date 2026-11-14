import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BarShapeProps } from 'recharts';
import { DEFAULT_SELLING_RATE, formatCompactINR, formatDateDDMMYYYY, formatINR, formatShortDate } from '../lib/format';
import { CHART_COLORS } from '../lib/chartTheme';
import { ChartCardShell, TooltipRow } from './ChartPrimitives';

export interface DailyProfitDatum {
  date: string;
  no_entry?: boolean;
  revenue: number;
  cost: number;
  profit: number;
}

export interface UnitProfitDatum {
  unit_id: string;
  name: string;
  unit_code: string;
  revenue: number;
  cost: number;
  profit: number;
}

function getCornerRadius(
  orientation: 'vertical' | 'horizontal',
  isNegative: boolean,
): [number, number, number, number] {
  if (orientation === 'horizontal') {
    return isNegative ? [6, 0, 0, 6] : [0, 6, 6, 0];
  }
  return isNegative ? [0, 0, 6, 6] : [6, 6, 0, 0];
}

function ProfitBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value,
  orientation,
}: BarShapeProps & { orientation: 'vertical' | 'horizontal' }) {
  const numericValue = Array.isArray(value) ? Number(value[1] ?? 0) : Number(value ?? 0);
  const isNegative = numericValue < 0;
  const rectX = width < 0 ? x + width : x;
  const rectY = height < 0 ? y + height : y;
  const rectWidth = Math.abs(width);
  const rectHeight = Math.abs(height);

  if (rectWidth <= 0 || rectHeight <= 0) {
    return null;
  }

  return (
    <Rectangle
      x={rectX}
      y={rectY}
      width={rectWidth}
      height={rectHeight}
      fill={isNegative ? CHART_COLORS.loss : CHART_COLORS.profit}
      radius={getCornerRadius(orientation, isNegative)}
    />
  );
}

/** Generate clean ₹0 / ₹2k / ₹4k axis domain + nice steps so labels are always easy to scan. */
export function computeCleanCurrencyTicks(values: number[]): { domain: [number, number]; ticks: number[] } {
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = Math.max(2000, rawMax - rawMin);

  const candidates = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const step = candidates.find(c => span / c <= 6) ?? Math.ceil(span / 5 / 10000) * 10000;

  const minTick = rawMin < 0 ? -Math.ceil(Math.abs(rawMin) / step) * step : 0;
  const maxTick = Math.max(step, Math.ceil(rawMax / step) * step);

  const ticks: number[] = [];
  for (let v = minTick; v <= maxTick; v += step) {
    ticks.push(v);
  }
  return { domain: [minTick, maxTick], ticks };
}

function FinancialTooltipCard({
  title,
  subtitle,
  revenue,
  cost,
  profit,
}: {
  title: string;
  subtitle?: string;
  revenue: number;
  cost: number;
  profit: number;
}) {
  const isLoss = profit < 0;
  const marginPct = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : null;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-header">
        <span className="chart-tooltip-title">{title}</span>
        {subtitle && <span className="chart-tooltip-sub">{subtitle}</span>}
      </div>
      <TooltipRow color={CHART_COLORS.primary} label="Revenue" value={formatINR(revenue)} />
      <TooltipRow color={CHART_COLORS.amber} label="Procurement Cost" value={formatINR(cost)} />
      <div className="chart-tooltip-divider" />
      <TooltipRow
        color={isLoss ? CHART_COLORS.loss : CHART_COLORS.profit}
        label={isLoss ? 'Net Loss' : 'Net Profit'}
        value={`${formatINR(profit, { showPlus: profit > 0 })}${marginPct !== null ? ` (${marginPct}%)` : ''}`}
        tone={isLoss ? 'negative' : 'positive'}
      />
      {isLoss && (
        <p className="chart-tooltip-note">
          Cost exceeded revenue by {formatINR(Math.abs(profit))}
        </p>
      )}
    </div>
  );
}

function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: DailyProfitDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  if (item.no_entry || (item.revenue === 0 && item.cost === 0 && item.profit === 0)) {
    return (
      <div className="chart-tooltip">
        <div className="chart-tooltip-header">
          <span className="chart-tooltip-title">{formatDateDDMMYYYY(item.date)}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>No entry recorded</p>
      </div>
    );
  }

  return (
    <FinancialTooltipCard
      title={formatDateDDMMYYYY(item.date)}
      revenue={item.revenue}
      cost={item.cost}
      profit={item.profit}
    />
  );
}

function UnitTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: UnitProfitDatum }>;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) return null;

  return (
    <FinancialTooltipCard
      title={item.name}
      subtitle={item.unit_code || undefined}
      revenue={item.revenue}
      cost={item.cost}
      profit={item.profit}
    />
  );
}

function PeriodSummaryBadge({ profit }: { profit: number }) {
  const isLoss = profit < 0;
  return (
    <span className={`chart-badge ${isLoss ? 'neg' : 'pos'}`}>
      {isLoss ? 'Net Loss: ' : 'Net Profit: '}
      {formatINR(profit, { showPlus: profit > 0 })}
    </span>
  );
}

/** Daily Net Profit / Loss chart (single clear green/red bar per day) with Revenue vs Cost toggle. */
export function DailyProfitLossChart({
  data,
  sellingRate = DEFAULT_SELLING_RATE,
  title = 'Daily Net Profit / Loss (₹)',
  emptyActionLabel,
  onEmptyAction,
}: {
  data: DailyProfitDatum[];
  sellingRate?: number;
  title?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const [view, setView] = useState<'net' | 'rev_cost'>('net');
  const activeRows = data.filter(d => !d.no_entry && (d.revenue !== 0 || d.cost !== 0 || d.profit !== 0));
  const totalRevenue = activeRows.reduce((s, d) => s + d.revenue, 0);
  const totalCost = activeRows.reduce((s, d) => s + d.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0';

  const chartData = data.map(d => (
    d.no_entry ? { ...d, profit: null as unknown as number, revenue: null as unknown as number, cost: null as unknown as number } : d
  ));

  const scaleValues = view === 'net'
    ? activeRows.map(d => d.profit)
    : activeRows.flatMap(d => [d.revenue, d.cost]);
  const { domain, ticks } = computeCleanCurrencyTicks(scaleValues);

  return (
    <ChartCardShell
      title={title}
      subtitle={
        view === 'net'
          ? `Single daily net balance (green = profit, red = loss) at ₹${sellingRate}/L selling rate`
          : `Estimated revenue (₹${sellingRate}/L on net accepted) vs procurement cost`
      }
      badge={activeRows.length > 0 ? <PeriodSummaryBadge profit={totalProfit} /> : undefined}
      headerRight={
        activeRows.length > 0 ? (
          <div className="period-tabs" role="group" aria-label="Profit chart view">
            <button
              type="button"
              className={`tab ${view === 'net' ? 'active' : ''}`}
              style={{ minHeight: 34, padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
              onClick={() => setView('net')}
            >
              Net Profit / Loss
            </button>
            <button
              type="button"
              className={`tab ${view === 'rev_cost' ? 'active' : ''}`}
              style={{ minHeight: 34, padding: '0.25rem 0.65rem', fontSize: '0.78rem' }}
              onClick={() => setView('rev_cost')}
            >
              Revenue vs Cost
            </button>
          </div>
        ) : undefined
      }
      isEmpty={activeRows.length === 0}
      emptyMessage="No financial entries recorded for this period."
      emptyActionLabel={emptyActionLabel}
      onEmptyAction={onEmptyAction}
      summaryStrip={
        activeRows.length > 0 ? (
          <div className="chart-kpi-strip">
            <span>Est. Revenue: <strong>{formatINR(totalRevenue)}</strong></span>
            <span>Procurement Cost: <strong>{formatINR(totalCost)}</strong></span>
            <span>
              Margin: <strong className={totalProfit >= 0 ? 'profit-pos' : 'profit-neg'}>{marginPct}%</strong>
            </span>
          </div>
        ) : undefined
      }
      legendItems={
        view === 'net'
          ? [
              { color: CHART_COLORS.profit, label: 'Net Profit (₹)' },
              { color: CHART_COLORS.loss, label: 'Net Loss (₹)' },
            ]
          : [
              { color: CHART_COLORS.primary, label: 'Revenue (₹)' },
              { color: CHART_COLORS.amber, label: 'Procurement Cost (₹)' },
            ]
      }
    >
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 4 }} barGap={6}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="date"
            tickFormatter={formatShortDate}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            dy={6}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            tickFormatter={formatCompactINR}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
            width={62}
          />
          <ReferenceLine y={0} stroke={CHART_COLORS.zeroLine} strokeWidth={1.5} />
          <Tooltip content={<DailyTooltip />} cursor={{ fill: CHART_COLORS.cursor }} />
          {view === 'net' ? (
            <Bar
              dataKey="profit"
              name="Net Profit / Loss"
              maxBarSize={36}
              shape={(props: BarShapeProps) => <ProfitBarShape {...props} orientation="vertical" />}
            />
          ) : (
            <>
              <Bar dataKey="revenue" name="Revenue" fill={CHART_COLORS.primary} radius={[6, 6, 0, 0]} maxBarSize={26} />
              <Bar dataKey="cost" name="Procurement Cost" fill={CHART_COLORS.amber} radius={[6, 6, 0, 0]} maxBarSize={26} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  );
}

/** Unit-wise comparison bar chart (used on Admin Dashboard). */
export function UnitProfitLossChart({
  data,
  sellingRate = DEFAULT_SELLING_RATE,
  title = 'Unit-wise Net Profit / Loss (₹)',
}: {
  data: UnitProfitDatum[];
  sellingRate?: number;
  title?: string;
}) {
  const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
  const totalCost = data.reduce((s, d) => s + d.cost, 0);
  const totalProfit = totalRevenue - totalCost;
  const chartHeight = Math.max(240, data.length * 52);
  const { domain, ticks } = computeCleanCurrencyTicks(data.map(d => d.profit));

  return (
    <ChartCardShell
      title={title}
      subtitle={`Per-unit net margin comparison across zone at ₹${sellingRate}/L`}
      badge={data.length > 0 ? <PeriodSummaryBadge profit={totalProfit} /> : undefined}
      isEmpty={data.length === 0}
      emptyMessage="No unit financial records for this period."
      summaryStrip={
        data.length > 0 ? (
          <div className="chart-kpi-strip">
            <span>Zone Revenue: <strong>{formatINR(totalRevenue)}</strong></span>
            <span>Zone Cost: <strong>{formatINR(totalCost)}</strong></span>
          </div>
        ) : undefined
      }
      legendItems={[
        { color: CHART_COLORS.profit, label: 'Net Profit (₹)' },
        { color: CHART_COLORS.loss, label: 'Net Loss (₹)' },
      ]}
    >
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_COLORS.grid} />
          <XAxis
            type="number"
            domain={domain}
            ticks={ticks}
            tickFormatter={formatCompactINR}
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
            width={120}
          />
          <ReferenceLine x={0} stroke={CHART_COLORS.zeroLine} strokeWidth={1.5} />
          <Tooltip content={<UnitTooltip />} cursor={{ fill: CHART_COLORS.cursor }} />
          <Bar
            dataKey="profit"
            name="Profit / Loss"
            maxBarSize={24}
            shape={(props: BarShapeProps) => <ProfitBarShape {...props} orientation="horizontal" />}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCardShell>
  );
}
