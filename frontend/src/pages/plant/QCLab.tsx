import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatFatSnf } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';

export default function QCLab() {
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // QC Form States
  const [qcDecision, setQcDecision] = useState<'accepted' | 'rejected'>('accepted');
  const [receivedFat, setReceivedFat] = useState('');
  const [receivedSnf, setReceivedSnf] = useState('');
  const [milkTemperature, setMilkTemperature] = useState('4.0');
  const [rejectionReason, setRejectionReason] = useState('');

  // CIP Form States
  const [cipStatus, setCipStatus] = useState<'pass' | 'fail'>('pass');
  const [chemicalUsed, setChemicalUsed] = useState('Caustic Soda 1.5%');
  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker', { params: { status: 'waiting' } });
      setTankers(res.data);
      if (res.data.length > 0 && !selectedTankerId) {
        setSelectedTankerId(res.data[0].id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load tankers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTankers();
  }, []);

  const activeTanker = tankers.find((t) => t.id === selectedTankerId) || tankers[0] || null;
  const journey = activeTanker?.journey;
  const currentStageKey = journey?.currentStageKey;

  // Pre-fill fat and snf from dispatch when tanker changes
  useEffect(() => {
    if (activeTanker) {
      setReceivedFat(activeTanker.dispatch_fat_pct != null ? String(activeTanker.dispatch_fat_pct) : '4.50');
      setReceivedSnf(activeTanker.dispatch_snf_pct != null ? String(activeTanker.dispatch_snf_pct) : '8.40');
      setRejectionReason('');
      setQcDecision('accepted');
    }
  }, [activeTanker]);

  const handleRecordStage = async (stageKey: string, payload: Record<string, any>) => {
    if (!activeTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/${stageKey}`, payload);
      setSuccessMsg(`Stage ${stageKey.replace('_', ' ').toUpperCase()} recorded successfully!`);
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to submit stage');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>QC Laboratory Portal</h1>
          <p className="page-subtitle">Milk quality testing (fat, SNF, temp) and post-unload CIP sanitization verification</p>
        </div>
        <button onClick={fetchTankers} className="btn btn-secondary">
          🔄 Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTankers} />}
      {successMsg && <div className="success-banner"><span>{successMsg}</span></div>}

      {/* Tanker Selector Bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px' }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Select Active Tanker in Plant Queue:
        </label>
        <select
          value={activeTanker?.id || ''}
          onChange={(e) => setSelectedTankerId(e.target.value)}
          style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '14px' }}
        >
          {tankers.length === 0 ? (
            <option value="">No tankers currently waiting at plant</option>
          ) : (
            tankers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tanker_number} — {t.journey?.tripStatusLabel} (Waiting on: {t.journey?.waitingTeamLabel}) — {t.units?.name}
              </option>
            ))
          )}
        </select>
      </div>

      {activeTanker && journey ? (
        <div>
          {/* Compact Timeline at top of form */}
          <TankerTimeline journey={journey} variant="compact" />

          {/* Action Form depending on journey state */}
          <div className="card" style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#1e293b' }}>
              QC Task: {journey.waitingTeam === 'qc' ? journey.currentStageTitle : 'No QC action required right now'}
            </h3>

            {/* STAGE 3: QC COMPLETED */}
            {currentStageKey === 'qc_completed' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 3: Sample tanker milk and verify quality against dispatch specifications.
                </p>

                <div style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#166534', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="qc_decision"
                      value="accepted"
                      checked={qcDecision === 'accepted'}
                      onChange={() => setQcDecision('accepted')}
                    />
                    ✓ Accept Tanker Milk
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="qc_decision"
                      value="rejected"
                      checked={qcDecision === 'rejected'}
                      onChange={() => setQcDecision('rejected')}
                    />
                    ✕ Reject Tanker Milk
                  </label>
                </div>

                {qcDecision === 'accepted' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        Plant Fat % * (Dispatched: {formatFatSnf(activeTanker.dispatch_fat_pct)})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 4.50"
                        value={receivedFat}
                        onChange={(e) => setReceivedFat(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        Plant SNF % * (Dispatched: {formatFatSnf(activeTanker.dispatch_snf_pct)})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="e.g. 8.40"
                        value={receivedSnf}
                        onChange={(e) => setReceivedSnf(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                        Temperature (°C)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g. 4.0"
                        value={milkTemperature}
                        onChange={(e) => setMilkTemperature(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ padding: '8px 12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', marginBottom: '12px', fontSize: '12px', color: '#991b1b' }}>
                      ⚠️ Rejecting milk will SKIP the Unloading bay entirely. The tanker will be routed directly to Weighbridge Tare Weight, CIP and Gate Exit.
                    </div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#dc2626' }}>
                      Rejection Reason (Mandatory) *
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Specify reason: e.g. Sour smell, Acidity > 0.16%, Neutralizer detected, Temperature > 10°C..."
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                )}

                <button
                  onClick={() =>
                    handleRecordStage('qc_completed', {
                      qc_status: qcDecision,
                      received_fat_pct: qcDecision === 'accepted' ? Number(receivedFat) : null,
                      received_snf_pct: qcDecision === 'accepted' ? Number(receivedSnf) : null,
                      temperature: qcDecision === 'accepted' ? Number(milkTemperature) : null,
                      rejection_reason: qcDecision === 'rejected' ? rejectionReason.trim() : null,
                    })
                  }
                  disabled={submitting || (qcDecision === 'rejected' && !rejectionReason.trim()) || (qcDecision === 'accepted' && (!receivedFat || !receivedSnf))}
                  className={qcDecision === 'accepted' ? 'btn btn-primary' : 'btn btn-danger'}
                >
                  {submitting
                    ? 'Submitting…'
                    : qcDecision === 'accepted'
                    ? '✓ Approve Milk Quality &amp; Authorize Unloading'
                    : '✕ Confirm Rejection &amp; Skip Unloading'}
                </button>
              </div>
            )}

            {/* STAGE 6: CIP COMPLETED */}
            {currentStageKey === 'cip_completed' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 6: Tanker milk is unloaded and tare weight recorded. Perform Clean-In-Place (CIP) sanitization.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      CIP Sanitization Result *
                    </label>
                    <select
                      value={cipStatus}
                      onChange={(e) => setCipStatus(e.target.value as any)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="pass">PASS (Sanitization Clean)</option>
                      <option value="fail">FAIL (Re-wash required)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Chemical / Concentration Used
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Caustic Soda 1.5% + Nitric Acid 1%"
                      value={chemicalUsed}
                      onChange={(e) => setChemicalUsed(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => handleRecordStage('cip_completed', { cip_status: cipStatus, chemical_used: chemicalUsed })}
                  disabled={submitting}
                  className="btn btn-primary"
                >
                  {submitting ? 'Recording…' : '✓ Record CIP Complete &amp; Hand Over to Gate for Exit'}
                </button>
              </div>
            )}

            {journey.waitingTeam !== 'qc' && (
              <div style={{ padding: '20px', textAlign: 'center', color: '#64748b' }}>
                <p>This tanker is currently with the <strong>{journey.waitingTeamLabel.toUpperCase()}</strong> team.</p>
                <p style={{ fontSize: '12px' }}>Waiting for: {journey.currentStageTitle}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          No tankers currently in queue.
        </div>
      )}
    </div>
  );
}
