import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
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
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Dialog Modals
  const [showUnloadModal, setShowUnloadModal] = useState(false);
  const [showDcModal, setShowDcModal] = useState(false);

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

  const fetchTankers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker');
      const list = res.data || [];
      setTankers(list);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load tankers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTankers();
    const interval = setInterval(fetchTankers, 30000);
    return () => clearInterval(interval);
  }, []);

  // 4. VEHICLES WAITING FOR UNLOADING: Condition: Display only vehicles for which QC has been completed.
  const unloadEligibleTankers = useMemo(() => {
    return tankers.filter((t) => {
      const isQcRej =
        t.journey?.isQcRejected ||
        t.qc_status === 'rejected' ||
        t.stage_data?.qc_completed?.qc_status === 'rejected';
      const qcDone =
        t.stage_data?.qc_completed?.qc_status === 'accepted' ||
        t.stage_data?.qc_completed != null ||
        t.journey?.completedStageKeys?.includes('qc_completed');
      const unloadedDone =
        t.stage_data?.unloaded != null || t.journey?.completedStageKeys?.includes('unloaded');
      return !t.stage_data?.unloaded && qcDone && !isQcRej && !unloadedDone && t.journey?.tripStatus !== 'exited';
    });
  }, [tankers]);

  const activeTanker = useMemo(() => {
    if (selectedTankerId) {
      const found = tankers.find((t) => t.id === selectedTankerId);
      if (found) return found;
    }
    return unloadEligibleTankers[0] || tankers[0] || null;
  }, [selectedTankerId, tankers, unloadEligibleTankers]);

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

      const bmcSources: string[] = [];
      if (activeTanker.units?.name) {
        bmcSources.push(`${activeTanker.units.name.toUpperCase()} [${activeTanker.units.unit_code || '17218'}]`);
      }
      if (activeTanker.compartments && Array.isArray(activeTanker.compartments)) {
        activeTanker.compartments.forEach((c: any) => {
          if (c.bmc_name && !bmcSources.some((b) => b.includes(c.bmc_name.toUpperCase()))) {
            bmcSources.push(`${c.bmc_name.toUpperCase()}`);
          }
        });
      }
      if (bmcSources.length === 0) {
        bmcSources.push('KRISHANAMPUDUR [CC_BMC87]');
        bmcSources.push('ADAIYUR BMC [17218]');
        bmcSources.push('CHITHOOR BMC [17193]');
      }
      setReceivedFromList(bmcSources);

      const resolvedSeal =
        activeTanker.seal_number ||
        activeTanker.stage_data?.outlet_seal_no ||
        activeTanker.stage_data?.seal_number ||
        activeTanker.stage_data?.vehicle_entered?.outlet_seal_no ||
        activeTanker.stage_data?.vehicle_entered?.seal_number ||
        '018168';
      setOutletSealNumber(resolvedSeal);

      const gw =
        activeTanker.stage_data?.gross_weight?.gross_weight_kg ||
        activeTanker.gross_weight_kg ||
        activeTanker.journey?.calculated?.gross_weight_kg ||
        '24850';
      setGrossWeightKg(String(gw));

      // Populate Received Quality from QC stage if available
      const qcRecQ = activeTanker.stage_data?.qc_completed?.received_quality;
      if (qcRecQ && Array.isArray(qcRecQ) && qcRecQ.length > 0) {
        setReceivedQualityList(
          qcRecQ.map((q: any) => ({
            cell: q.cell || 'FC',
            fat: String(q.fat ?? '4.25'),
            snf: String(q.snf ?? '8.10'),
            clr: String(q.clr ?? '27.56'),
            acidity: String(q.acidity ?? '0.13'),
            temp: String(q.temp ?? '4.0'),
            seal: String(q.seal ?? resolvedSeal),
            mbrt: String(q.mbrt ?? '45'),
            sTime: String(q.sampleTime ?? '02:33'),
            spGr: String(q.spGr ?? '1.030'),
            cob: q.cob === 'Positive' ? 'Positive' : 'Negative',
            milkType: q.milkType || 'MIXED MILK',
          }))
        );
      } else {
        setReceivedQualityList([
          {
            cell: 'FC',
            fat: '4.25',
            snf: '8.10',
            clr: '27.56',
            acidity: '0.13',
            temp: '4.0',
            seal: resolvedSeal,
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
            seal: resolvedSeal ? `${parseInt(resolvedSeal, 10) - 1 || '018167'}` : '018167',
            mbrt: '45',
            sTime: '02:33',
            spGr: '1.030',
            cob: 'Negative',
            milkType: 'MIXED MILK',
          },
        ]);
      }
    }
  }, [
    activeTanker?.id,
    activeTanker?.tanker_number,
    activeTanker?.seal_number,
    activeTanker?.dc_number,
    activeTanker?.stage_data,
    activeTanker,
  ]);

  const updateReceivedQuality = (idx: number, field: keyof UnloadReceivedQuality, val: any) => {
    setReceivedQualityList((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], [field]: val };
      }
      return next;
    });
  };

  const handleUpdateUnloading = async () => {
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
      setShowUnloadModal(false);
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
  const activeSilosCount = activeSilosSet.size || 2;
  const activeSilosStr = Array.from(activeSilosSet).length > 0 ? Array.from(activeSilosSet).join(', ') : 'Silo-1, Silo-2';

  const blockedCount = tankers.filter(
    (t) => t.qc_status === 'rejected' || t.stage_data?.qc_completed?.qc_status === 'rejected' || t.journey?.tripStatus === 'qc_rejected'
  ).length;

  // Search filter
  const matchesSearch = (t: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const v = (t.tanker_number || '').toLowerCase();
    const dc = (t.dc_number || t.stage_data?.dc_number || '').toLowerCase();
    const bmc = (t.units?.name || '').toLowerCase();
    const driver = (t.driver_name || '').toLowerCase();
    return v.includes(q) || dc.includes(q) || bmc.includes(q) || driver.includes(q);
  };

  const filteredUnloadWaiters = unloadEligibleTankers.filter(matchesSearch);

  return (
    <div className="page" style={{ maxWidth: '1180px', margin: '0 auto', padding: '1.25rem' }}>
      {/* 1. Header */}
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span>Milk Reception</span>
        <span>&gt;</span>
        <strong style={{ color: '#0f172a' }}>Unloading Bay</strong>
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0' }}>
            Milk Unloading Bay &amp; Silo Intake
          </h1>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b' }}>
            Condition: Display only vehicles for which QC has been completed and accepted
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTankers} />}
      {successMsg && (
        <div className="success-banner" style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
        </div>
      )}

      {/* 2. Unloading Bay KPI Counters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '12px',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fed7aa', borderLeft: '4px solid #f97316', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Ready for Silo Reception (Waiting for Unload)
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#c2410c', marginTop: '2px' }}>
            {waitingForUnloadCount}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>QC accepted, ready at bay</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Total Milk Unloaded Today
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d', marginTop: '2px' }}>
            {formatLitres(totalUnloadedLitresToday)}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Pumped into plant raw silos</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bae6fd', borderLeft: '4px solid #0284c7', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Silos in Active Use
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0369a1', marginTop: '2px' }}>
            {activeSilosCount} <span style={{ fontSize: '13px', fontWeight: 600, color: '#64748b' }}>({activeSilosStr})</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Receiving lines connected</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            QC Rejections Blocked
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#b91c1c', marginTop: '2px' }}>
            {blockedCount}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Blocked from unloading pumps</div>
        </div>
      </div>

      {/* QC Rejection Warning Banner if selected or detected */}
      {isQcRejected && (
        <div
          style={{
            backgroundColor: '#fee2e2',
            border: '2px solid #ef4444',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '1.25rem',
            color: '#7f1d1d',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '20px' }}>🚫</span>
            <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              UNLOADING STRICTLY BLOCKED (QC REJECTED)
            </strong>
          </div>
          <p style={{ margin: 0, fontSize: '12px', lineHeight: '1.5' }}>
            This tanker was rejected by QC Laboratory ({activeTanker?.stage_data?.qc_completed?.rejection_reason || 'Quality failure'}). It is prohibited from discharging milk into the dairy plant receiving silos and must proceed directly to the weighbridge for empty tare weighing.
          </p>
        </div>
      )}

      {/* Main Vehicle Sheet Card */}
      <div
        className="card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          border: '1px solid #cbd5e1',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          padding: '1.25rem',
          minHeight: '350px',
        }}
      >
        {/* Card Header & Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
              📋 Today's Unloading Bay Reception Register ({filteredUnloadWaiters.length} Vehicles)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
              Vehicles with completed QC inspection waiting for silo intake and unloading
            </p>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>Search Vehicles:</span>
            <input
              type="text"
              placeholder="Filter by Lorry No, DC No, BMC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: 260,
                height: 32,
                padding: '4px 10px',
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                fontSize: '0.85rem',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Clear
              </button>
            )}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            💡 Click on any row to open the Unloading Details dialog form
          </span>
        </div>

        {/* VEHICLE SHEET: Vehicles Waiting for Unloading (QC Completed) */}
        {filteredUnloadWaiters.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🥛</div>
            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>
              No vehicles currently waiting for Milk Unloading
            </div>
            <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
              Condition: Only vehicles for which QC has been completed and accepted will appear in this sheet.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '10px 12px' }}>VEHICLE / TANKER NO</th>
                  <th style={{ padding: '10px 12px' }}>DC # / DC NO</th>
                  <th style={{ padding: '10px 12px' }}>SOURCE CC / BMC</th>
                  <th style={{ padding: '10px 12px' }}>DRIVER NAME</th>
                  <th style={{ padding: '10px 12px' }}>DISPATCHED (L)</th>
                  <th style={{ padding: '10px 12px' }}>GROSS WEIGHT (KG)</th>
                  <th style={{ padding: '10px 12px' }}>QC STATUS</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnloadWaiters.map((t) => {
                  const dc = t.dc_number || t.stage_data?.dc_number || '—';
                  const grossKg = t.stage_data?.gross_weight?.gross_weight_kg || t.gross_weight_kg || '—';
                  return (
                    <tr
                      key={t.id}
                      onClick={() => {
                        setSelectedTankerId(t.id);
                        setShowUnloadModal(true);
                      }}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        backgroundColor: selectedTankerId === t.id ? '#f0fdf4' : '#ffffff',
                        transition: 'background-color 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = selectedTankerId === t.id ? '#f0fdf4' : '#ffffff')}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                        <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3 }}>
                          {t.tanker_number}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0284c7' }}>
                        #{dc}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#334155' }}>
                        {t.units?.name || 'BMC'}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#475569' }}>
                        {t.driver_name || '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                        {formatLitres(t.quantity_dispatched)}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#0f172a' }}>
                        {grossKg !== '—' ? `${Number(grossKg).toLocaleString('en-IN')} kg` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '0.78rem' }}>
                          ✓ Accepted
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTankerId(t.id);
                            setShowUnloadModal(true);
                          }}
                          className="btn btn-primary btn-sm"
                          style={{ backgroundColor: '#65a30d', borderColor: '#4d7c0f', fontWeight: 700, padding: '4px 12px' }}
                        >
                          🥛 Unload Tanker
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

      {/* DIALOG BOX MODAL: UNLOADING DETAILS (Requirement 4) */}
      {showUnloadModal && activeTanker && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '1rem',
          }}
          onClick={() => setShowUnloadModal(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              width: '100%',
              maxWidth: 960,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                backgroundColor: '#52525b',
                color: '#ffffff',
                padding: '0.5rem 1rem',
                fontSize: '0.88rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>UNLOADING DETAILS</span>
              <button
                type="button"
                onClick={() => setShowUnloadModal(false)}
                style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleUpdateUnloading();
                }}
              >
                {/* 4.1 Vehicle Details */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Vehicle No
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      value={vehicleNo || activeTanker.tanker_number || ''}
                      onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                      style={{ width: 140, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontWeight: 600 }}
                    />
                    <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                      {vehicleNo || activeTanker.tanker_number}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                    Received From :
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {receivedFromList.map((bmc, idx) => (
                      <span
                        key={idx}
                        style={{
                          backgroundColor: '#fef9c3',
                          border: '1px solid #fde047',
                          padding: '2px 8px',
                          borderRadius: 3,
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          color: '#1e293b',
                          display: 'inline-block',
                          width: 'fit-content',
                        }}
                      >
                        {bmc}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    DC NO: <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={dcNumber || activeTanker.dc_number || ''}
                    onChange={(e) => setDcNumber(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                {/* 4.2 Unloading Details Section */}
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#334155', marginBottom: '0.75rem' }}>
                    Unloading Parameters
                  </div>

                  {/* 1. Unloading Date */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Unloading Date
                    </label>
                    <input
                      type="text"
                      value={unloadingDate}
                      onChange={(e) => setUnloadingDate(e.target.value)}
                      style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                  </div>

                  {/* 2. Unloading Time */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Unloading Time(HHMM)[12 hour format]
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <input
                        type="text"
                        value={unloadingTime}
                        onChange={(e) => setUnloadingTime(e.target.value)}
                        style={{ width: 90, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                      />
                      <select
                        value={unloadingAmPm}
                        onChange={(e) => setUnloadingAmPm(e.target.value as any)}
                        style={{ height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff' }}
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                  </div>

                  {/* 3. Outlet Seal Number */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Outlet Seal No <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={outletSealNumber}
                      onChange={(e) => setOutletSealNumber(e.target.value)}
                      style={{ width: 180, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                  </div>

                  {/* 4. Unloaded To Silo */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Unloaded To Silo (Receiving Silo / Raw Milk Bay) <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      value={unloadedToSilo}
                      onChange={(e) => setUnloadedToSilo(e.target.value)}
                      style={{ width: 220, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff', fontWeight: 600 }}
                    >
                      <option value="Silo-1">Receiving Silo / Raw Milk Bay 1 (Silo-1)</option>
                      <option value="Silo-2">Receiving Silo / Raw Milk Bay 2 (Silo-2)</option>
                      <option value="Silo-3">Receiving Silo / Raw Milk Bay 3 (Silo-3)</option>
                      <option value="Silo-4">Receiving Silo / Raw Milk Bay 4 (Silo-4)</option>
                    </select>
                  </div>

                  {/* 5. Unload Operator Name */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Unload Operator Name <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={unloadOperatorName}
                      onChange={(e) => setUnloadOperatorName(e.target.value)}
                      style={{ width: 220, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
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
                      style={{ width: 140, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff', fontWeight: 600 }}
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
                      type="text"
                      value={grossWeightKg}
                      onChange={(e) => setGrossWeightKg(e.target.value)}
                      style={{ width: 140, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
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
                      style={{ width: '100%', maxWidth: 420, padding: '4px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                  </div>

                  {/* 9. Unloading Cells: FC & DC (Dialog Box) */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Unloading Cells
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={cellFcChecked}
                          onChange={(e) => setCellFcChecked(e.target.checked)}
                        />
                        FC
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={cellBcChecked}
                          onChange={(e) => setCellBcChecked(e.target.checked)}
                        />
                        BC
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowDcModal(true)}
                        style={{
                          backgroundColor: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: 3,
                          padding: '2px 10px',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: '#0369a1',
                          cursor: 'pointer',
                        }}
                      >
                        DC (Dialog Box) ▾
                      </button>
                    </div>
                  </div>

                  {/* 10. Is NPD Transfer? */}
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
                    <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                      Is NPD Transfer?
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.88rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="isNpdTransfer"
                          value="Yes"
                          checked={isNpdTransfer === 'Yes'}
                          onChange={() => setIsNpdTransfer('Yes')}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="isNpdTransfer"
                          value="No"
                          checked={isNpdTransfer === 'No'}
                          onChange={() => setIsNpdTransfer('No')}
                        />
                        No
                      </label>
                    </div>
                  </div>
                </div>

                {/* 4.3 Received Quality Section */}
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#334155', marginBottom: '0.75rem' }}>
                    Received Quality
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {receivedQualityList.map((row, idx) => (
                      <div key={idx} style={{ border: '1px solid #cbd5e1', borderRadius: 4, padding: '10px 12px', background: '#f8fafc' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>
                            {row.cell}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Fat%</span>
                              <input
                                type="text"
                                value={row.fat}
                                onChange={(e) => updateReceivedQuality(idx, 'fat', e.target.value)}
                                style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>SNF%</span>
                              <input
                                type="text"
                                value={row.snf}
                                onChange={(e) => updateReceivedQuality(idx, 'snf', e.target.value)}
                                style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 35 }}>CLR</span>
                              <input
                                type="text"
                                value={row.clr}
                                onChange={(e) => updateReceivedQuality(idx, 'clr', e.target.value)}
                                style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 55 }}>Acidity%</span>
                              <input
                                type="text"
                                value={row.acidity}
                                onChange={(e) => updateReceivedQuality(idx, 'acidity', e.target.value)}
                                style={{ width: 40, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Temp</span>
                              <input
                                type="text"
                                value={row.temp}
                                onChange={(e) => updateReceivedQuality(idx, 'temp', e.target.value)}
                                style={{ width: 40, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                              <span style={{ color: '#64748b' }}>°C</span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>Seal</span>
                              <input
                                type="text"
                                value={row.seal}
                                onChange={(e) => updateReceivedQuality(idx, 'seal', e.target.value)}
                                style={{ width: 70, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>MBRT</span>
                              <input
                                type="text"
                                value={row.mbrt}
                                onChange={(e) => updateReceivedQuality(idx, 'mbrt', e.target.value)}
                                style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>S.Time</span>
                              <input
                                type="text"
                                value={row.sTime}
                                onChange={(e) => updateReceivedQuality(idx, 'sTime', e.target.value)}
                                style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Sp. Gr.</span>
                              <input
                                type="text"
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
                                style={{ padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2, backgroundColor: '#ffffff' }}
                              >
                                <option value="Negative">Negative</option>
                                <option value="Positive">Positive</option>
                              </select>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ fontWeight: 600, color: '#334155', minWidth: 65 }}>Milk Type</span>
                              <input
                                type="text"
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

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setShowUnloadModal(false)}
                    className="btn btn-secondary"
                    style={{ padding: '6px 16px' }}
                  >
                    Cancel
                  </button>
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
                    }}
                  >
                    {submitting ? 'Updating…' : 'Update'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* DC (Dialog Box) Modal */}
      {showDcModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '1rem',
          }}
          onClick={() => setShowDcModal(false)}
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
            onClick={(e) => e.stopPropagation()}
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
                    <td style={{ padding: '6px', fontWeight: 700, color: '#0369a1' }}>#{dcNumber}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Vehicle Number:</td>
                    <td style={{ padding: '6px', fontWeight: 700 }}>{vehicleNo}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Source BMC:</td>
                    <td style={{ padding: '6px' }}>{receivedFromList.join(', ')}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Dispatch Date:</td>
                    <td style={{ padding: '6px' }}>{activeTanker?.date || 'Today'}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px', fontWeight: 600, color: '#475569' }}>Dispatched Qty:</td>
                    <td style={{ padding: '6px', fontWeight: 700 }}>{formatLitres(activeTanker?.quantity_dispatched || 0)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: '1rem', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => setShowDcModal(false)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', padding: '4px 14px' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
