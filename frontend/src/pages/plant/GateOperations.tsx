import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';

export default function GateOperations() {
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // Form states for Gate stages
  const [sealVerified, setSealVerified] = useState(true);
  const [grossWeightKg, setGrossWeightKg] = useState('');
  const [weighbridgeSlip, setWeighbridgeSlip] = useState('');
  const [tareWeightKg, setTareWeightKg] = useState('');
  const [tareSlip, setTareSlip] = useState('');
  const [gatePassNo, setGatePassNo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      // Gate is interested in waiting tankers (or all today)
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

  // Determine which gate stage is currently active/needed for this tanker
  // Gate owns: vehicle_entered (1), gross_weight (2), tare_weight (5), vehicle_exit (7)
  const journey = activeTanker?.journey;
  const currentStageKey = journey?.currentStageKey;

  const handleRecordStage = async (stageKey: string, payload: Record<string, any>) => {
    if (!activeTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/${stageKey}`, payload);
      setSuccessMsg(`Stage ${stageKey.replace('_', ' ').toUpperCase()} recorded successfully!`);
      // Reset forms
      setGrossWeightKg('');
      setWeighbridgeSlip('');
      setTareWeightKg('');
      setTareSlip('');
      setGatePassNo('');
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
          <h1>Gate Operations Portal</h1>
          <p className="page-subtitle">Entry verification, weighbridge gross/tare recording, and exit gate passes</p>
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
          Select Active Tanker in Gate Queue:
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

          {/* Gate Action Form depending on journey state */}
          <div className="card" style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#1e293b' }}>
              Active Gate Task: {journey.waitingTeam === 'gate' ? journey.currentStageTitle : 'No gate action required right now'}
            </h3>

            {currentStageKey === 'vehicle_entered' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Tanker <strong>{activeTanker.tanker_number}</strong> has arrived at the dairy gate. Verify seal and driver identity.
                </p>
                <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                  <div>Driver: <strong>{activeTanker.driver_name || '—'}</strong></div>
                  <div>Seal Number on Challan: <strong>{activeTanker.seal_number || '—'}</strong></div>
                  <div>Dispatched Quantity: <strong>{formatLitres(activeTanker.quantity_dispatched)}</strong></div>
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
                    <input
                      type="checkbox"
                      checked={sealVerified}
                      onChange={(e) => setSealVerified(e.target.checked)}
                    />
                    Physical seal is intact and matches seal number ({activeTanker.seal_number})
                  </label>
                </div>

                <button
                  onClick={() => handleRecordStage('vehicle_entered', { seal_verified: sealVerified })}
                  disabled={submitting}
                  className="btn btn-primary"
                >
                  {submitting ? 'Recording…' : '✓ Confirm Vehicle Entered Plant'}
                </button>
              </div>
            )}

            {currentStageKey === 'gross_weight' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 2: Weigh tanker with milk loaded on the weighbridge.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Gross Weight (kg) *
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 24500"
                      value={grossWeightKg}
                      onChange={(e) => setGrossWeightKg(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Weighbridge Slip No.
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. WB-1002"
                      value={weighbridgeSlip}
                      onChange={(e) => setWeighbridgeSlip(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => handleRecordStage('gross_weight', { gross_weight_kg: Number(grossWeightKg), weighbridge_slip_no: weighbridgeSlip })}
                  disabled={submitting || !grossWeightKg}
                  className="btn btn-primary"
                >
                  {submitting ? 'Recording…' : '✓ Record Gross Weight &amp; Hand Over to QC'}
                </button>
              </div>
            )}

            {currentStageKey === 'tare_weight' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 5: Tanker milk is unloaded (or QC rejected). Record empty tanker tare weight on the weighbridge.
                </p>
                <div style={{ marginBottom: '12px', fontSize: '13px' }}>
                  <div>Gross Weight: <strong>{journey.calculated.gross_weight_kg} kg</strong></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Tare Weight (kg) *
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 15200"
                      value={tareWeightKg}
                      onChange={(e) => setTareWeightKg(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Tare Slip No.
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. WB-TARE-1002"
                      value={tareSlip}
                      onChange={(e) => setTareSlip(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>
                {grossWeightKg && tareWeightKg && Number(grossWeightKg) > Number(tareWeightKg) && (
                  <div style={{ marginBottom: '16px', fontSize: '13px', color: '#0369a1', fontWeight: 600 }}>
                    Calculated Net Weight: {Number(grossWeightKg) - Number(tareWeightKg)} kg
                  </div>
                )}
                <button
                  onClick={() => handleRecordStage('tare_weight', { tare_weight_kg: Number(tareWeightKg), tare_slip_no: tareSlip })}
                  disabled={submitting || !tareWeightKg}
                  className="btn btn-primary"
                >
                  {submitting ? 'Recording…' : '✓ Record Tare Weight &amp; Hand Over to QC for CIP'}
                </button>
              </div>
            )}

            {currentStageKey === 'vehicle_exit' && (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 7: Tanker CIP is completed. Generate exit pass and release tanker from dairy premises.
                </p>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                    Gate Pass Number
                  </label>
                  <input
                    type="text"
                    placeholder={`GP-${Date.now().toString().slice(-6)}`}
                    value={gatePassNo}
                    onChange={(e) => setGatePassNo(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                  />
                </div>
                <button
                  onClick={() => handleRecordStage('vehicle_exit', { gate_pass_number: gatePassNo || undefined })}
                  disabled={submitting}
                  className="btn btn-primary"
                >
                  {submitting ? 'Releasing…' : '✓ Authorize Vehicle Exit'}
                </button>
              </div>
            )}

            {journey.waitingTeam !== 'gate' && (
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
