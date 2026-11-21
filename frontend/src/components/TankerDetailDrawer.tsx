import { useEffect, useRef } from 'react';
import type { DerivedTankerJourney } from '../lib/tankerJourney';
import { TankerTimeline } from './TankerTimeline';
import { formatDateDDMMYYYY, formatLitres } from '../lib/format';

export interface TankerDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  trip: any | null; // Enriched trip object with journey
  onTripUpdated?: () => void;
  isAdmin?: boolean;
}

export function TankerDetailDrawer({
  isOpen,
  onClose,
  trip,
}: TankerDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape & handle Focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !trip) return null;

  const journey: DerivedTankerJourney = trip.journey;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          zIndex: 1000,
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Drawer Container */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tanker ${trip.tanker_number} Journey Details`}
        className="tanker-detail-drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '520px',
          maxWidth: '100vw',
          backgroundColor: '#ffffff',
          boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.15)',
          zIndex: 1001,
          display: 'flex',
          flexDirection: 'column',
          transition: 'transform 0.25s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            backgroundColor: '#f8fafc',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                {trip.tanker_number}
              </h2>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: journey.stageColor.badgeBg,
                  color: journey.stageColor.badgeText,
                  border: `1px solid ${journey.stageColor.border}`,
                }}
              >
                {journey.tripStatusLabel}
              </span>
              {journey.isOverLimit && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 700,
                    backgroundColor: '#fee2e2',
                    color: '#991b1b',
                  }}
                >
                  Delayed
                </span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              BMC: <strong>{trip.bmcs?.name || 'BMC'}</strong> ({trip.bmcs?.bmc_code || '—'}) · DC No:{' '}
              <strong style={{ color: '#0284c7' }}>
                #{trip.dc_number || trip.stage_data?.dc_number || trip.stage_data?.vehicle_entered?.dc_number || '—'}
              </strong>{' '}
              · Dispatched: {formatLitres(trip.quantity_dispatched)} on {formatDateDDMMYYYY(trip.date)}
            </div>
            <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
              Driver: <strong style={{ color: '#0f172a' }}>{trip.driver_name || trip.stage_data?.driver_name || trip.stage_data?.vehicle_entered?.driver_name || '—'}</strong>
              {(trip.driver_phone || trip.stage_data?.driver_phone) && (
                <span> ({trip.driver_phone || trip.stage_data?.driver_phone})</span>
              )}
              {' '}· Seal: <strong style={{ color: '#0f172a' }}>{trip.seal_number || trip.stage_data?.seal_number || '—'}</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={onClose}
              aria-label="Close details drawer"
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#64748b',
                padding: '4px 8px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Auto Flags Notification Banner */}
        {journey.autoFlags && journey.autoFlags.length > 0 && (
          <div style={{ padding: '10px 20px', backgroundColor: '#fffbeb', borderBottom: '1px solid #fef3c7' }}>
            {journey.autoFlags.map((flag) => (
              <div
                key={flag.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: flag.tone === 'red' ? '#991b1b' : '#92400e',
                  fontWeight: 600,
                  marginBottom: '2px',
                }}
              >
                <span>⚠️</span>
                <span>{flag.label}: {flag.description}</span>
              </div>
            ))}
          </div>
        )}

        {/* Body Content - Stage Timeline with calculations */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Compartment Details Section if present */}
          {(() => {
            const compartments =
              (trip.compartments as any[]) ||
              journey.compartments ||
              (trip.stage_data as any)?.compartments ||
              (trip.stage_data as any)?.vehicle_entered?.compartments ||
              [];

            if (!compartments || compartments.length === 0) return null;

            return (
              <div
                style={{
                  marginBottom: '16px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🥛</span>
                    <span>Lorry Compartment Details ({compartments.length} Compartments)</span>
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#15803d' }}>
                    Total: {formatLitres(trip.quantity_dispatched)}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                  {compartments.map((comp: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #dcfce7',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                          {comp.compartment_name || `Compartment ${comp.compartment_no || idx + 1}`}
                        </span>
                        <strong style={{ fontSize: '13px', color: '#16a34a' }}>
                          {formatLitres(comp.quantity_litres)}
                        </strong>
                      </div>

                      <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {(comp.fat_pct != null || comp.snf_pct != null) && (
                          <div>
                            Quality: <strong>Fat {comp.fat_pct ?? '—'}% · SNF {comp.snf_pct ?? '—'}%</strong>
                          </div>
                        )}

                        {comp.seal_number && (
                          <div style={{ color: '#15803d' }}>
                            Top Seal: <strong>{comp.seal_number}</strong> ✓
                          </div>
                        )}
                        {comp.milk_type && (
                          <div style={{ color: '#475569' }}>
                            Milk Type: {comp.milk_type}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <TankerTimeline journey={journey} variant="full" />
        </div>
      </div>
    </>
  );
}

export default TankerDetailDrawer;
