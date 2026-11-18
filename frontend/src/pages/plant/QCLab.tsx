import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatFatSnf, formatLitres } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';

export default function QCLab() {
  const { lang } = useTranslation();
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // QC Form States (Step 3)
  const [qcDecision, setQcDecision] = useState<'accepted' | 'rejected'>('accepted');
  const [receivedFat, setReceivedFat] = useState('');
  const [receivedSnf, setReceivedSnf] = useState('');
  const [milkTemperature, setMilkTemperature] = useState('4.0');
  const [organoleptic, setOrganoleptic] = useState('normal');
  const [mbrtMin, setMbrtMin] = useState('45');
  const [rejectionReason, setRejectionReason] = useState('');
  const [qcRemarks, setQcRemarks] = useState('');

  // CIP Form States (Step 6)
  const [cipStatus, setCipStatus] = useState<'pass' | 'fail'>('pass');
  const [chemicalUsed, setChemicalUsed] = useState('Caustic Soda 1.5%');
  const [phTest, setPhTest] = useState('Neutral (pH 7.2)');
  const [cipRemarks, setCipRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch all active plant tankers
      const res = await api.get<any[]>('/tanker');
      const list = res.data || [];
      setTankers(list);
      if (list.length > 0) {
        // Prioritize a tanker waiting on QC
        const qcWaiting = list.find((t: any) => t.journey?.waitingTeam === 'qc');
        if (!selectedTankerId || !list.some((t: any) => t.id === selectedTankerId)) {
          setSelectedTankerId(qcWaiting ? qcWaiting.id : list[0].id);
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

  // Pre-fill fat and snf from dispatch when active tanker changes
  useEffect(() => {
    if (activeTanker) {
      setReceivedFat(activeTanker.dispatch_fat_pct != null ? String(activeTanker.dispatch_fat_pct) : '4.50');
      setReceivedSnf(activeTanker.dispatch_snf_pct != null ? String(activeTanker.dispatch_snf_pct) : '8.40');
      setRejectionReason('');
      setQcDecision('accepted');
      setMilkTemperature('4.0');
      setQcRemarks('');
    }
  }, [activeTanker]);

  const handleRecordStage = async (stageKey: string, payload: Record<string, any>) => {
    if (!activeTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post(`/tanker/${activeTanker.id}/stages/${stageKey}`, payload);
      setSuccessMsg(
        lang === 'ta'
          ? `QC தகவல் வெற்றிகரமாக பதிவு செய்யப்பட்டது! அடுத்த பணிக்கு அனுப்பப்பட்டது.`
          : `Stage ${stageKey.replace('_', ' ').toUpperCase()} recorded successfully!`
      );
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to submit QC stage');
    } finally {
      setSubmitting(false);
    }
  };

  const quickRejectionReasons = [
    'Sour milk / Curdled',
    'Fat below minimum threshold (<3.5%)',
    'SNF below minimum threshold (<8.0%)',
    'High milk temperature (>10°C)',
    'Foreign odor or abnormal off-flavor',
    'Clot on boiling test positive',
    'Adulteration detected',
  ];

  // QC Dashboard Counters
  const waitingQcCount = tankers.filter((t) => t.journey?.waitingTeam === 'qc' && t.journey?.currentStageKey === 'qc_completed').length;
  const waitingCipCount = tankers.filter((t) => t.journey?.waitingTeam === 'qc' && t.journey?.currentStageKey === 'cip_completed').length;
  const passedCount = tankers.filter((t) => t.stage_data?.qc_completed?.qc_status === 'accepted').length;
  const rejectedCount = tankers.filter((t) => t.stage_data?.qc_completed?.qc_status === 'rejected' || t.journey?.tripStatus === 'qc_rejected').length;

  return (
    <div className="page" style={{ maxWidth: '1060px', margin: '0 auto', padding: '1.25rem' }}>
      {/* 1. Header */}
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
            Dashboard &gt; Quality Control &gt; <strong style={{ color: '#0f172a' }}>Milk Testing & CIP</strong>
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {lang === 'ta' ? 'தரக்கட்டுப்பாட்டு ஆய்வகம் (QC Laboratory)' : 'QC Laboratory & Sanitization'}
          </h1>
        </div>

        <button type="button" onClick={fetchTankers} className="btn-secondary" style={{ padding: '0.45rem 0.85rem' }}>
          🔄 Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTankers} />}
      {successMsg && (
        <div className="success-banner" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
        </div>
      )}

      {/* QC Dashboard KPI Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fed7aa', borderLeft: '4px solid #ea580c', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase' }}>Waiting for QC</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#9a3412', marginTop: '2px' }}>{waitingQcCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Sampling &amp; Quality verification</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bae6fd', borderLeft: '4px solid #0284c7', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>Awaiting CIP</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#075985', marginTop: '2px' }}>{waitingCipCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Post-unloading sanitization</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>QC Accepted Today</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#14532d', marginTop: '2px' }}>{passedCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Approved for silo discharge</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase' }}>QC Rejected Today</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#7f1d1d', marginTop: '2px' }}>{rejectedCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Rerouted to weighbridge tare</div>
        </div>
      </div>

      {/* 2. Tanker Queue Selector Bar */}
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
          Select Tanker in QC Queue:
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
            <option value="">No tankers currently waiting in plant queue</option>
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

          {/* Tanker Details Card */}
          <div
            className="card"
            style={{
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Tanker Number</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{activeTanker.tanker_number}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>DC No (BMC Invoice)</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0369a1' }}>
                #{activeTanker.dc_number || activeTanker.stage_data?.dc_number || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Source BMC Unit</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                {activeTanker.units?.name || 'BMC'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Dispatched Milk</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                {formatLitres(activeTanker.quantity_dispatched)} (Fat {formatFatSnf(activeTanker.dispatch_fat_pct, true)} / SNF {formatFatSnf(activeTanker.dispatch_snf_pct, true)})
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Gross Weight at Gate</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                {journey.calculated?.gross_weight_kg ? `${journey.calculated.gross_weight_kg.toLocaleString('en-IN')} kg` : '—'}
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
                    {c.fat_pct ? ` (Fat: ${c.fat_pct}%, SNF: ${c.snf_pct}%)` : ''}
                    {c.seal_number ? ` [Seal: ${c.seal_number}]` : ''}
                  </span>
                ))}
              </div>
            );
          })()}

          {/* QC Action Form depending on journey state */}
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
            {/* STEP 3: QC TESTING */}
            {currentStageKey === 'qc_completed' && (
              <div>
                <div
                  style={{
                    backgroundColor: '#d97706',
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
                  <span>STEP 3: RAW MILK QUALITY TESTING & VERIFICATION</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>QC Testing Laboratory</span>
                </div>

                <div style={{ padding: '1.25rem' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (qcDecision === 'accepted') {
                        void handleRecordStage('qc_completed', {
                          qc_status: 'accepted',
                          received_fat_pct: parseFloat(receivedFat),
                          received_snf_pct: parseFloat(receivedSnf),
                          temperature: parseFloat(milkTemperature),
                          organoleptic_status: organoleptic,
                          mbrt_minutes: parseInt(mbrtMin, 10) || 45,
                          remarks: qcRemarks.trim() || undefined,
                        });
                      } else {
                        void handleRecordStage('qc_completed', {
                          qc_status: 'rejected',
                          accepted: false,
                          rejection_reason: rejectionReason.trim(),
                          remarks: qcRemarks.trim() || undefined,
                        });
                      }
                    }}
                    className="entry-form"
                  >
                    {/* Decision Selector */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                        Quality Assessment Decision *
                      </label>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <button
                          type="button"
                          onClick={() => setQcDecision('accepted')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            borderRadius: 8,
                            border: `2px solid ${qcDecision === 'accepted' ? '#16a34a' : '#cbd5e1'}`,
                            background: qcDecision === 'accepted' ? '#f0fdf4' : '#ffffff',
                            color: qcDecision === 'accepted' ? '#15803d' : '#475569',
                            fontWeight: 700,
                            fontSize: '0.92rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span style={{ fontSize: '1.1rem' }}>✓</span>
                          <span>Accept Milk (Pass Quality)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setQcDecision('rejected')}
                          style={{
                            flex: 1,
                            padding: '0.75rem',
                            borderRadius: 8,
                            border: `2px solid ${qcDecision === 'rejected' ? '#dc2626' : '#cbd5e1'}`,
                            background: qcDecision === 'rejected' ? '#fef2f2' : '#ffffff',
                            color: qcDecision === 'rejected' ? '#b91c1c' : '#475569',
                            fontWeight: 700,
                            fontSize: '0.92rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                          <span>Reject Milk (Fail Quality)</span>
                        </button>
                      </div>
                    </div>

                    {qcDecision === 'accepted' ? (
                      <>
                        {/* Row: Fat & SNF */}
                        <div className="form-row">
                          <div className="form-group">
                            <label style={{ fontWeight: 600 }}>
                              Received Fat % <span style={{ color: '#dc2626' }}>*</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="e.g. 4.45"
                              value={receivedFat}
                              onChange={(e) => setReceivedFat(e.target.value)}
                              required
                              style={{ fontWeight: 700, fontSize: '1.05rem' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              BMC Dispatched Fat: {formatFatSnf(activeTanker.dispatch_fat_pct, true)}
                            </span>
                          </div>

                          <div className="form-group">
                            <label style={{ fontWeight: 600 }}>
                              Received SNF % <span style={{ color: '#dc2626' }}>*</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="e.g. 8.35"
                              value={receivedSnf}
                              onChange={(e) => setReceivedSnf(e.target.value)}
                              required
                              style={{ fontWeight: 700, fontSize: '1.05rem' }}
                            />
                            <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              BMC Dispatched SNF: {formatFatSnf(activeTanker.dispatch_snf_pct, true)}
                            </span>
                          </div>
                        </div>

                        {/* Row: Temperature & Tests */}
                        <div className="form-row">
                          <div className="form-group">
                            <label style={{ fontWeight: 600 }}>
                              Milk Temperature (°C) <span style={{ color: '#dc2626' }}>*</span>
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              placeholder="4.0"
                              value={milkTemperature}
                              onChange={(e) => setMilkTemperature(e.target.value)}
                              required
                              style={{ fontWeight: 600 }}
                            />
                          </div>

                          <div className="form-group">
                            <label style={{ fontWeight: 600 }}>Organoleptic &amp; Acidity Test</label>
                            <select value={organoleptic} onChange={(e) => setOrganoleptic(e.target.value)}>
                              <option value="normal">Normal (Clean taste, good smell, normal acidity)</option>
                              <option value="acceptable">Acceptable (Pass)</option>
                            </select>
                          </div>

                          <div className="form-group">
                            <label style={{ fontWeight: 600 }}>MBRT Test (Mins)</label>
                            <input
                              type="number"
                              value={mbrtMin}
                              onChange={(e) => setMbrtMin(e.target.value)}
                              placeholder="45"
                            />
                          </div>
                        </div>

                        {/* Remarks */}
                        <div className="form-group">
                          <label style={{ fontWeight: 600 }}>QC Lab Remarks</label>
                          <input
                            type="text"
                            placeholder="e.g. Organoleptic tests normal, approved for Silo reception"
                            value={qcRemarks}
                            onChange={(e) => setQcRemarks(e.target.value)}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                          <button
                            type="submit"
                            disabled={submitting || !receivedFat || !receivedSnf}
                            className="btn-primary"
                            style={{ minWidth: 220, padding: '0.65rem 1.25rem', fontWeight: 700, background: '#16a34a' }}
                          >
                            {submitting ? 'Submitting…' : '✓ Approve QC & Hand Over to Unloading Bay'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Rejection Form */}
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
                          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#991b1b', marginBottom: '0.4rem' }}>
                            Mandatory Rejection Reason <span style={{ color: '#dc2626' }}>*</span>
                          </label>
                          <textarea
                            value={rejectionReason}
                            onChange={(e) => setRejectionReason(e.target.value)}
                            placeholder="Specify detailed reason for rejecting this tanker milk..."
                            rows={3}
                            required
                            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #f87171' }}
                          />

                          {/* Quick Chips */}
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {quickRejectionReasons.map((reason) => (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => setRejectionReason(reason)}
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #fca5a5',
                                  color: '#b91c1c',
                                  borderRadius: 4,
                                  fontSize: '0.72rem',
                                  padding: '2px 8px',
                                  cursor: 'pointer',
                                }}
                              >
                                + {reason}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                          <button
                            type="submit"
                            disabled={submitting || !rejectionReason.trim()}
                            className="btn-primary"
                            style={{ minWidth: 220, padding: '0.65rem 1.25rem', fontWeight: 700, background: '#dc2626', borderColor: '#b91c1c' }}
                          >
                            {submitting ? 'Submitting…' : '⚠️ Confirm QC Rejection & Route to Tare'}
                          </button>
                        </div>
                      </>
                    )}
                  </form>
                </div>
              </div>
            )}

            {/* STEP 6: CIP SANITIZATION */}
            {currentStageKey === 'cip_completed' && (
              <div>
                <div
                  style={{
                    backgroundColor: '#0891b2',
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
                  <span>STEP 6: TANKER CIP (CLEAN-IN-PLACE) SANITIZATION VERIFICATION</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>QC &amp; Hygiene Inspection</span>
                </div>

                <div style={{ padding: '1.25rem' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRecordStage('cip_completed', {
                        cip_status: cipStatus,
                        chemical_used: chemicalUsed,
                        ph_test: phTest,
                        remarks: cipRemarks.trim() || undefined,
                      });
                    }}
                    className="entry-form"
                  >
                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>CIP Sanitization Status *</label>
                        <select value={cipStatus} onChange={(e) => setCipStatus(e.target.value as any)}>
                          <option value="pass">Pass (Cleaned, Sanitized &amp; Dry)</option>
                          <option value="fail">Fail (Needs Re-washing)</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>Sanitization Chemical / Cycle *</label>
                        <select value={chemicalUsed} onChange={(e) => setChemicalUsed(e.target.value)}>
                          <option value="Caustic Soda 1.5%">Caustic Soda 1.5% (Alkaline wash)</option>
                          <option value="Nitric Acid 1.0%">Nitric Acid 1.0% (Acid descaling wash)</option>
                          <option value="Hot Water Steam (85°C)">Hot Water Steam Rinse (85°C)</option>
                          <option value="Complete 5-Step CIP">Complete 5-Step Automated CIP</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>Rinse Water pH Test</label>
                        <input
                          type="text"
                          value={phTest}
                          onChange={(e) => setPhTest(e.target.value)}
                          placeholder="Neutral (pH 7.0 - 7.5)"
                        />
                      </div>

                      <div className="form-group">
                        <label style={{ fontWeight: 600 }}>Inspector Remarks</label>
                        <input
                          type="text"
                          value={cipRemarks}
                          onChange={(e) => setCipRemarks(e.target.value)}
                          placeholder="e.g. Tanker barrel visual inspection clear and odorless"
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                      <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary"
                        style={{ minWidth: 220, padding: '0.65rem 1.25rem', fontWeight: 700, background: '#0891b2' }}
                      >
                        {submitting ? 'Certifying…' : '✓ Certify CIP & Hand Over to Gate for Exit'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* If waiting for another team */}
            {journey.waitingTeam !== 'qc' && (
              <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.05rem', marginBottom: '0.35rem' }}>
                  Waiting for {journey.waitingTeamLabel?.toUpperCase()} Team
                </div>
                <div style={{ fontSize: '0.85rem' }}>
                  Current active stage: <strong>{journey.currentStageTitle}</strong>. QC actions will unlock once this tanker reaches QC.
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🧪</div>
          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>
            No tankers currently waiting for QC testing
          </div>
        </div>
      )}
      {/* 3. QC Lab Milk Testing Register */}
      <div
        className="card"
        style={{
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
              📋 Today's QC Laboratory Register
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
              All arriving plant tankers, composite quality samples, and CIP sanitization certifications
            </p>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            Total Tankers: <strong style={{ color: '#0284c7' }}>{tankers.length}</strong>
          </span>
        </div>

        {tankers.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
            No tankers recorded in the plant queue today
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                  <th style={{ padding: '8px 10px' }}>Tanker / Lorry</th>
                  <th style={{ padding: '8px 10px' }}>DC No</th>
                  <th style={{ padding: '8px 10px' }}>Source BMC</th>
                  <th style={{ padding: '8px 10px' }}>Dispatched Milk</th>
                  <th style={{ padding: '8px 10px' }}>Tested Fat %</th>
                  <th style={{ padding: '8px 10px' }}>Tested SNF %</th>
                  <th style={{ padding: '8px 10px' }}>QC Status</th>
                  <th style={{ padding: '8px 10px' }}>CIP Cleaned</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {tankers.map((t) => {
                  const qc = t.stage_data?.qc_completed;
                  const cip = t.stage_data?.cip_completed;
                  const isSel = t.id === activeTanker?.id;
                  const isRej = t.journey?.isQcRejected || qc?.qc_status === 'rejected';
                  const isAcc = qc?.qc_status === 'accepted';
                  const isCipDone = cip?.cip_status === 'pass';

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
                        #{t.dc_number || t.stage_data?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#334155' }}>
                        {t.units?.name || 'BMC'}
                      </td>
                      <td style={{ padding: '8px 10px', color: '#0f172a' }}>
                        {formatLitres(t.quantity_dispatched)}
                      </td>
                      <td style={{ padding: '8px 10px', color: qc?.received_fat_pct ? '#047857' : '#94a3b8' }}>
                        {qc?.received_fat_pct != null ? `${Number(qc.received_fat_pct).toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', color: qc?.received_snf_pct ? '#047857' : '#94a3b8' }}>
                        {qc?.received_snf_pct != null ? `${Number(qc.received_snf_pct).toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {isRej ? (
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                            REJECTED
                          </span>
                        ) : isAcc ? (
                          <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, fontWeight: 700, fontSize: '0.72rem' }}>
                            ACCEPTED
                          </span>
                        ) : (
                          <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 4, fontWeight: 600, fontSize: '0.72rem' }}>
                            {t.journey?.waitingTeam === 'qc' ? 'WAITING QC' : t.journey?.tripStatusLabel}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {isCipDone ? (
                          <span style={{ color: '#0891b2', fontWeight: 700 }}>✓ Done</span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTankerId(t.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className={isSel ? 'btn-primary' : 'btn-secondary'}
                          style={{ fontSize: '0.75rem', padding: '3px 8px' }}
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
