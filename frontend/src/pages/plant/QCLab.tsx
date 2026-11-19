import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { TankerTimeline } from '../../components/TankerTimeline';
import { formatFatSnf, formatLitres, getLocalTodayIso } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';

export interface QcDispatchQuality {
  cell: string; // 'FC' | 'BC' | 'MC'
  fat: string;
  snf: string;
  clr: string;
  acidity: string;
  temp: string;
  milkType: string;
  qty: string;
}

export type AdulterationTestResult = 'Positive' | 'Negative' | 'Not Tested';

export interface QcCellTests {
  // A. Freshness Test
  freshnessTemp: string;
  freshnessOrganoleptic: 'Satisfied' | 'Unsatisfied';
  freshnessChemist: string;

  // B. SNF Adulteration Test
  sugarTest: AdulterationTestResult;
  starchTest: AdulterationTestResult;
  maltoseTest: AdulterationTestResult;
  saltTest: AdulterationTestResult;
  ureaTest: AdulterationTestResult;
  neutralizersTest: AdulterationTestResult;
  waterTest: AdulterationTestResult;
  ammoniumSulphateTest: AdulterationTestResult;
  abnormalTest: AdulterationTestResult;
  snfChemist: string;

  // C. Special Test
  antibioticTest: AdulterationTestResult;
  aflatoxinTest: AdulterationTestResult;
  specialChemist: string;

  // D. FAT Adulteration Test
  freeFattyAcid: string;
  brReading: string;
  motTest: AdulterationTestResult;
  rmValue: string;
  fatChemist: string;
}

export function getDefaultCellTests(chemist = 'S. Ramesh (QC Chemist)'): QcCellTests {
  return {
    freshnessTemp: '4.0',
    freshnessOrganoleptic: 'Satisfied',
    freshnessChemist: chemist,

    sugarTest: 'Negative',
    starchTest: 'Negative',
    maltoseTest: 'Negative',
    saltTest: 'Negative',
    ureaTest: 'Negative',
    neutralizersTest: 'Negative',
    waterTest: 'Negative',
    ammoniumSulphateTest: 'Negative',
    abnormalTest: 'Negative',
    snfChemist: chemist,

    antibioticTest: 'Negative',
    aflatoxinTest: 'Negative',
    specialChemist: chemist,

    freeFattyAcid: '0.12',
    brReading: '41.2',
    motTest: 'Negative',
    rmValue: '28.5',
    fatChemist: chemist,
  };
}

export interface QcReceivedQuality {
  cell: string; // 'FC' | 'BC' | 'MC'
  purpose: string;
  cps: string;
  fat: string;
  snf: string;
  clr: string;
  acidity: string;
  temp: string;
  seal: string;
  mbrt: string;
  sampleDate: string;
  sampleTime: string;
  spGr: string;
  cob: 'Negative' | 'Positive';
  milkType: string;
  cellRejected: boolean;
  qty?: string;
}

export default function QCLab() {
  const { lang } = useTranslation();
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');

  // Sub-navigation tab: Quality Control Details vs CIP Sanitization
  const [qcSubTab, setQcSubTab] = useState<'qc' | 'cip' | null>(null);

  // Quality Control Form States (Matching authentic Aavin IDMS QC photo)
  const [qcVehicleNo, setQcVehicleNo] = useState('');
  const [qcReceivedFromList, setQcReceivedFromList] = useState<string[]>([]);
  const [qcDcNo, setQcDcNo] = useState('');
  const [qcDispatchDate, setQcDispatchDate] = useState('');
  const [qcDispatchTime, setQcDispatchTime] = useState('01:00');
  const [qcDispatchAmPm, setQcDispatchAmPm] = useState<'AM' | 'PM'>('PM');
  const [qcDate, setQcDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [qcTime, setQcTime] = useState('02:33');
  const [qcTimeAmPm, setQcTimeAmPm] = useState<'AM' | 'PM'>('PM');

  // Dispatch Quality per cell
  const [dispatchQualityList, setDispatchQualityList] = useState<QcDispatchQuality[]>([]);

  // Received Quality per cell
  const [receivedQualityList, setReceivedQualityList] = useState<QcReceivedQuality[]>([]);

  // Meta & Tests
  const [manualEntryReason, setManualEntryReason] = useState('');
  const [testTypes, setTestTypes] = useState<Record<string, string>>({});
  const [qcRemarks, setQcRemarks] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // 3.5 Select Test: 4 test categories separately for FC and BC
  const [cellTests, setCellTests] = useState<Record<string, QcCellTests>>({
    FC: getDefaultCellTests(),
    BC: getDefaultCellTests(),
  });
  const [selectedTestCellTab, setSelectedTestCellTab] = useState<string>('FC');

  const updateCellTest = <K extends keyof QcCellTests>(cell: string, field: K, val: QcCellTests[K]) => {
    setCellTests((prev) => ({
      ...prev,
      [cell]: {
        ...(prev[cell] || getDefaultCellTests()),
        [field]: val,
      },
    }));
  };

  // CIP Details Form States (Matching authentic Aavin IDMS CIP photo)
  const [cipVehicleNo, setCipVehicleNo] = useState('');
  const [cipReceivedFromList, setCipReceivedFromList] = useState<string[]>([]);
  const [cipDcNo, setCipDcNo] = useState('');
  const [cipDispatchDate, setCipDispatchDate] = useState('');
  const [cipDispatchTime, setCipDispatchTime] = useState('12:05');
  const [cipDispatchAmPm, setCipDispatchAmPm] = useState<'AM' | 'PM'>('AM');
  const [cipDate, setCipDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${mon}/${d.getFullYear()}`;
  });
  const [cipTime, setCipTime] = useState('02:35');
  const [cipTimeAmPm, setCipTimeAmPm] = useState<'AM' | 'PM'>('PM');
  const [cipOperator, setCipOperator] = useState('');
  const [qcInspection, setQcInspection] = useState('SATISFIED');
  const [cipAutomaticTest, setCipAutomaticTest] = useState(false);
  const [cipManualTest, setCipManualTest] = useState(false);
  const [isCipChecked, setIsCipChecked] = useState(false);
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

  // Pre-fill QC details when active tanker changes
  useEffect(() => {
    if (activeTanker) {
      setQcVehicleNo(activeTanker.tanker_number || '');

      const resolvedDc =
        activeTanker.dc_number ||
        activeTanker.stage_data?.dc_number ||
        activeTanker.stage_data?.dc_no ||
        activeTanker.stage_data?.gross_weight?.dc_number ||
        activeTanker.stage_data?.vehicle_entered?.dc_number ||
        activeTanker.journey?.dc_number ||
        '106451';
      setQcDcNo(resolvedDc);

      const bmcName = activeTanker.units?.name || 'KRISHANAMPUDUR';
      const bmcCode = activeTanker.units?.unit_code || 'CC_BMC87';
      const primaryBmcTag = `${bmcName} [${bmcCode}]`;
      const storedReceived =
        activeTanker.stage_data?.gross_weight?.received_from ||
        activeTanker.stage_data?.qc_completed?.received_from;

      if (Array.isArray(storedReceived) && storedReceived.length > 0) {
        setQcReceivedFromList(storedReceived);
      } else {
        setQcReceivedFromList([
          primaryBmcTag,
          'ADAIYUR BMC [17218]',
          'CHITHOOR BMC [17193]',
        ]);
      }

      // Dispatch date & time
      const rawDispDate =
        activeTanker.date ||
        activeTanker.stage_data?.vehicle_entered?.dispatch_date ||
        getLocalTodayIso();
      const dParts = rawDispDate.split('-');
      setQcDispatchDate(dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : rawDispDate);

      const rawDispTime =
        activeTanker.dispatch_time ||
        activeTanker.stage_data?.dispatch_time ||
        activeTanker.stage_data?.vehicle_entered?.dispatch_time ||
        '01:00 PM';
      if (rawDispTime) {
        const isPm = rawDispTime.toUpperCase().includes('PM');
        const isAm = rawDispTime.toUpperCase().includes('AM');
        const cleanT = rawDispTime.replace(/(AM|PM)/gi, '').trim();
        const tParts = cleanT.split(':');
        const h = parseInt(tParts[0], 10) || 1;
        const m = tParts[1] || '00';
        setQcDispatchTime(`${String(h > 12 ? h - 12 : h === 0 ? 12 : h).padStart(2, '0')}:${m}`);
        setQcDispatchAmPm(isPm ? 'PM' : isAm ? 'AM' : (h >= 12 ? 'PM' : 'AM'));
      }

      // QC date & time
      const todayIso = getLocalTodayIso();
      const tParts2 = todayIso.split('-');
      setQcDate(tParts2.length === 3 ? `${tParts2[2]}/${tParts2[1]}/${tParts2[0]}` : todayIso);

      const now = new Date();
      let nowH = now.getHours();
      const nowAmPm = nowH >= 12 ? 'PM' : 'AM';
      if (nowH > 12) nowH -= 12;
      if (nowH === 0) nowH = 12;
      setQcTime(`${String(nowH).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setQcTimeAmPm(nowAmPm);

      // Compartments
      const comps =
        activeTanker.compartments ||
        activeTanker.stage_data?.compartments ||
        activeTanker.stage_data?.gross_weight?.dispatch_quality ||
        activeTanker.journey?.compartments ||
        [];

      const numCells = comps.length > 0 ? comps.length : 2;
      const cellLabels = numCells === 1 ? ['FC'] : numCells === 2 ? ['FC', 'BC'] : numCells === 3 ? ['FC', 'MC', 'BC'] : ['FC', 'MC 1', 'MC 2', 'BC'];

      const dispList: QcDispatchQuality[] = [];
      const recList: QcReceivedQuality[] = [];

      for (let i = 0; i < numCells; i++) {
        const c = comps[i] || {};
        const cell = cellLabels[i] || `C${i + 1}`;
        const fatVal = c.fat_percentage != null ? String(c.fat_percentage) : (activeTanker.dispatch_fat_pct ? String(activeTanker.dispatch_fat_pct) : (i === 0 ? '4.25' : '4.15'));
        const snfVal = c.snf_percentage != null ? String(c.snf_percentage) : (activeTanker.dispatch_snf_pct ? String(activeTanker.dispatch_snf_pct) : (i === 0 ? '8.1' : '8.05'));
        const clrVal = c.clr != null ? String(c.clr) : (i === 0 ? '27.56' : '27.44');
        const acidityVal = c.acidity != null ? String(c.acidity) : '0';
        const tempVal = c.temperature != null ? String(c.temperature) : '4';
        const milkTypeVal = c.milk_type || 'MIXED MILK';
        const qtyVal = c.quantity_litres != null ? String(c.quantity_litres) : (i === 0 ? '6378' : '5098');
        const sealVal = c.seal_number || (i === 0 ? '018168' : '018167');

        dispList.push({
          cell,
          fat: fatVal,
          snf: snfVal,
          clr: clrVal,
          acidity: acidityVal,
          temp: tempVal,
          milkType: milkTypeVal,
          qty: String(qtyVal),
        });

        recList.push({
          cell,
          purpose: 'SELECT',
          cps: 'SELECT',
          fat: fatVal,
          snf: snfVal,
          clr: clrVal,
          acidity: acidityVal,
          temp: tempVal,
          seal: sealVal,
          mbrt: '45',
          sampleDate: tParts2.length === 3 ? `${tParts2[2]}/${tParts2[1]}/${tParts2[0]}` : todayIso,
          sampleTime: `${String(nowH).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          spGr: '1.030',
          cob: 'Negative',
          milkType: milkTypeVal,
          cellRejected: false,
          qty: String(qtyVal),
        });
      }

      setDispatchQualityList(dispList);
      setReceivedQualityList(recList);
      setManualEntryReason(activeTanker.stage_data?.qc_completed?.manual_entry_reason || '');
      setQcRemarks(activeTanker.stage_data?.qc_completed?.remarks || '');
      setRejectionReason('');

      // CIP Details Pre-fill (Matching authentic Aavin IDMS CIP photo)
      setCipVehicleNo(activeTanker.tanker_number || 'TN28BJ1697');

      const resolvedCipDc =
        activeTanker.stage_data?.cip_completed?.dc_number ||
        activeTanker.stage_data?.gross_weight?.dc_number ||
        activeTanker.stage_data?.qc_completed?.dc_number ||
        activeTanker.dc_number ||
        '015991';
      setCipDcNo(resolvedCipDc);

      const storedCipRec =
        activeTanker.stage_data?.cip_completed?.received_from ||
        activeTanker.stage_data?.gross_weight?.received_from ||
        activeTanker.stage_data?.qc_completed?.received_from;

      if (Array.isArray(storedCipRec) && storedCipRec.length > 0) {
        setCipReceivedFromList(storedCipRec);
      } else {
        const uName = activeTanker.units?.name ? `${activeTanker.units.name} [${activeTanker.units.unit_code || '17210'}]` : 'VANAVASI BMC [17210]';
        setCipReceivedFromList([
          uName,
          'K.KUTTAPATTIYAN TERU BMC [17221]',
        ]);
      }

      const rawCipDispDate =
        activeTanker.stage_data?.cip_completed?.dispatch_date ||
        activeTanker.date ||
        activeTanker.stage_data?.vehicle_entered?.dispatch_date ||
        getLocalTodayIso();
      const cipDParts = rawCipDispDate.includes('-') ? rawCipDispDate.split('-') : null;
      setCipDispatchDate(cipDParts && cipDParts.length === 3 ? `${cipDParts[2]}/${cipDParts[1]}/${cipDParts[0]}` : rawCipDispDate);

      const rawCipDispTime =
        activeTanker.stage_data?.cip_completed?.dispatch_time ||
        activeTanker.dispatch_time ||
        activeTanker.stage_data?.vehicle_entered?.dispatch_time ||
        '12:05 AM';
      if (rawCipDispTime) {
        const isPm = rawCipDispTime.toUpperCase().includes('PM');
        const isAm = rawCipDispTime.toUpperCase().includes('AM');
        const cleanT = rawCipDispTime.replace(/(AM|PM)/gi, '').trim();
        const tParts = cleanT.split(':');
        const h = parseInt(tParts[0], 10) || 12;
        const m = tParts[1] || '05';
        setCipDispatchTime(`${String(h > 12 ? h - 12 : h === 0 ? 12 : h).padStart(2, '0')}:${m}`);
        setCipDispatchAmPm(isPm ? 'PM' : isAm ? 'AM' : (h >= 12 ? 'PM' : 'AM'));
      }

      const cipTodayParts = getLocalTodayIso().split('-');
      setCipDate(
        activeTanker.stage_data?.cip_completed?.cip_date ||
        (cipTodayParts.length === 3 ? `${cipTodayParts[2]}/${cipTodayParts[1]}/${cipTodayParts[0]}` : '19/11/2026')
      );

      setCipTime(
        activeTanker.stage_data?.cip_completed?.cip_time
          ? activeTanker.stage_data.cip_completed.cip_time.slice(0, 5)
          : `${String(nowH).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
      setCipTimeAmPm(
        activeTanker.stage_data?.cip_completed?.cip_time?.toUpperCase().includes('AM')
          ? 'AM'
          : activeTanker.stage_data?.cip_completed?.cip_time?.toUpperCase().includes('PM')
          ? 'PM'
          : nowAmPm
      );

      setCipOperator(activeTanker.stage_data?.cip_completed?.cip_operator || '');
      setQcInspection(activeTanker.stage_data?.cip_completed?.qc_inspection || 'SATISFIED');
      setCipAutomaticTest(activeTanker.stage_data?.cip_completed?.cip_clean_types?.automatic_test ?? false);
      setCipManualTest(activeTanker.stage_data?.cip_completed?.cip_clean_types?.manual_test ?? false);
      setIsCipChecked(activeTanker.stage_data?.cip_completed?.is_cip_checked ?? false);
    }
  }, [activeTanker]);

  const updateDispatchQuality = (idx: number, field: keyof QcDispatchQuality, value: string) => {
    setDispatchQualityList((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const updateReceivedQuality = (idx: number, field: keyof QcReceivedQuality, value: any) => {
    setReceivedQualityList((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleUpdateQc = async () => {
    if (!activeTanker) return;

    // Check if any compartment was marked rejected
    const hasCellRejected = receivedQualityList.some((r) => r.cellRejected);
    if (hasCellRejected) {
      setShowRejectModal(true);
      return;
    }

    let sumFat = 0;
    let sumSnf = 0;
    let sumQty = 0;
    for (const r of receivedQualityList) {
      const q = Number(r.qty) || 1;
      const f = parseFloat(r.fat);
      const s = parseFloat(r.snf);
      if (!isNaN(f) && !isNaN(s) && f > 0 && s > 0) {
        sumQty += q;
        sumFat += f * q;
        sumSnf += s * q;
      }
    }

    const avgFat = sumQty > 0 ? Number((sumFat / sumQty).toFixed(2)) : (parseFloat(receivedQualityList[0]?.fat) || 4.25);
    const avgSnf = sumQty > 0 ? Number((sumSnf / sumQty).toFixed(2)) : (parseFloat(receivedQualityList[0]?.snf) || 8.1);
    const avgTemp = parseFloat(receivedQualityList[0]?.temp || '4.0');

    await handleRecordStage('qc_completed', {
      qc_status: 'accepted',
      accepted: true,
      received_fat_pct: avgFat,
      received_snf_pct: avgSnf,
      temperature: avgTemp,
      dispatch_quality: dispatchQualityList,
      received_quality: receivedQualityList,
      test_categories: cellTests,
      freshness_test: cellTests,
      snf_adulteration_test: cellTests,
      special_test: cellTests,
      fat_adulteration_test: cellTests,
      tests_completed: 'All 4 Categories Tested for FC & BC',
      qc_date: qcDate,
      qc_time: `${qcTime} ${qcTimeAmPm}`,
      manual_entry_reason: manualEntryReason.trim() || undefined,
      remarks: qcRemarks.trim() || undefined,
      test_types: testTypes,
      dc_number: qcDcNo,
      received_from: qcReceivedFromList,
    });
  };

  const handleConfirmRejection = async () => {
    if (!activeTanker) return;
    const finalReason = rejectionReason.trim() || 'Quality parameters failed / Below standard';

    await handleRecordStage('qc_completed', {
      qc_status: 'rejected',
      accepted: false,
      rejection_reason: finalReason,
      dispatch_quality: dispatchQualityList,
      received_quality: receivedQualityList,
      remarks: qcRemarks.trim() || undefined,
      qc_date: qcDate,
      qc_time: `${qcTime} ${qcTimeAmPm}`,
    });
    setShowRejectModal(false);
  };

  const handleUpdateCip = async () => {
    if (!activeTanker) return;
    if (!isCipChecked) {
      setError('Please check "Is CIP Checked" before updating');
      return;
    }

    await handleRecordStage('cip_completed', {
      vehicle_no: cipVehicleNo,
      received_from: cipReceivedFromList,
      dc_number: cipDcNo,
      dispatch_date: cipDispatchDate,
      dispatch_time: `${cipDispatchTime} ${cipDispatchAmPm}`,
      cip_date: cipDate,
      cip_time: `${cipTime} ${cipTimeAmPm}`,
      cip_operator: cipOperator.trim() || undefined,
      qc_inspection: qcInspection,
      cip_clean_types: {
        automatic_test: cipAutomaticTest,
        manual_test: cipManualTest,
      },
      is_cip_checked: isCipChecked,
      cip_status: qcInspection === 'SATISFIED' ? 'pass' : 'fail',
      chemical_used: cipAutomaticTest ? 'Automated CIP 5-Step Cycle' : 'Manual Caustic/Acid Sanitization',
    });
  };

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

  // QC Dashboard Counters & Queue Filters
  // Condition 3: QC queue displays only vehicles for which Gross Weight has been completed
  const qcEligibleTankers = tankers.filter(
    (t) => (t.stage_data?.gross_weight != null || t.journey?.completedStageKeys?.includes('gross_weight')) &&
      !t.stage_data?.qc_completed &&
      t.journey?.tripStatus !== 'qc_rejected'
  );

  // Condition 5: CIP queue displays only vehicles for which Tare Weight has been completed
  const cipEligibleTankers = tankers.filter(
    (t) => (t.stage_data?.tare_weight != null || t.journey?.completedStageKeys?.includes('tare_weight')) &&
      !t.stage_data?.cip_completed
  );

  const isCipActive = qcSubTab === 'cip';
  const displayedQueue = isCipActive
    ? (cipEligibleTankers.length > 0 ? cipEligibleTankers : tankers)
    : (qcEligibleTankers.length > 0 ? qcEligibleTankers : tankers);

  const waitingQcCount = qcEligibleTankers.length || tankers.filter((t) => t.journey?.waitingTeam === 'qc' && t.journey?.currentStageKey === 'qc_completed').length;
  const waitingCipCount = cipEligibleTankers.length || tankers.filter((t) => t.journey?.waitingTeam === 'qc' && t.journey?.currentStageKey === 'cip_completed').length;
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

        <button type="button" onClick={fetchTankers} className="btn btn-secondary" style={{ height: '38px', padding: '0 0.85rem', width: 'auto' }}>
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
        <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', minWidth: '220px' }}>
          {isCipActive ? 'Vehicles Waiting for CIP (Tare Done):' : 'Vehicles Waiting for QC (Gross Done):'}
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
            <option value="">
              {isCipActive
                ? 'No vehicles currently waiting for CIP (Condition: Tare Weight completed)'
                : 'No vehicles currently waiting for QC (Condition: Gross Weight completed)'}
            </option>
          ) : (
            displayedQueue.map((t) => (
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
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Driver &amp; Mobile</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                {activeTanker.driver_name || activeTanker.stage_data?.driver_name || activeTanker.stage_data?.vehicle_entered?.driver_name || '—'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {activeTanker.driver_phone || activeTanker.stage_data?.driver_phone || '—'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Outlet Seal No</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#16a34a' }}>
                {activeTanker.seal_number || activeTanker.stage_data?.seal_number || activeTanker.stage_data?.vehicle_entered?.seal_number || '—'} ✓
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
              activeTanker.stage_data?.vehicle_entered?.compartments ||
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
              onClick={() => setQcSubTab('qc')}
              style={{
                backgroundColor: (qcSubTab === 'qc' || (!qcSubTab && currentStageKey !== 'cip_completed')) ? '#ffffff' : 'transparent',
                color: (qcSubTab === 'qc' || (!qcSubTab && currentStageKey !== 'cip_completed')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (qcSubTab === 'qc' || (!qcSubTab && currentStageKey !== 'cip_completed')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              Milk Receipt Entry ▾
            </button>
            <button
              type="button"
              onClick={() => setQcSubTab('cip')}
              style={{
                backgroundColor: (qcSubTab === 'cip' || (!qcSubTab && currentStageKey === 'cip_completed')) ? '#ffffff' : 'transparent',
                color: (qcSubTab === 'cip' || (!qcSubTab && currentStageKey === 'cip_completed')) ? '#0369a1' : '#f0f9ff',
                border: 'none',
                borderRadius: '4px 4px 0 0',
                padding: '6px 16px',
                fontSize: '0.85rem',
                fontWeight: (qcSubTab === 'cip' || (!qcSubTab && currentStageKey === 'cip_completed')) ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              CIP Details
            </button>
          </div>

          {/* QC Action Form */}
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
            {/* 1. QUALITY CONTROL DETAILS (Matching user photo 1 & 2) */}
            {(qcSubTab === 'qc' || (!qcSubTab && currentStageKey !== 'cip_completed')) && (
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
                  QUALITY CONTROL DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form onSubmit={(e) => { e.preventDefault(); void handleUpdateQc(); }}>
                    {/* Vehicle No */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={qcVehicleNo}
                          onChange={(e) => setQcVehicleNo(e.target.value.toUpperCase())}
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
                          {qcVehicleNo || activeTanker.tanker_number}
                        </span>
                      </div>
                    </div>

                    {/* Received From : */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {qcReceivedFromList.map((bmc, idx) => (
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
                          value={qcDcNo}
                          onChange={(e) => setQcDcNo(e.target.value.toUpperCase())}
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

                    {/* Dispatch Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Dispatch Date
                      </label>
                      <input
                        type="text"
                        value={qcDispatchDate}
                        onChange={(e) => setQcDispatchDate(e.target.value)}
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

                    {/* Dispatch Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Dispatch Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={qcDispatchTime}
                          onChange={(e) => setQcDispatchTime(e.target.value)}
                          placeholder="01:00"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={qcDispatchAmPm}
                          onChange={(e) => setQcDispatchAmPm(e.target.value as any)}
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

                    {/* QC Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        QC Date
                      </label>
                      <input
                        type="text"
                        value={qcDate}
                        onChange={(e) => setQcDate(e.target.value)}
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

                    {/* QC Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        QC Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          value={qcTime}
                          onChange={(e) => setQcTime(e.target.value)}
                          placeholder="02:33"
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={qcTimeAmPm}
                          onChange={(e) => setQcTimeAmPm(e.target.value as any)}
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

                    {/* Dispatch Quality Section (Matching photo) */}
                    <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700, color: '#334155' }}>
                        Dispatch Quality
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {dispatchQualityList.map((row, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                              <strong style={{ minWidth: 28, fontSize: '0.9rem', color: '#0f172a' }}>{row.cell}</strong>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Fat%</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.fat}
                                  onChange={(e) => updateDispatchQuality(idx, 'fat', e.target.value)}
                                  style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>SNF%</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.snf}
                                  onChange={(e) => updateDispatchQuality(idx, 'snf', e.target.value)}
                                  style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>CLR</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.clr}
                                  onChange={(e) => updateDispatchQuality(idx, 'clr', e.target.value)}
                                  style={{ width: 60, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Acidity%</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={row.acidity}
                                  onChange={(e) => updateDispatchQuality(idx, 'acidity', e.target.value)}
                                  style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Temp</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={row.temp}
                                  onChange={(e) => updateDispatchQuality(idx, 'temp', e.target.value)}
                                  style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                                <span style={{ color: '#64748b' }}>°C</span>
                              </div>
                            </div>

                            {/* Second line: Milk Type & Quantity */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginLeft: '42px', fontSize: '0.85rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Milk Type</span>
                                <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '1px 8px', borderRadius: 2, fontWeight: 700, fontSize: '0.78rem', color: '#1e293b' }}>
                                  {row.milkType}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: '#334155' }}>Quantity</span>
                                <input
                                  type="number"
                                  step="1"
                                  value={row.qty}
                                  onChange={(e) => updateDispatchQuality(idx, 'qty', e.target.value)}
                                  style={{ width: 75, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Received Quality Section (Matching photo 1 & 2) */}
                    <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                      <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 700, color: '#334155' }}>
                        Received Quality
                      </h4>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {receivedQualityList.map((r, idx) => (
                          <div key={idx} style={{ padding: '0.85rem 1rem', background: '#f8fafc', border: `1px solid ${r.cellRejected ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 6 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a', marginBottom: '0.5rem' }}>
                              {r.cell}
                            </div>

                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                              {/* Left Column: Purpose & C/P/S */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 190 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', width: 70, fontSize: '0.85rem' }}>Purpose</span>
                                  <select
                                    value={r.purpose}
                                    onChange={(e) => updateReceivedQuality(idx, 'purpose', e.target.value)}
                                    style={{ width: 140, height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 2, fontSize: '0.82rem', fontWeight: 600 }}
                                  >
                                    <option value="Purchase">Purchase</option>
                                    <option value="Inter Unit Transfer">Inter Unit Transfer</option>
                                    <option value="Conversion">Conversion</option>
                                  </select>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontWeight: 600, color: '#334155', width: 70, fontSize: '0.85rem' }}>C/P/S</span>
                                  <select
                                    value={r.cps}
                                    onChange={(e) => updateReceivedQuality(idx, 'cps', e.target.value)}
                                    style={{ width: 140, height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 2, fontSize: '0.82rem', fontWeight: 600 }}
                                  >
                                    <option value="Chilled">Chilled</option>
                                    <option value="Pasteurized">Pasteurized</option>
                                    <option value="Skim Separated Milk">Skim Separated Milk</option>
                                    <option value="Condensed Skim Milk">Condensed Skim Milk</option>
                                  </select>
                                </div>
                              </div>

                              {/* Right Grid: 3 Rows */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                                {/* Grid Row 1: Fat%, SNF%, CLR, Acidity%, Temp */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>Fat%</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={r.fat}
                                      onChange={(e) => updateReceivedQuality(idx, 'fat', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>SNF%</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={r.snf}
                                      onChange={(e) => updateReceivedQuality(idx, 'snf', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 35 }}>CLR</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={r.clr}
                                      onChange={(e) => updateReceivedQuality(idx, 'clr', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 55 }}>Acidity%</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={r.acidity}
                                      onChange={(e) => updateReceivedQuality(idx, 'acidity', e.target.value)}
                                      style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Temp</span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={r.temp}
                                      onChange={(e) => updateReceivedQuality(idx, 'temp', e.target.value)}
                                      style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                    <span style={{ color: '#64748b' }}>°C</span>
                                  </div>
                                </div>

                                {/* Grid Row 2: Seal, MBRT, Sample Date, Sample Time, Sp Gr */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>Seal</span>
                                    <input
                                      value={r.seal}
                                      onChange={(e) => updateReceivedQuality(idx, 'seal', e.target.value)}
                                      style={{ width: 65, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 45 }}>MBRT</span>
                                    <input
                                      value={r.mbrt}
                                      onChange={(e) => updateReceivedQuality(idx, 'mbrt', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 80 }}>Sample Date</span>
                                    <input
                                      type="text"
                                      value={r.sampleDate}
                                      onChange={(e) => updateReceivedQuality(idx, 'sampleDate', e.target.value)}
                                      style={{ width: 85, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 80 }}>Sample Time</span>
                                    <input
                                      type="text"
                                      value={r.sampleTime}
                                      onChange={(e) => updateReceivedQuality(idx, 'sampleTime', e.target.value)}
                                      style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 40 }}>Sp Gr</span>
                                    <input
                                      value={r.spGr}
                                      onChange={(e) => updateReceivedQuality(idx, 'spGr', e.target.value)}
                                      style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>
                                </div>

                                {/* Grid Row 3: COB, Milk Type, none, REJECT */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ fontWeight: 600, color: '#334155', minWidth: 42 }}>COB</span>
                                    <select
                                      value={r.cob}
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
                                      value={r.milkType}
                                      onChange={(e) => updateReceivedQuality(idx, 'milkType', e.target.value)}
                                      style={{ width: 85, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => updateReceivedQuality(idx, 'milkType', '')}
                                    style={{
                                      background: '#fef08a',
                                      border: '1px solid #eab308',
                                      padding: '1px 6px',
                                      borderRadius: 3,
                                      fontSize: '0.72rem',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      height: 24,
                                    }}
                                  >
                                    none
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => updateReceivedQuality(idx, 'cellRejected', !r.cellRejected)}
                                    style={{
                                      background: r.cellRejected ? '#ef4444' : '#65a30d',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '2px 10px',
                                      fontWeight: 700,
                                      fontSize: '0.75rem',
                                      cursor: 'pointer',
                                      height: 24,
                                    }}
                                  >
                                    {r.cellRejected ? 'REJECTED' : 'REJECT'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Qc Manual Entry Reason (Matching photo 2) */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}>
                        Qc Manual Entry Reason
                      </label>
                      <textarea
                        rows={2}
                        value={manualEntryReason}
                        onChange={(e) => setManualEntryReason(e.target.value)}
                        style={{ width: '100%', maxWidth: 350, padding: '4px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: '0.85rem' }}
                        placeholder=""
                      />
                    </div>

                    {/* 3.5 SELECT TEST: 4 test categories separately for FC and BC */}
                    <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#475569', marginBottom: '0.5rem' }}>
                        Select Test
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Test Type For FC</span>
                          <select
                            value={testTypes['FC'] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTestTypes((prev) => ({ ...prev, FC: val }));
                              setSelectedTestCellTab('FC');
                            }}
                            style={{ padding: '3px 8px', fontSize: '0.82rem', border: '1px solid #94a3b8', borderRadius: 2, backgroundColor: '#ffffff', minWidth: 110 }}
                          >
                            <option value="">SELECT</option>
                            <option value="ALL">All Tests</option>
                            <option value="Freshness">Freshness Test</option>
                            <option value="SNF Adulteration">SNF Adulteration Test</option>
                            <option value="Special">Special Test</option>
                            <option value="FAT Adulteration">FAT Adulteration Test</option>
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Test Type For BC</span>
                          <select
                            value={testTypes['BC'] || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTestTypes((prev) => ({ ...prev, BC: val }));
                              setSelectedTestCellTab('BC');
                            }}
                            style={{ padding: '3px 8px', fontSize: '0.82rem', border: '1px solid #94a3b8', borderRadius: 2, backgroundColor: '#ffffff', minWidth: 110 }}
                          >
                            <option value="">SELECT</option>
                            <option value="ALL">All Tests</option>
                            <option value="Freshness">Freshness Test</option>
                            <option value="SNF Adulteration">SNF Adulteration Test</option>
                            <option value="Special">Special Test</option>
                            <option value="FAT Adulteration">FAT Adulteration Test</option>
                          </select>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                          {(receivedQualityList.length > 0 ? receivedQualityList.map((r) => r.cell) : ['FC', 'BC']).map((cell) => (
                            <button
                              key={cell}
                              type="button"
                              onClick={() => setSelectedTestCellTab(cell)}
                              style={{
                                padding: '3px 10px',
                                borderRadius: 3,
                                border: selectedTestCellTab === cell ? '2px solid #0284c7' : '1px solid #cbd5e1',
                                backgroundColor: selectedTestCellTab === cell ? '#e0f2fe' : '#f8fafc',
                                color: selectedTestCellTab === cell ? '#0369a1' : '#475569',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                              }}
                            >
                              {cell} {cell === 'FC' ? '(Front Cell)' : cell === 'BC' ? '(Back Cell)' : ''}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Active Compartment Tests Container */}
                      {(() => {
                        const activeCell = selectedTestCellTab || 'FC';
                        const currentTests = cellTests[activeCell] || getDefaultCellTests();

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            {/* A. Freshness Test */}
                            <div style={{ border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 12px', backgroundColor: '#f0fdf4' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#166534', marginBottom: '6px' }}>
                                A. Freshness Test — {activeCell}
                              </div>
                              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>1. Temperature (°C)</label>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={currentTests.freshnessTemp}
                                    onChange={(e) => updateCellTest(activeCell, 'freshnessTemp', e.target.value)}
                                    style={{ width: 80, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>2. Organoleptic</label>
                                  <select
                                    value={currentTests.freshnessOrganoleptic}
                                    onChange={(e) => updateCellTest(activeCell, 'freshnessOrganoleptic', e.target.value as any)}
                                    style={{ height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 3, fontWeight: 600 }}
                                  >
                                    <option value="Satisfied">Satisfied</option>
                                    <option value="Unsatisfied">Unsatisfied</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>3. Chemist Name</label>
                                  <input
                                    value={currentTests.freshnessChemist}
                                    onChange={(e) => updateCellTest(activeCell, 'freshnessChemist', e.target.value)}
                                    style={{ width: 170, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* B. SNF Adulteration Test */}
                            <div style={{ border: '1px solid #fef08a', borderRadius: 6, padding: '10px 12px', backgroundColor: '#fefce8' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#854d0e', marginBottom: '6px' }}>
                                B. SNF Adulteration Test — {activeCell}
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '8px', marginBottom: '6px' }}>
                                {[
                                  { label: '1. Sugar Test', key: 'sugarTest' },
                                  { label: '2. Starch Test', key: 'starchTest' },
                                  { label: '3. Maltose Test', key: 'maltoseTest' },
                                  { label: '4. Salt', key: 'saltTest' },
                                  { label: '5. Urea', key: 'ureaTest' },
                                  { label: '6. Neutralizers', key: 'neutralizersTest' },
                                  { label: '7. Water', key: 'waterTest' },
                                  { label: '8. Ammonium Sulphate', key: 'ammoniumSulphateTest' },
                                  { label: '9. Abnormal', key: 'abnormalTest' },
                                ].map((f) => (
                                  <div key={f.key}>
                                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', display: 'block' }}>{f.label}</label>
                                    <select
                                      value={(currentTests as any)[f.key]}
                                      onChange={(e) => updateCellTest(activeCell, f.key as any, e.target.value as any)}
                                      style={{ width: '100%', height: 26, padding: '1px 4px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: '0.78rem' }}
                                    >
                                      <option value="Positive">Positive</option>
                                      <option value="Negative">Negative</option>
                                      <option value="Not Tested">Not Tested</option>
                                    </select>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>10. Chemist Name</label>
                                <input
                                  value={currentTests.snfChemist}
                                  onChange={(e) => updateCellTest(activeCell, 'snfChemist', e.target.value)}
                                  style={{ width: 170, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                />
                              </div>
                            </div>

                            {/* C. Special Test */}
                            <div style={{ border: '1px solid #bfdbfe', borderRadius: 6, padding: '10px 12px', backgroundColor: '#eff6ff' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1e40af', marginBottom: '6px' }}>
                                C. Special Test — {activeCell}
                              </div>
                              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>1. Antibiotic</label>
                                  <select
                                    value={currentTests.antibioticTest}
                                    onChange={(e) => updateCellTest(activeCell, 'antibioticTest', e.target.value as any)}
                                    style={{ height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  >
                                    <option value="Positive">Positive</option>
                                    <option value="Negative">Negative</option>
                                    <option value="Not Tested">Not Tested</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>2. Aflatoxin Test</label>
                                  <select
                                    value={currentTests.aflatoxinTest}
                                    onChange={(e) => updateCellTest(activeCell, 'aflatoxinTest', e.target.value as any)}
                                    style={{ height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  >
                                    <option value="Positive">Positive</option>
                                    <option value="Negative">Negative</option>
                                    <option value="Not Tested">Not Tested</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>3. Chemist Name</label>
                                  <input
                                    value={currentTests.specialChemist}
                                    onChange={(e) => updateCellTest(activeCell, 'specialChemist', e.target.value)}
                                    style={{ width: 170, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* D. FAT Adulteration Test */}
                            <div style={{ border: '1px solid #e9d5ff', borderRadius: 6, padding: '10px 12px', backgroundColor: '#faf5ff' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#6b21a8', marginBottom: '6px' }}>
                                D. FAT Adulteration Test — {activeCell}
                              </div>
                              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>1. Free Fatty Acid</label>
                                  <input
                                    value={currentTests.freeFattyAcid}
                                    onChange={(e) => updateCellTest(activeCell, 'freeFattyAcid', e.target.value)}
                                    style={{ width: 80, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>2. B.R.</label>
                                  <input
                                    value={currentTests.brReading}
                                    onChange={(e) => updateCellTest(activeCell, 'brReading', e.target.value)}
                                    style={{ width: 80, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>3. MOT</label>
                                  <select
                                    value={currentTests.motTest}
                                    onChange={(e) => updateCellTest(activeCell, 'motTest', e.target.value as any)}
                                    style={{ height: 26, padding: '1px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  >
                                    <option value="Positive">Positive</option>
                                    <option value="Negative">Negative</option>
                                    <option value="Not Tested">Not Tested</option>
                                  </select>
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>4. R.M.</label>
                                  <input
                                    value={currentTests.rmValue}
                                    onChange={(e) => updateCellTest(activeCell, 'rmValue', e.target.value)}
                                    style={{ width: 80, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'block' }}>5. Chemist Name</label>
                                  <input
                                    value={currentTests.fatChemist}
                                    onChange={(e) => updateCellTest(activeCell, 'fatChemist', e.target.value)}
                                    style={{ width: 170, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3 }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* 3.6 QC Completion */}
                    <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                        Tests Completed:
                      </label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {receivedQualityList.map((r, i) => (
                          <span
                            key={r.cell}
                            style={{
                              backgroundColor: '#f0fdf4',
                              border: '1px solid #86efac',
                              borderRadius: 4,
                              padding: '2px 8px',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              color: r.cellRejected ? '#dc2626' : i === 0 ? '#16a34a' : '#d97706',
                            }}
                          >
                            ✓ {r.cell}: All Tests Verified
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Remarks (Matching photo 2) */}
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.25rem' }}>
                        Remarks
                      </label>
                      <textarea
                        rows={3}
                        value={qcRemarks}
                        onChange={(e) => setQcRemarks(e.target.value)}
                        style={{ width: '100%', maxWidth: 450, padding: '4px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: '0.85rem' }}
                        placeholder=""
                      />
                    </div>

                    {/* Action Buttons matching photo */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '0.5rem' }}>
                      <button
                        type="submit"
                        disabled={submitting}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '5px 18px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                          opacity: submitting ? 0.7 : 1,
                        }}
                      >
                        {submitting ? 'Updating…' : 'Update'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowRejectModal(true)}
                        disabled={submitting}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '5px 18px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: submitting ? 'not-allowed' : 'pointer',
                          opacity: submitting ? 0.7 : 1,
                        }}
                      >
                        REJECT
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* STEP 6: CIP SANITIZATION (Matching authentic Aavin IDMS CIP photo) */}
            {(qcSubTab === 'cip' || (!qcSubTab && currentStageKey === 'cip_completed')) && (
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
                  CIP DETAILS
                </div>

                <div style={{ padding: '1.25rem 1.5rem' }}>
                  <form onSubmit={(e) => { e.preventDefault(); void handleUpdateCip(); }}>
                    {/* Vehicle No */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Vehicle No
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          value={cipVehicleNo}
                          onChange={(e) => setCipVehicleNo(e.target.value.toUpperCase())}
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
                            fontStyle: 'italic',
                            color: '#1e293b',
                          }}
                        >
                          {cipVehicleNo || activeTanker.tanker_number || 'TN28BJ1697'}
                        </span>
                      </div>
                    </div>

                    {/* Received From : */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '2px' }}>
                        Received From :
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {cipReceivedFromList.map((bmc, idx) => (
                          <span
                            key={idx}
                            style={{
                              backgroundColor: '#fef9c3',
                              border: '1px solid #fde047',
                              padding: '1px 8px',
                              borderRadius: 2,
                              fontWeight: 600,
                              fontSize: '0.82rem',
                              fontStyle: 'italic',
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
                        DC NO: <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          value={cipDcNo}
                          onChange={(e) => setCipDcNo(e.target.value)}
                          required
                          style={{
                            width: 150,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>

                    {/* Dispatch Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Dispatch Date
                      </label>
                      <input
                        value={cipDispatchDate}
                        onChange={(e) => setCipDispatchDate(e.target.value)}
                        style={{
                          width: 150,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* Dispatch Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Dispatch Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          value={cipDispatchTime}
                          onChange={(e) => setCipDispatchTime(e.target.value)}
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={cipDispatchAmPm}
                          onChange={(e) => setCipDispatchAmPm(e.target.value as any)}
                          style={{
                            height: 28,
                            padding: '0 4px',
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

                    {/* CIP Date */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        CIP Date
                      </label>
                      <input
                        value={cipDate}
                        onChange={(e) => setCipDate(e.target.value)}
                        style={{
                          width: 150,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* CIP Time(HHMM)[12 hour format] */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        CIP Time(HHMM)[12 hour format]
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          value={cipTime}
                          onChange={(e) => setCipTime(e.target.value)}
                          style={{
                            width: 90,
                            height: 28,
                            padding: '2px 8px',
                            border: '1px solid #94a3b8',
                            borderRadius: 3,
                          }}
                        />
                        <select
                          value={cipTimeAmPm}
                          onChange={(e) => setCipTimeAmPm(e.target.value as any)}
                          style={{
                            height: 28,
                            padding: '0 4px',
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

                    {/* CIP Operator */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        CIP Operator
                      </label>
                      <input
                        value={cipOperator}
                        onChange={(e) => setCipOperator(e.target.value)}
                        placeholder=""
                        style={{
                          width: 180,
                          height: 28,
                          padding: '2px 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                        }}
                      />
                    </div>

                    {/* QC Inspection */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        QC Inspection
                      </label>
                      <select
                        value={qcInspection}
                        onChange={(e) => setQcInspection(e.target.value)}
                        style={{
                          width: 150,
                          height: 28,
                          padding: '0 8px',
                          border: '1px solid #94a3b8',
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        <option value="Satisfied">Satisfied</option>
                        <option value="Unsatisfied">Unsatisfied</option>
                      </select>
                    </div>

                    {/* CIP Clean Types */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        CIP Clean Types
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                          <input
                            type="checkbox"
                            checked={cipAutomaticTest}
                            onChange={(e) => setCipAutomaticTest(e.target.checked)}
                            style={{ width: 15, height: 15 }}
                          />
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>Automatic Test</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                          <input
                            type="checkbox"
                            checked={cipManualTest}
                            onChange={(e) => setCipManualTest(e.target.checked)}
                            style={{ width: 15, height: 15 }}
                          />
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>Manual Test</span>
                        </label>
                      </div>
                    </div>

                    {/* Is CIP Checked */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                      <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                        Is CIP Checked
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="checkbox"
                          checked={isCipChecked}
                          onChange={(e) => setIsCipChecked(e.target.checked)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                        <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '1rem' }}>*</span>
                      </div>
                    </div>

                    {/* Update button */}
                    <div style={{ display: 'flex', alignItems: 'center', paddingTop: '0.25rem' }}>
                      <button
                        type="submit"
                        disabled={submitting}
                        style={{
                          backgroundColor: '#65a30d',
                          color: '#ffffff',
                          border: 'none',
                          borderRadius: 3,
                          padding: '5px 18px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
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
            {!qcSubTab && journey.waitingTeam !== 'qc' && (
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

      {/* Rejection Confirmation Modal */}
      {showRejectModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
              maxWidth: 540,
              width: '100%',
              padding: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#dc2626', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#991b1b' }}>
                Confirm Tanker Milk Rejection
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.4 }}>
              Are you sure you want to reject milk for Tanker <strong>{activeTanker?.tanker_number}</strong>?
              This will route the tanker directly to Tare Weighbridge and mark the batch as rejected.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                Reason for Rejection:
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Clot on boiling positive, sour milk, low Fat/SNF..."
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            {/* Quick chips */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.4rem' }}>
                Quick Selection:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {quickRejectionReasons.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setRejectionReason(reason)}
                    style={{
                      background: rejectionReason === reason ? '#fee2e2' : '#f1f5f9',
                      color: rejectionReason === reason ? '#991b1b' : '#334155',
                      border: rejectionReason === reason ? '1px solid #f87171' : '1px solid #cbd5e1',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowRejectModal(false);
                }}
                disabled={submitting}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  padding: '6px 14px',
                  borderRadius: 4,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                disabled={submitting}
                style={{
                  background: '#dc2626',
                  border: 'none',
                  color: '#ffffff',
                  padding: '6px 16px',
                  borderRadius: 4,
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
