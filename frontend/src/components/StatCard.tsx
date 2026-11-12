import { InfoTooltip } from './UiPrimitives';

export interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  valueTone?: 'positive' | 'negative' | 'warning';
  tooltip?: string;
  onClick?: () => void;
}

/** Shared KPI summary card used across Admin and Unit dashboards. */
export function StatCard({ label, value, sub, positive, valueTone, tooltip, onClick }: StatCardProps) {
  const valueClass = valueTone === 'positive'
    ? 'stat-value profit-pos'
    : valueTone === 'negative'
      ? 'stat-value profit-neg'
      : valueTone === 'warning'
        ? 'stat-value stat-warn'
        : 'stat-value';

  const interactiveClass = onClick ? 'stat-card stat-card-clickable' : 'stat-card';

  return (
    <div
      className={interactiveClass}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
    >
      <div className="stat-label-row">
        <p className="stat-label">{label}</p>
        {tooltip && <InfoTooltip text={tooltip} label={label} />}
      </div>
      <p className={valueClass}>{value}</p>
      {sub && <p className={`stat-sub ${positive === true ? 'up' : positive === false ? 'down' : ''}`}>{sub}</p>}
    </div>
  );
}
