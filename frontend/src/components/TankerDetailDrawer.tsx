import { useEffect, useRef, useState } from 'react';
import type { DerivedTankerJourney, TankerStageKey } from '../lib/tankerJourney';
import { TankerTimeline } from './TankerTimeline';
import { formatDateDDMMYYYY, formatLitres } from '../lib/format';
import api from '../lib/api';

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
  onTripUpdated,
  isAdmin = true,
}: TankerDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Correction modal state
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedStageKey, setSelectedStageKey] = useState<TankerStageKey>('gross_weight');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionFields, setCorrectionFields] = useState<Record<string, any>>({});
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState('');

  // Remark modal state
  const [showRemarkModal, setShowRemarkModal] = useState(false);
  const [remarkText, setRemarkText] = useState('');
  const [isException, setIsException] = useState(false);
  const [savingRemark, setSavingRemark] = useState(false);
  const [exportingDossier, setExportingDossier] = useState(false);

  const handleExportDossier = async () => {
    if (!trip?.id) return;
    setExportingDossier(true);
    try {
      const res = await api.get(`/export/tanker/${trip.id}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      const cleanNo = String(trip.tanker_number || 'Tanker').replace(/[^A-Za-z0-9]/g, '_');
      link.setAttribute('download', `Tanker_${cleanNo}_Dossier.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      alert('Failed to export tanker dossier: ' + (err.response?.data?.error || err.message));
    } finally {
      setExportingDossier(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

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

  const handleOpenCorrection = (stageKey?: TankerStageKey) => {
    const key = stageKey || 'gross_weight';
    setSelectedStageKey(key);
    setCorrectionReason('');
    setCorrectionError('');

    // Prepopulate fields based on existing stage data
    const stageRecord = journey.timelineSteps.find((s) => s.key === key);
    const existingData = stageRecord?.data || {};

    if (key === 'gross_weight') {
      setCorrectionFields({
        gross_weight_kg: existingData.gross_weight_kg || journey.calculated.gross_weight_kg || '',
        weighbridge_slip_no: existingData.weighbridge_slip_no || '',
      });
    } else if (key === 'tare_weight') {
      setCorrectionFields({
        tare_weight_kg: existingData.tare_weight_kg || journey.calculated.tare_weight_kg || '',
        tare_slip_no: existingData.tare_slip_no || '',
      });
    } else if (key === 'qc_completed') {
      setCorrectionFields({
        qc_status: existingData.qc_status || 'accepted',
        received_fat_pct: existingData.received_fat_pct || '',
        received_snf_pct: existingData.received_snf_pct || '',
        rejection_reason: existingData.rejection_reason || '',
      });
    } else if (key === 'unloaded') {
      setCorrectionFields({
        unloaded_litres: existingData.unloaded_litres || journey.calculated.received_litres || '',
        silo_or_bay: existingData.silo_or_bay || 'Main Bay',
      });
    } else {
      setCorrectionFields({});
    }

    setShowCorrectionModal(true);
  };

  const handleSaveCorrection = async () => {
    if (!correctionReason.trim()) {
      setCorrectionError('Reason is mandatory for stage correction');
      return;
    }
    setSavingCorrection(true);
    setCorrectionError('');

    try {
      await api.post(`/tanker/${trip.id}/correct`, {
        stage_name: selectedStageKey,
        changes: correctionFields,
        reason: correctionReason.trim(),
      });
      setShowCorrectionModal(false);
      onTripUpdated?.();
    } catch (err: any) {
      setCorrectionError(err.response?.data?.error || err.message || 'Failed to correct stage');
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleSaveRemark = async () => {
    if (!remarkText.trim()) return;
    setSavingRemark(true);
    try {
      await api.post(`/tanker/${trip.id}/remark`, {
        remark: remarkText.trim(),
        is_exception: isException,
      });
      setShowRemarkModal(false);
      setRemarkText('');
      onTripUpdated?.();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingRemark(false);
    }
  };

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
              BMC: <strong>{trip.units?.name || 'BMC'}</strong> ({trip.units?.unit_code || '—'}) · DC No:{' '}
              <strong style={{ color: '#0284c7' }}>
                #{trip.dc_number || trip.stage_data?.dc_number || trip.stage_data?.vehicle_entered?.dc_number || '—'}
              </strong>{' '}
              · Dispatched: {formatLitres(trip.quantity_dispatched)} on {formatDateDDMMYYYY(trip.date)}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleExportDossier}
              disabled={exportingDossier}
              className="btn btn-secondary btn-sm"
              style={{
                fontSize: '11px',
                height: '32px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #86efac',
                backgroundColor: '#f0fdf4',
                color: '#166534',
                fontWeight: 700,
                cursor: exportingDossier ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                width: 'auto',
              }}
              title="Export complete tanker particulars, weights, QC, and compartment breakdown as Excel"
            >
              {exportingDossier ? 'Exporting…' : '📥 Export Dossier (.xlsx)'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="btn btn-secondary btn-sm"
              style={{
                fontSize: '11px',
                height: '32px',
                padding: '0 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#334155',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                width: 'auto',
              }}
              title="Print official gate pass & tanker dossier"
            >
              🖨️ Print
            </button>

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
                marginLeft: '4px',
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
                        {comp.dipstick_cm != null && (
                          <div>
                            Dipstick Level: <strong>{comp.dipstick_cm} cm</strong>
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

        {/* Footer Admin Actions */}
        {isAdmin && (
          <div
            style={{
              padding: '12px 20px',
              borderTop: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => handleOpenCorrection()}
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              ✏️ Correct a Stage
            </button>
            <button
              onClick={() => setShowRemarkModal(true)}
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '6px 12px' }}
            >
              💬 Add Remark
            </button>
          </div>
        )}
      </div>

      {/* Stage Correction Modal */}
      {showCorrectionModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '480px',
              width: '100%',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Correct Tanker Stage</h3>
            {correctionError && (
              <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>
                {correctionError}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Select Stage to Correct
              </label>
              <select
                value={selectedStageKey}
                onChange={(e) => handleOpenCorrection(e.target.value as TankerStageKey)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              >
                <option value="vehicle_entered">1. Vehicle Entered (Gate)</option>
                <option value="gross_weight">2. Gross Weight (Gate)</option>
                <option value="qc_completed">3. QC Completed (QC)</option>
                <option value="unloaded">4. Unloaded (Unloading)</option>
                <option value="tare_weight">5. Tare Weight (Gate)</option>
                <option value="cip_completed">6. CIP Completed (QC)</option>
                <option value="vehicle_exit">7. Vehicle Exit (Gate)</option>
              </select>
            </div>

            {/* Dynamic Stage Input Fields */}
            {selectedStageKey === 'gross_weight' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Gross Weight (kg)
                </label>
                <input
                  type="number"
                  value={correctionFields.gross_weight_kg ?? ''}
                  onChange={(e) => setCorrectionFields({ ...correctionFields, gross_weight_kg: Number(e.target.value) })}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            {selectedStageKey === 'tare_weight' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Tare Weight (kg)
                </label>
                <input
                  type="number"
                  value={correctionFields.tare_weight_kg ?? ''}
                  onChange={(e) => setCorrectionFields({ ...correctionFields, tare_weight_kg: Number(e.target.value) })}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            {selectedStageKey === 'qc_completed' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Received Fat %
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={correctionFields.received_fat_pct ?? ''}
                    onChange={(e) => setCorrectionFields({ ...correctionFields, received_fat_pct: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Received SNF %
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={correctionFields.received_snf_pct ?? ''}
                    onChange={(e) => setCorrectionFields({ ...correctionFields, received_snf_pct: Number(e.target.value) })}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  />
                </div>
              </div>
            )}

            {selectedStageKey === 'unloaded' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Unloaded Litres
                </label>
                <input
                  type="number"
                  value={correctionFields.unloaded_litres ?? ''}
                  onChange={(e) => setCorrectionFields({ ...correctionFields, unloaded_litres: Number(e.target.value) })}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>
            )}

            {/* Mandatory Reason */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#dc2626' }}>
                Reason for Correction (Mandatory) *
              </label>
              <textarea
                rows={3}
                placeholder="Explain why this stage is being corrected..."
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="btn btn-secondary"
                disabled={savingCorrection}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrection}
                className="btn btn-primary"
                disabled={savingCorrection || !correctionReason.trim()}
              >
                {savingCorrection ? 'Saving…' : 'Save Correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remark Modal */}
      {showRemarkModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '20px',
              maxWidth: '420px',
              width: '100%',
              boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Add Admin Remark</h3>
            <div style={{ marginBottom: '12px' }}>
              <textarea
                rows={3}
                placeholder="Enter note or explanation for this trip..."
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                <input
                  type="checkbox"
                  checked={isException}
                  onChange={(e) => setIsException(e.target.checked)}
                />
                Mark as operational exception
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowRemarkModal(false)}
                className="btn btn-secondary"
                disabled={savingRemark}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRemark}
                className="btn btn-primary"
                disabled={savingRemark || !remarkText.trim()}
              >
                {savingRemark ? 'Saving…' : 'Save Remark'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default TankerDetailDrawer;
