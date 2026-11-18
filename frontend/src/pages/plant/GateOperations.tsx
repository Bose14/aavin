import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres, getLocalTodayIso } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';

function computeTimeDifference(
  dispDate: string,
  dispTime: string,
  dispAmPm: 'AM' | 'PM',
  entryDate: string,
  entryTime: string,
  entryAmPm: 'AM' | 'PM'
): string {
  try {
    if (!dispTime || !entryTime) return '—';
    const parse12h = (tStr: string, ampm: 'AM' | 'PM') => {
      const parts = tStr.split(':');
      let h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return { h, m };
    };

    const dTime = parse12h(dispTime, dispAmPm);
    const eTime = parse12h(entryTime, entryAmPm);

    const dIso = dispDate || new Date().toISOString().slice(0, 10);
    const eIso = entryDate || new Date().toISOString().slice(0, 10);

    const dDate = new Date(`${dIso}T${String(dTime.h).padStart(2, '0')}:${String(dTime.m).padStart(2, '0')}:00`);
    const eDate = new Date(`${eIso}T${String(eTime.h).padStart(2, '0')}:${String(eTime.m).padStart(2, '0')}:00`);

    const diffMs = eDate.getTime() - dDate.getTime();
    if (diffMs <= 0 || isNaN(diffMs)) return '00.00';
    const totalMin = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return `${String(hours).padStart(2, '0')}.${String(mins).padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export default function GateOperations() {
  const { lang } = useTranslation();
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // Step 1: Vehicle Entry form states (matching Aavin IDMS portal)
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [entryDate, setEntryDate] = useState(() => getLocalTodayIso());
  const [entryTime, setEntryTime] = useState(() => {
    const d = new Date();
    let h = d.getHours();
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [entryAmPm, setEntryAmPm] = useState<'AM' | 'PM'>(() => {
    return new Date().getHours() >= 12 ? 'PM' : 'AM';
  });
  const [dispatchDate, setDispatchDate] = useState(() => getLocalTodayIso());
  const [dispatchTime, setDispatchTime] = useState('09:00');
  const [dispatchAmPm, setDispatchAmPm] = useState<'AM' | 'PM'>('AM');
  const [dcNumber, setDcNumber] = useState('');
  const [outletSealNo, setOutletSealNo] = useState('');
  const [sealVerified, setSealVerified] = useState(true);

  // Step 2: Gross Weight states
  const [grossWeightKg, setGrossWeightKg] = useState('');
  const [weighbridgeSlip, setWeighbridgeSlip] = useState('');

  // Step 5: Tare Weight states
  const [tareWeightKg, setTareWeightKg] = useState('');
  const [tareSlip, setTareSlip] = useState('');

  // Step 7: Vehicle Exit states
  const [gatePassNo, setGatePassNo] = useState('');

  // Submitting state
  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker', { params: { status: 'waiting' } });
      setTankers(res.data || []);
      if (res.data && res.data.length > 0) {
        if (!selectedTankerId || !res.data.some((t: any) => t.id === selectedTankerId)) {
          setSelectedTankerId(res.data[0].id);
        }
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

  // Pre-fill Vehicle Entry form fields when active tanker changes
  useEffect(() => {
    if (activeTanker) {
      setVehicleNo(activeTanker.tanker_number || '');

      const resolvedDriverName =
        activeTanker.driver_name ||
        activeTanker.stage_data?.driver_name ||
        activeTanker.stage_data?.vehicle_entered?.driver_name ||
        activeTanker.journey?.driver_name ||
        '';
      setDriverName(resolvedDriverName);

      const resolvedSealNo =
        activeTanker.seal_number ||
        activeTanker.stage_data?.seal_number ||
        activeTanker.stage_data?.outlet_seal_no ||
        activeTanker.stage_data?.vehicle_entered?.seal_number ||
        '';
      setOutletSealNo(resolvedSealNo);

      const existingDc =
        activeTanker.dc_number ||
        activeTanker.stage_data?.dc_number ||
        activeTanker.stage_data?.dc_no ||
        activeTanker.stage_data?.vehicle_entered?.dc_number ||
        activeTanker.journey?.dc_number ||
        '';
      setDcNumber(existingDc || (resolvedSealNo ? `DC-${resolvedSealNo.replace(/\D/g, '') || '101'}` : ''));
      setDispatchDate(activeTanker.date || getLocalTodayIso());

      // Parse dispatch time if available
      const rawDispatchTime = activeTanker.dispatch_time || activeTanker.stage_data?.dispatch_time || '';
      if (rawDispatchTime) {
        const isPm = rawDispatchTime.toUpperCase().includes('PM');
        const isAm = rawDispatchTime.toUpperCase().includes('AM');
        const cleanTime = rawDispatchTime.replace(/(AM|PM)/gi, '').trim();
        const parts = cleanTime.split(':');
        let h = parseInt(parts[0], 10) || 9;
        const m = parts[1] || '00';
        if (isPm) {
          setDispatchAmPm('PM');
          if (h > 12) h -= 12;
        } else if (isAm) {
          setDispatchAmPm('AM');
          if (h === 0) h = 12;
          if (h > 12) h -= 12;
        } else {
          if (h >= 12) {
            setDispatchAmPm('PM');
            if (h > 12) h -= 12;
          } else {
            setDispatchAmPm('AM');
            if (h === 0) h = 12;
          }
        }
        setDispatchTime(`${String(h).padStart(2, '0')}:${m}`);
      }

      setSealVerified(true);
      setGrossWeightKg(activeTanker.gross_weight_kg ? String(activeTanker.gross_weight_kg) : '');
      setTareWeightKg(activeTanker.tare_weight_kg ? String(activeTanker.tare_weight_kg) : '');
    }
  }, [
    activeTanker?.id,
    activeTanker?.tanker_number,
    activeTanker?.driver_name,
    activeTanker?.seal_number,
    activeTanker?.dc_number,
    activeTanker?.dispatch_time,
    activeTanker?.stage_data,
    activeTanker,
  ]);

  // Live auto-calculated time difference between dispatch and entry
  const calculatedTimeDiff = useMemo(() => {
    return computeTimeDifference(dispatchDate, dispatchTime, dispatchAmPm, entryDate, entryTime, entryAmPm);
  }, [dispatchDate, dispatchTime, dispatchAmPm, entryDate, entryTime, entryAmPm]);

  const handleRecordStage = async (stageKey: string, payload: Record<string, any>) => {
    if (!activeTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/${stageKey}`, payload);
      setSuccessMsg(
        lang === 'ta'
          ? `${stageKey.replace('_', ' ').toUpperCase()} வெற்றிகரமாக பதிவு செய்யப்பட்டது!`
          : `Stage ${stageKey.replace('_', ' ').toUpperCase()} recorded successfully!`
      );
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

  // Count vehicles entered today
  const vehiclesInTodayCount = tankers.filter((t) => t.journey?.tripStatus !== 'on_the_way').length;

  return (
    <div className="page" style={{ maxWidth: '1060px', margin: '0 auto', padding: '1.25rem' }}>
      {/* 1. TOP HEADER & BREADCRUMB (Matching Aavin IDMS Portal) */}
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: '0.75rem',
        }}
      >
        <div>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '0.2rem' }}>
            Dashboard &gt; Milk Receipt Entry &gt; <strong style={{ color: '#0f172a' }}>Tanker In</strong>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {lang === 'ta' ? 'நுழைவாயில் செயல்பாடுகள் (Gate Operations)' : 'Gate Operations & Vehicle Entry'}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              padding: '0 0.85rem',
              borderRadius: 6,
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#1e293b',
              height: '38px',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            No.Of Vehicles In Today : <span style={{ color: '#047857', fontSize: '1rem', marginLeft: '6px' }}>{vehiclesInTodayCount}</span>
          </div>

          <button
            type="button"
            onClick={fetchTankers}
            className="btn btn-secondary"
            style={{ height: '38px', padding: '0 0.85rem', width: 'auto' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTankers} />}
      {successMsg && (
        <div className="success-banner" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
        </div>
      )}

      {/* 2. TANKER QUEUE SELECTOR BAR */}
      <div
        className="card"
        style={{
          padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', minWidth: '180px' }}>
          Select Tanker in Queue:
        </label>
        <select
          value={activeTanker?.id || ''}
          onChange={(e) => setSelectedTankerId(e.target.value)}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            border: '1px solid #94a3b8',
            fontSize: '0.88rem',
            fontWeight: 600,
          }}
        >
          {tankers.length === 0 ? (
            <option value="">No tankers currently waiting at dairy plant</option>
          ) : (
            tankers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tanker_number} {t.dc_number ? `(DC #${t.dc_number})` : ''} — Stage: {t.journey?.tripStatusLabel} (Waiting on: {t.journey?.waitingTeamLabel?.toUpperCase()}) — BMC: {t.units?.name}
              </option>
            ))
          )}
        </select>
      </div>

      {activeTanker && journey ? (
        <div>
          {/* Compact Timeline at top of form */}
          <div style={{ marginBottom: '1.25rem' }}>
            <TankerTimeline journey={journey} variant="compact" />
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
                  marginBottom: '1rem',
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <strong style={{ color: '#166534' }}>🥛 Lorry Compartments ({comps.length}):</strong>
                {comps.map((c: any, i: number) => (
                  <span
                    key={i}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #86efac',
                      borderRadius: 4,
                      padding: '2px 6px',
                      color: '#15803d',
                      fontWeight: 600,
                    }}
                  >
                    {c.compartment_name || `Comp ${i + 1}`}: {c.quantity_litres} L
                    {c.seal_number ? ` (Seal: ${c.seal_number})` : ''}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* Gate Action Form depending on journey state */}
          <div
            className="card"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}
          >
            {/* STAGE 1: VEHICLE ENTRY DETAILS (Matching photo layout) */}
            {currentStageKey === 'vehicle_entered' && (
              <div>
                <div
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#ffffff',
                    padding: '0.65rem 1rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>VEHICLE ENTRY DETAILS</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 500, color: '#cbd5e1' }}>
                    Dairy Gate 1 Reception
                  </span>
                </div>

                <div style={{ padding: '1.25rem' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRecordStage('vehicle_entered', {
                        driver_name: driverName.trim(),
                        seal_number: outletSealNo.trim(),
                        dc_number: dcNumber.trim(),
                        entry_date: entryDate,
                        entry_time: `${entryTime} ${entryAmPm}`,
                        dispatch_date: dispatchDate,
                        dispatch_time: `${dispatchTime} ${dispatchAmPm}`,
                        time_difference: calculatedTimeDiff,
                        receiving_dairy: 'NAMAKKAL DAIRY',
                        seal_verified: sealVerified,
                      });
                    }}
                    className="entry-form"
                  >
                    {/* Row 1: Vehicle No & Driver Name */}
                    <div className="form-row">
                      <div className="form-group">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <label style={{ fontWeight: 600 }}>Vehicle No</label>
                          <button
                            type="button"
                            onClick={() => setVehicleNo('')}
                            style={{
                              background: '#fef08a',
                              border: '1px solid #eab308',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              fontWeight: 600,
                            }}
                          >
                            none
                          </button>
                        </div>
                        <input
                          value={vehicleNo}
                          onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                          placeholder="e.g. TN-28-AB-1234"
                          required
                          style={{ fontWeight: 700 }}
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>
                          Driver Name <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <input
                          value={driverName}
                          onChange={(e) => setDriverName(e.target.value)}
                          placeholder="e.g. S. Raman"
                          required
                        />
                      </div>
                    </div>

                    {/* Row 2: Entry Date & Entry Time (12h with AM/PM) */}
                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>Entry Date</label>
                        <input
                          type="date"
                          value={entryDate}
                          onChange={(e) => setEntryDate(e.target.value)}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>
                          Entry Time(HHMM)(12 hour format) <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            type="text"
                            value={entryTime}
                            onChange={(e) => setEntryTime(e.target.value)}
                            placeholder="12:33"
                            required
                            style={{ flex: 1, fontFamily: 'monospace', fontWeight: 600 }}
                          />
                          <select
                            value={entryAmPm}
                            onChange={(e) => setEntryAmPm(e.target.value as 'AM' | 'PM')}
                            style={{ width: '80px', fontWeight: 600 }}
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Row 3: Dispatch Date & Dispatch Time (12h with AM/PM) */}
                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>Dispatch Date</label>
                        <input
                          type="date"
                          value={dispatchDate}
                          onChange={(e) => setDispatchDate(e.target.value)}
                          required
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>
                          Dispatch Time(HHMM)(12 hour format) <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <input
                            type="text"
                            value={dispatchTime}
                            onChange={(e) => setDispatchTime(e.target.value)}
                            placeholder="09:15"
                            required
                            style={{ flex: 1, fontFamily: 'monospace', fontWeight: 600 }}
                          />
                          <select
                            value={dispatchAmPm}
                            onChange={(e) => setDispatchAmPm(e.target.value as 'AM' | 'PM')}
                            style={{ width: '80px', fontWeight: 600 }}
                          >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Row 4: Calculated Time Difference */}
                    <div className="form-group">
                      <label style={{ fontWeight: 600, color: '#334155' }}>
                        Time Difference Between Dispatch And Entry(HH.MM)
                      </label>
                      <input
                        type="text"
                        value={calculatedTimeDiff}
                        readOnly
                        style={{
                          backgroundColor: '#f1f5f9',
                          fontWeight: 700,
                          color: '#0f172a',
                          fontFamily: 'monospace',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </div>

                    {/* Row 5: DC No & Outlet Seal No */}
                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>
                          DC No <span style={{ color: '#dc2626' }}>*</span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 400, marginLeft: '4px' }}>
                            (BMC Invoice / Challan No)
                          </span>
                        </label>
                        <input
                          type="text"
                          value={dcNumber}
                          onChange={(e) => setDcNumber(e.target.value.toUpperCase())}
                          placeholder="e.g. DC-2026-9041"
                          required
                          style={{ fontWeight: 700, letterSpacing: '0.04em' }}
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>
                          Outlet Seal No <span style={{ color: '#dc2626' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={outletSealNo}
                          onChange={(e) => setOutletSealNo(e.target.value.toUpperCase())}
                          placeholder="e.g. SL-9941"
                          required
                          style={{ fontWeight: 700 }}
                        />
                      </div>
                    </div>

                    {/* Row 6: Receiving Dairy */}
                    <div className="form-group">
                      <label style={{ fontWeight: 600, color: '#475569' }}>Receiving Dairy</label>
                      <div style={{ fontWeight: 700, color: '#1e293b', padding: '0.35rem 0' }}>
                        NAMAKKAL DAIRY
                      </div>
                    </div>

                    {/* Physical Seal Intact Checkbox */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', margin: '0.75rem 0 1.25rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={sealVerified}
                        onChange={(e) => setSealVerified(e.target.checked)}
                      />
                      <span>Physical seal is intact and matches outlet seal number ({outletSealNo || activeTanker.seal_number || 'SL-xxx'})</span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button
                        type="submit"
                        disabled={submitting || !dcNumber.trim()}
                        className="btn-primary"
                        style={{ minWidth: 220, padding: '0.6rem 1.25rem', fontWeight: 700 }}
                      >
                        {submitting ? 'Submitting…' : '✓ Confirm Vehicle Entry & Proceed to Weighbridge'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* STAGE 2: GROSS WEIGHT (WEIGHBRIDGE) */}
            {currentStageKey === 'gross_weight' && (
              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚖️</span>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    Gross Weighbridge Measurement — {activeTanker.tanker_number}
                  </h3>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                  Tanker has entered dairy gate. Record loaded gross weight on the certified weighbridge.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
                  <div>DC No: <strong>#{activeTanker.dc_number || '—'}</strong></div>
                  <div>Driver: <strong>{activeTanker.driver_name || '—'}</strong></div>
                  <div>Dispatched Qty: <strong>{formatLitres(activeTanker.quantity_dispatched)}</strong></div>
                  <div>BMC: <strong>{activeTanker.units?.name || '—'}</strong></div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRecordStage('gross_weight', {
                      gross_weight_kg: Number(grossWeightKg),
                      weighbridge_slip_no: weighbridgeSlip.trim() || undefined,
                    });
                  }}
                  className="entry-form"
                >
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontWeight: 600 }}>
                        Gross Weight (kg) <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 24500"
                        value={grossWeightKg}
                        onChange={(e) => setGrossWeightKg(e.target.value)}
                        required
                        style={{ fontWeight: 700, fontSize: '1.1rem' }}
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ fontWeight: 600 }}>Weighbridge Gross Slip No.</label>
                      <input
                        type="text"
                        placeholder="e.g. WB-GROSS-1002"
                        value={weighbridgeSlip}
                        onChange={(e) => setWeighbridgeSlip(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      type="submit"
                      disabled={submitting || !grossWeightKg}
                      className="btn-primary"
                      style={{ minWidth: 200, padding: '0.6rem 1.25rem', fontWeight: 700 }}
                    >
                      {submitting ? 'Recording…' : '✓ Record Gross Weight & Hand Over to QC'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STAGE 5: TARE WEIGHT (WEIGHBRIDGE) */}
            {currentStageKey === 'tare_weight' && (
              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚖️</span>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    Tare Weighbridge Measurement — {activeTanker.tanker_number}
                  </h3>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                  Tanker milk has been discharged (or rejected by QC). Record empty tare weight.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: '#f8fafc', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
                  <div>Gross Weight: <strong>{journey.calculated?.gross_weight_kg ? `${journey.calculated.gross_weight_kg} kg` : '—'}</strong></div>
                  <div>Dispatched Milk: <strong>{formatLitres(activeTanker.quantity_dispatched)}</strong></div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRecordStage('tare_weight', {
                      tare_weight_kg: Number(tareWeightKg),
                      tare_slip_no: tareSlip.trim() || undefined,
                    });
                  }}
                  className="entry-form"
                >
                  <div className="form-row">
                    <div className="form-group">
                      <label style={{ fontWeight: 600 }}>
                        Tare Weight (kg) <span style={{ color: '#dc2626' }}>*</span>
                      </label>
                      <input
                        type="number"
                        placeholder="e.g. 15200"
                        value={tareWeightKg}
                        onChange={(e) => setTareWeightKg(e.target.value)}
                        required
                        style={{ fontWeight: 700, fontSize: '1.1rem' }}
                      />
                    </div>

                    <div className="form-group">
                      <label style={{ fontWeight: 600 }}>Tare Slip No.</label>
                      <input
                        type="text"
                        placeholder="e.g. WB-TARE-1002"
                        value={tareSlip}
                        onChange={(e) => setTareSlip(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Net Weight Preview */}
                  {grossWeightKg && tareWeightKg && Number(grossWeightKg) > Number(tareWeightKg) && (
                    <div
                      style={{
                        padding: '0.75rem',
                        background: '#eff6ff',
                        borderRadius: 6,
                        border: '1px solid #bfdbfe',
                        marginBottom: '1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        Calculated Net Milk Weight: <strong>{Number(grossWeightKg) - Number(tareWeightKg)} kg</strong>
                      </div>
                      <div>
                        Calculated Net Volume: <strong>{((Number(grossWeightKg) - Number(tareWeightKg)) / 1.030).toFixed(1)} L</strong>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      type="submit"
                      disabled={submitting || !tareWeightKg}
                      className="btn-primary"
                      style={{ minWidth: 200, padding: '0.6rem 1.25rem', fontWeight: 700 }}
                    >
                      {submitting ? 'Recording…' : '✓ Record Tare Weight & Hand Over to QC for CIP'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STAGE 7: VEHICLE EXIT */}
            {currentStageKey === 'vehicle_exit' && (
              <div style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>🚪</span>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    Vehicle Exit Authorization & Gate Pass — {activeTanker.tanker_number}
                  </h3>
                </div>
                <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
                  Post-unloading CIP sanitization is completed. Issue exit gate pass and authorize vehicle exit.
                </p>

                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0.75rem', borderRadius: 8, marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 700, color: '#065f46', marginBottom: '0.25rem' }}>
                    ✅ Tanker Processing Complete
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#047857' }}>
                    CIP Certified · Net Litres: {formatLitres(journey.calculated?.net_litres || journey.calculated?.received_litres || activeTanker.quantity_dispatched)} · Turnaround: {journey.calculated?.total_turnaround_min ?? '—'} mins
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRecordStage('vehicle_exit', {
                      gate_pass_number: gatePassNo.trim() || `GP-${Date.now().toString().slice(-6)}`,
                    });
                  }}
                  className="entry-form"
                >
                  <div className="form-group">
                    <label style={{ fontWeight: 600 }}>Gate Pass Number</label>
                    <input
                      type="text"
                      placeholder={`GP-${Date.now().toString().slice(-6)}`}
                      value={gatePassNo}
                      onChange={(e) => setGatePassNo(e.target.value)}
                      style={{ fontWeight: 700, fontSize: '1rem' }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-primary"
                      style={{ minWidth: 200, padding: '0.6rem 1.25rem', fontWeight: 700, background: '#16a34a' }}
                    >
                      {submitting ? 'Releasing…' : '✓ Authorize Vehicle Exit'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* If waiting for another team */}
            {journey.waitingTeam !== 'gate' && (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.05rem', marginBottom: '0.35rem' }}>
                  Waiting for {journey.waitingTeamLabel?.toUpperCase()} Team
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  Current active stage: <strong>{journey.currentStageTitle}</strong>. Gate tasks will unlock once this stage completes.
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚚</div>
          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>
            No tankers currently waiting in queue
          </div>
          <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
            Tankers dispatched from BMC collection units will appear here automatically for gate reception.
          </p>
        </div>
      )}

      {/* Today's Gate Vehicle Register Table */}
      <div
        className="card"
        style={{
          marginTop: '20px',
          padding: '16px 20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
              📋 Today's Gate Vehicle Register ({tankers.length} Vehicles)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Namakkal Dairy gate entry, gross weighbridge, tare weighbridge, and exit pass issuance log
            </p>
          </div>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            Click <strong>Select</strong> to open vehicle at gate
          </span>
        </div>

        {tankers.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            No vehicles registered at gate today yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '8px 10px' }}>Vehicle / Tanker</th>
                  <th style={{ padding: '8px 10px' }}>DC No</th>
                  <th style={{ padding: '8px 10px' }}>Source BMC</th>
                  <th style={{ padding: '8px 10px' }}>Driver</th>
                  <th style={{ padding: '8px 10px' }}>Dispatched Qty</th>
                  <th style={{ padding: '8px 10px' }}>Gross Wt (kg)</th>
                  <th style={{ padding: '8px 10px' }}>Tare Wt (kg)</th>
                  <th style={{ padding: '8px 10px' }}>Stage Status</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {tankers.map((t) => {
                  const isSel = t.id === activeTanker?.id;
                  const dc = t.dc_number || t.stage_data?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '—';
                  const gross = t.journey?.calculated?.gross_weight_kg || t.gross_weight_kg;
                  const tare = t.journey?.calculated?.tare_weight_kg || t.tare_weight_kg;
                  const isGateTurn = t.journey?.waitingTeam === 'gate';

                  return (
                    <tr
                      key={t.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isSel ? '#f0fdf4' : 'transparent',
                        fontWeight: isSel ? 600 : 400,
                      }}
                    >
                      <td style={{ padding: '8px 10px', color: '#0f172a', fontWeight: 700 }}>
                        {t.tanker_number}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#0284c7', fontWeight: 600 }}>
                        #{dc}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#334155' }}>
                        {t.units?.name || 'BMC'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#475569' }}>
                        {t.driver_name || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#0f172a' }}>
                        {formatLitres(t.quantity_dispatched)}
                      </td>
                      <td style={{ padding: '8px 10px', color: gross ? '#0f172a' : '#94a3b8' }}>
                        {gross ? `${Number(gross).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: tare ? '#0f172a' : '#94a3b8' }}>
                        {tare ? `${Number(tare).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            background: isGateTurn ? '#eff6ff' : t.journey?.stageColor?.badgeBg || '#f1f5f9',
                            color: isGateTurn ? '#1d4ed8' : t.journey?.stageColor?.badgeText || '#475569',
                            border: `1px solid ${isGateTurn ? '#bfdbfe' : t.journey?.stageColor?.border || '#cbd5e1'}`,
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 600,
                            fontSize: '0.72rem',
                          }}
                        >
                          {isGateTurn ? `👉 ${t.journey?.currentStageTitle || 'Gate Turn'}` : t.journey?.tripStatusLabel || 'In Plant'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTankerId(t.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={isSel ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                          style={{ fontSize: '0.75rem', height: '28px', padding: '0 10px', width: 'auto' }}
                        >
                          {isSel ? 'Selected' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
