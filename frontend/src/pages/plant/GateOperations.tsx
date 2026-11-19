import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatLitres, getLocalTodayIso } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';
import NewTankerRegistrationModal from '../../components/NewTankerRegistrationModal';

export interface GrossQualityRow {
  id: string;
  cell: string; // 'FC' | 'MC' | 'BC'
  bmc: string;
  fat: string;
  snf: string;
  temp: string;
  qty: string;
  dcNo: string;
}

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

  // Sub-navigation tabs: receipt, gross, tare, exit, register
  const [gateSubTab, setGateSubTab] = useState<'receipt' | 'gross' | 'tare' | 'exit' | 'register' | null>(null);
  const [showNewTankerModal, setShowNewTankerModal] = useState(false);

  // Step 2: Gross Weight states (Matching Aavin IDMS Gross Weight Entry photo)
  const [grossVehicleNo, setGrossVehicleNo] = useState('');
  const [grossReceivedFromList, setGrossReceivedFromList] = useState<string[]>([]);
  const [grossDcNo, setGrossDcNo] = useState('');
  const [numberOfCells, setNumberOfCells] = useState(2);
  const [grossDate, setGrossDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [grossEntryTime, setGrossEntryTime] = useState('02:14');
  const [grossEntryAmPm, setGrossEntryAmPm] = useState<'AM' | 'PM'>('PM');
  const [grossDispatchQty, setGrossDispatchQty] = useState('');
  const [grossWeightKg, setGrossWeightKg] = useState('');
  const [weighbridgeSlip, setWeighbridgeSlip] = useState('');
  const [grossQualityRows, setGrossQualityRows] = useState<GrossQualityRow[]>([]);
  const [showGrossReportModal, setShowGrossReportModal] = useState(false);

  // Step 5: Tare Weight states (Requirement 6.2)
  const [tareVehicleNo, setTareVehicleNo] = useState('');
  const [tareDcNo, setTareDcNo] = useState('');
  const [tareDate, setTareDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [tareTime, setTareTime] = useState('03:15');
  const [tareAmPm, setTareAmPm] = useState<'AM' | 'PM'>('PM');
  const [tareWeightKg, setTareWeightKg] = useState('');
  const [tareSlip, setTareSlip] = useState('');
  const [tareRemarks, setTareRemarks] = useState('');

  // Step 7: Tanker Out states (Requirement 6.3)
  const [exitVehicleNo, setExitVehicleNo] = useState('');
  const [exitDcNo, setExitDcNo] = useState('');
  const [exitDate, setExitDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [exitTime, setExitTime] = useState('04:00');
  const [exitAmPm, setExitAmPm] = useState<'AM' | 'PM'>('PM');
  const [gatePassNo, setGatePassNo] = useState('');
  const [securityGuardName, setSecurityGuardName] = useState('K. Muthu (Security)');
  const [exitRemarks, setExitRemarks] = useState('');

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

      // Gross Weight Entry Form Initializations (Matching Aavin IDMS Gross Weight photo)
      const vNo = activeTanker.tanker_number || '';
      setGrossVehicleNo(vNo);

      const resolvedDc =
        activeTanker.dc_number ||
        activeTanker.stage_data?.dc_number ||
        activeTanker.stage_data?.dc_no ||
        activeTanker.stage_data?.vehicle_entered?.dc_number ||
        activeTanker.journey?.dc_number ||
        '';
      setGrossDcNo(resolvedDc || '012748');

      const bmcName = activeTanker.units?.name || 'MALLUR VADAKADU BMC';
      const bmcCode = activeTanker.units?.unit_code || '17226';
      const primaryBmcTag = `${bmcName} [${bmcCode}]`;

      const storedReceived = activeTanker.stage_data?.gross_weight?.received_from;
      if (Array.isArray(storedReceived) && storedReceived.length > 0) {
        setGrossReceivedFromList(storedReceived);
      } else {
        setGrossReceivedFromList([
          primaryBmcTag,
          'ARIYANOOR [CC_BMC75]',
          'VEERAPANDI BMC [17225]',
        ]);
      }

      // Format Date to DD/MM/YYYY
      const rawDate = activeTanker.stage_data?.vehicle_entered?.entry_date || activeTanker.date || getLocalTodayIso();
      const dParts = rawDate.split('-');
      if (dParts.length === 3) {
        setGrossDate(`${dParts[2]}/${dParts[1]}/${dParts[0]}`);
      } else {
        setGrossDate(rawDate);
      }

      // Parse entry time for Gross Weight
      const rawEntryTime = activeTanker.stage_data?.vehicle_entered?.entry_time || '';
      if (rawEntryTime) {
        const isPm = rawEntryTime.toUpperCase().includes('PM');
        const isAm = rawEntryTime.toUpperCase().includes('AM');
        const cleanT = rawEntryTime.replace(/(AM|PM)/gi, '').trim();
        const tParts = cleanT.split(':');
        const h = parseInt(tParts[0], 10) || 2;
        const m = tParts[1] || '14';
        setGrossEntryTime(`${String(h > 12 ? h - 12 : h === 0 ? 12 : h).padStart(2, '0')}:${m}`);
        setGrossEntryAmPm(isPm ? 'PM' : isAm ? 'AM' : (h >= 12 ? 'PM' : 'AM'));
      } else {
        setGrossEntryTime('02:14');
        setGrossEntryAmPm('PM');
      }

      const rawDispatchedLitres =
        activeTanker.quantity_dispatched ||
        activeTanker.stage_data?.vehicle_entered?.quantity_dispatched ||
        '';
      setGrossDispatchQty(rawDispatchedLitres ? String(rawDispatchedLitres) : '9000.0');

      const existingGrossKg =
        activeTanker.gross_weight_kg ||
        activeTanker.stage_data?.gross_weight?.gross_weight_kg ||
        activeTanker.journey?.calculated?.gross_weight_kg ||
        '';
      setGrossWeightKg(existingGrossKg ? String(existingGrossKg) : '');

      const existingSlip =
        activeTanker.stage_data?.gross_weight?.weighbridge_slip_no ||
        '';
      setWeighbridgeSlip(existingSlip || '');

      // Compartments
      const comps =
        activeTanker.compartments ||
        activeTanker.stage_data?.compartments ||
        activeTanker.journey?.compartments ||
        [];

      const numCells = comps.length > 0 ? comps.length : (activeTanker.stage_data?.gross_weight?.number_of_cells || 2);
      setNumberOfCells(numCells);

      const cellLabels = numCells === 1 ? ['FC'] : numCells === 2 ? ['FC', 'BC'] : numCells === 3 ? ['FC', 'MC', 'BC'] : ['FC', 'MC 1', 'MC 2', 'BC'];
      const defaultQtyPerCell = rawDispatchedLitres
        ? String(Math.round(Number(rawDispatchedLitres) / (numCells || 1)))
        : '4500';

      const initialRows: GrossQualityRow[] = [];
      if (comps.length > 0) {
        comps.forEach((c: any, i: number) => {
          initialRows.push({
            id: `comp_${i}_${Date.now()}`,
            cell: cellLabels[i] || `C${i + 1}`,
            bmc: c.bmc_name || activeTanker.units?.name || (i === 0 ? 'ARIYANOOR' : 'MALLUR VADAKADU B'),
            fat: c.fat_percentage != null ? String(c.fat_percentage) : (4.30 - i * 0.1).toFixed(2),
            snf: c.snf_percentage != null ? String(c.snf_percentage) : (8.45 - i * 0.05).toFixed(2),
            temp: c.temperature != null ? String(c.temperature) : (4.0 + i * 0.2).toFixed(1),
            qty: c.quantity_litres != null ? String(c.quantity_litres) : defaultQtyPerCell,
            dcNo: resolvedDc || '012748',
          });
        });
      } else {
        // Matching authentic photo sample (FC with 2 rows: Ariyanoor & Veerapandi, BC with 1 row: Mallur Vadakadu)
        initialRows.push({
          id: 'fc_1',
          cell: 'FC',
          bmc: 'ARIYANOOR',
          fat: '4.30',
          snf: '8.45',
          temp: '4.0',
          qty: '4500',
          dcNo: resolvedDc || '012748',
        });
        initialRows.push({
          id: 'fc_2',
          cell: 'FC',
          bmc: 'VEERAPANDI BMC',
          fat: '4.25',
          snf: '8.42',
          temp: '4.1',
          qty: '4500',
          dcNo: resolvedDc || '012748',
        });
        initialRows.push({
          id: 'bc_1',
          cell: 'BC',
          bmc: 'MALLUR VADAKADU B',
          fat: '4.20',
          snf: '8.40',
          temp: '4.2',
          qty: '4500',
          dcNo: resolvedDc || '012748',
        });
      }
      setGrossQualityRows(initialRows);
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

  const handleNumberOfCellsChange = (newCount: number) => {
    const count = Math.max(1, Math.min(4, newCount || 1));
    setNumberOfCells(count);
    const cellLabels = count === 1 ? ['FC'] : count === 2 ? ['FC', 'BC'] : count === 3 ? ['FC', 'MC', 'BC'] : ['FC', 'MC 1', 'MC 2', 'BC'];
    const sampleBmcs = ['ARIYANOOR', 'VEERAPANDI BMC', 'MALLUR VADAKADU B'];
    const defaultQty = grossDispatchQty ? String(Math.round(Number(grossDispatchQty) / count)) : '4500';

    setGrossQualityRows((prev) => {
      const next: GrossQualityRow[] = [];
      for (let i = 0; i < count; i++) {
        const cell = cellLabels[i] || `Cell ${i + 1}`;
        const existing = prev.find((p) => p.cell === cell) || prev[i];
        next.push({
          id: existing?.id || `${cell}_${i}`,
          cell,
          bmc: existing?.bmc || sampleBmcs[i % sampleBmcs.length] || activeTanker?.units?.name || 'BMC',
          fat: existing?.fat || (4.30 - i * 0.1).toFixed(2),
          snf: existing?.snf || (8.45 - i * 0.05).toFixed(2),
          temp: existing?.temp || (4.0 + i * 0.2).toFixed(1),
          qty: existing?.qty || defaultQty,
          dcNo: existing?.dcNo || grossDcNo || '012748',
        });
      }
      return next;
    });
  };

  const updateQualityRow = (id: string, field: keyof GrossQualityRow, value: string) => {
    setGrossQualityRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const addRowToCell = (cellName: string) => {
    setGrossQualityRows((prev) => [
      ...prev,
      {
        id: `${cellName}_${Date.now()}`,
        cell: cellName,
        bmc: activeTanker?.units?.name || 'BMC',
        fat: '4.25',
        snf: '8.40',
        temp: '4.0',
        qty: '4500',
        dcNo: grossDcNo || '012748',
      },
    ]);
  };

  const deleteQualityRow = (id: string) => {
    setGrossQualityRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleUpdateGrossWeight = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTanker) return;
    const kg = Number(grossWeightKg);
    if (!kg || kg <= 0) {
      setError('Please enter a valid Gross Weight (Kgs)');
      return;
    }
    const slip = weighbridgeSlip.trim() || `WB-GROSS-${Math.floor(1000 + Math.random() * 9000)}`;
    setWeighbridgeSlip(slip);

    await handleRecordStage('gross_weight', {
      gross_weight_kg: kg,
      weighbridge_slip_no: slip,
      number_of_cells: numberOfCells,
      gross_date: grossDate,
      entry_time: `${grossEntryTime} ${grossEntryAmPm}`,
      dispatch_quantity: Number(grossDispatchQty) || activeTanker.quantity_dispatched,
      dispatch_quality: grossQualityRows,
      received_from: grossReceivedFromList,
      dc_number: grossDcNo,
      vehicle_number: grossVehicleNo || activeTanker.tanker_number,
    });
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
            <button
              type="button"
              onClick={() => setGateSubTab('receipt')}
              style={{
                backgroundColor: (gateSubTab === 'receipt' || (!gateSubTab && currentStageKey === 'vehicle_entered')) ? '#ffffff' : 'transparent',
                color: (gateSubTab === 'receipt' || (!gateSubTab && currentStageKey === 'vehicle_entered')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (gateSubTab === 'receipt' || (!gateSubTab && currentStageKey === 'vehicle_entered')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Milk Receipt Entry ▾
            </button>
            <button
              type="button"
              onClick={() => setGateSubTab('gross')}
              style={{
                backgroundColor: (gateSubTab === 'gross' || (!gateSubTab && currentStageKey === 'gross_weight')) ? '#ffffff' : 'transparent',
                color: (gateSubTab === 'gross' || (!gateSubTab && currentStageKey === 'gross_weight')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (gateSubTab === 'gross' || (!gateSubTab && currentStageKey === 'gross_weight')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Gross Weight Entry
            </button>
            <button
              type="button"
              onClick={() => setGateSubTab('tare')}
              style={{
                backgroundColor: (gateSubTab === 'tare' || (!gateSubTab && currentStageKey === 'tare_weight')) ? '#ffffff' : 'transparent',
                color: (gateSubTab === 'tare' || (!gateSubTab && currentStageKey === 'tare_weight')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (gateSubTab === 'tare' || (!gateSubTab && currentStageKey === 'tare_weight')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Tare Weight Entry
            </button>
            <button
              type="button"
              onClick={() => setGateSubTab('exit')}
              style={{
                backgroundColor: (gateSubTab === 'exit' || (!gateSubTab && currentStageKey === 'vehicle_exit')) ? '#ffffff' : 'transparent',
                color: (gateSubTab === 'exit' || (!gateSubTab && currentStageKey === 'vehicle_exit')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (gateSubTab === 'exit' || (!gateSubTab && currentStageKey === 'vehicle_exit')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Tanker Out
            </button>
            <button
              type="button"
              onClick={() => setShowNewTankerModal(true)}
              style={{
                backgroundColor: 'transparent',
                color: '#bbf7d0',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              + New Tanker Registration
            </button>
          </div>

          {/* Gate Action Form depending on journey state */}
          <div
            className="card"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '0 0 8px 8px',
              border: '1px solid #cbd5e1',
              borderTop: 'none',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              overflow: 'hidden',
            }}
          >
            {/* STAGE 1: VEHICLE ENTRY DETAILS (Matching photo layout) */}
            {(gateSubTab === 'receipt' || (!gateSubTab && currentStageKey === 'vehicle_entered')) && (
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
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                      <label style={{ fontWeight: 600, color: '#475569' }}>Receiving Dairy</label>
                      <div style={{ fontWeight: 700, color: '#1e293b', padding: '0.35rem 0' }}>
                        NAMAKKAL DAIRY
                      </div>
                    </div>

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

            {/* STAGE 2: VEHICLE GROSS WEIGHT DETAILS (Matching user photo) */}
            {(gateSubTab === 'gross' || (!gateSubTab && currentStageKey === 'gross_weight')) && (
              <div>
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
                  VEHICLE GROSS WEIGHT DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form onSubmit={handleUpdateGrossWeight}>
                    {/* Vehicle No */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={grossVehicleNo}
                          onChange={(e) => setGrossVehicleNo(e.target.value.toUpperCase())}
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
                          {grossVehicleNo || activeTanker.tanker_number}
                        </span>
                      </div>
                    </div>

                    {/* Received From : */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {grossReceivedFromList.map((bmc, idx) => (
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

                    {/* DC NO: */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        DC NO:
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          value={grossDcNo}
                          onChange={(e) => setGrossDcNo(e.target.value.toUpperCase())}
                          style={{
                            width: 150,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                            fontWeight: 600,
                          }}
                        />
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span>
                      </div>
                    </div>

                    {/* Number of Cells */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Number of Cells
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={4}
                        value={numberOfCells}
                        onChange={(e) => handleNumberOfCellsChange(Number(e.target.value))}
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

                    {/* Gross Weight Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Gross Weight Date
                      </label>
                      <input
                        type="text"
                        value={grossDate}
                        onChange={(e) => setGrossDate(e.target.value)}
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

                    {/* Entry Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Entry Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={grossEntryTime}
                          onChange={(e) => setGrossEntryTime(e.target.value)}
                          placeholder="02:14"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={grossEntryAmPm}
                          onChange={(e) => setGrossEntryAmPm(e.target.value as 'AM' | 'PM')}
                          style={{
                            width: 60,
                            height: 28,
                            padding: '2px 4px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        >
                          <option value="AM">AM</option>
                          <option value="PM">PM</option>
                        </select>
                      </div>
                    </div>

                    {/* Dispatch Quantity(Ltrs) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Dispatch Quantity(Ltrs)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={grossDispatchQty}
                        onChange={(e) => setGrossDispatchQty(e.target.value)}
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

                    {/* Gross Weight(Kgs) */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 700, color: '#0f172a', fontSize: '0.92rem' }}>
                        Gross Weight(Kgs) <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="number"
                          placeholder="e.g. 24500"
                          value={grossWeightKg}
                          onChange={(e) => setGrossWeightKg(e.target.value)}
                          required
                          style={{
                            width: 150,
                            height: 32,
                            padding: '4px 8px',
                            border: '2px solid #0284c7',
                            borderRadius: 3,
                            fontWeight: 700,
                            fontSize: '1rem',
                            color: '#0f172a',
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>Slip No:</span>
                          <input
                            value={weighbridgeSlip}
                            onChange={(e) => setWeighbridgeSlip(e.target.value)}
                            placeholder="e.g. WB-GROSS-1002"
                            style={{
                              width: 140,
                              height: 26,
                              padding: '2px 6px',
                              border: '1px solid #cbd5e1',
                              borderRadius: 3,
                              fontSize: '0.8rem',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Dispatch Quality */}
                    <div style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
                        Dispatch Quality
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {Array.from(new Set(grossQualityRows.map((r) => r.cell))).map((cellName) => {
                          const cellRows = grossQualityRows.filter((r) => r.cell === cellName);
                          return (
                            <div key={cellName} style={{ marginBottom: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                                <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>{cellName}</strong>
                                <button
                                  type="button"
                                  onClick={() => addRowToCell(cellName)}
                                  style={{
                                    background: 'none',
                                    border: '1px dashed #94a3b8',
                                    borderRadius: 3,
                                    padding: '1px 8px',
                                    fontSize: '0.72rem',
                                    color: '#0369a1',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                  }}
                                >
                                  + Add {cellName} Entry
                                </button>
                              </div>

                              {cellRows.map((row) => (
                                <div
                                  key={row.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '6px',
                                    flexWrap: 'wrap',
                                    fontSize: '0.85rem',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 55 }}>CC/BMC</span>
                                    <input
                                      value={row.bmc}
                                      onChange={(e) => updateQualityRow(row.id, 'bmc', e.target.value)}
                                      style={{ width: 140, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155' }}>Fat</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={row.fat}
                                      onChange={(e) => updateQualityRow(row.id, 'fat', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155' }}>SNF</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={row.snf}
                                      onChange={(e) => updateQualityRow(row.id, 'snf', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155' }}>TEMP</span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={row.temp}
                                      onChange={(e) => updateQualityRow(row.id, 'temp', e.target.value)}
                                      style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                    <span style={{ color: '#64748b' }}>°C</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155' }}>Quantity</span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={row.qty}
                                      onChange={(e) => updateQualityRow(row.id, 'qty', e.target.value)}
                                      style={{ width: 75, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155' }}>DC No</span>
                                    <input
                                      value={row.dcNo}
                                      onChange={(e) => updateQualityRow(row.id, 'dcNo', e.target.value)}
                                      style={{ width: 75, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  {cellRows.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => deleteQualityRow(row.id)}
                                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.9rem', padding: '0 4px' }}
                                      title="Remove entry"
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Buttons matching photo */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '1.5rem', paddingTop: '0.5rem' }}>
                      <button
                        type="submit"
                        disabled={submitting || !grossWeightKg}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '5px 16px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: submitting || !grossWeightKg ? 'not-allowed' : 'pointer',
                          opacity: submitting || !grossWeightKg ? 0.7 : 1,
                        }}
                      >
                        {submitting ? 'Updating…' : 'Update'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowGrossReportModal(true)}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '5px 16px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                        }}
                      >
                        Gross Weight Report
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* STAGE 5: TARE WEIGHT (WEIGHBRIDGE) - Requirement 6.2 */}
            {(gateSubTab === 'tare' || (!gateSubTab && currentStageKey === 'tare_weight')) && (
              <div>
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
                  VEHICLE TARE WEIGHT DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const kg = Number(tareWeightKg);
                      if (!kg || kg <= 0) {
                        setError('Please enter a valid Tare Weight (Kgs)');
                        return;
                      }
                      const slip = tareSlip.trim() || `WB-TARE-${Math.floor(1000 + Math.random() * 9000)}`;
                      void handleRecordStage('tare_weight', {
                        tare_weight_kg: kg,
                        tare_slip_no: slip,
                        tare_date: tareDate,
                        tare_time: `${tareTime} ${tareAmPm}`,
                        remarks: tareRemarks.trim() || undefined,
                        dc_number: tareDcNo || activeTanker.dc_number,
                      });
                    }}
                  >
                    {/* 1. Vehicle No */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={tareVehicleNo || activeTanker.tanker_number || ''}
                          onChange={(e) => setTareVehicleNo(e.target.value.toUpperCase())}
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
                          {tareVehicleNo || activeTanker.tanker_number}
                        </span>
                      </div>
                    </div>

                    {/* 2. Received From */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {grossReceivedFromList.map((bmc, idx) => (
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

                    {/* 3. DC NO */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        DC NO: <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        value={tareDcNo || activeTanker.dc_number || ''}
                        onChange={(e) => setTareDcNo(e.target.value)}
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

                    {/* 4. Tare Weight Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Tare Weight Date
                      </label>
                      <input
                        value={tareDate}
                        onChange={(e) => setTareDate(e.target.value)}
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

                    {/* 5. Tare Weight Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Tare Weight Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={tareTime}
                          onChange={(e) => setTareTime(e.target.value)}
                          placeholder="03:15"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={tareAmPm}
                          onChange={(e) => setTareAmPm(e.target.value as any)}
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

                    {/* 6. Gross Weight(Kgs) - Readonly */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Gross Weight(Kgs)
                      </label>
                      <input
                        value={grossWeightKg || activeTanker.gross_weight_kg || journey.calculated?.gross_weight_kg || ''}
                        readOnly
                        style={{
                          width: 150,
                          height: 28,
                          padding: '2px 8px',
                          backgroundColor: '#f1f5f9',
                          border: '1px solid #cbd5e1',
                          borderRadius: 3,
                          fontWeight: 700,
                          color: '#334155',
                        }}
                      />
                    </div>

                    {/* 7. Tare Weight(Kgs) - Required */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 700, color: '#0f172a', fontSize: '0.92rem' }}>
                        Tare Weight(Kgs) <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="number"
                          placeholder="e.g. 15200"
                          value={tareWeightKg}
                          onChange={(e) => setTareWeightKg(e.target.value)}
                          required
                          style={{
                            width: 150,
                            height: 32,
                            padding: '4px 8px',
                            border: '2px solid #0284c7',
                            borderRadius: 3,
                            fontWeight: 700,
                            fontSize: '1rem',
                            color: '#0f172a',
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: '#64748b' }}>
                          <span>Tare Slip No:</span>
                          <input
                            value={tareSlip}
                            onChange={(e) => setTareSlip(e.target.value)}
                            placeholder="e.g. WB-TARE-1002"
                            style={{
                              width: 140,
                              height: 26,
                              padding: '2px 6px',
                              border: '1px solid #cbd5e1',
                              borderRadius: 3,
                              fontSize: '0.8rem',
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 8. Net Milk Weight(Kgs) - Auto Calculated */}
                    {grossWeightKg && tareWeightKg && Number(grossWeightKg) > Number(tareWeightKg) && (
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                          Net Milk Weight(Kgs)
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <input
                            value={Number(grossWeightKg) - Number(tareWeightKg)}
                            readOnly
                            style={{
                              width: 150,
                              height: 28,
                              padding: '2px 8px',
                              backgroundColor: '#f0fdf4',
                              border: '1px solid #86efac',
                              borderRadius: 3,
                              fontWeight: 700,
                              color: '#15803d',
                            }}
                          />
                          <span style={{ fontSize: '0.82rem', color: '#15803d', fontWeight: 600 }}>
                            (~{(((Number(grossWeightKg) - Number(tareWeightKg)) / 1.030)).toFixed(1)} L at 1.030 density)
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 9. Remarks */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                        Remarks
                      </label>
                      <textarea
                        rows={2}
                        value={tareRemarks}
                        onChange={(e) => setTareRemarks(e.target.value)}
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

                    {/* Action Button matching Aavin IDMS */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '0.5rem' }}>
                      <button
                        type="submit"
                        disabled={submitting || !tareWeightKg}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '6px 20px',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          cursor: submitting || !tareWeightKg ? 'not-allowed' : 'pointer',
                          opacity: submitting || !tareWeightKg ? 0.7 : 1,
                        }}
                      >
                        {submitting ? 'Updating…' : 'Update'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* STAGE 7: TANKER OUT DETAILS - Requirement 6.3 */}
            {(gateSubTab === 'exit' || (!gateSubTab && currentStageKey === 'vehicle_exit')) && (
              <div>
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
                  TANKER OUT DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleRecordStage('vehicle_exit', {
                        gate_pass_number: gatePassNo.trim() || `GP-${Date.now().toString().slice(-6)}`,
                        exit_date: exitDate,
                        exit_time: `${exitTime} ${exitAmPm}`,
                        security_guard_name: securityGuardName.trim(),
                        remarks: exitRemarks.trim() || undefined,
                        dc_number: exitDcNo || activeTanker.dc_number,
                      });
                    }}
                  >
                    {/* 1. Vehicle No */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={exitVehicleNo || activeTanker.tanker_number || ''}
                          onChange={(e) => setExitVehicleNo(e.target.value.toUpperCase())}
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
                          {exitVehicleNo || activeTanker.tanker_number}
                        </span>
                      </div>
                    </div>

                    {/* 2. Received From */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {grossReceivedFromList.map((bmc, idx) => (
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

                    {/* 3. DC NO */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        DC NO: <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        value={exitDcNo || activeTanker.dc_number || ''}
                        onChange={(e) => setExitDcNo(e.target.value)}
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

                    {/* 4. Exit Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Exit Date
                      </label>
                      <input
                        value={exitDate}
                        onChange={(e) => setExitDate(e.target.value)}
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

                    {/* 5. Exit Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Exit Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={exitTime}
                          onChange={(e) => setExitTime(e.target.value)}
                          placeholder="04:00"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={exitAmPm}
                          onChange={(e) => setExitAmPm(e.target.value as any)}
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

                    {/* 6. Gate Pass Number */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Gate Pass Number <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <input
                        value={gatePassNo}
                        onChange={(e) => setGatePassNo(e.target.value)}
                        placeholder="e.g. GP-884920"
                        style={{
                          width: 180,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontWeight: 700,
                        }}
                      />
                    </div>

                    {/* 7. Security Guard Name */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Security Guard Name
                      </label>
                      <input
                        value={securityGuardName}
                        onChange={(e) => setSecurityGuardName(e.target.value)}
                        style={{
                          width: 200,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* 8. Remarks */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                        Remarks
                      </label>
                      <textarea
                        rows={2}
                        value={exitRemarks}
                        onChange={(e) => setExitRemarks(e.target.value)}
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

      {/* GROSS WEIGHT REPORT MODAL (Matching photo button action) */}
      {showGrossReportModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 680, padding: '1.5rem', background: '#ffffff', borderRadius: 8, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #0f172a', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 800, color: '#0f172a', letterSpacing: '0.02em' }}>
                  TAMIL NADU CO-OPERATIVE MILK PRODUCERS FEDERATION (AAVIN)
                </h3>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#475569', marginTop: 2 }}>
                  NAMAKKAL DAIRY PLANT — OFFICIAL WEIGHBRIDGE GROSS SLIP
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGrossReportModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1.25rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', background: '#f8fafc', padding: '0.75rem', borderRadius: 6, fontSize: '0.82rem', marginBottom: '1rem', border: '1px solid #e2e8f0' }}>
              <div>Vehicle Number: <strong style={{ color: '#0f172a' }}>{grossVehicleNo || activeTanker?.tanker_number}</strong></div>
              <div>DC Number: <strong style={{ color: '#0f172a' }}>{grossDcNo || '—'}</strong></div>
              <div>Gross Weight Date: <strong style={{ color: '#0f172a' }}>{grossDate}</strong></div>
              <div>Entry Time: <strong style={{ color: '#0f172a' }}>{grossEntryTime} {grossEntryAmPm}</strong></div>
              <div>Number of Cells: <strong style={{ color: '#0f172a' }}>{numberOfCells}</strong></div>
              <div>Dispatched Volume: <strong style={{ color: '#0f172a' }}>{grossDispatchQty ? `${grossDispatchQty} L` : '—'}</strong></div>
              <div>Weighbridge Slip: <strong style={{ color: '#0f172a' }}>{weighbridgeSlip || 'WB-GROSS-1002'}</strong></div>
              <div style={{ gridColumn: 'span 2' }}>
                Received From (BMCs): <strong style={{ color: '#0f172a' }}>{grossReceivedFromList.join(', ')}</strong>
              </div>
            </div>

            <div style={{ background: '#ecfdf5', border: '2px solid #059669', padding: '0.85rem', borderRadius: 6, textAlign: 'center', marginBottom: '1.25rem' }}>
              <span style={{ fontSize: '0.78rem', color: '#065f46', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Certified Loaded Gross Weight
              </span>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#047857', marginTop: 2 }}>
                {grossWeightKg ? `${Number(grossWeightKg).toLocaleString('en-IN')} kg` : '—'}
              </div>
            </div>

            <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
              Dispatch Quality Breakdown
            </h5>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: '1.25rem' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px' }}>Cell</th>
                  <th style={{ padding: '6px 8px' }}>CC / BMC</th>
                  <th style={{ padding: '6px 8px' }}>Fat %</th>
                  <th style={{ padding: '6px 8px' }}>SNF %</th>
                  <th style={{ padding: '6px 8px' }}>Temp</th>
                  <th style={{ padding: '6px 8px' }}>Qty (L)</th>
                  <th style={{ padding: '6px 8px' }}>DC No</th>
                </tr>
              </thead>
              <tbody>
                {grossQualityRows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700 }}>{r.cell}</td>
                    <td style={{ padding: '6px 8px' }}>{r.bmc}</td>
                    <td style={{ padding: '6px 8px' }}>{r.fat}</td>
                    <td style={{ padding: '6px 8px' }}>{r.snf}</td>
                    <td style={{ padding: '6px 8px' }}>{r.temp}°C</td>
                    <td style={{ padding: '6px 8px' }}>{r.qty}</td>
                    <td style={{ padding: '6px 8px' }}>{r.dcNo}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px dashed #cbd5e1' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Weighbridge Operator: <strong>Bose (AV_GT_001)</strong>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                >
                  🖨️ Print Slip
                </button>
                <button
                  type="button"
                  onClick={() => setShowGrossReportModal(false)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 1rem' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewTankerModal && (
        <NewTankerRegistrationModal
          isOpen={showNewTankerModal}
          onClose={() => setShowNewTankerModal(false)}
          onSuccess={() => {
            setShowNewTankerModal(false);
            void fetchTankers();
          }}
        />
      )}
    </div>
  );
}
