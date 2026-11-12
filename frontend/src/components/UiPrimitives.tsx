import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../context/LanguageContext';

export function InfoTooltip({ text, label = 'More info' }: { text: string; label?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'above' | 'below' } | null>(null);

  const openAtButton = () => {
    const el = btnRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const popWidth = 236;
    const clampedLeft = Math.max(12, Math.min(rect.left + rect.width / 2 - popWidth / 2, window.innerWidth - popWidth - 12));
    const placeBelow = rect.top < 120;
    setPos({
      left: clampedLeft,
      top: placeBelow ? rect.bottom + 8 : rect.top - 8,
      placement: placeBelow ? 'below' : 'above',
    });
  };

  return (
    <span
      className="info-tooltip-wrap"
      onMouseEnter={openAtButton}
      onMouseLeave={() => setPos(null)}
    >
      <button
        ref={btnRef}
        type="button"
        className="info-tooltip-btn"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          if (pos) setPos(null);
          else openAtButton();
        }}
        onBlur={() => setPos(null)}
      >
        i
      </button>
      {pos && (
        <span
          className="info-tooltip-pop"
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            transform: pos.placement === 'above' ? 'translateY(-100%)' : 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export type BadgeTone = 'green' | 'amber' | 'red' | 'grey' | 'indigo';

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn-secondary btn-sm" onClick={onRetry}>
          {t('retry')}
        </button>
      )}
    </div>
  );
}

export function StatsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="stats-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card">
          <div className="skeleton skeleton-line sm" />
          <div className="skeleton skeleton-line lg" />
          <div className="skeleton skeleton-line md" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="card chart-card">
      <div className="skeleton skeleton-line md" style={{ marginBottom: 12 }} />
      <div className="skeleton" style={{ height, borderRadius: 8 }} />
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card table-card" style={{ padding: '1rem' }}>
      <div className="skeleton skeleton-line md" style={{ marginBottom: 14 }} />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10, marginBottom: 10 }}>
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="skeleton" style={{ height: 18 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel,
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="modal-card">
        <h3 id="confirm-dialog-title" className="modal-title">{title}</h3>
        <p className="modal-body-text">{message}</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t('cancel')}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            style={{ width: 'auto' }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? t('saving') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

