import { useCallback, useRef, useState, type ReactNode } from 'react';
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
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * Hook for full-column (horizontal layout) or full-row (vertical layout) touch & pointer selection.
 * Spans the entire plot height/width so taps anywhere in the vertical column (above, on, or below a bar)
 * instantly select that item and trigger Recharts' native tooltip & cursor without needing an external card.
 */
export interface UseChartSlotSelectionOptions<T> {
  data: T[];
  getKey: (item: T) => string;
  layout?: 'horizontal' | 'vertical';
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
}

export function useChartSlotSelection<T>({
  data,
  getKey,
  layout = 'horizontal',
  marginLeft = 56,
  marginRight = 12,
  marginTop = 8,
  marginBottom = 24,
}: UseChartSlotSelectionOptions<T>) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPointerTimeRef = useRef<number>(0);

  const clearSelection = useCallback(() => {
    setSelectedKey(null);
    if (containerRef.current) {
      dismissChartTooltip(containerRef.current);
    }
  }, []);

  const selectSlot = useCallback(
    (clientX: number, clientY?: number) => {
      const container = containerRef.current;
      if (!container || data.length === 0) return;
      const wrapper = container.querySelector('.recharts-wrapper') as HTMLElement | null;
      if (!wrapper) return;

      const rect = wrapper.getBoundingClientRect();

      if (layout === 'horizontal') {
        const touchX = clientX - rect.left;
        const plotLeft = marginLeft;
        const plotRight = rect.width - marginRight;
        const plotWidth = plotRight - plotLeft;

        if (plotWidth <= 0 || touchX < plotLeft - 12 || touchX > plotRight + 12) {
          return;
        }

        const clampedX = Math.max(0, Math.min(plotWidth - 1, touchX - plotLeft));
        const slotWidth = plotWidth / data.length;
        const idx = Math.floor(clampedX / slotWidth);
        const safeIdx = Math.max(0, Math.min(data.length - 1, idx));
        const item = data[safeIdx];
        if (!item) return;

        const key = getKey(item);
        if (selectedKey === key) {
          setSelectedKey(null);
          wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          return;
        }

        setSelectedKey(key);
        const centerX = rect.left + plotLeft + (safeIdx + 0.5) * slotWidth;
        const centerY = clientY ?? (rect.top + rect.height / 2);

        wrapper.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: centerX,
            clientY: centerY,
            bubbles: true,
            cancelable: true,
          })
        );
      } else {
        const touchY = (clientY ?? (rect.top + rect.height / 2)) - rect.top;
        const plotTop = marginTop;
        const plotBottom = rect.height - marginBottom;
        const plotHeight = plotBottom - plotTop;

        if (plotHeight <= 0 || touchY < plotTop - 8 || touchY > plotBottom + 8) {
          return;
        }

        const clampedY = Math.max(0, Math.min(plotHeight - 1, touchY - plotTop));
        const slotHeight = plotHeight / data.length;
        const idx = Math.floor(clampedY / slotHeight);
        const safeIdx = Math.max(0, Math.min(data.length - 1, idx));
        const item = data[safeIdx];
        if (!item) return;

        const key = getKey(item);
        if (selectedKey === key) {
          setSelectedKey(null);
          wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          return;
        }

        setSelectedKey(key);
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + plotTop + (safeIdx + 0.5) * slotHeight;

        wrapper.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: centerX,
            clientY: centerY,
            bubbles: true,
            cancelable: true,
          })
        );
      }
    },
    [data, getKey, layout, marginLeft, marginRight, marginTop, marginBottom, selectedKey]
  );

  const containerProps = {
    ref: containerRef,
    style: { width: '100%', position: 'relative' as const, touchAction: 'pan-y' as const },
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.isPrimary) {
        lastPointerTimeRef.current = Date.now();
        selectSlot(e.clientX, e.clientY);
      }
    },
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() - lastPointerTimeRef.current > 400) {
        selectSlot(e.clientX, e.clientY);
      }
    },
  };

  return {
    selectedKey,
    setSelectedKey,
    clearSelection,
    containerRef,
    containerProps,
  };
}

/**
 * Ensures instantaneous touch/tap response on mobile screens for Recharts.
 * Recharts 3.10 handles touch event state inside touchmove but ignores touchstart alone;
 * dispatching a touchmove event with the same touch coordinate ensures immediate selection on tap.
 */
export function handleChartTouchStart(_state: unknown, event?: React.TouchEvent<SVGGraphicsElement>) {
  try {
    const rawTarget = event?.currentTarget as unknown as HTMLElement | null;
    if (rawTarget && event && event.touches && event.touches.length > 0) {
      const touch = event.touches[0] as unknown as Touch;
      if (typeof TouchEvent === 'function') {
        const moveEvent = new TouchEvent('touchmove', {
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        });
        rawTarget.dispatchEvent(moveEvent);
      }
    }
  } catch {
    // Ignore fallback for environments without TouchEvent constructor
  }
}

/**
 * Dismisses any active/stuck tooltip on the target chart container by simulating mouseleave.
 */
export function dismissChartTooltip(container: HTMLElement | null) {
  if (!container) return;
  const wrapper = container.querySelector('.recharts-wrapper');
  if (wrapper) {
    wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
  }
}

/** Shared card wrapper with header, contextual subtitle, badge/toggle controls, summary strip, tap-to-dismiss, and empty CTA. */
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
  onDismiss,
  children,
}: ChartCardShellProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleCardDismiss = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    // If the user clicks or taps outside the active SVG plot (e.g. on header, legend, or empty card margin),
    // dismiss any open sticky tooltip so they can easily reset/unclutter the graph on mobile.
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('.recharts-responsive-container') && !target.closest('button') && !target.closest('input')) {
      dismissChartTooltip(cardRef.current);
      onDismiss?.();
    }
  };

  return (
    <div
      ref={cardRef}
      className="card chart-card"
      onClick={handleCardDismiss}
      onTouchEnd={handleCardDismiss}
    >
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
