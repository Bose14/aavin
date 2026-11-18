import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';

export default function UnloadingBay() {
  const [tankers, setTankers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // Unloading Form States
  const [siloOrBay, setSiloOrBay] = useState('Silo-1');
  const [unloadedLitres, setUnloadedLitres] = useState('');
  const [dipstickStart, setDipstickStart] = useState('');
  const [dipstickEnd, setDipstickEnd] = useState('');
  const [flowmeterReading, setFlowmeterReading] = useState('');
  const [hoseChecked, setHoseChecked] = useState(true);
  const [groundingChecked, setGroundingChecked] = useState(true);
  const [drainageChecked, setDrainageChecked] = useState(true);
  const [operatorRemarks, setOperatorRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker', { params: { status: 'waiting' } });
      setTankers(res.data);
      if (res.data.length > 0) {
        // If current selected tanker is no longer in list or not set, select first
        if (!selectedTankerId || !res.data.some((t) => t.id === selectedTankerId)) {
          setSelectedTankerId(res.data[0].id);
        }
      } else {
        setSelectedTankerId('');
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
  const isQcRejected = journey?.isQcRejected || activeTanker?.qc_status === 'rejected';

  // Pre-fill unloaded litres from dispatched or net litres
  useEffect(() => {
    if (activeTanker) {
      const suggested = activeTanker.journey?.calculated?.net_litres || activeTanker.quantity_dispatched;
      setUnloadedLitres(suggested != null ? String(suggested) : '');
      setDipstickStart('');
      setDipstickEnd('');
      setFlowmeterReading('');
      setOperatorRemarks('');
    }
  }, [activeTanker?.id]);

  const handleRecordUnloaded = async () => {
    if (!activeTanker) return;
    const ltrNum = Number(unloadedLitres);
    if (!ltrNum || ltrNum <= 0) {
      setError('Please enter a valid unloaded milk volume in litres');
      return;
    }
    if (!hoseChecked || !groundingChecked || !drainageChecked) {
      setError('Please confirm all safety & sanitary checks (hose connection, grounding, and drainage) before submitting');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/unloaded`, {
        silo_or_bay: siloOrBay,
        unloaded_litres: ltrNum,
        dipstick_start_cm: dipstickStart ? Number(dipstickStart) : null,
        dipstick_end_cm: dipstickEnd ? Number(dipstickEnd) : null,
        flowmeter_reading: flowmeterReading ? Number(flowmeterReading) : null,
        remarks: operatorRemarks.trim() || undefined,
      });
      setSuccessMsg(
        `✓ ${ltrNum.toLocaleString('en-IN')} L unloaded into ${siloOrBay} successfully! Tanker handed over to Gate for Tare Weight.`
      );
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to record unloading');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculations for transit variance
  const dispatchedQty = Number(activeTanker?.quantity_dispatched || 0);
  const currentUnloaded = Number(unloadedLitres || 0);
  const diffLitres = dispatchedQty && currentUnloaded ? +(dispatchedQty - currentUnloaded).toFixed(1) : 0;
  const diffPct = dispatchedQty && currentUnloaded ? +((diffLitres / dispatchedQty) * 100).toFixed(2) : 0;

  // Extract DC No and QC values
  const dcNo = activeTanker?.dc_number || activeTanker?.stage_data?.dc_number || activeTanker?.stage_data?.vehicle_entered?.dc_number || '—';
  const qcData = activeTanker?.stage_data?.qc_completed || {};
  const testedFat = qcData.received_fat_pct ?? activeTanker?.received_fat_pct ?? '—';
  const testedSnf = qcData.received_snf_pct ?? activeTanker?.received_snf_pct ?? '—';
  const grossKg = activeTanker?.journey?.calculated?.gross_weight_kg || activeTanker?.gross_weight_kg;

  return (
    <div className="page" style={{ maxWidth: '1080px', margin: '0 auto', padding: '16px' }}>
      {/* Breadcrumb matching Aavin IDMS header */}
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>Dashboard</span>
        <span>&gt;</span>
        <span>Milk Reception</span>
        <span>&gt;</span>
        <strong style={{ color: '#0f172a' }}>Unloading Bay Operations</strong>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
            Unloading Bay Operations
          </h1>
          <p className="page-subtitle" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Silo allocation, tanker milk discharge, volume measurement, and transfer to gate tare weighbridge
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#475569', fontWeight: 600 }}>
            Tankers in Queue: <strong style={{ color: '#0284c7' }}>{tankers.length}</strong>
          </span>
          <button onClick={fetchTankers} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTankers} />}
      {successMsg && (
        <div
          className="success-banner"
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontWeight: 600,
          }}
        >
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tanker Selector Bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <label style={{ fontSize: '13px', fontWeight: 700, display: 'block', marginBottom: '6px', color: '#1e293b' }}>
          Select Active Tanker in Plant:
        </label>
        <select
          value={activeTanker?.id || ''}
          onChange={(e) => setSelectedTankerId(e.target.value)}
          style={{
            width: '100%',
            padding: '9px 12px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            fontSize: '14px',
            backgroundColor: '#ffffff',
            fontWeight: 600,
          }}
        >
          {tankers.length === 0 ? (
            <option value="">No tankers currently waiting at plant</option>
          ) : (
            tankers.map((t) => {
              const tDc = t.dc_number || t.stage_data?.dc_number || '—';
              const isTurn = t.journey?.waitingTeam === 'unloading';
              return (
                <option key={t.id} value={t.id}>
                  {isTurn ? '👉 [READY FOR UNLOAD] ' : ''}
                  {t.tanker_number} · DC #{tDc} · BMC: {t.units?.name} · {formatLitres(t.quantity_dispatched)} · (Waiting: {t.journey?.waitingTeamLabel})
                </option>
              );
            })
          )}
        </select>
      </div>

      {activeTanker && journey ? (
        <div>
          {/* Connected 7-Stage Horizontal Pipeline Header */}
          <TankerTimeline journey={journey} variant="compact" />

          {/* Milk & Tanker Profile Summary Card */}
          <div
            className="card"
            style={{
              padding: '16px 20px',
              marginBottom: '16px',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '10px', marginBottom: '12px' }}>
              <div>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
                  Active Tanker Dossier
                </span>
                <h3 style={{ margin: '2px 0 0 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  {activeTanker.tanker_number}
                </h3>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 700,
                    backgroundColor: journey.stageColor.badgeBg,
                    color: journey.stageColor.badgeText,
                    border: `1px solid ${journey.stageColor.border}`,
                  }}
                >
                  {journey.tripStatusLabel}
                </span>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                  Waiting on: <strong style={{ color: '#0284c7' }}>{journey.waitingTeamLabel.toUpperCase()}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', fontSize: '13px' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>DC NO (BMC CHALLAN)</div>
                <div style={{ fontWeight: 800, color: '#0284c7', fontSize: '14px' }}>DC #{dcNo}</div>
              </div>

              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>SOURCE BMC UNIT</div>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>{activeTanker.units?.name || 'BMC'}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>{activeTanker.units?.unit_code || '—'}</div>
              </div>

              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>DRIVER &amp; SEAL</div>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>{activeTanker.driver_name || 'Driver'}</div>
                <div style={{ fontSize: '11px', color: '#16a34a' }}>Seal: {activeTanker.seal_number || 'OK'} ✓</div>
              </div>

              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>DISPATCHED VOLUME</div>
                <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '14px' }}>{formatLitres(activeTanker.quantity_dispatched)}</div>
              </div>

              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>GROSS WEIGHT (WEIGHBRIDGE)</div>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>
                  {grossKg ? `${Number(grossKg).toLocaleString('en-IN')} kg` : 'Pending Gross'}
                </div>
              </div>

              <div>
                <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600 }}>QC TESTED QUALITY</div>
                <div style={{ fontWeight: 700, color: isQcRejected ? '#dc2626' : '#16a34a' }}>
                  {isQcRejected ? 'REJECTED' : `Fat: ${testedFat}% · SNF: ${testedSnf}%`}
                </div>
              </div>
            </div>

            {/* Lorry Compartment Summary if present */}
            {(() => {
              const comps =
                activeTanker.compartments ||
                journey.compartments ||
                activeTanker.stage_data?.compartments ||
                [];
              if (!comps || comps.length === 0) return null;
              return (
                <div
                  style={{
                    marginTop: '12px',
                    paddingTop: '10px',
                    borderTop: '1px dashed #e2e8f0',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong style={{ color: '#0369a1' }}>🥛 Discharged Compartments ({comps.length}):</strong>
                  {comps.map((c: any, i: number) => (
                    <span
                      key={i}
                      style={{
                        backgroundColor: '#f0f9ff',
                        border: '1px solid #bae6fd',
                        borderRadius: 4,
                        padding: '2px 8px',
                        color: '#0284c7',
                        fontWeight: 600,
                      }}
                    >
                      {c.compartment_name || `Comp ${i + 1}`}: {c.quantity_litres} L
                      {c.dipstick_cm ? ` (Dip: ${c.dipstick_cm}cm)` : ''}
                      {c.seal_number ? ` [Seal: ${c.seal_number}]` : ''}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Action / Guard Form */}
          <div className="card" style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
            <h3 style={{ margin: '0 0 14px 0', fontSize: '16px', fontWeight: 700, color: '#1e293b' }}>
              Unloading Operations: {journey.waitingTeam === 'unloading' ? 'Unload Milk into Storage Silo' : 'Unloading Bay Standby'}
            </h3>

            {isQcRejected ? (
              <div
                style={{
                  padding: '20px',
                  backgroundColor: '#fee2e2',
                  border: '2px solid #ef4444',
                  borderRadius: '8px',
                  color: '#991b1b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '22px' }}>🚫</span>
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>UNLOADING STRICTLY BLOCKED (QC REJECTED)</h4>
                </div>
                <p style={{ margin: '0 0 10px 0', fontSize: '14px' }}>
                  This tanker was <strong>REJECTED</strong> during Quality Control testing due to:{' '}
                  <strong style={{ textDecoration: 'underline' }}>{journey.qcRejectionReason || 'Quality failure'}</strong>.
                </p>
                <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d' }}>
                  ⚠️ Discharging rejected milk into Aavin storage silos or processing bays is strictly forbidden.
                  The tanker must proceed directly to the <strong>Gate Weighbridge</strong> for empty tare weight recording and exit gate pass issuance.
                </p>
              </div>
            ) : currentStageKey === 'unloaded' ? (
              <div>
                <p style={{ fontSize: '13px', color: '#475569', marginBottom: '18px' }}>
                  <strong>Step 4: Silo Reception &amp; Milk Discharge</strong> — QC is completed and passed. Connect flexible milk hose to the receiving silo, verify earth grounding, and discharge the raw milk.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '18px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                      Receiving Silo / Raw Milk Bay *
                    </label>
                    <select
                      value={siloOrBay}
                      onChange={(e) => setSiloOrBay(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '14px',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <option value="Silo-1">Raw Milk Silo 1 (50,000 L capacity)</option>
                      <option value="Silo-2">Raw Milk Silo 2 (50,000 L capacity)</option>
                      <option value="Silo-3">Raw Milk Silo 3 (30,000 L capacity)</option>
                      <option value="Silo-4">Raw Milk Silo 4 (40,000 L capacity)</option>
                      <option value="Bay-A">Direct Processing Bay A (Pasteurizer)</option>
                      <option value="Bay-B">Direct Processing Bay B (Standardization)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '6px', color: '#334155' }}>
                      Unloaded Milk Volume (Litres) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 9480"
                      value={unloadedLitres}
                      onChange={(e) => setUnloadedLitres(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '14px',
                        fontWeight: 700,
                      }}
                    />
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      Dispatched from BMC: {formatLitres(activeTanker.quantity_dispatched)}
                    </span>
                  </div>
                </div>

                {/* Dipstick and Flowmeter Measurements */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '18px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>
                      Dipstick Start Level (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 142.5"
                      value={dipstickStart}
                      onChange={(e) => setDipstickStart(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>
                      Dipstick End Level (cm)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 0.0"
                      value={dipstickEnd}
                      onChange={(e) => setDipstickEnd(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>
                      Flowmeter Totalizer Reading (L)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 9482.0"
                      value={flowmeterReading}
                      onChange={(e) => setFlowmeterReading(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                  </div>
                </div>

                {/* Sanitary & Safety Checkboxes */}
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    padding: '14px 16px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '18px',
                  }}
                >
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
                    Sanitary &amp; Safety Verification Checklist:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#334155' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={hoseChecked}
                        onChange={(e) => setHoseChecked(e.target.checked)}
                      />
                      <span>Sanitary food-grade flexible hose inspected, sanitized, and clamped securely</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={groundingChecked}
                        onChange={(e) => setGroundingChecked(e.target.checked)}
                      />
                      <span>Tanker chassis electrostatic grounding earth clamp attached</span>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={drainageChecked}
                        onChange={(e) => setDrainageChecked(e.target.checked)}
                      />
                      <span>Tanker milk barrel completely drained and inspected empty</span>
                    </label>
                  </div>
                </div>

                {/* Operator Remarks */}
                <div style={{ marginBottom: '18px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px', color: '#475569' }}>
                    Unloading Operator Remarks / Silo Observations (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Flow normal, pump speed 25 m3/hr, no foam observed"
                    value={operatorRemarks}
                    onChange={(e) => setOperatorRemarks(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                {/* Calculated Transit Variance Preview */}
                {dispatchedQty > 0 && currentUnloaded > 0 && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: '6px',
                      backgroundColor: Math.abs(diffPct) > 1.5 ? '#fef2f2' : Math.abs(diffPct) > 0.5 ? '#fffbeb' : '#f0fdf4',
                      border: `1px solid ${Math.abs(diffPct) > 1.5 ? '#f87171' : Math.abs(diffPct) > 0.5 ? '#fde68a' : '#86efac'}`,
                      color: Math.abs(diffPct) > 1.5 ? '#991b1b' : Math.abs(diffPct) > 0.5 ? '#92400e' : '#166534',
                      marginBottom: '18px',
                      fontSize: '13px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <strong>Transit Volume Variance: </strong>
                      {diffLitres >= 0 ? `${diffLitres} L loss` : `${Math.abs(diffLitres)} L gain`} ({diffPct}%)
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600 }}>
                      Tolerance limit: ±0.50%
                    </div>
                  </div>
                )}

                <button
                  onClick={handleRecordUnloaded}
                  disabled={submitting || !unloadedLitres}
                  className="btn btn-primary"
                  style={{
                    padding: '10px 20px',
                    fontSize: '14px',
                    fontWeight: 700,
                    backgroundColor: '#16a34a',
                    borderColor: '#16a34a',
                    cursor: submitting || !unloadedLitres ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? 'Recording…' : '✓ Confirm Milk Unloaded & Advance to Tare Weight'}
                </button>
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '14px' }}>
                  This tanker is currently with the <strong style={{ color: '#0f172a' }}>{journey.waitingTeamLabel.toUpperCase()}</strong> team.
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                  Waiting for stage: <strong>{journey.currentStageTitle}</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          {loading ? 'Loading active tankers…' : 'No tankers currently waiting in plant queue.'}
        </div>
      )}
    </div>
  );
}
