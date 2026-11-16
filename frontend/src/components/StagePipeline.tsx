export interface StageChipData {
  count: number;
  delayedCount: number;
  label: string;
  color?: string;
}

export interface StagePipelineProps {
  chips: Record<string, StageChipData>;
  selectedStage: string;
  onSelectStage: (stageKey: string) => void;
  inPlantCount?: number;
  waitingTooLongCount?: number;
  qcRejectedCount?: number;
  totalTankersCount?: number;
  className?: string;
}

interface PipelineStepDef {
  key: string;
  title: string;
  team: 'transit' | 'gate' | 'qc' | 'unloading';
  teamLabel: string;
  iconBg: string;
  iconColor: string;
}

const PIPELINE_STEPS: PipelineStepDef[] = [
  { key: 'on_the_way', title: 'On the way', team: 'transit', teamLabel: 'Transit', iconBg: '#eff6ff', iconColor: '#2563eb' },
  { key: 'vehicle_entered', title: 'Vehicle Entered', team: 'gate', teamLabel: 'Gate', iconBg: '#fef3c7', iconColor: '#d97706' },
  { key: 'gross_done', title: 'Gross Done', team: 'gate', teamLabel: 'Gate', iconBg: '#fef9c3', iconColor: '#ca8a04' },
  { key: 'qc_done', title: 'QC Done', team: 'qc', teamLabel: 'QC', iconBg: '#ffedd5', iconColor: '#ea580c' },
  { key: 'unloaded', title: 'Unloaded', team: 'unloading', teamLabel: 'Unloading', iconBg: '#e0f2fe', iconColor: '#0284c7' },
  { key: 'tare_done', title: 'Tare Done', team: 'gate', teamLabel: 'Gate', iconBg: '#f3e8ff', iconColor: '#9333ea' },
  { key: 'cip_done', title: 'CIP Done', team: 'qc', teamLabel: 'QC', iconBg: '#ccfbf1', iconColor: '#0d9488' },
  { key: 'exited', title: 'Vehicle Exit', team: 'gate', teamLabel: 'Gate', iconBg: '#dcfce7', iconColor: '#16a34a' },
];

function renderStepIcon(key: string, color: string) {
  switch (key) {
    case 'on_the_way':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="3" width="15" height="13" rx="1" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
    case 'vehicle_entered':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V7l8-4v18" />
          <path d="M19 21V11l-6-3" />
          <circle cx="9" cy="12" r="1" />
        </svg>
      );
    case 'gross_done':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18" />
          <path d="M6 7l6-2 6 2" />
          <path d="M6 7l-3 7h6l-3-7z" />
          <path d="M18 7l-3 7h6l-3-7z" />
          <path d="M8 21h8" />
        </svg>
      );
    case 'qc_done':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2v7.5L4.5 19.5A2 2 0 0 0 6.2 22h11.6a2 2 0 0 0 1.7-2.5L14 9.5V2" />
          <path d="M8.5 2h7" />
          <path d="M7 16h10" />
        </svg>
      );
    case 'unloaded':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
        </svg>
      );
    case 'tare_done':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18" />
          <path d="M4 8l8-3 8 3" />
          <circle cx="12" cy="12" r="3" />
          <path d="M6 21h12" />
        </svg>
      );
    case 'cip_done':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          <circle cx="19" cy="5" r="1.5" />
        </svg>
      );
    case 'exited':
    default:
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      );
  }
}

export function StagePipeline({
  chips,
  selectedStage,
  onSelectStage,
  inPlantCount = 0,
  waitingTooLongCount = 0,
  qcRejectedCount = 0,
  totalTankersCount = 0,
  className = '',
}: StagePipelineProps) {
  const selectedStepDef = PIPELINE_STEPS.find((s) => s.key === selectedStage);
  const isQcRejectedSelected = selectedStage === 'qc_rejected';

  return (
    <div
      className={`stage-pipeline-card card ${className}`}
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '20px 24px',
        marginBottom: '22px',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.05)',
      }}
      role="region"
      aria-label="Tanker Journey Stage Pipeline"
    >
      {/* Header with Stage Pipeline title and status pills */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '14px',
          borderBottom: '1px solid #f1f5f9',
          marginBottom: '20px',
        }}
      >
        {/* Left: Clean title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Stage Pipeline Overview
          </span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            ({totalTankersCount > 0 ? `${totalTankersCount} tankers · ` : ''}Click stage node to filter)
          </span>
        </div>

        {/* Right: Status Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Blue Pill: In Plant Now */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: '#475569',
              fontWeight: 600,
            }}
          >
            <span>In Plant :</span>
            <span
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                padding: '4px 12px',
                borderRadius: '16px',
                fontWeight: 700,
                fontSize: '12px',
                boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
              }}
            >
              {inPlantCount} tankers
            </span>
          </div>

          {/* Red Pill: Waiting Too Long / Delayed */}
          {waitingTooLongCount > 0 && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: '#475569',
                fontWeight: 600,
              }}
            >
              <span>Delayed :</span>
              <span
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontWeight: 700,
                  fontSize: '12px',
                  boxShadow: '0 2px 4px rgba(220,38,38,0.25)',
                }}
              >
                {waitingTooLongCount} over limit
              </span>
            </div>
          )}

          {/* Crimson Pill: QC Rejected */}
          {qcRejectedCount > 0 && (
            <button
              type="button"
              onClick={() => onSelectStage(isQcRejectedSelected ? '' : 'qc_rejected')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: isQcRejectedSelected ? '2px solid #991b1b' : 'none',
                background: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
              title="Filter by QC Rejected tankers"
            >
              <span
                style={{
                  backgroundColor: isQcRejectedSelected ? '#991b1b' : '#ef4444',
                  color: '#ffffff',
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontWeight: 700,
                  fontSize: '12px',
                  boxShadow: '0 2px 4px rgba(239,68,68,0.25)',
                }}
              >
                ⚠ {qcRejectedCount} QC Rejected
              </span>
            </button>
          )}

          {/* Active Filter Clear Pill */}
          {selectedStage && (
            <button
              type="button"
              onClick={() => onSelectStage('')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '16px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
              }}
              title="Clear active stage filter"
            >
              <span>
                Filtered: <strong>{selectedStepDef?.title || (isQcRejectedSelected ? 'QC Rejected' : selectedStage)}</strong>
              </span>
              <span style={{ color: '#ef4444', fontWeight: 800 }}>✕</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Horizontal Connected Stepper Line (Exact GeeksforGeeks design) */}
      <div
        className="pipeline-stepper-scroll"
        style={{
          overflowX: 'auto',
          paddingBottom: '8px',
          paddingTop: '6px',
        }}
      >
        <div
          style={{
            display: 'flex',
            minWidth: '780px',
            position: 'relative',
          }}
        >
          {PIPELINE_STEPS.map((step, idx) => {
            const chip = chips[step.key] || { count: 0, delayedCount: 0, label: step.title };
            const isSelected = selectedStage === step.key;
            const hasTankers = chip.count > 0;
            const isDelayed = chip.delayedCount > 0;

            // In the reference image:
            // Continuous green line connects through nodes; completed/active stages have green line, future stages grey line
            const isLeftLineGreen = idx > 0;
            const isRightLineGreen = idx < PIPELINE_STEPS.length - 1;

            return (
              <div
                key={step.key}
                onClick={() => onSelectStage(isSelected ? '' : step.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'pointer',
                  position: 'relative',
                  userSelect: 'none',
                  padding: '4px 6px',
                  borderRadius: '10px',
                  backgroundColor: isSelected ? '#f8fafc' : 'transparent',
                  transition: 'all 0.15s ease',
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`${step.title}, ${chip.count} tankers, ${chip.delayedCount} delayed. Click to filter.`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectStage(isSelected ? '' : step.key);
                  }
                }}
              >
                {/* Stepper Node & Connecting Lines Row */}
                <div
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    position: 'relative',
                    height: '42px',
                  }}
                >
                  {/* Left Connector Line */}
                  <div
                    style={{
                      flex: 1,
                      height: '6px',
                      backgroundColor: idx === 0 ? 'transparent' : isLeftLineGreen ? '#16a34a' : '#64748b',
                      borderRadius: idx === 0 ? '0' : '3px 0 0 3px',
                    }}
                  />

                  {/* Circular Node (Green with checkmark ✓ like reference image) */}
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      backgroundColor: isSelected
                        ? '#15803d'
                        : hasTankers
                        ? '#16a34a'
                        : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      boxShadow: isSelected
                        ? '0 0 0 4px rgba(37, 99, 235, 0.4), 0 2px 6px rgba(0,0,0,0.15)'
                        : '0 2px 6px rgba(0,0,0,0.12)',
                      position: 'relative',
                      zIndex: 2,
                      transform: isSelected ? 'scale(1.12)' : 'scale(1)',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {/* White Checkmark Icon (Exact like reference image) */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>

                    {/* Tanker Count Badge (on top-right of node) */}
                    {chip.count > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-8px',
                          backgroundColor: '#1e293b',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '10px',
                          border: '2px solid #ffffff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          minWidth: '18px',
                          textAlign: 'center',
                        }}
                      >
                        {chip.count}
                      </span>
                    )}

                    {/* Delayed Alert Badge */}
                    {isDelayed && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: '-4px',
                          right: '-8px',
                          backgroundColor: '#ef4444',
                          color: '#ffffff',
                          fontSize: '10px',
                          fontWeight: 800,
                          padding: '1px 5px',
                          borderRadius: '8px',
                          border: '1.5px solid #ffffff',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                        title={`${chip.delayedCount} tanker(s) waiting beyond SLA limit!`}
                      >
                        ! {chip.delayedCount}
                      </span>
                    )}
                  </div>

                  {/* Right Connector Line */}
                  <div
                    style={{
                      flex: 1,
                      height: '6px',
                      backgroundColor: idx === PIPELINE_STEPS.length - 1 ? 'transparent' : isRightLineGreen ? '#16a34a' : '#64748b',
                      borderRadius: idx === PIPELINE_STEPS.length - 1 ? '0' : '0 3px 3px 0',
                    }}
                  />
                </div>

                {/* Bottom Row: Stage Icon + Title (Exact GeeksforGeeks bottom style) */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    marginTop: '12px',
                    gap: '4px',
                  }}
                >
                  {/* Icon with soft background pill */}
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: step.iconBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '2px',
                    }}
                  >
                    {renderStepIcon(step.key, step.iconColor)}
                  </div>

                  {/* Stage Title */}
                  <div
                    style={{
                      fontSize: '12.5px',
                      fontWeight: isSelected ? 800 : 700,
                      color: isSelected ? '#1e40af' : '#1e293b',
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {step.title}
                  </div>

                  {/* Team & Live Count Subtitle */}
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span
                      style={{
                        padding: '1px 5px',
                        borderRadius: '4px',
                        backgroundColor: '#f1f5f9',
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#475569',
                      }}
                    >
                      {step.teamLabel}
                    </span>
                    <span>·</span>
                    <strong style={{ color: chip.count > 0 ? '#0f172a' : '#94a3b8' }}>
                      {chip.count}
                    </strong>
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

export default StagePipeline;
