import type {
  DerivedTankerJourney,
  DerivedTimelineStep,
} from '../lib/tankerJourney';
import { formatLitres } from '../lib/format';

export interface TankerTimelineProps {
  journey: DerivedTankerJourney;
  tankerNumber?: string;
  sealNumber?: string;
  dispatchTime?: string;
  variant?: 'full' | 'compact' | 'mini';
  className?: string;
  onStepClick?: (step: DerivedTimelineStep) => void;
  showCalculatedBlock?: boolean;
}

export function TankerTimeline({
  journey,
  tankerNumber,
  sealNumber,
  dispatchTime,
  variant = 'full',
  className = '',
  onStepClick,
  showCalculatedBlock = true,
}: TankerTimelineProps) {
  const displayTanker =
    tankerNumber ||
    (journey as any).tanker_number ||
    (journey as any).tankerNumber ||
    (journey.timelineSteps[0]?.data?.tanker_number as string) ||
    '';
  const displaySeal =
    sealNumber ||
    (journey as any).seal_number ||
    (journey as any).sealNumber ||
    (journey.timelineSteps[0]?.data?.seal_number as string) ||
    '';
  const displayTime = dispatchTime || (journey as any).dispatch_time || (journey as any).dispatchTime || '';
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

  // Compact connected horizontal stepper version for plant team forms (GATE, QC, UNLOADING)
  if (variant === 'compact') {
    return (
      <div
        className={`tanker-timeline-compact card ${className}`}
        style={{
          padding: '16px 20px',
          marginBottom: '20px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        }}
        role="region"
        aria-label="Tanker Journey Stepper"
      >
        {/* Top Order-ID & Status Header (Exact reference image layout) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            paddingBottom: '14px',
            borderBottom: '1px solid #f1f5f9',
            marginBottom: '16px',
          }}
        >
          {/* Left: Order / Tanker ID with green highlight */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" rx="1" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b' }}>
              Tanker Journey Progress: <strong style={{ color: '#16a34a', fontWeight: 800 }}>#{displayTanker || 'TANKER'}</strong>
            </span>
          </div>

          {/* Right: Colored Pills (Expected Arrival & Tracking ID style) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {displayTime && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', fontWeight: 600 }}>
                <span>Expected Arrival</span>
                <span
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    padding: '3px 10px',
                    borderRadius: '14px',
                    fontWeight: 700,
                    fontSize: '11px',
                  }}
                >
                  {displayTime}
                </span>
              </div>
            )}

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569', fontWeight: 600 }}>
              <span>Tracking ID</span>
              <span
                style={{
                  backgroundColor: displaySeal ? '#dc2626' : '#64748b',
                  color: '#ffffff',
                  padding: '3px 10px',
                  borderRadius: '14px',
                  fontWeight: 700,
                  fontSize: '11px',
                }}
              >
                {displaySeal || displayTanker || 'LIVE'}
              </span>
            </div>

            <span
              style={{
                display: 'inline-block',
                padding: '3px 9px',
                borderRadius: '12px',
                fontSize: '11px',
                fontWeight: 700,
                backgroundColor: journey.stageColor.badgeBg,
                color: journey.stageColor.badgeText,
              }}
            >
              {journey.tripStatusLabel}
            </span>

            {journey.isOverLimit && (
              <span
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: '#fee2e2',
                  color: '#991b1b',
                }}
              >
                OVER LIMIT
              </span>
            )}
          </div>
        </div>

        {/* Horizontal Connected Stepper Line */}
        <div style={{ overflowX: 'auto', paddingBottom: '6px', paddingTop: '4px' }}>
          <div style={{ display: 'flex', minWidth: '700px', position: 'relative' }}>
            {journey.timelineSteps.map((step, idx) => {
              const isDone = step.status === 'done';
              const isCurrent = step.status === 'current';
              const isRejected = step.status === 'rejected';
              const isSkipped = step.status === 'skipped';
              const isPending = step.status === 'pending';

              let nodeBg = '#64748b';
              if (isDone) nodeBg = '#16a34a'; // Solid green like reference image
              else if (isCurrent) nodeBg = step.isOverLimit ? '#ef4444' : '#ea580c';
              else if (isRejected) nodeBg = '#ef4444';
              else if (isSkipped) nodeBg = '#94a3b8';

              const isLeftLineGreen = idx > 0 && journey.timelineSteps[idx - 1].status === 'done';
              const isRightLineGreen = isDone;

              return (
                <div
                  key={step.key}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: onStepClick ? 'pointer' : 'default',
                    userSelect: 'none',
                    padding: '2px 4px',
                  }}
                  onClick={() => onStepClick?.(step)}
                  title={step.keyDataSummary}
                >
                  {/* Stepper Node & Connector Line */}
                  <div
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      position: 'relative',
                      height: '38px',
                    }}
                  >
                    {/* Left Line */}
                    <div
                      style={{
                        flex: 1,
                        height: '5px',
                        backgroundColor: idx === 0 ? 'transparent' : isLeftLineGreen ? '#16a34a' : '#64748b',
                        borderRadius: idx === 0 ? '0' : '3px 0 0 3px',
                      }}
                    />

                    {/* Circular Node */}
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '50%',
                        backgroundColor: nodeBg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                        boxShadow: isCurrent ? '0 0 0 4px rgba(234, 88, 12, 0.3)' : '0 2px 4px rgba(0,0,0,0.12)',
                        position: 'relative',
                        zIndex: 2,
                        transform: isCurrent ? 'scale(1.1)' : 'scale(1)',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isDone ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : isRejected ? (
                        <span style={{ fontSize: '14px', fontWeight: 800 }}>✕</span>
                      ) : isSkipped ? (
                        <span style={{ fontSize: '14px', fontWeight: 800 }}>–</span>
                      ) : isCurrent ? (
                        <span style={{ fontSize: '11px', fontWeight: 800 }}>●</span>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>

                    {/* Right Line */}
                    <div
                      style={{
                        flex: 1,
                        height: '5px',
                        backgroundColor: idx === journey.timelineSteps.length - 1 ? 'transparent' : isRightLineGreen ? '#16a34a' : '#64748b',
                        borderRadius: idx === journey.timelineSteps.length - 1 ? '0' : '0 3px 3px 0',
                      }}
                    />
                  </div>

                  {/* Under Node: Title and detail */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                      marginTop: '8px',
                      gap: '2px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: isCurrent ? 800 : 700,
                        color: isCurrent ? '#ea580c' : isDone ? '#166534' : isPending ? '#64748b' : '#1e293b',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.title}
                    </div>

                    <div style={{ fontSize: '10.5px', color: '#64748b' }}>
                      {isDone ? (
                        <span style={{ color: '#16a34a', fontWeight: 600 }}>Done</span>
                      ) : isCurrent ? (
                        <span style={{ color: step.isOverLimit ? '#ef4444' : '#ea580c', fontWeight: 700 }}>
                          Waiting ({step.waitingMinutes ?? 0}m)
                        </span>
                      ) : isSkipped ? (
                        <span style={{ color: '#94a3b8' }}>Skipped</span>
                      ) : (
                        <span>{step.teamLabel}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
