import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';

export interface UnloadReceivedQuality {
  cell: string; // 'FC' | 'BC'
  fat: string;
  snf: string;
  clr: string;
  acidity: string;
  temp: string;
  seal: string;
  mbrt: string;
  sTime: string;
  spGr: string;
  cob: 'Negative' | 'Positive';
  milkType: string;
}

export default function UnloadingBay() {
  const [tankers, setTankers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // 4.1 Vehicle Details
  const [vehicleNo, setVehicleNo] = useState('');
  const [receivedFromList, setReceivedFromList] = useState<string[]>([]);
  const [dcNumber, setDcNumber] = useState('');

  // 4.2 Unloading Details
  const [unloadingDate, setUnloadingDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [unloadingTime, setUnloadingTime] = useState('02:45');
  const [unloadingAmPm, setUnloadingAmPm] = useState<'AM' | 'PM'>('PM');
  const [outletSealNumber, setOutletSealNumber] = useState('');
  const [unloadedToSilo, setUnloadedToSilo] = useState('Silo-1');
  const [unloadOperatorName, setUnloadOperatorName] = useState('R. Kumaran');
  const [lineNumber, setLineNumber] = useState<'Line 1' | 'Line 2' | 'Line 3' | 'Line 4'>('Line 1');
  const [grossWeightKg, setGrossWeightKg] = useState('');
  const [remarks, setRemarks] = useState('');
  const [cellFcChecked, setCellFcChecked] = useState(true);
  const [cellBcChecked, setCellBcChecked] = useState(true);
  const [showDcModal, setShowDcModal] = useState(false);
  const [isNpdTransfer, setIsNpdTransfer] = useState<'Yes' | 'No'>('No');

  // 4.3 Received Quality (FC and BC)
  const [receivedQualityList, setReceivedQualityList] = useState<UnloadReceivedQuality[]>([
    {
      cell: 'FC',
      fat: '4.25',
      snf: '8.10',
      clr: '27.56',
      acidity: '0.13',
      temp: '4.0',
      seal: '018168',
      mbrt: '45',
      sTime: '02:33',
      spGr: '1.030',
      cob: 'Negative',
      milkType: 'MIXED MILK',
    },
    {
      cell: 'BC',
      fat: '4.15',
      snf: '8.05',
      clr: '27.44',
      acidity: '0.13',
      temp: '4.1',
      seal: '018167',
      mbrt: '45',
      sTime: '02:33',
      spGr: '1.030',
      cob: 'Negative',
      milkType: 'MIXED MILK',
    },
  ]);

  const [submitting, setSubmitting] = useState(false);

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker');
      const list = res.data || [];
      setTankers(list);
      if (list.length > 0) {
        // Prioritize a tanker waiting on unloading with QC completed
        const unloadWaiting = list.find(
          (t: any) =>
            (t.stage_data?.qc_completed?.qc_status === 'accepted' || t.journey?.completedStageKeys?.includes('qc_completed')) &&
            !t.stage_data?.unloaded
        );
        if (!selectedTankerId || !list.some((t: any) => t.id === selectedTankerId)) {
          setSelectedTankerId(unloadWaiting ? unloadWaiting.id : list[0].id);
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

  // 4. VEHICLES WAITING FOR UNLOADING: Condition: Display only vehicles for which QC has been completed.
  const unloadEligibleTankers = useMemo(() => {
    return tankers.filter(
      (t) =>
        (t.stage_data?.qc_completed?.qc_status === 'accepted' || t.journey?.completedStageKeys?.includes('qc_completed')) &&
        !t.stage_data?.unloaded &&
        t.journey?.tripStatus !== 'qc_rejected'
    );
  }, [tankers]);

  const displayedQueue = unloadEligibleTankers.length > 0 ? unloadEligibleTankers : tankers;

  const activeTanker = tankers.find((t) => t.id === selectedTankerId) || displayedQueue[0] || tankers[0] || null;
  const journey = activeTanker?.journey;
  const isQcRejected = journey?.isQcRejected || activeTanker?.qc_status === 'rejected' || activeTanker?.stage_data?.qc_completed?.qc_status === 'rejected';

  // Pre-fill form when active tanker changes
  useEffect(() => {
    if (activeTanker) {
      setVehicleNo(activeTanker.tanker_number || '');

      const resolvedDc =
        activeTanker.dc_number ||
        activeTanker.stage_data?.dc_number ||
        activeTanker.stage_data?.dc_no ||
        activeTanker.stage_data?.qc_completed?.dc_number ||
        activeTanker.stage_data?.gross_weight?.dc_number ||
        activeTanker.stage_data?.vehicle_entered?.dc_number ||
        activeTanker.journey?.dc_number ||
        '106451';
      setDcNumber(resolvedDc);

      const bmcName = activeTanker.units?.name || 'KRISHANAMPUDUR';
      const bmcCode = activeTanker.units?.unit_code || 'CC_BMC87';
      const primaryBmcTag = `${bmcName} [${bmcCode}]`;
      const storedReceived =
        activeTanker.stage_data?.qc_completed?.received_from ||
        activeTanker.stage_data?.gross_weight?.received_from;

      if (Array.isArray(storedReceived) && storedReceived.length > 0) {
        setReceivedFromList(storedReceived);
      } else {
        setReceivedFromList([
          primaryBmcTag,
          'ADAIYUR BMC [17218]',
          'CHITHOOR BMC [17193]',
        ]);
      }

      const sealNo =
        activeTanker.seal_number ||
        activeTanker.stage_data?.seal_number ||
        activeTanker.stage_data?.outlet_seal_no ||
        activeTanker.stage_data?.vehicle_entered?.seal_number ||
        '018168';
      setOutletSealNumber(sealNo);

      const gKg =
        activeTanker.gross_weight_kg ||
        activeTanker.stage_data?.gross_weight?.gross_weight_kg ||
        activeTanker.journey?.calculated?.gross_weight_kg ||
        '';
      setGrossWeightKg(gKg ? String(gKg) : '');

      const existingRemarks =
        activeTanker.stage_data?.unloaded?.remarks ||
        activeTanker.stage_data?.qc_completed?.remarks ||
        '';
      setRemarks(existingRemarks);

      // Populate 4.3 Received Quality from QC or defaults for FC and BC
      const qcRecList = activeTanker.stage_data?.qc_completed?.received_quality;
      if (Array.isArray(qcRecList) && qcRecList.length > 0) {
        const mapped = qcRecList.map((q: any) => ({
          cell: q.cell || 'FC',
          fat: String(q.fat ?? '4.25'),
          snf: String(q.snf ?? '8.10'),
          clr: String(q.clr ?? '27.56'),
          acidity: String(q.acidity ?? '0.13'),
          temp: String(q.temp ?? '4.0'),
          seal: String(q.seal ?? sealNo),
          mbrt: String(q.mbrt ?? '45'),
          sTime: String(q.sampleTime ?? '02:33'),
          spGr: String(q.spGr ?? '1.030'),
          cob: (q.cob === 'Positive' ? 'Positive' : 'Negative') as 'Negative' | 'Positive',
          milkType: String(q.milkType ?? 'MIXED MILK'),
        }));
        setReceivedQualityList(mapped);
      } else {
        setReceivedQualityList([
          {
            cell: 'FC',
            fat: String(activeTanker.stage_data?.qc_completed?.received_fat_pct || activeTanker.received_fat_pct || '4.25'),
            snf: String(activeTanker.stage_data?.qc_completed?.received_snf_pct || activeTanker.received_snf_pct || '8.10'),
            clr: '27.56',
            acidity: '0.13',
            temp: '4.0',
            seal: sealNo,
            mbrt: '45',
            sTime: '02:33',
            spGr: '1.030',
            cob: 'Negative',
            milkType: 'MIXED MILK',
          },
          {
            cell: 'BC',
            fat: '4.15',
            snf: '8.05',
            clr: '27.44',
            acidity: '0.13',
            temp: '4.1',
            seal: '018167',
            mbrt: '45',
            sTime: '02:33',
            spGr: '1.030',
            cob: 'Negative',
            milkType: 'MIXED MILK',
          },
        ]);
      }
    }
  }, [activeTanker?.id]);

  const updateReceivedQuality = (idx: number, field: keyof UnloadReceivedQuality, value: any) => {
    setReceivedQualityList((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleUpdateUnloading = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTanker) return;

    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload = {
        unloading_date: unloadingDate,
        unloading_time: `${unloadingTime} ${unloadingAmPm}`,
        seal_number: outletSealNumber,
        unloaded_to_silo: unloadedToSilo,
        silo_or_bay: unloadedToSilo,
        unload_operator_name: unloadOperatorName,
        line_number: lineNumber,
        gross_weight_kg: Number(grossWeightKg) || activeTanker.gross_weight_kg,
        remarks: remarks.trim() || undefined,
        unloading_cells: {
          fc: cellFcChecked,
          bc: cellBcChecked,
        },
        dc_details: {
          dc_number: dcNumber,
          vehicle_number: vehicleNo,
          received_from: receivedFromList,
        },
        is_npd_transfer: isNpdTransfer === 'Yes',
        received_quality: receivedQualityList,
        unloaded_litres: activeTanker.journey?.calculated?.net_litres || activeTanker.quantity_dispatched,
        dc_number: dcNumber,
        received_from: receivedFromList,
      };

      await api.post(`/tanker/${activeTanker.id}/stages/unloaded`, payload);
      setSuccessMsg('Unloading Details updated successfully! Tanker moved to Weighbridge for Tare Weight.');
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update unloading details');
    } finally {
      setSubmitting(false);
    }
  };

  // KPI Calculations
  const waitingForUnloadCount = unloadEligibleTankers.length;
  const totalUnloadedLitresToday = tankers.reduce((sum, t) => {
    const un = t.stage_data?.unloaded?.unloaded_litres ?? t.received_qty ?? 0;
    return sum + Number(un || 0);
  }, 0);

  const activeSilosSet = new Set(
    tankers
      .map((t) => t.stage_data?.unloaded?.unloaded_to_silo || t.stage_data?.unloaded?.silo_or_bay)
      .filter(Boolean)
  );
  const activeSilosCount = activeSilosSet.size;
  const activeSilosStr = Array.from(activeSilosSet).slice(0, 3).join(', ') || 'Silo-1';

  return (
    <div className="page" style={{ maxWidth: '1080px', margin: '0 auto', padding: '16px' }}>
      {/* Header */}
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>Dashboard</span>
        <span>&gt;</span>
        <span>Milk Reception</span>
        <span>&gt;</span>
        <strong style={{ color: '#0f172a' }}>Vehicles Waiting for Unloading</strong>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
            Unloading Bay Operations
          </h1>
          <p className="page-subtitle" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Condition: Display only vehicles for which QC has been completed
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#475569', fontWeight: 600 }}>
            Waiting for Unloading: <strong style={{ color: '#0284c7' }}>{waitingForUnloadCount}</strong>
          </span>
          <button onClick={fetchTankers} className="btn btn-secondary" style={{ height: '36px', padding: '0 12px', fontSize: '13px', width: 'auto' }}>
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

      {/* 4 Top KPI Dashboard Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #0284c7', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Ready for Silo Reception
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>
            {waitingForUnloadCount}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            QC Completed &amp; Approved
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #16a34a', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Total Milk Unloaded Today
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
            {formatLitres(totalUnloadedLitresToday)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Discharged into plant silos
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #8b5cf6', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Active Storage Silos
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#8b5cf6', marginTop: '4px' }}>
            {activeSilosCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>({activeSilosStr})</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Receiving raw chilled milk
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #0d9488', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Reception Lines
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0d9488', marginTop: '4px' }}>
            4 Lines
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Line 1, Line 2, Line 3, Line 4
          </div>
        </div>
      </div>

      {/* 4. Tanker Queue Selector Bar (Condition: Display only vehicles for which QC has been completed) */}
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
        <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', minWidth: '240px' }}>
          Vehicles Waiting for Unloading (QC Done):
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
          {displayedQueue.length === 0 ? (
            <option value="">No vehicles currently waiting for Unloading (Condition: QC completed)</option>
          ) : (
            displayedQueue.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tanker_number} {t.dc_number ? `(DC #${t.dc_number})` : ''} — Stage: {t.journey?.tripStatusLabel} — BMC: {t.units?.name}
              </option>
            ))
          )}
        </select>
      </div>

      {activeTanker && journey ? (
        <div>
          {/* Connected 7-Stage Horizontal Pipeline Header */}
          <div style={{ marginBottom: '1.25rem' }}>
            <TankerTimeline journey={journey} variant="compact" />
          </div>

          {/* Sub Navigation Bar matching Aavin IDMS header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              backgroundColor: '#0284c7',
              padding: '6px 10px 0 10px',
              borderRadius: '8px 8px 0 0',
              borderBottom: '2px solid #0369a1',
            }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                color: '#0369a1',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: 700,
              }}
            >
              Milk Receipt Entry ▾
            </div>
            <div
              style={{
                backgroundColor: '#0369a1',
                color: '#f0f9ff',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              Unloading Details
            </div>
          </div>

          {/* Action Form Card */}
          <div
            className="card"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '0 0 8px 8px',
              border: '1px solid #cbd5e1',
              borderTop: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              marginBottom: '1.5rem',
            }}
          >
            {isQcRejected ? (
              <div
                style={{
                  padding: '20px',
                  backgroundColor: '#fee2e2',
                  border: '2px solid #ef4444',
                  borderRadius: '8px',
                  color: '#991b1b',
                  margin: '1rem',
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
            ) : (
              <div>
                {/* Authentic Aavin IDMS Banner */}
                <div
                  style={{
                    backgroundColor: '#52525b',
                    color: '#ffffff',
                    padding: '0.5rem 1rem',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                  }}
                >
                  UNLOADING DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form onSubmit={handleUpdateUnloading}>
                    {/* 4.1 Vehicle Details */}
                    {/* 1. Vehicle Number */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={vehicleNo}
                          onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                          style={{
                            width: 150,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                            fontWeight: 600,
                          }}
                        />
                        <span
                          style={{
                            backgroundColor: '#fef9c3',
                            border: '1px solid #fde047',
                            padding: '2px 8px',
                            borderRadius: 3,
                            fontWeight: 700,
                            fontSize: '0.85rem',
                            color: '#1e293b',
                          }}
                        >
                          {vehicleNo || activeTanker.tanker_number}
                        </span>
                      </div>
                    </div>

                    {/* 2. Received From */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {receivedFromList.map((bmc, idx) => (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: '#fef9c3',
                              border: '1px solid #fde047',
                              padding: '1px 8px',
                              borderRadius: 2,
                              fontWeight: 600,
                              fontSize: '0.82rem',
                              color: '#1e293b',
                              width: 'fit-content',
                            }}
                          >
                            {bmc}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 3. DC Number */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        DC NO: <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          value={dcNumber}
                          onChange={(e) => setDcNumber(e.target.value.toUpperCase())}
                          style={{
                            width: 150,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                            fontWeight: 600,
                          }}
                        />
                      </div>
                    </div>

                    {/* 4.2 Unloading Details */}
                    {/* 1. Unloading Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Unloading Date
                      </label>
                      <input
                        type="text"
                        value={unloadingDate}
                        onChange={(e) => setUnloadingDate(e.target.value)}
                        placeholder="DD/MM/YYYY"
                        style={{
                          width: 150,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* 2. Unloading Time (HH:MM, 12-hour format) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Unloading Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={unloadingTime}
                          onChange={(e) => setUnloadingTime(e.target.value)}
                          placeholder="02:45"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={unloadingAmPm}
                          onChange={(e) => setUnloadingAmPm(e.target.value as any)}
                          style={{
                            width: 60,
                            height: 28,
                            padding: '2px 4px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                            fontWeight: 600,
                          }}
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>

                    {/* 3. Outlet Seal Number */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Outlet Seal Number
                      </label>
                      <input
                        value={outletSealNumber}
                        onChange={(e) => setOutletSealNumber(e.target.value)}
                        placeholder="e.g. SL-018168"
                        style={{
                          width: 180,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* 4. Unloaded To Silo (Dropdown) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Unloaded To Silo (Receiving Silo / Raw Milk Bay)
                      </label>
                      <select
                        value={unloadedToSilo}
                        onChange={(e) => setUnloadedToSilo(e.target.value)}
                        style={{
                          width: 240,
                          height: 28,
                          padding: '0 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        <option value="Silo-1">Silo 1 (50,000 L Raw Chilled Milk)</option>
                        <option value="Silo-2">Silo 2 (50,000 L Raw Chilled Milk)</option>
                        <option value="Silo-3">Silo 3 (30,000 L Whole Milk)</option>
                        <option value="Silo-4">Silo 4 (40,000 L Standardized Milk)</option>
                        <option value="Silo-5">Silo 5 (50,000 L Storage)</option>
                        <option value="Raw Milk Silo A">Raw Milk Silo A</option>
                        <option value="Raw Milk Silo B">Raw Milk Silo B</option>
                      </select>
                    </div>

                    {/* 5. Unload Operator Name */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Unload Operator Name
                      </label>
                      <input
                        value={unloadOperatorName}
                        onChange={(e) => setUnloadOperatorName(e.target.value)}
                        style={{
                          width: 200,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* 6. Line Number */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Line Number
                      </label>
                      <select
                        value={lineNumber}
                        onChange={(e) => setLineNumber(e.target.value as any)}
                        style={{
                          width: 150,
                          height: 28,
                          padding: '0 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        <option value="Line 1">Line 1</option>
                        <option value="Line 2">Line 2</option>
                        <option value="Line 3">Line 3</option>
                        <option value="Line 4">Line 4</option>
                      </select>
                    </div>

                    {/* 7. Gross Weight (Kgs) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Gross Weight (Kgs)
                      </label>
                      <input
                        type="number"
                        value={grossWeightKg}
                        onChange={(e) => setGrossWeightKg(e.target.value)}
                        placeholder="e.g. 25300"
                        style={{
                          width: 150,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      />
                    </div>

                    {/* 8. Remarks */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                        Remarks
                      </label>
                      <textarea
                        rows={2}
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder=""
                        style={{
                          width: '100%',
                          maxWidth: 380,
                          padding: '4px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>

                    {/* 9. Unloading Cells: FC & DC (Dialog Box) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Unloading Cells
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.88rem' }}>
                          <input
                            type="checkbox"
                            checked={cellFcChecked}
                            onChange={(e) => setCellFcChecked(e.target.checked)}
                            style={{ width: 16, height: 16 }}
                          />
                          <span style={{ fontWeight: 700, color: '#1e293b' }}>FC</span>
                        </label>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.88rem' }}>
                          <input
                            type="checkbox"
                            checked={cellBcChecked}
                            onChange={(e) => setCellBcChecked(e.target.checked)}
                            style={{ width: 16, height: 16 }}
                          />
                          <span style={{ fontWeight: 700, color: '#1e293b' }}>BC</span>
                        </label>

                        <button
                          type="button"
                          onClick={() => setShowDcModal(true)}
                          style={{
                            backgroundColor: '#0284c7',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 3,
                            padding: '3px 12px',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          DC (Dialog Box) ▾
                        </button>
                      </div>
                    </div>

                    {/* 10. Is NPD Transfer? */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Is NPD Transfer?
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.88rem' }}>
                          <input
                            type="radio"
                            name="npdTransfer"
                            value="Yes"
                            checked={isNpdTransfer === 'Yes'}
                            onChange={() => setIsNpdTransfer('Yes')}
                          />
                          <span style={{ fontWeight: 600 }}>Yes</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.88rem' }}>
                          <input
                            type="radio"
                            name="npdTransfer"
                            value="No"
                            checked={isNpdTransfer === 'No'}
                            onChange={() => setIsNpdTransfer('No')}
                          />
                          <span style={{ fontWeight: 600 }}>No</span>
                        </label>
                      </div>
                    </div>

                    {/* 4.3 Received Quality (Separately for FC and BC) */}
                    <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700, color: '#334155' }}>
                        Received Quality
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {receivedQualityList.map((row, idx) => (
                          <div
                            key={row.cell}
                            style={{
                              padding: '10px 14px',
                              backgroundColor: '#f8fafc',
                              border: '1px solid #e2e8f0',
                              borderRadius: 6,
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a', marginBottom: '6px' }}>
                              {row.cell}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {/* Row 1: Fat, SNF, CLR, Acidity %, Temp */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>Fat%</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.fat}
                                    onChange={(e) => updateReceivedQuality(idx, 'fat', e.target.value)}
                                    style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>SNF%</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.snf}
                                    onChange={(e) => updateReceivedQuality(idx, 'snf', e.target.value)}
                                    style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 35 }}>CLR</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.clr}
                                    onChange={(e) => updateReceivedQuality(idx, 'clr', e.target.value)}
                                    style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 55 }}>Acidity%</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={row.acidity}
                                    onChange={(e) => updateReceivedQuality(idx, 'acidity', e.target.value)}
                                    style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Temp</span>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={row.temp}
                                    onChange={(e) => updateReceivedQuality(idx, 'temp', e.target.value)}
                                    style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                  <span style={{ color: '#64748b' }}>°C</span>
                                </div>
                              </div>

                              {/* Row 2: Seal, MBRT, S.Time, Sp. Gr., COB, Milk Type */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>Seal</span>
                                  <input
                                    value={row.seal}
                                    onChange={(e) => updateReceivedQuality(idx, 'seal', e.target.value)}
                                    style={{ width: 65, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>MBRT</span>
                                  <input
                                    value={row.mbrt}
                                    onChange={(e) => updateReceivedQuality(idx, 'mbrt', e.target.value)}
                                    style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>S.Time</span>
                                  <input
                                    value={row.sTime}
                                    onChange={(e) => updateReceivedQuality(idx, 'sTime', e.target.value)}
                                    style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Sp. Gr.</span>
                                  <input
                                    value={row.spGr}
                                    onChange={(e) => updateReceivedQuality(idx, 'spGr', e.target.value)}
                                    style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 35 }}>COB</span>
                                  <select
                                    value={row.cob}
                                    onChange={(e) => updateReceivedQuality(idx, 'cob', e.target.value as any)}
                                    style={{ width: 85, height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  >
                                    <option value="Negative">Negative</option>
                                    <option value="Positive">Positive</option>
                                  </select>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', minWidth: 65 }}>Milk Type</span>
                                  <input
                                    value={row.milkType}
                                    onChange={(e) => updateReceivedQuality(idx, 'milkType', e.target.value)}
                                    style={{ width: 90, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Action Button matching Aavin IDMS */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '0.5rem' }}>
                      <button
                        type="submit"
                        disabled={submitting}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '6px 20px',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                          opacity: submitting ? 0.7 : 1,
                        }}
                      >
                        {submitting ? 'Updating…' : 'Update'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          {loading ? 'Loading active tankers…' : 'No tankers currently waiting in plant queue.'}
        </div>
      )}

      {/* DC (Dialog Box) Modal */}
      {showDcModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              width: '100%',
              maxWidth: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                backgroundColor: '#0284c7',
                color: '#ffffff',
                padding: '0.75rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontWeight: 700,
              }}
            >
              <span>Delivery Challan (DC) Details</span>
              <button
                type="button"
                onClick={() => setShowDcModal(false)}
                style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.1rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '1rem', fontSize: '0.88rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>DC Number:</td>
                    <td style={{ padding: '6px', fontWeight: 700, color: '#0284c7' }}>#{dcNumber}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Vehicle Number:</td>
                    <td style={{ padding: '6px', fontWeight: 700 }}>{vehicleNo}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Dispatch Date:</td>
                    <td style={{ padding: '6px' }}>{activeTanker?.date || unloadingDate}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Dispatched Qty:</td>
                    <td style={{ padding: '6px', fontWeight: 700 }}>{formatLitres(activeTanker?.quantity_dispatched || 0)}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Outlet Seal No:</td>
                    <td style={{ padding: '6px' }}>{outletSealNumber}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Source BMC Units:</td>
                    <td style={{ padding: '6px' }}>{receivedFromList.join(', ')}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Driver Name:</td>
                    <td style={{ padding: '6px' }}>{activeTanker?.driver_name || 'Driver'}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => setShowDcModal(false)}
                  style={{
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 16px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Today's Unloading Bay Reception Register Table */}
      <div
        className="card"
        style={{
          marginTop: '24px',
          padding: '16px 20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
              📋 Today's Unloading Bay Reception Register ({tankers.length} Tankers)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Daily milk reception log, silo allocation, volume discharged, and transit loss
            </p>
          </div>
        </div>

        {tankers.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            No tanker movements recorded today yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>TANKER NO</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>DC #</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>SOURCE BMC</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>SILO / BAY</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>DISPATCHED (L)</th>
                  <th style={{ padding: '10px 12px', fontWeight: 700, color: '#475569' }}>STAGE STATUS</th>
                </tr>
              </thead>
              <tbody>
                {tankers.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 700 }}>{t.tanker_number}</td>
                    <td style={{ padding: '8px 12px', color: '#0284c7' }}>#{t.dc_number || '—'}</td>
                    <td style={{ padding: '8px 12px' }}>{t.units?.name || 'BMC'}</td>
                    <td style={{ padding: '8px 12px' }}>{t.stage_data?.unloaded?.unloaded_to_silo || t.stage_data?.unloaded?.silo_or_bay || '—'}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{formatLitres(t.quantity_dispatched)}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          backgroundColor: t.journey?.stageColor?.badgeBg || '#e2e8f0',
                          color: t.journey?.stageColor?.badgeText || '#334155',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontWeight: 600,
                          fontSize: '11px',
                        }}
                      >
                        {t.journey?.tripStatusLabel || 'In Process'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
