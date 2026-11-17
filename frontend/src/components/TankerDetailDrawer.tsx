import { useEffect, useRef, useState } from 'react';
import type { DerivedTankerJourney, TankerStageKey } from '../lib/tankerJourney';
import { TankerTimeline } from './TankerTimeline';
import { formatDateDDMMYYYY, formatLitres, formatFatSnf } from '../lib/format';
import api from '../lib/api';

export interface AuditLogItem {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  actor_name?: string | null;
  created_at: string;
}

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
  const [activeTab, setActiveTab] = useState<'timeline' | 'all_data' | 'audit'>('timeline');

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

  // Full trip audit log state
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

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

  // Fetch audit logs when tab changes or drawer opens
  useEffect(() => {
    if (isOpen && trip?.id) {
      setLoadingAudit(true);
      api
        .get(`/tanker/${trip.id}`)
        .then((res) => {
          if (res.data?.audit_logs) {
            setAuditLogs(res.data.audit_logs);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingAudit(false));
    }
  }, [isOpen, trip?.id, activeTab]);

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
              Unit: <strong>{trip.units?.name || 'Village Unit'}</strong> ({trip.units?.unit_code || '—'}) · Dispatched: {formatLitres(trip.quantity_dispatched)} on {formatDateDDMMYYYY(trip.date)}
            </div>
          </div>

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
            }}
          >
            ✕
          </button>
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

        {/* Tab Navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            padding: '0 16px',
          }}
        >
          <button
            onClick={() => setActiveTab('timeline')}
            style={{
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'timeline' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'timeline' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Stage Timeline
          </button>
          <button
            onClick={() => setActiveTab('all_data')}
            style={{
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'all_data' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'all_data' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            All Stage Records
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            style={{
              padding: '10px 14px',
              border: 'none',
              background: 'none',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              color: activeTab === 'audit' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'audit' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Audit Log ({auditLogs.length})
          </button>
        </div>

        {/* Body Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {activeTab === 'timeline' && (
            <div>
              <TankerTimeline journey={journey} variant="full" />
            </div>
          )}

          {activeTab === 'all_data' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Trip General Info */}
              <div style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#1e293b' }}>Trip Information</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  <div>Driver: <strong>{trip.driver_name || '—'}</strong></div>
                  <div>Seal No: <strong>{trip.seal_number || '—'}</strong></div>
                  <div>Dispatch Fat: <strong>{formatFatSnf(trip.dispatch_fat_pct)}</strong></div>
                  <div>Dispatch SNF: <strong>{formatFatSnf(trip.dispatch_snf_pct)}</strong></div>
                  <div>Destination: <strong>{trip.destination || 'Main Dairy Plant'}</strong></div>
                  <div>Dispatch Time: <strong>{trip.dispatch_time || '—'}</strong></div>
                </div>
              </div>

              {/* Each Stage Data in order */}
              {journey.timelineSteps.map((step) => (
                <div
                  key={step.key}
                  style={{
                    padding: '12px',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    backgroundColor: step.status === 'done' ? '#f8fafc' : '#ffffff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                      {step.stepNumber}. {step.title}
                    </strong>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        color: step.status === 'done' ? '#166534' : step.status === 'rejected' ? '#991b1b' : '#64748b',
                      }}
                    >
                      {step.status}
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    {step.done_at && <div>Completed at: {step.done_at} by {step.done_by_name || 'Staff'}</div>}
                    {Object.keys(step.data).length > 0 ? (
                      <pre
                        style={{
                          margin: '6px 0 0 0',
                          padding: '6px 8px',
                          background: '#f1f5f9',
                          borderRadius: '4px',
                          fontSize: '11px',
                          overflowX: 'auto',
                        }}
                      >
                        {JSON.stringify(step.data, null, 2)}
                      </pre>
                    ) : (
                      <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No stage data recorded yet.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'audit' && (
            <div>
              {loadingAudit ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>Loading audit history…</div>
              ) : auditLogs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                  No audit entries found for this trip.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        padding: '10px 12px',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        backgroundColor: '#f8fafc',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#1e293b' }}>
                        <span>{log.action}</span>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>
                          {formatDateDDMMYYYY(log.created_at.slice(0, 10))} {log.created_at.slice(11, 16)}
                        </span>
                      </div>
                      <div style={{ color: '#475569', marginTop: '2px' }}>
                        Actor: <strong>{log.actor_name || 'System'}</strong>
                      </div>
                      {log.changes && (
                        <pre
                          style={{
                            margin: '4px 0 0 0',
                            padding: '4px 6px',
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '4px',
                            fontSize: '11px',
                          }}
                        >
                          {JSON.stringify(log.changes, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
