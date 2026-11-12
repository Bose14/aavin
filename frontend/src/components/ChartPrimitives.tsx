import type { ReactNode } from 'react';
import { InfoTooltip } from './UiPrimitives';

export interface ChartCardShellProps {
  title: string;
  subtitle: string;
  tooltip?: string;
  badge?: ReactNode;
  headerRight?: ReactNode;
  summaryStrip?: ReactNode;
  legendItems?: ReadonlyArray<{ color: string; label: string; dashed?: boolean }>;
  isEmpty: boolean;
  emptyMessage: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  children: ReactNode;
}

/** Shared card wrapper with header, contextual subtitle, badge/toggle controls, summary strip, and empty CTA. */
export function ChartCardShell({
  title,
  subtitle,
  tooltip,
  badge,
  headerRight,
  summaryStrip,
  legendItems,
  isEmpty,
  emptyMessage,
  emptyActionLabel,
  onEmptyAction,
  children,
}: ChartCardShellProps) {
  return (
    <div className="card chart-card">
      <div className="chart-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <h2>{title}</h2>
            {tooltip && <InfoTooltip text={tooltip} label={title} />}
          </div>
          <p className="chart-subtitle">{subtitle}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {headerRight}
          {badge}
        </div>
      </div>

      {isEmpty ? (
        <div className="chart-empty" style={{ flexDirection: 'column', gap: '0.75rem', padding: '1rem', textAlign: 'center' }}>
          <p>{emptyMessage}</p>
          {emptyActionLabel && onEmptyAction && (
            <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={onEmptyAction}>
              {emptyActionLabel}
            </button>
          )}
        </div>
      ) : (
        <>
          {summaryStrip}
          {legendItems && legendItems.length > 0 && (
            <div className="chart-legend" aria-label="Chart legend">
              {legendItems.map((item) => (
                <span key={item.label} className="chart-legend-item">
                  <span
                    className={item.dashed ? 'chart-line-sample' : 'chart-dot'}
                    style={item.dashed ? { borderTopColor: item.color } : { backgroundColor: item.color }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}

export interface TooltipRowProps {
  color: string;
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}

export function TooltipRow({ color, label, value, tone }: TooltipRowProps) {
  return (
    <div className="chart-tooltip-row">
      <span className="chart-tooltip-label">
        <span className="chart-dot" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className={`chart-tooltip-val ${tone === 'positive' ? 'profit-pos' : tone === 'negative' ? 'profit-neg' : ''}`}>
        {value}
      </span>
    </div>
  );
}
