import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';

export default function UnloadingBay() {
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // Unloading Form States
  const [siloOrBay, setSiloOrBay] = useState('Silo-1');
  const [unloadedLitres, setUnloadedLitres] = useState('');
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
  const isQcRejected = journey?.isQcRejected;

  // Pre-fill unloaded litres from dispatched or net litres
  useEffect(() => {
    if (activeTanker) {
      const suggested = activeTanker.journey?.calculated?.net_litres || activeTanker.quantity_dispatched;
      setUnloadedLitres(suggested != null ? String(suggested) : '');
    }
  }, [activeTanker]);

  const handleRecordUnloaded = async () => {
    if (!activeTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/unloaded`, {
        silo_or_bay: siloOrBay,
        unloaded_litres: Number(unloadedLitres),
      });
      setSuccessMsg('Milk unloaded into silo successfully! Tanker handed over to Gate for Tare Weight.');
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to record unloading');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Unloading Bay Operations</h1>
          <p className="page-subtitle">Silo reception, tanker milk discharge, and volume verification</p>
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
          Select Active Tanker in Queue:
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

          {/* Action Form */}
          <div className="card" style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: '#1e293b' }}>
              Unloading Task: {journey.waitingTeam === 'unloading' ? 'Unload Milk into Storage Silo' : 'Unloading Bay Standby'}
            </h3>

            {isQcRejected ? (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#fee2e2',
                  border: '1px solid #f87171',
                  borderRadius: '6px',
                  color: '#991b1b',
                }}
              >
                <h4 style={{ margin: '0 0 6px 0', fontSize: '14px' }}>🚫 UNLOADING BLOCKED (QC Rejected)</h4>
                <p style={{ margin: 0, fontSize: '13px' }}>
                  QC has rejected this tanker due to: <strong>{journey.qcRejectionReason || 'Quality failure'}</strong>.
                  <br />
                  Unloading is SKIPPED. The tanker must proceed directly to Gate for empty tare recording and exit.
                </p>
              </div>
            ) : currentStageKey === 'unloaded' ? (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '16px' }}>
                  Step 4: QC is completed and approved. Connect tanker hose to receiving silo and pump milk.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Receiving Silo / Raw Milk Bay *
                    </label>
                    <select
                      value={siloOrBay}
                      onChange={(e) => setSiloOrBay(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="Silo-1">Raw Milk Silo 1 (50,000 L)</option>
                      <option value="Silo-2">Raw Milk Silo 2 (50,000 L)</option>
                      <option value="Silo-3">Raw Milk Silo 3 (30,000 L)</option>
                      <option value="Bay-A">Direct Processing Bay A</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                      Unloaded Milk Litres * (Dispatched: {formatLitres(activeTanker.quantity_dispatched)})
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 9480"
                      value={unloadedLitres}
                      onChange={(e) => setUnloadedLitres(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                  </div>
                </div>

                {activeTanker.quantity_dispatched && unloadedLitres && (
                  <div style={{ marginBottom: '16px', fontSize: '13px', color: '#475569' }}>
                    Calculated Transit Difference:{' '}
                    <strong>
                      {(Number(activeTanker.quantity_dispatched) - Number(unloadedLitres)).toFixed(1)} L (
                      {(
                        ((Number(activeTanker.quantity_dispatched) - Number(unloadedLitres)) /
                          Number(activeTanker.quantity_dispatched)) *
                        100
                      ).toFixed(2)}
                      %)
                    </strong>
                  </div>
                )}

                <button
                  onClick={handleRecordUnloaded}
                  disabled={submitting || !unloadedLitres}
                  className="btn btn-primary"
                >
                  {submitting ? 'Recording…' : '✓ Confirm Milk Unloaded &amp; Hand Over to Gate for Tare Weight'}
                </button>
              </div>
            ) : (
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
