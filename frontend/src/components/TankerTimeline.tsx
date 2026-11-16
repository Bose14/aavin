import React from 'react';
import type {
  DerivedTankerJourney,
  DerivedTimelineStep,
} from '../lib/tankerJourney';
import { formatLitres } from '../lib/format';

export interface TankerTimelineProps {
  journey: DerivedTankerJourney;
  variant?: 'full' | 'compact' | 'mini';
  className?: string;
  onStepClick?: (step: DerivedTimelineStep) => void;
  showCalculatedBlock?: boolean;
}

export function TankerTimeline({
  journey,
  variant = 'full',
  className = '',
  onStepClick,
  showCalculatedBlock = true,
}: TankerTimelineProps) {
  // Mini 7-dot stepper for table rows
  if (variant === 'mini') {
    return (
      <div
        className={`tanker-stepper-mini ${className}`}
        role="group"
        aria-label={`Tanker progress: ${journey.tripStatusLabel}, ${journey.completedStepsCount} of 7 stages done`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
      >
        {journey.timelineSteps.map((step) => {
          let bg = '#cbd5e1';
          let border = '1px solid #94a3b8';
          let title = `${step.stepNumber}. ${step.title}: ${step.status.toUpperCase()}`;

          if (step.status === 'done') {
            bg = '#22c55e'; // Green
            border = '1px solid #16a34a';
          } else if (step.status === 'rejected') {
            bg = '#ef4444'; // Red
            border = '1px solid #b91c1c';
            title += ` (Reason: ${step.rejectionReason || 'Rejected'})`;
          } else if (step.status === 'skipped') {
            bg = '#94a3b8'; // Grey skipped
            border = '1px dashed #64748b';
            title += ' (Skipped)';
          } else if (step.status === 'current') {
            bg = step.isOverLimit ? '#ef4444' : '#f97316'; // Orange / Red if over limit
            border = '2px solid #ea580c';
            title += ` (Waiting: ${step.waitingMinutes ?? 0}m)`;
          }

          return (
            <span
              key={step.key}
              title={title}
              aria-label={step.ariaLabel}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: bg,
                border,
                display: 'inline-block',
                cursor: 'pointer',
                transition: 'transform 0.15s ease',
              }}
              onClick={() => onStepClick?.(step)}
            />
          );
        })}
      </div>
    );
  }

  // Compact collapsed version for plant team forms (GATE, QC, UNLOADING)
  if (variant === 'compact') {
    return (
      <div
        className={`tanker-timeline-compact card ${className}`}
        style={{
          padding: '12px 16px',
          marginBottom: '16px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Tanker Journey Progress: </span>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                backgroundColor: journey.stageColor.badgeBg,
                color: journey.stageColor.badgeText,
              }}
            >
              {journey.tripStatusLabel}
            </span>
            {journey.isOverLimit && (
              <span
                style={{
                  marginLeft: '8px',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                }}
              >
                OVER LIMIT
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            Waiting on: <strong style={{ textTransform: 'uppercase', color: '#1e293b' }}>{journey.waitingTeamLabel}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          {journey.timelineSteps.map((step, idx) => {
            const isDone = step.status === 'done';
            const isCurrent = step.status === 'current';
            const isRejected = step.status === 'rejected';
            const isSkipped = step.status === 'skipped';

            let dotColor = '#cbd5e1';
            let textColor = '#64748b';
            if (isDone) {
              dotColor = '#22c55e';
              textColor = '#166534';
            } else if (isCurrent) {
              dotColor = step.isOverLimit ? '#ef4444' : '#ea580c';
              textColor = step.isOverLimit ? '#991b1b' : '#c2410c';
            } else if (isRejected) {
              dotColor = '#ef4444';
              textColor = '#991b1b';
            } else if (isSkipped) {
              dotColor = '#94a3b8';
              textColor = '#64748b';
            }

            return (
              <React.Fragment key={step.key}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    whiteSpace: 'nowrap',
                    opacity: step.status === 'pending' ? 0.6 : 1,
                  }}
                  title={step.keyDataSummary}
                >
                  <span
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      backgroundColor: dotColor,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '10px',
                      fontWeight: 700,
                    }}
                  >
                    {isDone ? '✓' : isRejected ? '✕' : isSkipped ? '–' : step.stepNumber}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: isCurrent ? 700 : 500, color: textColor }}>
                    {step.title}
                  </span>
                </div>
                {idx < journey.timelineSteps.length - 1 && (
                  <span style={{ color: '#cbd5e1', fontSize: '12px' }}>→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  // Full Vertical Order-Tracking Timeline
  return (
    <div className={`tanker-vertical-timeline ${className}`} style={{ padding: '8px 0' }}>
      <div style={{ position: 'relative', paddingLeft: '32px' }}>
        {journey.timelineSteps.map((step, idx) => {
          const isDone = step.status === 'done';
          const isCurrent = step.status === 'current';
          const isRejected = step.status === 'rejected';
          const isSkipped = step.status === 'skipped';
          const isPending = step.status === 'pending';

          const isLast = idx === journey.timelineSteps.length - 1;

          // Connector line color
          let lineColor = '#e2e8f0';
          if (isDone) lineColor = '#22c55e';

          return (
            <div
              key={step.key}
              style={{
                position: 'relative',
                paddingBottom: isLast ? '0px' : '24px',
              }}
              role="listitem"
              aria-label={step.ariaLabel}
            >
              {/* Vertical connector line */}
              {!isLast && (
                <div
                  style={{
                    position: 'absolute',
                    top: '20px',
                    left: '-23px',
                    bottom: '0',
                    width: '2px',
                    backgroundColor: lineColor,
                  }}
                />
              )}

              {/* Marker Dot */}
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: '-32px',
                  width: '20px',
                  height: '20px',
                  borderRadius: isPending ? '4px' : '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  boxSizing: 'border-box',
                  ...(isDone && {
                    backgroundColor: '#ffffff',
                    border: '3px solid #22c55e',
                    color: '#22c55e',
                  }),
                  ...(isCurrent && {
                    backgroundColor: step.isOverLimit ? '#ef4444' : '#f97316',
                    border: '3px solid #e2e8f0',
                    color: '#ffffff',
                  }),
                  ...(isRejected && {
                    backgroundColor: '#fee2e2',
                    border: '3px solid #ef4444',
                    color: '#ef4444',
                  }),
                  ...(isSkipped && {
                    backgroundColor: '#f1f5f9',
                    border: '2px dashed #94a3b8',
                    color: '#64748b',
                  }),
                  ...(isPending && {
                    backgroundColor: '#f8fafc',
                    border: '2px solid #cbd5e1',
                    color: '#94a3b8',
                  }),
                }}
              >
                {isDone ? '✓' : isRejected ? '✕' : isSkipped ? '–' : isCurrent ? '●' : '○'}
              </div>

              {/* Content Block */}
              <div style={{ marginLeft: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px' }}>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: isCurrent ? 700 : 600,
                      color: isPending ? '#94a3b8' : isRejected ? '#991b1b' : '#1e293b',
                    }}
                  >
                    {step.title}
                  </span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '1px 6px',
                      borderRadius: '4px',
                      backgroundColor: '#f1f5f9',
                      color: '#475569',
                      textTransform: 'uppercase',
                    }}
                  >
                    {step.teamLabel}
                  </span>
                </div>

                {/* Subtitle / Timestamp line */}
                <div style={{ fontSize: '12px', marginTop: '2px', color: '#64748b' }}>
                  {isDone && (
                    <>
                      <span>{step.done_at ? formatTimestamp(step.done_at) : 'Completed'}</span>
                      {step.done_by_name && <span> · by <strong>{step.done_by_name}</strong></span>}
                      {step.timeSpentMin != null && <span> · took {step.timeSpentMin}m</span>}
                    </>
                  )}
                  {isCurrent && (
                    <span style={{ color: step.isOverLimit ? '#dc2626' : '#d97706', fontWeight: 600 }}>
                      Waiting for {step.teamLabel} team · {step.waitingMinutes ?? 0}m
                      {step.isOverLimit && ` (Over limit by ${(step.waitingMinutes ?? 0) - step.timeLimitMin}m)`}
                    </span>
                  )}
                  {isRejected && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>
                      Rejected: {step.rejectionReason || 'QC Rejection'}
                    </span>
                  )}
                  {isSkipped && (
                    <span style={{ color: '#64748b', fontStyle: 'italic' }}>
                      Skipped (QC rejected)
                    </span>
                  )}
                  {isPending && <span>Pending</span>}
                </div>

                {/* Key data details */}
                {step.keyDataSummary && (
                  <div
                    style={{
                      marginTop: '4px',
                      fontSize: '12px',
                      backgroundColor: isDone ? '#f0fdf4' : isRejected ? '#fef2f2' : '#f8fafc',
                      border: `1px solid ${isDone ? '#bbf7d0' : isRejected ? '#fecaca' : '#e2e8f0'}`,
                      borderRadius: '4px',
                      padding: '4px 8px',
                      color: '#334155',
                    }}
                  >
                    {step.keyDataSummary}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Calculated Block under the timeline */}
      {showCalculatedBlock && (
        <div
          className="tanker-calculated-block"
          style={{
            marginTop: '20px',
            padding: '14px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
            Calculated Journey Metrics
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Gross Weight</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                {journey.calculated.gross_weight_kg != null ? `${journey.calculated.gross_weight_kg.toLocaleString('en-IN')} kg` : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Tare Weight</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                {journey.calculated.tare_weight_kg != null ? `${journey.calculated.tare_weight_kg.toLocaleString('en-IN')} kg` : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Net Weight</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>
                {journey.calculated.net_weight_kg != null ? `${journey.calculated.net_weight_kg.toLocaleString('en-IN')} kg` : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Net Litres</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>
                {journey.calculated.net_litres != null ? `${formatLitres(journey.calculated.net_litres)}` : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Transit Loss</div>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: (journey.calculated.transit_loss_pct ?? 0) > 1.0 ? '#dc2626' : '#166534',
                }}
              >
                {journey.calculated.transit_loss_litres != null
                  ? `${formatLitres(journey.calculated.transit_loss_litres)} (${journey.calculated.transit_loss_pct ?? 0}%)`
                  : '—'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>Turnaround</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                {journey.calculated.total_turnaround_min != null ? `${journey.calculated.total_turnaround_min} min` : 'In progress'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${mins}`;
  } catch {
    return isoString;
  }
}

export default TankerTimeline;
