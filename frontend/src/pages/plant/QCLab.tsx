import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatLitres, getLocalTodayIso } from '../../lib/format';
import { ErrorBanner } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { parseDispatchTime } from './GateOperations';

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

export function getDefaultCellTests(chemist = ''): QcCellTests {
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

    freeFattyAcid: '',
    brReading: '',
    motTest: 'Negative',
    rmValue: '',
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

export interface QCLabProps {
  activeView?: 'qc' | 'cip' | 'gate-pass';
}

export default function QCLab({ activeView = 'qc' }: QCLabProps) {
  const navigate = useNavigate();
  const { lang } = useTranslation();
  const [tankers, setTankers] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [selectedTankerId, setSelectedTankerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sub-navigation tab: Quality Control Details vs CIP Sanitization vs Gate Pass
  const [qcSubTab, setQcSubTab] = useState<'qc' | 'cip' | 'gate-pass'>(activeView);

  // Sync prop changes
  useEffect(() => {
    if (activeView) setQcSubTab(activeView);
  }, [activeView]);

  // Dialog Modals
  const [showQcModal, setShowQcModal] = useState(false);
  const [showCipModal, setShowCipModal] = useState(false);
  const [showGatePassModal, setShowGatePassModal] = useState(false);
  const [gatePassTanker, setGatePassTanker] = useState<any>(null);

  // Gate Pass Form States (Matching authentic Aavin yellow voucher slip)
  const [gatePassNo, setGatePassNo] = useState('005616');
  const [gatePassDate, setGatePassDate] = useState(() => {
    const d = new Date();
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${mon}.${String(d.getFullYear()).slice(-2)}`;
  });
  const [gatePassTime, setGatePassTime] = useState(() => {
    const d = new Date();
    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}.${mins} ${ampm}`;
  });
  const [gatePassSlNo, setGatePassSlNo] = useState('1)');
  const [gatePassItem, setGatePassItem] = useState('EMPTY TANKER');
  const [gatePassQty, setGatePassQty] = useState('1');
  const [gatePassPurpose, setGatePassPurpose] = useState('TO BMC');
  const [gatePassReturnable, setGatePassReturnable] = useState('Returnable');
  const [gatePassToWhom, setGatePassToWhom] = useState('');
  const [gatePassIssuedBy, setGatePassIssuedBy] = useState('Lab');
  const [gatePassVehicleNo, setGatePassVehicleNo] = useState('');
  const [gatePassIssuingOfficer, setGatePassIssuingOfficer] = useState('');
  const [gatePassReceivedBy, setGatePassReceivedBy] = useState('');
  const [gatePassSecurity, setGatePassSecurity] = useState('Security Incharge');
  const [exportingPdf, setExportingPdf] = useState(false);

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

  const { profile } = useAuth();
  const userChemist = profile?.full_name || '';
  const lastLoadedTankerIdRef = useRef<string | null>(null);

  // Meta & Tests
  const [manualEntryReason, setManualEntryReason] = useState('');
  const [testTypes, setTestTypes] = useState<Record<string, string>>({});
  const [qcRemarks, setQcRemarks] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  // 3.5 Select Test: 4 test categories separately for FC and BC
  const [cellTests, setCellTests] = useState<Record<string, QcCellTests>>(() => ({
    FC: getDefaultCellTests(profile?.full_name || ''),
    BC: getDefaultCellTests(profile?.full_name || ''),
  }));
  const [selectedTestCellTab, setSelectedTestCellTab] = useState<string>('FC');
  const [savedCellTests, setSavedCellTests] = useState<Record<string, boolean>>({});
  const [testSavedToast, setTestSavedToast] = useState<{ cell: string; test: string } | null>(null);

  const handleSaveTest = (cell: string, testCategory: string) => {
    const key = `${cell}_${testCategory}`;
    setSavedCellTests((prev) => ({
      ...prev,
      [key]: true,
      [cell]: true,
    }));

    try {
      const draftKey = `aavin_qc_draft_${activeTanker?.id || 'active'}`;
      const draft = {
        cellTests,
        testTypes,
        savedCellTests: { ...savedCellTests, [key]: true, [cell]: true },
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}

    setTestSavedToast({ cell, test: testCategory });
    setTimeout(() => {
      setTestSavedToast(null);
    }, 3500);
  };

  const handleSaveAllTestsForCell = (cell: string) => {
    const currentType = testTypes[cell] || 'ALL';
    const newSaved = { ...savedCellTests, [cell]: true };
    if (currentType === 'ALL') {
      newSaved[`${cell}_Freshness`] = true;
      newSaved[`${cell}_SNF Adulteration`] = true;
      newSaved[`${cell}_Special`] = true;
      newSaved[`${cell}_FAT Adulteration`] = true;
    } else {
      newSaved[`${cell}_${currentType}`] = true;
    }
    setSavedCellTests(newSaved);

    try {
      const draftKey = `aavin_qc_draft_${activeTanker?.id || 'active'}`;
      const draft = {
        cellTests,
        testTypes,
        savedCellTests: newSaved,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}

    setTestSavedToast({ cell, test: currentType === 'ALL' ? 'All Tests' : currentType });
    setTimeout(() => {
      setTestSavedToast(null);
    }, 3500);
  };

  const updateCellTest = <K extends keyof QcCellTests>(cell: string, field: K, val: QcCellTests[K]) => {
    setCellTests((prev) => ({
      ...prev,
      [cell]: {
        ...(prev[cell] || getDefaultCellTests(userChemist)),
        [field]: val,
      },
    }));
  };

  // CIP Details Form States
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
  const [qcInspection, setQcInspection] = useState<'SATISFIED' | 'UNSATISFIED'>('SATISFIED');
  const [cipAutomaticTest, setCipAutomaticTest] = useState(true);
  const [cipManualTest, setCipManualTest] = useState(false);
  const [isCipChecked, setIsCipChecked] = useState(true);

  const fetchTankers = async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError('');
    try {
      const res = await api.get('/tanker');
      const list = Array.isArray(res.data) ? res.data : (res.data?.tankers || []);
      setTankers(list);
    } catch (err: any) {
      if (!isBackground) setError(err.response?.data?.error || err.message || 'Failed to load tankers');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTankers(false);
    const interval = setInterval(() => {
      if (!document.hidden) void fetchTankers(true);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Condition 3: QC queue displays only vehicles for which Gross Weight has been completed
  const qcEligibleTankers = useMemo(() => {
    return tankers.filter(
      (t) =>
        (t.stage_data?.gross_weight != null || t.journey?.completedStageKeys?.includes('gross_weight')) &&
        !t.stage_data?.qc_completed &&
        !t.journey?.completedStageKeys?.includes('qc_completed') &&
        t.journey?.tripStatus !== 'qc_rejected' &&
        t.journey?.tripStatus !== 'exited',
    );
  }, [tankers]);

  // Condition 5: CIP queue displays only vehicles for which Tare Weight has been completed (and keeps unsatisfied ones for re-cleaning)
  const cipEligibleTankers = useMemo(() => {
    return tankers.filter(
      (t) =>
        (t.stage_data?.tare_weight != null || t.journey?.completedStageKeys?.includes('tare_weight')) &&
        (!t.stage_data?.cip_completed || t.stage_data?.cip_completed?.cip_status === 'unsatisfied' || t.stage_data?.cip_completed?.status === 'rejected' || t.cip_status === 'unsatisfied') &&
        t.journey?.tripStatus !== 'exited',
    );
  }, [tankers]);

  // Condition 6: Gate Pass queue displays vehicles that completed CIP sanitization with pass/satisfied and need Gate Pass before exit
  const gatePassWaiters = useMemo(() => {
    return tankers.filter((t) => {
      const cipPassed = Boolean(
        t.stage_data?.cip_completed?.cip_status === 'pass' ||
        t.stage_data?.cip_completed?.qc_inspection === 'SATISFIED' ||
        (t.journey?.completedStageKeys?.includes('cip_completed') && t.cip_status !== 'unsatisfied' && t.stage_data?.cip_completed?.cip_status !== 'unsatisfied')
      );
      const hasGatePass = Boolean(
        t.gate_pass != null ||
        t.stage_data?.gate_pass != null ||
        (t.journey as any)?.hasGatePass ||
        t.journey?.completedStageKeys?.includes('gate_pass')
      );
      const exited = t.journey?.tripStatus === 'exited' || t.stage_data?.vehicle_exit != null;
      return cipPassed && !hasGatePass && !exited;
    });
  }, [tankers]);

  // Issued Gate Passes: All tankers that have gate pass data recorded
  const issuedGatePasses = useMemo(() => {
    return tankers.filter((t) => {
      return Boolean(
        t.gate_pass != null ||
        t.stage_data?.gate_pass != null ||
        (t.journey as any)?.hasGatePass ||
        t.journey?.completedStageKeys?.includes('gate_pass')
      );
    });
  }, [tankers]);

  // Active tanker for modal form editing
  const activeTanker = useMemo(() => {
    if (selectedTankerId) {
      const found = tankers.find((t) => t.id === selectedTankerId);
      if (found) return found;
    }
    if (qcSubTab === 'gate-pass' && gatePassWaiters.length > 0) return gatePassWaiters[0];
    if (qcSubTab === 'cip' && cipEligibleTankers.length > 0) return cipEligibleTankers[0];
    if (qcSubTab === 'qc' && qcEligibleTankers.length > 0) return qcEligibleTankers[0];
    return tankers[0] || null;
  }, [selectedTankerId, tankers, qcSubTab, qcEligibleTankers, cipEligibleTankers, gatePassWaiters]);



  // Pre-fill form when active tanker changes (guarded to avoid wiping active edits or polling reset)
  useEffect(() => {
    if (!activeTanker) return;
    const isAnyModalOpen = showQcModal || showCipModal || showRejectModal || showGatePassModal;
    if (isAnyModalOpen) return;
    if (activeTanker.id === lastLoadedTankerIdRef.current) return;
    lastLoadedTankerIdRef.current = activeTanker.id;

    const vNo = activeTanker.tanker_number || '';
    setQcVehicleNo(vNo);
    setCipVehicleNo(vNo);

    const resolvedDc =
      activeTanker.dc_number ||
      activeTanker.stage_data?.dc_number ||
      activeTanker.stage_data?.dc_no ||
      activeTanker.stage_data?.gross_weight?.dc_number ||
      activeTanker.stage_data?.vehicle_entered?.dc_number ||
      '';
    setQcDcNo(resolvedDc);
    setCipDcNo(resolvedDc);

    const bmcSources: string[] = [];
    if (activeTanker.bmcs?.name) {
      bmcSources.push(`${activeTanker.bmcs.name.toUpperCase()}${activeTanker.bmcs.bmc_code ? ` [${activeTanker.bmcs.bmc_code}]` : ''}`);
    }
    if (activeTanker.compartments && Array.isArray(activeTanker.compartments)) {
      activeTanker.compartments.forEach((c: any) => {
        if (c.bmc_name && !bmcSources.some((b) => b.includes(c.bmc_name.toUpperCase()))) {
          bmcSources.push(`${c.bmc_name.toUpperCase()}`);
        }
      });
    }
    setQcReceivedFromList(bmcSources);
    setCipReceivedFromList(bmcSources);

    const dispDate = activeTanker.date || getLocalTodayIso();
    const [y, m, d] = dispDate.split('-');
    if (y && m && d) {
      setQcDispatchDate(`${d}/${m}/${y}`);
      setCipDispatchDate(`${d}/${m}/${y}`);
    } else {
      setQcDispatchDate(dispDate);
      setCipDispatchDate(dispDate);
    }

    const parsedDisp = parseDispatchTime(
      activeTanker.dispatch_time || activeTanker.stage_data?.dispatch_time,
      activeTanker.dispatch_ampm || activeTanker.stage_data?.dispatch_ampm,
      activeTanker.created_at
    );
    setQcDispatchTime(parsedDisp.time);
    setQcDispatchAmPm(parsedDisp.ampm);
    setCipDispatchTime(parsedDisp.time);
    setCipDispatchAmPm(parsedDisp.ampm);

    // Initialize Dispatch Quality List
    const dispQ: QcDispatchQuality[] = [];
    const grossRows = activeTanker.stage_data?.gross_weight?.quality_breakdown;
    if (grossRows && Array.isArray(grossRows) && grossRows.length > 0) {
      grossRows.forEach((r: any) => {
        dispQ.push({
          cell: r.cell || 'FC',
          fat: String(r.fat ?? activeTanker.dispatch_fat_pct ?? ''),
          snf: String(r.snf ?? activeTanker.dispatch_snf_pct ?? ''),
          clr: '',
          acidity: '',
          temp: String(r.temp ?? '4.0'),
          milkType: 'MIXED MILK',
          qty: String(r.qty ?? ''),
        });
      });
    } else {
      const comps = activeTanker.compartments || activeTanker.stage_data?.compartments;
      if (comps && Array.isArray(comps) && comps.length > 0) {
        comps.forEach((c: any, idx: number) => {
          let cellLabel = 'FC';
          if (c.cell && ['FC', 'MC', 'BC'].includes(String(c.cell).toUpperCase())) {
            cellLabel = String(c.cell).toUpperCase();
          } else if (comps.length === 3) {
            cellLabel = idx === 0 ? 'FC' : idx === 1 ? 'MC' : 'BC';
          } else if (comps.length === 2) {
            cellLabel = idx === 0 ? 'FC' : 'BC';
          }
          dispQ.push({
            cell: cellLabel,
            fat: String(c.fat_pct ?? c.fat ?? activeTanker.dispatch_fat_pct ?? ''),
            snf: String(c.snf_pct ?? c.snf ?? activeTanker.dispatch_snf_pct ?? ''),
            clr: '',
            acidity: '',
            temp: String(c.temperature ?? c.temp ?? '4.0'),
            milkType: c.milk_type || 'MIXED MILK',
            qty: String(c.quantity_litres ?? c.qty ?? ''),
          });
        });
      } else {
        const defaultFat = activeTanker.dispatch_fat_pct != null ? String(activeTanker.dispatch_fat_pct) : '';
        const defaultSnf = activeTanker.dispatch_snf_pct != null ? String(activeTanker.dispatch_snf_pct) : '';
        const halfQty = activeTanker.quantity_dispatched > 0 ? String(Math.round(activeTanker.quantity_dispatched / 2)) : '';
        dispQ.push({
          cell: 'FC',
          fat: defaultFat,
          snf: defaultSnf,
          clr: '',
          acidity: '',
          temp: '4.0',
          milkType: 'MIXED MILK',
          qty: halfQty,
        });
        dispQ.push({
          cell: 'BC',
          fat: defaultFat,
          snf: defaultSnf,
          clr: '',
          acidity: '',
          temp: '4.0',
          milkType: 'MIXED MILK',
          qty: halfQty,
        });
      }
    }
    setDispatchQualityList(dispQ);

    // Initialize Received Quality List
    const recQ: QcReceivedQuality[] = [];
    const cellNames = dispQ.map((d) => d.cell);
    const uniqueCells = Array.from(new Set(cellNames.length > 0 ? cellNames : ['FC', 'BC']));

    uniqueCells.forEach((cLabel) => {
      const matchDisp = dispQ.find((d) => d.cell === cLabel);
      recQ.push({
        cell: cLabel,
        purpose: 'Purchase',
        cps: 'Chilled',
        fat: matchDisp?.fat || (activeTanker.dispatch_fat_pct != null ? String(activeTanker.dispatch_fat_pct) : ''),
        snf: matchDisp?.snf || (activeTanker.dispatch_snf_pct != null ? String(activeTanker.dispatch_snf_pct) : ''),
        clr: '',
        acidity: '',
        temp: '4.0',
        seal: activeTanker.seal_number || activeTanker.stage_data?.seal_number || activeTanker.stage_data?.outlet_seal_no || '',
        mbrt: '',
        sampleDate: qcDate,
        sampleTime: '',
        spGr: '',
        cob: 'Negative',
        milkType: 'MIXED MILK',
        cellRejected: false,
        qty: matchDisp?.qty || '',
      });
    });
    setReceivedQualityList(recQ);

    // Initialize cellTests for all unique compartments
    setCellTests((prev) => {
      const next = { ...prev };
      uniqueCells.forEach((c) => {
        if (!next[c]) {
          next[c] = getDefaultCellTests(userChemist);
        }
      });
      return next;
    });
    if (uniqueCells.length > 0 && !uniqueCells.includes(selectedTestCellTab)) {
      setSelectedTestCellTab(uniqueCells[0]);
    }
  }, [
    activeTanker?.id,
    showQcModal,
    showCipModal,
    showRejectModal,
    showGatePassModal,
    userChemist,
  ]);

  const openQcModal = (t: any) => {
    setSelectedTankerId(t.id);
    lastLoadedTankerIdRef.current = t.id;
    const vNo = t.tanker_number || '';
    setQcVehicleNo(vNo);
    const resolvedDc = t.dc_number || t.stage_data?.dc_number || t.stage_data?.dc_no || t.stage_data?.gross_weight?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '';
    setQcDcNo(resolvedDc);
    try {
      const draftKey = `aavin_qc_draft_${t.id}`;
      const rawDraft = localStorage.getItem(draftKey);
      if (rawDraft) {
        const parsed = JSON.parse(rawDraft);
        if (parsed.savedCellTests) setSavedCellTests(parsed.savedCellTests);
        if (parsed.testTypes) setTestTypes(parsed.testTypes);
        if (parsed.cellTests) setCellTests(parsed.cellTests);
      }
    } catch {}
    setShowQcModal(true);
  };

  const openCipModal = (t: any) => {
    setSelectedTankerId(t.id);
    lastLoadedTankerIdRef.current = t.id;
    const vNo = t.tanker_number || '';
    setCipVehicleNo(vNo);
    const resolvedDc = t.dc_number || t.stage_data?.dc_number || t.stage_data?.dc_no || t.stage_data?.gross_weight?.dc_number || t.stage_data?.vehicle_entered?.dc_number || '';
    setCipDcNo(resolvedDc);
    setShowCipModal(true);
  };

  const openGatePassModal = (t: any) => {
    setGatePassTanker(t);
    setSelectedTankerId(t.id);
    lastLoadedTankerIdRef.current = t.id;
    const existing = t.gate_pass || t.stage_data?.gate_pass || {};
    const vNo = t.tanker_number || '';
    setGatePassVehicleNo(existing.vehicle_no || vNo);

    // Auto-generate or reuse serial number
    const existingNo = existing.gate_pass_no || t.gate_pass_no;
    if (existingNo) {
      setGatePassNo(existingNo);
    } else {
      const idx = tankers.indexOf(t);
      const baseNum = 5616 + (idx >= 0 ? idx : 1);
      setGatePassNo(String(baseNum).padStart(6, '0'));
    }

    const d = new Date();
    const defaultDate = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(-2)}`;
    setGatePassDate(existing.date || defaultDate);

    let hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const defaultTime = `${hours}.${mins} ${ampm}`;
    setGatePassTime(existing.time || defaultTime);

    setGatePassSlNo(existing.sl_no || '1)');
    setGatePassItem(existing.item || 'EMPTY TANKER');
    setGatePassQty(existing.quantity || '1');
    const bmcName = t.bmcs?.name ? `TO ${t.bmcs.name.toUpperCase()}` : 'TO BMC';
    setGatePassPurpose(existing.purpose || bmcName);
    setGatePassReturnable(existing.whether_returnable || 'Returnable');

    const driver = t.driver_name || t.stage_data?.vehicle_entered?.driver_name || 'S. PERIYASAMY';
    setGatePassToWhom(existing.to_whom_issued || driver);
    setGatePassReceivedBy(existing.received_by || driver);
    setGatePassIssuedBy(existing.issued_by || 'Lab');
    setGatePassIssuingOfficer(existing.issuing_officer || userChemist || 'P. Sathiya');
    setGatePassSecurity(existing.security_officer || 'Security Incharge');

    setShowGatePassModal(true);
  };

  const handleSaveGatePass = async () => {
    const targetTanker = gatePassTanker || activeTanker;
    if (!targetTanker) return;
    setSubmitting(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload = {
        gate_pass_no: gatePassNo,
        date: gatePassDate,
        time: gatePassTime,
        sl_no: gatePassSlNo,
        item: gatePassItem,
        quantity: gatePassQty,
        purpose: gatePassPurpose,
        whether_returnable: gatePassReturnable,
        to_whom_issued: gatePassToWhom,
        issued_by: gatePassIssuedBy,
        vehicle_no: gatePassVehicleNo,
        issuing_officer: gatePassIssuingOfficer,
        received_by: gatePassReceivedBy,
        security_officer: gatePassSecurity,
      };

      const res = await api.post(`/tanker/${targetTanker.id}/gate-pass`, payload);
      setSuccessMsg(
        lang === 'ta'
          ? `வாயில் அனுமதிச் சீட்டு (Gate Pass № ${gatePassNo}) வெற்றிகரமாக வழங்கப்பட்டது!`
          : `Gate Pass № ${gatePassNo} issued successfully for Tanker ${gatePassVehicleNo}!`
      );
      if (res.data?.gate_pass) {
        setGatePassTanker((prev: any) => ({ ...prev, gate_pass: res.data.gate_pass, gate_pass_no: gatePassNo }));
      }
      setShowGatePassModal(false);
      await fetchTankers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to issue Gate Pass');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExportGatePassPdf = async (tankerId: string, vehicleNo?: string) => {
    setExportingPdf(true);
    setError('');
    try {
      const res = await api.get(`/export/gate-pass/${tankerId}`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const fileUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = fileUrl;
      link.download = `Gate_Pass_${(vehicleNo || 'tanker').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to export Gate Pass PDF');
    } finally {
      setExportingPdf(false);
    }
  };

  const updateReceivedQuality = (idx: number, field: keyof QcReceivedQuality, val: any) => {
    setReceivedQualityList((prev) => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = { ...next[idx], [field]: val };
      }
      return next;
    });
  };

  const handleUpdateQc = async () => {
    if (!activeTanker) return;
    for (let i = 0; i < receivedQualityList.length; i++) {
      const q = receivedQualityList[i];
      const f = parseFloat(q.fat);
      const s = parseFloat(q.snf);
      if (isNaN(f) || f <= 0) {
        setError(`Please enter valid Received Fat % for compartment ${q.cell}`);
        return;
      }
      if (isNaN(s) || s <= 0) {
        setError(`Please enter valid Received SNF % for compartment ${q.cell}`);
        return;
      }
    }

    let sumQty = 0;
    let sumFat = 0;
    let sumSnf = 0;
    for (const qRow of receivedQualityList) {
      const q = parseFloat(qRow.qty || '1');
      const f = parseFloat(qRow.fat) || 0;
      const s = parseFloat(qRow.snf) || 0;
      if (q > 0) {
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
      tests_completed: Object.entries(testTypes).map(([c, t]) => `${c}: ${t}`).join(', ') || 'QC Completed',
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

    const isUnsatisfied = qcInspection === 'UNSATISFIED';
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
      cip_status: isUnsatisfied ? 'unsatisfied' : 'pass',
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
      if (stageKey === 'cip_completed' && payload.qc_inspection === 'UNSATISFIED') {
        setSuccessMsg(
          lang === 'ta'
            ? 'CIP சுத்தம் அதிருப்தி என பதிவு செய்யப்பட்டது! டேங்கர் மீண்டும் கழுவுவதற்காக இறக்கும் குழுவுக்கு திருப்பி அனுப்பப்பட்டது.'
            : 'CIP cleaning was marked UNSATISFIED. Tanker rejected and returned to Unloading / Cleaning team for re-washing!'
        );
      } else {
        setSuccessMsg(
          lang === 'ta'
            ? `QC தகவல் வெற்றிகரமாக பதிவு செய்யப்பட்டது! அடுத்த பணிக்கு அனுப்பப்பட்டது.`
            : `Stage ${stageKey.replace('_', ' ').toUpperCase()} recorded successfully!`
        );
      }
      if (stageKey === 'qc_completed') {
        try {
          if (activeTanker) localStorage.removeItem(`aavin_qc_draft_${activeTanker.id}`);
        } catch {}
        setSavedCellTests({});
      }
      setShowQcModal(false);
      setShowCipModal(false);
      setShowRejectModal(false);
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

  const waitingQcCount = qcEligibleTankers.length;
  const waitingCipCount = cipEligibleTankers.length;
  const passedCount = tankers.filter((t) => t.stage_data?.qc_completed?.qc_status === 'accepted').length;
  const rejectedCount = tankers.filter((t) => t.stage_data?.qc_completed?.qc_status === 'rejected' || t.journey?.tripStatus === 'qc_rejected').length;

  // Search filter
  const matchesSearch = (t: any) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const v = (t.tanker_number || '').toLowerCase();
    const dc = (t.dc_number || t.stage_data?.dc_number || '').toLowerCase();
    const bmc = (t.bmcs?.name || '').toLowerCase();
    const driver = (t.driver_name || '').toLowerCase();
    const gpNo = (t.gate_pass?.gate_pass_no || t.gate_pass_no || t.stage_data?.gate_pass?.gate_pass_no || '').toLowerCase();
    return v.includes(q) || dc.includes(q) || bmc.includes(q) || driver.includes(q) || gpNo.includes(q);
  };

  const filteredQcWaiters = qcEligibleTankers.filter(matchesSearch);
  const filteredCipWaiters = cipEligibleTankers.filter(matchesSearch);
  const filteredGatePassWaiters = gatePassWaiters.filter(matchesSearch);
  const filteredIssuedGatePasses = issuedGatePasses.filter(matchesSearch);

  return (
    <div className="page" style={{ maxWidth: '1180px', margin: '0 auto', padding: '1.25rem' }}>
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
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {qcSubTab === 'gate-pass'
              ? (lang === 'ta' ? 'வாயில் அனுமதிச் சீட்டு (Gate Pass Details)' : 'Gate Pass Issuance (After CIP)')
              : qcSubTab === 'cip'
              ? (lang === 'ta' ? 'சி.ஐ.பி சுத்தம் செய்தல் (CIP Details)' : 'Tanker CIP Sanitization Details')
              : (lang === 'ta' ? 'தரக்கட்டுப்பாட்டு ஆய்வகம் (QC Laboratory)' : 'QC Laboratory Milk Inspection')}
          </h1>
        </div>
      </div>

      {/* QC Sub-Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '4px' }}>
        <button
          type="button"
          onClick={() => {
            setQcSubTab('qc');
            navigate('/qc');
          }}
          style={{
            padding: '8px 18px',
            fontSize: '0.88rem',
            fontWeight: 700,
            borderRadius: '6px 6px 0 0',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: qcSubTab === 'qc' ? '#65a30d' : '#f1f5f9',
            color: qcSubTab === 'qc' ? '#ffffff' : '#475569',
            boxShadow: qcSubTab === 'qc' ? '0 2px 4px rgba(101, 163, 13, 0.25)' : 'none',
          }}
        >
          <span>🔬 Quality Control</span>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '1px 7px',
              borderRadius: '999px',
              backgroundColor: qcSubTab === 'qc' ? '#4d7c0f' : '#e2e8f0',
              color: qcSubTab === 'qc' ? '#ffffff' : '#64748b',
              fontWeight: 800,
            }}
          >
            {waitingQcCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setQcSubTab('cip');
            navigate('/qc/cip');
          }}
          style={{
            padding: '8px 18px',
            fontSize: '0.88rem',
            fontWeight: 700,
            borderRadius: '6px 6px 0 0',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: qcSubTab === 'cip' ? '#0284c7' : '#f1f5f9',
            color: qcSubTab === 'cip' ? '#ffffff' : '#475569',
            boxShadow: qcSubTab === 'cip' ? '0 2px 4px rgba(2, 132, 199, 0.25)' : 'none',
          }}
        >
          <span>🧼 CIP Sanitization</span>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '1px 7px',
              borderRadius: '999px',
              backgroundColor: qcSubTab === 'cip' ? '#0369a1' : '#e2e8f0',
              color: qcSubTab === 'cip' ? '#ffffff' : '#64748b',
              fontWeight: 800,
            }}
          >
            {waitingCipCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setQcSubTab('gate-pass');
            navigate('/qc/gate-pass');
          }}
          style={{
            padding: '8px 18px',
            fontSize: '0.88rem',
            fontWeight: 700,
            borderRadius: '6px 6px 0 0',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: qcSubTab === 'gate-pass' ? '#d97706' : '#f1f5f9',
            color: qcSubTab === 'gate-pass' ? '#ffffff' : '#475569',
            boxShadow: qcSubTab === 'gate-pass' ? '0 2px 4px rgba(217, 119, 6, 0.25)' : 'none',
          }}
        >
          <span>📋 Gate Pass</span>
          <span
            style={{
              fontSize: '0.72rem',
              padding: '1px 7px',
              borderRadius: '999px',
              backgroundColor: qcSubTab === 'gate-pass' ? '#b45309' : '#e2e8f0',
              color: qcSubTab === 'gate-pass' ? '#ffffff' : '#64748b',
              fontWeight: 800,
            }}
          >
            {gatePassWaiters.length}
          </span>
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fed7aa', borderLeft: '4px solid #ea580c', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase' }}>Waiting for QC</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#9a3412', marginTop: '2px' }}>{waitingQcCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Gross Weight done</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bae6fd', borderLeft: '4px solid #0284c7', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase' }}>Awaiting CIP</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#075985', marginTop: '2px' }}>{waitingCipCount}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Tare Weight done</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #fef08a', borderLeft: '4px solid #d97706', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase' }}>Awaiting Gate Pass</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#92400e', marginTop: '2px' }}>{gatePassWaiters.length}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>CIP passed, ready for exit</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #bbf7d0', borderLeft: '4px solid #16a34a', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Gate Passes Issued</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#14532d', marginTop: '2px' }}>{issuedGatePasses.length}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Stored with PDF export</div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #475569', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#334155', textTransform: 'uppercase' }}>QC Accepted / Rej</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
            <span style={{ color: '#16a34a' }}>{passedCount}</span> / <span style={{ color: '#dc2626' }}>{rejectedCount}</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>Lab decisions</div>
        </div>
      </div>

      {/* Main Vehicle Sheet Container */}
      <div
        className="card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          padding: '1.25rem',
          minHeight: '350px',
        }}
      >
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

        </div>

        {/* Card Header & Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
              📋 {qcSubTab === 'gate-pass'
                ? `Today's Gate Pass Register (${gatePassWaiters.length} Awaiting / ${issuedGatePasses.length} Issued)`
                : qcSubTab === 'cip'
                ? `Today's CIP Sanitization Register (${cipEligibleTankers.length} Vehicles)`
                : `Today's QC Laboratory Register (${qcEligibleTankers.length} Vehicles)`}
            </h3>
          </div>
        </div>

        {/* SHEET 1: Vehicles Waiting for QC (Gross Weight Completed) */}
        {qcSubTab === 'qc' && (
          <div>
            {filteredQcWaiters.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔬</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>
                  No vehicles currently waiting for QC Inspection
                </div>
                <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
                  Condition: Only vehicles for which Gross Weight has been completed will appear in this sheet.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                      <th style={{ padding: '10px 12px' }}>VEHICLE / TANKER NO</th>
                      <th style={{ padding: '10px 12px' }}>DC # / DC NO</th>
                      <th style={{ padding: '10px 12px' }}>RECEIVED FROM (BMC)</th>
                      <th style={{ padding: '10px 12px' }}>DRIVER NAME</th>
                      <th style={{ padding: '10px 12px' }}>GROSS WEIGHT (KG)</th>
                      <th style={{ padding: '10px 12px' }}>DISPATCHED (L)</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQcWaiters.map((t) => {
                      const dc = t.dc_number || t.stage_data?.dc_number || '—';
                      const grossKg = t.stage_data?.gross_weight?.gross_weight_kg || t.gross_weight_kg || '—';
                      return (
                        <tr
                          key={t.id}
                          onClick={() => openQcModal(t)}
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
                            {t.bmcs?.name || 'BMC'}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#475569' }}>
                            {t.driver_name || '—'}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                            {grossKg !== '—' ? `${Number(grossKg).toLocaleString('en-IN')} kg` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', color: '#0f172a' }}>
                            {formatLitres(t.quantity_dispatched)}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openQcModal(t);
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ backgroundColor: '#65a30d', borderColor: '#4d7c0f', fontWeight: 700, padding: '4px 12px' }}
                            >
                              🔬 Conduct QC
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
        )}

        {/* SHEET 2: Vehicles Waiting for CIP (Tare Weight Completed) */}
        {qcSubTab === 'cip' && (
          <div>
            {filteredCipWaiters.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🧼</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>
                  No vehicles currently waiting for CIP Sanitization
                </div>
                <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
                  Condition: Only vehicles for which Tare Weight has been completed will appear in this sheet.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                      <th style={{ padding: '10px 12px' }}>VEHICLE / TANKER NO</th>
                      <th style={{ padding: '10px 12px' }}>DC # / DC NO</th>
                      <th style={{ padding: '10px 12px' }}>RECEIVED FROM (BMC)</th>
                      <th style={{ padding: '10px 12px' }}>TARE WEIGHT (KG)</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCipWaiters.map((t) => {
                      const dc = t.dc_number || t.stage_data?.dc_number || '—';
                      const tareKg = t.stage_data?.tare_weight?.tare_weight_kg || t.tare_weight_kg || '—';
                      return (
                        <tr
                          key={t.id}
                          onClick={() => openCipModal(t)}
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
                            {t.bmcs?.name || 'BMC'}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                            {tareKg !== '—' ? `${Number(tareKg).toLocaleString('en-IN')} kg` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openCipModal(t);
                              }}
                              className="btn btn-primary btn-sm"
                              style={{ backgroundColor: '#0284c7', borderColor: '#0369a1', fontWeight: 700, padding: '4px 12px' }}
                            >
                              🧼 CIP Inspection
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
        )}

        {/* SHEET 3: Gate Pass (After CIP Completed) */}
        {qcSubTab === 'gate-pass' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Section A: Vehicles Waiting for Gate Pass */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    🚚 Vehicles Awaiting Gate Pass ({filteredGatePassWaiters.length})
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                    Condition: Tankers that passed CIP inspection and require an authentic Gate Pass before exiting through the gate.
                  </p>
                </div>
              </div>

              {filteredGatePassWaiters.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>🚚</div>
                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>
                    No vehicles currently waiting for Gate Pass
                  </div>
                  <p style={{ fontSize: '0.8rem', margin: '0.25rem 0' }}>
                    Vehicles will automatically appear here once CIP Sanitization is completed with SATISFIED status.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                        <th style={{ padding: '10px 12px' }}>VEHICLE / TANKER NO</th>
                        <th style={{ padding: '10px 12px' }}>DC # / DC NO</th>
                        <th style={{ padding: '10px 12px' }}>RECEIVED FROM (BMC)</th>
                        <th style={{ padding: '10px 12px' }}>DRIVER NAME</th>
                        <th style={{ padding: '10px 12px' }}>CIP STATUS</th>
                        <th style={{ padding: '10px 12px' }}>CIP TIME</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGatePassWaiters.map((t) => {
                        const dc = t.dc_number || t.stage_data?.dc_number || '—';
                        const cipTimeStr = t.stage_data?.cip_completed?.cip_time || t.stage_data?.cip_completed?.cip_date || 'Completed';
                        return (
                          <tr
                            key={t.id}
                            onClick={() => openGatePassModal(t)}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              cursor: 'pointer',
                              backgroundColor: selectedTankerId === t.id ? '#fefce8' : '#ffffff',
                              transition: 'background-color 0.15s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fefce8')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = selectedTankerId === t.id ? '#fefce8' : '#ffffff')}
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
                              {t.bmcs?.name || 'BMC'}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#475569' }}>
                              {t.driver_name || '—'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac', padding: '2px 8px', borderRadius: 4, fontWeight: 700, fontSize: '11px' }}>
                                ✓ CIP PASSED
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>
                              {cipTimeStr}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openGatePassModal(t);
                                }}
                                className="btn btn-primary btn-sm"
                                style={{ backgroundColor: '#d97706', borderColor: '#b45309', fontWeight: 700, padding: '4px 12px' }}
                              >
                                📋 Issue Gate Pass
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

            {/* Section B: Issued Gate Passes Register */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    📄 Issued Gate Passes Register ({filteredIssuedGatePasses.length})
                  </h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                    Official Gate Pass vouchers stored for tankers. Click "Export PDF" to generate the yellow receipt voucher.
                  </p>
                </div>
              </div>

              {filteredIssuedGatePasses.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', background: '#f8fafc', borderRadius: 6, border: '1px dashed #cbd5e1' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>📄</div>
                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem' }}>
                    No Gate Passes issued yet
                  </div>
                  <p style={{ fontSize: '0.8rem', margin: '0.25rem 0' }}>
                    Once you issue a Gate Pass for a vehicle above, it will be catalogued in this register.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                        <th style={{ padding: '10px 12px' }}>GATE PASS №</th>
                        <th style={{ padding: '10px 12px' }}>VEHICLE / TANKER NO</th>
                        <th style={{ padding: '10px 12px' }}>ISSUED TO (DRIVER)</th>
                        <th style={{ padding: '10px 12px' }}>PURPOSE</th>
                        <th style={{ padding: '10px 12px' }}>ISSUED BY</th>
                        <th style={{ padding: '10px 12px' }}>DATE & TIME</th>
                        <th style={{ padding: '10px 12px' }}>EXIT STATUS</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIssuedGatePasses.map((t) => {
                        const gp = t.gate_pass || t.stage_data?.gate_pass || {};
                        const gpNo = gp.gate_pass_no || t.gate_pass_no || '005616';
                        const driver = gp.to_whom_issued || t.driver_name || '—';
                        const purpose = gp.purpose || (t.bmcs?.name ? `TO ${t.bmcs.name.toUpperCase()}` : 'TO BMC');
                        const isExited = t.journey?.tripStatus === 'exited' || t.stage_data?.vehicle_exit != null;

                        return (
                          <tr
                            key={t.id}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              backgroundColor: '#ffffff',
                            }}
                          >
                            <td style={{ padding: '10px 12px' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '2px',
                                  border: '1.5px solid #991b1b',
                                  backgroundColor: '#fffbeb',
                                  color: '#991b1b',
                                  fontFamily: 'monospace',
                                  fontWeight: 800,
                                  fontSize: '12px',
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                }}
                              >
                                № {gpNo}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>
                              <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3 }}>
                                {t.tanker_number}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1e3a8a' }}>
                              {driver}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#334155' }}>
                              {purpose}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#475569' }}>
                              <span style={{ backgroundColor: '#f1f5f9', padding: '2px 6px', borderRadius: 3, fontSize: '11px', fontWeight: 700 }}>
                                {gp.issued_by || 'Lab'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>
                              {gp.date || '—'} {gp.time || ''}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {isExited ? (
                                <span style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 700 }}>
                                  EXITED
                                </span>
                              ) : (
                                <span style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #86efac', padding: '2px 8px', borderRadius: 4, fontSize: '11px', fontWeight: 700 }}>
                                  READY FOR EXIT
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleExportGatePassPdf(t.id, t.tanker_number)}
                                  disabled={exportingPdf}
                                  className="btn btn-sm"
                                  style={{
                                    backgroundColor: '#fef08a',
                                    border: '1px solid #ca8a04',
                                    color: '#854d0e',
                                    fontWeight: 700,
                                    padding: '3px 10px',
                                    borderRadius: 4,
                                    fontSize: '12px',
                                    cursor: exportingPdf ? 'not-allowed' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                  title="Export authentic yellow receipt PDF"
                                >
                                  📄 Export PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openGatePassModal(t)}
                                  className="btn btn-sm"
                                  style={{
                                    backgroundColor: '#f1f5f9',
                                    border: '1px solid #cbd5e1',
                                    color: '#334155',
                                    fontWeight: 600,
                                    padding: '3px 10px',
                                    borderRadius: 4,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                  }}
                                  title="View or modify Gate Pass voucher"
                                >
                                  ✏️ View
                                </button>
                              </div>
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
        )}
      </div>

      {/* DIALOG BOX MODAL 1: QUALITY CONTROL DETAILS (Requirement 3) */}
      {showQcModal && activeTanker && (
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
          onClick={() => setShowQcModal(false)}
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
              <span>QUALITY CONTROL DETAILS</span>
              <button
                type="button"
                onClick={() => setShowQcModal(false)}
                style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleUpdateQc();
                }}
              >
                {/* 3.1 Vehicle Details */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Vehicle No
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      value={qcVehicleNo || activeTanker.tanker_number || ''}
                      onChange={(e) => setQcVehicleNo(e.target.value.toUpperCase())}
                      style={{ width: 140, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontWeight: 600 }}
                    />
                    <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                      {qcVehicleNo || activeTanker.tanker_number}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                    Received From :
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {qcReceivedFromList.map((bmc, idx) => (
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

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    DC NO: <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={qcDcNo || activeTanker.dc_number || ''}
                    onChange={(e) => setQcDcNo(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Dispatch Date
                  </label>
                  <input
                    type="text"
                    value={qcDispatchDate}
                    onChange={(e) => setQcDispatchDate(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Dispatch Time(HHMM)[12 hour format]
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="text"
                      value={qcDispatchTime}
                      onChange={(e) => setQcDispatchTime(e.target.value)}
                      style={{ width: 90, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                    <select
                      value={qcDispatchAmPm}
                      onChange={(e) => setQcDispatchAmPm(e.target.value as any)}
                      style={{ height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff' }}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    QC Date
                  </label>
                  <input
                    type="text"
                    value={qcDate}
                    onChange={(e) => setQcDate(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    QC Time(HHMM)[12 hour format]
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="text"
                      value={qcTime}
                      onChange={(e) => setQcTime(e.target.value)}
                      style={{ width: 90, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                    <select
                      value={qcTimeAmPm}
                      onChange={(e) => setQcTimeAmPm(e.target.value as any)}
                      style={{ height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff' }}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>

                {/* 3.2 Dispatch Quality */}
                <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#475569', marginBottom: '0.5rem' }}>
                    Dispatch Quality
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dispatchQualityList.map((row, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 800, width: 35, color: '#1e293b' }}>{row.cell}</span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>Fat%</span>
                          <input
                            type="text"
                            value={row.fat}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, fat: val } : r)));
                            }}
                            style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>SNF%</span>
                          <input
                            type="text"
                            value={row.snf}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, snf: val } : r)));
                            }}
                            style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>CLR</span>
                          <input
                            type="text"
                            value={row.clr}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, clr: val } : r)));
                            }}
                            style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>Acidity%</span>
                          <input
                            type="text"
                            value={row.acidity}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, acidity: val } : r)));
                            }}
                            style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>Temp</span>
                          <input
                            type="text"
                            value={row.temp}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, temp: val } : r)));
                            }}
                            style={{ width: 40, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                          <span style={{ color: '#64748b' }}>°C</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>Milk Type</span>
                          <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 6px', borderRadius: 2, fontWeight: 700, fontSize: '0.8rem' }}>
                            {row.milkType}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ color: '#475569' }}>Quantity</span>
                          <input
                            type="text"
                            value={row.qty}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDispatchQualityList((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: val } : r)));
                            }}
                            style={{ width: 60, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3.3 Received Quality */}
                <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#475569', marginBottom: '0.5rem' }}>
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

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.82rem', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Purpose</span>
                            <select
                              value={row.purpose}
                              onChange={(e) => updateReceivedQuality(idx, 'purpose', e.target.value)}
                              style={{ padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2, backgroundColor: '#ffffff' }}
                            >
                              <option value="Purchase">Purchase</option>
                              <option value="Inter Unit Transfer">Inter Unit Transfer</option>
                              <option value="Conversion">Conversion</option>
                            </select>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>C/P/S</span>
                            <select
                              value={row.cps}
                              onChange={(e) => updateReceivedQuality(idx, 'cps', e.target.value)}
                              style={{ padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2, backgroundColor: '#ffffff' }}
                            >
                              <option value="Chilled">Chilled</option>
                              <option value="Pasteurized">Pasteurized</option>
                              <option value="Skim Separated Milk">Skim Separated Milk</option>
                              <option value="Condensed Skim Milk">Condensed Skim Milk</option>
                            </select>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Fat% *</span>
                            <input
                              type="text"
                              required
                              value={row.fat}
                              onChange={(e) => updateReceivedQuality(idx, 'fat', e.target.value)}
                              style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>SNF% *</span>
                            <input
                              type="text"
                              required
                              value={row.snf}
                              onChange={(e) => updateReceivedQuality(idx, 'snf', e.target.value)}
                              style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>CLR</span>
                            <input
                              type="text"
                              value={row.clr}
                              onChange={(e) => updateReceivedQuality(idx, 'clr', e.target.value)}
                              style={{ width: 45, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Acidity%</span>
                            <input
                              type="text"
                              value={row.acidity}
                              onChange={(e) => updateReceivedQuality(idx, 'acidity', e.target.value)}
                              style={{ width: 40, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Temp</span>
                            <input
                              type="text"
                              value={row.temp}
                              onChange={(e) => updateReceivedQuality(idx, 'temp', e.target.value)}
                              style={{ width: 40, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                            <span style={{ color: '#64748b' }}>°C</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Seal</span>
                            <input
                              type="text"
                              value={row.seal}
                              onChange={(e) => updateReceivedQuality(idx, 'seal', e.target.value)}
                              style={{ width: 70, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>MBRT</span>
                            <input
                              type="text"
                              value={row.mbrt}
                              onChange={(e) => updateReceivedQuality(idx, 'mbrt', e.target.value)}
                              style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Sample Date</span>
                            <input
                              type="text"
                              value={row.sampleDate}
                              onChange={(e) => updateReceivedQuality(idx, 'sampleDate', e.target.value)}
                              style={{ width: 85, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Sample Time</span>
                            <input
                              type="text"
                              value={row.sampleTime}
                              onChange={(e) => updateReceivedQuality(idx, 'sampleTime', e.target.value)}
                              style={{ width: 55, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>Sp Gr</span>
                            <input
                              type="text"
                              value={row.spGr}
                              onChange={(e) => updateReceivedQuality(idx, 'spGr', e.target.value)}
                              style={{ width: 50, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>COB</span>
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
                            <span style={{ fontWeight: 600, color: '#334155' }}>Milk Type</span>
                            <input
                              type="text"
                              value={row.milkType}
                              onChange={(e) => updateReceivedQuality(idx, 'milkType', e.target.value)}
                              style={{ width: 90, height: 26, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2 }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3.4 QC Manual Entry Reason */}
                <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', marginBottom: '4px' }}>
                    Qc Manual Entry Reason
                  </label>
                  <textarea
                    rows={2}
                    value={manualEntryReason}
                    onChange={(e) => setManualEntryReason(e.target.value)}
                    style={{ width: '100%', maxWidth: 450, padding: '4px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: '0.85rem' }}
                  />
                </div>

                {/* 3.5 SELECT TEST: test categories dynamically for each cell (FC, MC, BC, etc.) */}
                {(() => {
                  const availableCells = receivedQualityList.length > 0
                    ? Array.from(new Set(receivedQualityList.map((r) => r.cell)))
                    : ['FC', 'BC'];
                  const activeCell = selectedTestCellTab && availableCells.includes(selectedTestCellTab)
                    ? selectedTestCellTab
                    : availableCells[0] || 'FC';

                  return (
                    <div style={{ marginTop: '1.5rem', marginBottom: '1.25rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#475569', marginBottom: '0.5rem' }}>
                        Select Test
                      </div>
                      {testSavedToast && (
                        <div
                          style={{
                            backgroundColor: '#f0fdf4',
                            border: '1px solid #86efac',
                            borderRadius: 4,
                            padding: '6px 12px',
                            color: '#15803d',
                            fontWeight: 700,
                            fontSize: '0.84rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginBottom: '0.65rem',
                          }}
                        >
                          <span style={{ fontSize: '1rem' }}>✓</span>
                          <span>
                            <strong>{testSavedToast.test}</strong> test for compartment <strong>{testSavedToast.cell}</strong> saved successfully!
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        {availableCells.map((cellKey) => (
                          <div key={cellKey} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem', color: '#1e293b' }}>Test Type For {cellKey}</span>
                            <select
                              value={testTypes[cellKey] || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setTestTypes((prev) => ({ ...prev, [cellKey]: val }));
                                setSelectedTestCellTab(cellKey);
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
                        ))}

                        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                          {availableCells.map((cell) => (
                            <button
                              key={cell}
                              type="button"
                              onClick={() => setSelectedTestCellTab(cell)}
                              style={{
                                padding: '3px 10px',
                                borderRadius: 3,
                                border: activeCell === cell ? '2px solid #0284c7' : '1px solid #cbd5e1',
                                backgroundColor: activeCell === cell ? '#e0f2fe' : '#f8fafc',
                                color: activeCell === cell ? '#0369a1' : '#475569',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                              }}
                            >
                              {cell} {cell === 'FC' ? '(Front Cell)' : cell === 'BC' ? '(Back Cell)' : cell === 'MC' ? '(Middle Cell)' : ''}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Active Compartment Tests Container */}
                      {(() => {
                        const currentTests = cellTests[activeCell] || getDefaultCellTests();
                        const selectedType = testTypes[activeCell] || '';

                        if (!selectedType) {
                          return (
                            <div
                              style={{
                                padding: '2rem 1.5rem',
                                textAlign: 'center',
                                backgroundColor: '#f8fafc',
                                border: '1px dashed #cbd5e1',
                                borderRadius: 6,
                                color: '#64748b',
                              }}
                            >
                              <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>🧪</div>
                              <div style={{ fontWeight: 700, color: '#1e293b', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                                No Test Category Selected for {activeCell}
                              </div>
                              <div style={{ fontSize: '0.84rem' }}>
                                Please select a test from the <strong>Test Type For {activeCell}</strong> dropdown above to display test parameters.
                              </div>
                            </div>
                          );
                        }

                        const showFreshness = selectedType === 'ALL' || selectedType === 'Freshness';
                        const showSnf = selectedType === 'ALL' || selectedType === 'SNF Adulteration';
                        const showSpecial = selectedType === 'ALL' || selectedType === 'Special';
                        const showFat = selectedType === 'ALL' || selectedType === 'FAT Adulteration';

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                            {/* A. Freshness Test */}
                            {showFreshness && (
                              <div style={{ border: '1px solid #bbf7d0', borderRadius: 6, padding: '10px 12px', backgroundColor: '#f0fdf4' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#166534', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>A. Freshness Test — {activeCell}</span>
                                    {savedCellTests[`${activeCell}_Freshness`] && (
                                      <span style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700, backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: 3, border: '1px solid #86efac' }}>
                                        ✓ Saved
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'Freshness')}
                                    style={{
                                      backgroundColor: savedCellTests[`${activeCell}_Freshness`] ? '#15803d' : '#16a34a',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '3px 12px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_Freshness`] ? '✓ Saved' : 'Save'}
                                  </button>
                                </div>
                                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                                    <span>Temperature:</span>
                                    <input
                                      type="text"
                                      value={currentTests.freshnessTemp}
                                      onChange={(e) => updateCellTest(activeCell, 'freshnessTemp', e.target.value)}
                                      style={{ width: 45, height: 24, padding: '1px 4px', border: '1px solid #86efac', borderRadius: 2 }}
                                    />
                                    <span>°C</span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                                    <span>Organoleptic:</span>
                                    <select
                                      value={currentTests.freshnessOrganoleptic}
                                      onChange={(e) => updateCellTest(activeCell, 'freshnessOrganoleptic', e.target.value as any)}
                                      style={{ height: 24, padding: '1px 6px', border: '1px solid #86efac', borderRadius: 2, backgroundColor: '#ffffff' }}
                                    >
                                      <option value="Satisfied">Satisfied</option>
                                      <option value="Unsatisfied">Unsatisfied</option>
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                                    <span>Chemist Name:</span>
                                    <input
                                      type="text"
                                      value={currentTests.freshnessChemist}
                                      onChange={(e) => updateCellTest(activeCell, 'freshnessChemist', e.target.value)}
                                      style={{ width: 160, height: 24, padding: '1px 6px', border: '1px solid #86efac', borderRadius: 2 }}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #bbf7d0' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'Freshness')}
                                    style={{
                                      backgroundColor: '#16a34a',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '4px 14px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_Freshness`] ? '✓ Freshness Test Saved' : 'Save Freshness Test'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* B. SNF Adulteration Test */}
                            {showSnf && (
                              <div style={{ border: '1px solid #fed7aa', borderRadius: 6, padding: '10px 12px', backgroundColor: '#fff7ed' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#9a3412', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>B. SNF Adulteration Test — {activeCell}</span>
                                    {savedCellTests[`${activeCell}_SNF Adulteration`] && (
                                      <span style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700, backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: 3, border: '1px solid #86efac' }}>
                                        ✓ Saved
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'SNF Adulteration')}
                                    style={{
                                      backgroundColor: savedCellTests[`${activeCell}_SNF Adulteration`] ? '#15803d' : '#ea580c',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '3px 12px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_SNF Adulteration`] ? '✓ Saved' : 'Save'}
                                  </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '8px', fontSize: '0.82rem' }}>
                                  {[
                                    { label: 'Sugar Test', key: 'sugarTest' as const },
                                    { label: 'Starch Test', key: 'starchTest' as const },
                                    { label: 'Maltose Test', key: 'maltoseTest' as const },
                                    { label: 'Salt', key: 'saltTest' as const },
                                    { label: 'Urea', key: 'ureaTest' as const },
                                    { label: 'Neutralizers', key: 'neutralizersTest' as const },
                                    { label: 'Water', key: 'waterTest' as const },
                                    { label: 'Ammonium Sulphate', key: 'ammoniumSulphateTest' as const },
                                    { label: 'Abnormal', key: 'abnormalTest' as const },
                                  ].map((tItem) => (
                                    <div key={tItem.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', background: '#ffffff', padding: '3px 6px', borderRadius: 3, border: '1px solid #fed7aa' }}>
                                      <span style={{ color: '#431407' }}>{tItem.label}:</span>
                                      <select
                                        value={currentTests[tItem.key]}
                                        onChange={(e) => updateCellTest(activeCell, tItem.key, e.target.value as AdulterationTestResult)}
                                        style={{
                                          height: 22,
                                          fontSize: '0.78rem',
                                          border: '1px solid #fdba74',
                                          borderRadius: 2,
                                          backgroundColor: currentTests[tItem.key] === 'Positive' ? '#fee2e2' : '#ffffff',
                                          color: currentTests[tItem.key] === 'Positive' ? '#991b1b' : '#1e293b',
                                          fontWeight: currentTests[tItem.key] === 'Positive' ? 700 : 500,
                                        }}
                                      >
                                        <option value="Negative">Negative</option>
                                        <option value="Positive">Positive</option>
                                        <option value="Not Tested">Not Tested</option>
                                      </select>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
                                  <span style={{ color: '#9a3412', fontWeight: 600 }}>Chemist Name:</span>
                                  <input
                                    type="text"
                                    value={currentTests.snfChemist}
                                    onChange={(e) => updateCellTest(activeCell, 'snfChemist', e.target.value)}
                                    style={{ width: 180, height: 24, padding: '1px 6px', border: '1px solid #fdba74', borderRadius: 2 }}
                                  />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', paddingTop: '6px', borderTop: '1px dashed #fed7aa' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'SNF Adulteration')}
                                    style={{
                                      backgroundColor: '#ea580c',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '4px 14px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_SNF Adulteration`] ? '✓ SNF Test Saved' : 'Save SNF Adulteration Test'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* C. Special Test */}
                            {showSpecial && (
                              <div style={{ border: '1px solid #e9d5ff', borderRadius: 6, padding: '10px 12px', backgroundColor: '#faf5ff' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#6b21a8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>C. Special Test — {activeCell}</span>
                                    {savedCellTests[`${activeCell}_Special`] && (
                                      <span style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700, backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: 3, border: '1px solid #86efac' }}>
                                        ✓ Saved
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'Special')}
                                    style={{
                                      backgroundColor: savedCellTests[`${activeCell}_Special`] ? '#15803d' : '#9333ea',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '3px 12px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_Special`] ? '✓ Saved' : 'Save'}
                                  </button>
                                </div>
                                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', padding: '3px 8px', borderRadius: 3, border: '1px solid #e9d5ff' }}>
                                    <span>Antibiotic:</span>
                                    <select
                                      value={currentTests.antibioticTest}
                                      onChange={(e) => updateCellTest(activeCell, 'antibioticTest', e.target.value as AdulterationTestResult)}
                                      style={{
                                        height: 24,
                                        fontSize: '0.78rem',
                                        border: '1px solid #d8b4fe',
                                        borderRadius: 2,
                                        backgroundColor: currentTests.antibioticTest === 'Positive' ? '#fee2e2' : '#ffffff',
                                        color: currentTests.antibioticTest === 'Positive' ? '#991b1b' : '#1e293b',
                                        fontWeight: currentTests.antibioticTest === 'Positive' ? 700 : 500,
                                      }}
                                    >
                                      <option value="Negative">Negative</option>
                                      <option value="Positive">Positive</option>
                                      <option value="Not Tested">Not Tested</option>
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', padding: '3px 8px', borderRadius: 3, border: '1px solid #e9d5ff' }}>
                                    <span>Aflatoxin Test:</span>
                                    <select
                                      value={currentTests.aflatoxinTest}
                                      onChange={(e) => updateCellTest(activeCell, 'aflatoxinTest', e.target.value as AdulterationTestResult)}
                                      style={{
                                        height: 24,
                                        fontSize: '0.78rem',
                                        border: '1px solid #d8b4fe',
                                        borderRadius: 2,
                                        backgroundColor: currentTests.aflatoxinTest === 'Positive' ? '#fee2e2' : '#ffffff',
                                        color: currentTests.aflatoxinTest === 'Positive' ? '#991b1b' : '#1e293b',
                                        fontWeight: currentTests.aflatoxinTest === 'Positive' ? 700 : 500,
                                      }}
                                    >
                                      <option value="Negative">Negative</option>
                                      <option value="Positive">Positive</option>
                                      <option value="Not Tested">Not Tested</option>
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ color: '#6b21a8', fontWeight: 600 }}>Chemist Name:</span>
                                    <input
                                      type="text"
                                      value={currentTests.specialChemist}
                                      onChange={(e) => updateCellTest(activeCell, 'specialChemist', e.target.value)}
                                      style={{ width: 180, height: 24, padding: '1px 6px', border: '1px solid #d8b4fe', borderRadius: 2 }}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #e9d5ff' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'Special')}
                                    style={{
                                      backgroundColor: '#9333ea',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '4px 14px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_Special`] ? '✓ Special Test Saved' : 'Save Special Test'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* D. FAT Adulteration Test */}
                            {showFat && (
                              <div style={{ border: '1px solid #fecdd3', borderRadius: 6, padding: '10px 12px', backgroundColor: '#fff1f2' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#9f1239', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>D. FAT Adulteration Test — {activeCell}</span>
                                    {savedCellTests[`${activeCell}_FAT Adulteration`] && (
                                      <span style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 700, backgroundColor: '#dcfce7', padding: '1px 6px', borderRadius: 3, border: '1px solid #86efac' }}>
                                        ✓ Saved
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'FAT Adulteration')}
                                    style={{
                                      backgroundColor: savedCellTests[`${activeCell}_FAT Adulteration`] ? '#15803d' : '#e11d48',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '3px 12px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_FAT Adulteration`] ? '✓ Saved' : 'Save'}
                                  </button>
                                </div>
                                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.82rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.82rem' }}>
                                    <span>Free Fatty Acid:</span>
                                    <input
                                      type="text"
                                      value={currentTests.freeFattyAcid}
                                      onChange={(e) => updateCellTest(activeCell, 'freeFattyAcid', e.target.value)}
                                      style={{ width: 45, height: 24, padding: '1px 4px', border: '1px solid #fda4af', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>B.R.:</span>
                                    <input
                                      type="text"
                                      value={currentTests.brReading}
                                      onChange={(e) => updateCellTest(activeCell, 'brReading', e.target.value)}
                                      style={{ width: 45, height: 24, padding: '1px 4px', border: '1px solid #fda4af', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#ffffff', padding: '2px 6px', borderRadius: 3, border: '1px solid #fecdd3' }}>
                                    <span>MOT:</span>
                                    <select
                                      value={currentTests.motTest}
                                      onChange={(e) => updateCellTest(activeCell, 'motTest', e.target.value as AdulterationTestResult)}
                                      style={{
                                        height: 22,
                                        fontSize: '0.78rem',
                                        border: '1px solid #fda4af',
                                        borderRadius: 2,
                                        backgroundColor: currentTests.motTest === 'Positive' ? '#fee2e2' : '#ffffff',
                                        color: currentTests.motTest === 'Positive' ? '#991b1b' : '#1e293b',
                                        fontWeight: currentTests.motTest === 'Positive' ? 700 : 500,
                                      }}
                                    >
                                      <option value="Negative">Negative</option>
                                      <option value="Positive">Positive</option>
                                      <option value="Not Tested">Not Tested</option>
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>R.M.:</span>
                                    <input
                                      type="text"
                                      value={currentTests.rmValue}
                                      onChange={(e) => updateCellTest(activeCell, 'rmValue', e.target.value)}
                                      style={{ width: 45, height: 24, padding: '1px 4px', border: '1px solid #fda4af', borderRadius: 2 }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span style={{ color: '#9f1239', fontWeight: 600 }}>Chemist Name:</span>
                                    <input
                                      type="text"
                                      value={currentTests.fatChemist}
                                      onChange={(e) => updateCellTest(activeCell, 'fatChemist', e.target.value)}
                                      style={{ width: 170, height: 24, padding: '1px 6px', border: '1px solid #fda4af', borderRadius: 2 }}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px', paddingTop: '6px', borderTop: '1px dashed #fecdd3' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveTest(activeCell, 'FAT Adulteration')}
                                    style={{
                                      backgroundColor: '#e11d48',
                                      color: '#ffffff',
                                      border: 'none',
                                      borderRadius: 3,
                                      padding: '4px 14px',
                                      fontWeight: 700,
                                      fontSize: '0.8rem',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {savedCellTests[`${activeCell}_FAT Adulteration`] ? '✓ FAT Test Saved' : 'Save FAT Adulteration Test'}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Save All Tests for this Compartment */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px', paddingTop: '8px', borderTop: '1px dashed #cbd5e1' }}>
                              <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                                Selected Test for <strong>{activeCell}</strong>: <strong style={{ color: '#0f172a' }}>{selectedType}</strong>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleSaveAllTestsForCell(activeCell)}
                                style={{
                                  backgroundColor: '#16a34a',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 3,
                                  padding: '5px 16px',
                                  fontWeight: 700,
                                  fontSize: '0.82rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                }}
                              >
                                💾 Save All Tests For {activeCell}
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* 3.6 QC Completion */}
                <div style={{ marginTop: '1.25rem', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                      Tests Completed:
                    </span>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {(receivedQualityList.length > 0 ? Array.from(new Set(receivedQualityList.map((r) => r.cell))) : ['FC', 'BC']).map((cell) => {
                        const cellType = testTypes[cell];
                        const isDone = Boolean(cellType && cellType !== '');
                        const isSaved = Boolean(savedCellTests[cell]);
                        return (
                          <span
                            key={cell}
                            style={{
                              color: isSaved ? '#15803d' : isDone ? '#16a34a' : '#ca8a04',
                              fontWeight: 800,
                              fontSize: '0.85rem',
                              backgroundColor: isSaved ? '#bbf7d0' : isDone ? '#dcfce7' : '#fef9c3',
                              border: isSaved ? '1px solid #86efac' : '1px solid transparent',
                              padding: '2px 8px',
                              borderRadius: 4,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            {cell} {isSaved ? `✓ (${cellType || 'Saved'})` : isDone ? `✓ (${cellType})` : 'Pending'}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', marginBottom: '4px' }}>
                      Remarks
                    </label>
                    <textarea
                      rows={2}
                      value={qcRemarks}
                      onChange={(e) => setQcRemarks(e.target.value)}
                      style={{ width: '100%', maxWidth: 500, padding: '4px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: '0.85rem' }}
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setShowRejectModal(true)}
                    style={{
                      backgroundColor: '#84cc16',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 3,
                      padding: '6px 18px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    REJECT
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowQcModal(false)}
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

      {/* DIALOG BOX MODAL 2: CIP DETAILS (Requirement 5) */}
      {showCipModal && activeTanker && (
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
          onClick={() => setShowCipModal(false)}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 8,
              width: '100%',
              maxWidth: 820,
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
              <span>CIP DETAILS</span>
              <button
                type="button"
                onClick={() => setShowCipModal(false)}
                style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleUpdateCip();
                }}
              >
                {/* 1. Vehicle No */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Vehicle No
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      value={cipVehicleNo || activeTanker.tanker_number || ''}
                      onChange={(e) => setCipVehicleNo(e.target.value.toUpperCase())}
                      style={{ width: 140, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, fontWeight: 600 }}
                    />
                    <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                      {cipVehicleNo || activeTanker.tanker_number}
                    </span>
                  </div>
                </div>

                {/* 2. Received From */}
                <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem', paddingTop: '4px' }}>
                    Received From :
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {cipReceivedFromList.map((bmc, idx) => (
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

                {/* 3. DC NO */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    DC NO: <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={cipDcNo || activeTanker.dc_number || ''}
                    onChange={(e) => setCipDcNo(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                {/* 4. Dispatch Date */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Dispatch Date
                  </label>
                  <input
                    type="text"
                    value={cipDispatchDate}
                    onChange={(e) => setCipDispatchDate(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                {/* 5. Dispatch Time(HHMM)[12 hour format] */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Dispatch Time(HHMM)[12 hour format]
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="text"
                      value={cipDispatchTime}
                      onChange={(e) => setCipDispatchTime(e.target.value)}
                      style={{ width: 90, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                    <select
                      value={cipDispatchAmPm}
                      onChange={(e) => setCipDispatchAmPm(e.target.value as any)}
                      style={{ height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff' }}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>

                {/* 6. CIP Date */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    CIP Date
                  </label>
                  <input
                    type="text"
                    value={cipDate}
                    onChange={(e) => setCipDate(e.target.value)}
                    style={{ width: 150, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                {/* 7. CIP Time(HHMM)[12 hour format] */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    CIP Time(HHMM)[12 hour format]
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="text"
                      value={cipTime}
                      onChange={(e) => setCipTime(e.target.value)}
                      style={{ width: 90, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                    />
                    <select
                      value={cipTimeAmPm}
                      onChange={(e) => setCipTimeAmPm(e.target.value as any)}
                      style={{ height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff' }}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>

                {/* 8. CIP Operator */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    CIP Operator
                  </label>
                  <input
                    type="text"
                    placeholder="Operator name"
                    value={cipOperator}
                    onChange={(e) => setCipOperator(e.target.value)}
                    style={{ width: 200, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>

                {/* 9. QC Inspection */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    QC Inspection
                  </label>
                  <select
                    value={qcInspection}
                    onChange={(e) => setQcInspection(e.target.value as any)}
                    style={{ width: 140, height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 3, backgroundColor: '#ffffff', fontWeight: 600 }}
                  >
                    <option value="SATISFIED">SATISFIED</option>
                    <option value="UNSATISFIED">UNSATISFIED</option>
                  </select>
                </div>

                {/* 10. CIP Clean Types */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    CIP Clean Types
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.88rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#16a34a' }}>
                      <input
                        type="checkbox"
                        checked={cipAutomaticTest}
                        onChange={(e) => setCipAutomaticTest(e.target.checked)}
                      />
                      Automatic Test
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#dc2626' }}>
                      <input
                        type="checkbox"
                        checked={cipManualTest}
                        onChange={(e) => setCipManualTest(e.target.checked)}
                      />
                      Manual Test
                    </label>
                  </div>
                </div>

                {/* 11. Is CIP Checked */}
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <label style={{ width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' }}>
                    Is CIP Checked <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="checkbox"
                    checked={isCipChecked}
                    onChange={(e) => setIsCipChecked(e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                  <button
                    type="button"
                    onClick={() => setShowCipModal(false)}
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

      {/* DIALOG BOX MODAL 3: GATE PASS (Authentic Yellow Voucher Slip) */}
      {showGatePassModal && (gatePassTanker || activeTanker) && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '1rem',
          }}
          onClick={() => setShowGatePassModal(false)}
        >
          <div
            style={{
              backgroundColor: '#fef9c3',
              border: '2px solid #ca8a04',
              borderRadius: 8,
              width: '100%',
              maxWidth: 780,
              maxHeight: '94vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar with Close button */}
            <div
              style={{
                backgroundColor: '#ca8a04',
                color: '#ffffff',
                padding: '0.45rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>📋 AAVIN GATE PASS VOUCHER — (CIP COMPLETED VEHICLE)</span>
              <button
                type="button"
                onClick={() => setShowGatePassModal(false)}
                style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 800 }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveGatePass();
                }}
              >
                {/* 1. Header: Aavin logo, Union title, Gate Pass, Serial Number */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1.5px solid #ca8a04', paddingBottom: '0.75rem', marginBottom: '0.75rem', gap: '8px' }}>
                  {/* Left: Aavin Logo */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      style={{
                        backgroundColor: '#0072bc',
                        color: '#ffffff',
                        fontWeight: 900,
                        fontSize: '18px',
                        padding: '4px 14px',
                        borderRadius: '6px',
                        letterSpacing: '-0.5px',
                        display: 'inline-block',
                      }}
                    >
                      aavin
                    </div>
                  </div>

                  {/* Center: Union Title & Gate Pass heading */}
                  <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.25 }}>
                      Namakkal District Co-operative Milk Producers' Union Limited,
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e293b', marginTop: '2px' }}>
                      NAMAKKAL MILK UNION
                    </div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900, color: '#0f172a', textDecoration: 'underline', marginTop: '4px', letterSpacing: '0.05em' }}>
                      GATE PASS
                    </div>
                  </div>

                  {/* Right: Boxed Red Serial Number */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px' }}>
                      <span style={{ fontSize: '1.2rem', fontWeight: 800, color: '#991b1b', marginRight: '2px' }}>№</span>
                      {gatePassNo.padStart(6, '0').slice(-6).split('').map((digit, i) => (
                        <span
                          key={i}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '20px',
                            height: '26px',
                            border: '1.5px solid #991b1b',
                            backgroundColor: '#ffffff',
                            color: '#991b1b',
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            fontSize: '14px',
                            borderRadius: '2px',
                          }}
                        >
                          {digit}
                        </span>
                      ))}
                    </div>
                    <div style={{ marginTop: '4px' }}>
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="Serial #"
                        value={gatePassNo}
                        onChange={(e) => setGatePassNo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        style={{
                          width: '80px',
                          fontSize: '11px',
                          padding: '2px 4px',
                          textAlign: 'center',
                          border: '1px solid #f87171',
                          borderRadius: 3,
                          backgroundColor: '#fff',
                        }}
                        title="Edit serial number"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Date and Time Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Time:</span>
                    <input
                      type="text"
                      value={gatePassTime}
                      onChange={(e) => setGatePassTime(e.target.value)}
                      placeholder="e.g. 3.08 PM"
                      style={{
                        backgroundColor: '#fffbeb',
                        border: 'none',
                        borderBottom: '1.5px dashed #b45309',
                        padding: '2px 6px',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        width: '100px',
                        color: '#0f172a',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>Date:</span>
                    <input
                      type="text"
                      value={gatePassDate}
                      onChange={(e) => setGatePassDate(e.target.value)}
                      placeholder="e.g. 23.11.26"
                      style={{
                        backgroundColor: '#fffbeb',
                        border: 'none',
                        borderBottom: '1.5px dashed #b45309',
                        padding: '2px 6px',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        width: '100px',
                        color: '#0f172a',
                      }}
                    />
                  </div>
                </div>

                {/* 3. 5-Column Grid Table */}
                <div style={{ marginBottom: '1rem', border: '1.5px solid #1e293b', borderRadius: 4, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#fef08a', borderBottom: '1.5px solid #1e293b', textAlign: 'center', fontWeight: 800, color: '#0f172a' }}>
                        <th style={{ width: '60px', padding: '6px 8px', borderRight: '1.5px solid #1e293b' }}>Sl. No.</th>
                        <th style={{ padding: '6px 8px', borderRight: '1.5px solid #1e293b' }}>Item</th>
                        <th style={{ width: '60px', padding: '6px 8px', borderRight: '1.5px solid #1e293b' }}>Qty.</th>
                        <th style={{ padding: '6px 8px', borderRight: '1.5px solid #1e293b' }}>Purpose</th>
                        <th style={{ padding: '6px 8px' }}>Whether returnable</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ backgroundColor: '#ffffff' }}>
                        <td style={{ padding: '6px', borderRight: '1.5px solid #1e293b', textAlign: 'center' }}>
                          <input
                            type="text"
                            value={gatePassSlNo}
                            onChange={(e) => setGatePassSlNo(e.target.value)}
                            style={{
                              width: '100%',
                              textAlign: 'center',
                              fontWeight: 700,
                              border: '1px solid #cbd5e1',
                              borderRadius: 2,
                              padding: '4px 2px',
                            }}
                          />
                        </td>
                        <td style={{ padding: '6px', borderRight: '1.5px solid #1e293b' }}>
                          <input
                            type="text"
                            value={gatePassItem}
                            onChange={(e) => setGatePassItem(e.target.value)}
                            style={{
                              width: '100%',
                              fontWeight: 700,
                              border: '1px solid #cbd5e1',
                              borderRadius: 2,
                              padding: '4px 8px',
                              color: '#0f172a',
                            }}
                          />
                        </td>
                        <td style={{ padding: '6px', borderRight: '1.5px solid #1e293b', textAlign: 'center' }}>
                          <input
                            type="text"
                            value={gatePassQty}
                            onChange={(e) => setGatePassQty(e.target.value)}
                            style={{
                              width: '100%',
                              textAlign: 'center',
                              fontWeight: 700,
                              border: '1px solid #cbd5e1',
                              borderRadius: 2,
                              padding: '4px 2px',
                            }}
                          />
                        </td>
                        <td style={{ padding: '6px', borderRight: '1.5px solid #1e293b' }}>
                          <input
                            type="text"
                            value={gatePassPurpose}
                            onChange={(e) => setGatePassPurpose(e.target.value)}
                            style={{
                              width: '100%',
                              fontWeight: 700,
                              border: '1px solid #cbd5e1',
                              borderRadius: 2,
                              padding: '4px 8px',
                              color: '#0f172a',
                            }}
                          />
                        </td>
                        <td style={{ padding: '6px' }}>
                          <input
                            type="text"
                            value={gatePassReturnable}
                            onChange={(e) => setGatePassReturnable(e.target.value)}
                            style={{
                              width: '100%',
                              fontWeight: 700,
                              border: '1px solid #cbd5e1',
                              borderRadius: 2,
                              padding: '4px 8px',
                              color: '#0f172a',
                            }}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* 4. Bottom Fields */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.25rem', fontSize: '0.88rem' }}>
                  {/* To whom issued */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ width: '130px', fontWeight: 700, color: '#0f172a' }}>
                      To whom issued :
                    </label>
                    <input
                      type="text"
                      required
                      value={gatePassToWhom}
                      onChange={(e) => setGatePassToWhom(e.target.value)}
                      placeholder="Driver name (e.g. S. PERIYASAMY)"
                      style={{
                        flex: 1,
                        backgroundColor: '#ffffff',
                        border: '1px solid #b45309',
                        borderRadius: 3,
                        padding: '5px 10px',
                        fontWeight: 700,
                        color: '#1e3a8a',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>

                  {/* Issued by */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <label style={{ width: '130px', fontWeight: 700, color: '#0f172a' }}>
                      Issued by :
                    </label>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {['Stores', 'CC', 'TPT', 'ADM', 'Lab', 'P&I'].map((dept) => {
                        const isSelected = gatePassIssuedBy === dept;
                        return (
                          <button
                            key={dept}
                            type="button"
                            onClick={() => setGatePassIssuedBy(dept)}
                            style={{
                              padding: '3px 10px',
                              borderRadius: 4,
                              fontSize: '0.8rem',
                              fontWeight: isSelected ? 800 : 600,
                              cursor: 'pointer',
                              border: isSelected ? '1.5px solid #1e3a8a' : '1px solid #cbd5e1',
                              backgroundColor: isSelected ? '#1e3a8a' : '#ffffff',
                              color: isSelected ? '#ffffff' : '#475569',
                            }}
                          >
                            {dept}
                          </button>
                        );
                      })}
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '6px' }}>
                        (Stores / CC / TPT / ADM / Lab / P&I)
                      </span>
                    </div>
                  </div>

                  {/* Vehicle No */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ width: '130px', fontWeight: 700, color: '#0f172a' }}>
                      Vehicle No. if any :
                    </label>
                    <input
                      type="text"
                      required
                      value={gatePassVehicleNo}
                      onChange={(e) => setGatePassVehicleNo(e.target.value)}
                      placeholder="Tanker No (e.g. TN 18 AF 3000)"
                      style={{
                        flex: 1,
                        backgroundColor: '#ffffff',
                        border: '1px solid #b45309',
                        borderRadius: 3,
                        padding: '5px 10px',
                        fontWeight: 700,
                        color: '#b45309',
                        fontSize: '0.9rem',
                      }}
                    />
                  </div>
                </div>

                {/* 5. Signatures Row */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '12px',
                    paddingTop: '0.75rem',
                    borderTop: '1px dashed #b45309',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      Issuing Officer.
                    </label>
                    <input
                      type="text"
                      value={gatePassIssuingOfficer}
                      onChange={(e) => setGatePassIssuingOfficer(e.target.value)}
                      placeholder="QC Officer name"
                      style={{
                        width: '100%',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 3,
                        padding: '4px 8px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        color: '#1e3a8a',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      Received.
                    </label>
                    <input
                      type="text"
                      value={gatePassReceivedBy}
                      onChange={(e) => setGatePassReceivedBy(e.target.value)}
                      placeholder="Driver Signature / Name"
                      style={{
                        width: '100%',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 3,
                        padding: '4px 8px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        color: '#334155',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                      Security.
                    </label>
                    <input
                      type="text"
                      value={gatePassSecurity}
                      onChange={(e) => setGatePassSecurity(e.target.value)}
                      placeholder="Security Incharge"
                      style={{
                        width: '100%',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 3,
                        padding: '4px 8px',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        color: '#334155',
                      }}
                    />
                  </div>
                </div>

                {/* 6. Form Footer Actions */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '0.75rem',
                    borderTop: '1.5px solid #ca8a04',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div>
                    {(gatePassTanker?.id || activeTanker?.id) && (
                      <button
                        type="button"
                        onClick={() => handleExportGatePassPdf(gatePassTanker?.id || activeTanker.id, gatePassVehicleNo)}
                        disabled={exportingPdf}
                        style={{
                          backgroundColor: '#fde047',
                          color: '#713f12',
                          border: '1.5px solid #ca8a04',
                          borderRadius: 4,
                          padding: '6px 14px',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: exportingPdf ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📄 Export PDF</span>
                        {exportingPdf && <span style={{ fontSize: '11px' }}>(Generating...)</span>}
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setShowGatePassModal(false)}
                      className="btn btn-secondary"
                      style={{ padding: '6px 16px', fontSize: '0.85rem' }}
                    >
                      Close
                    </button>

                    <button
                      type="submit"
                      disabled={submitting}
                      style={{
                        backgroundColor: '#16a34a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 4,
                        padding: '6px 20px',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        boxShadow: '0 2px 4px rgba(22, 163, 74, 0.3)',
                      }}
                    >
                      {submitting ? 'Issuing…' : '💾 Save & Issue Gate Pass'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* REJECTION CONFIRMATION MODAL */}
      {showRejectModal && activeTanker && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500, padding: '1.5rem', background: '#ffffff', borderRadius: 8 }}>
            <h3 style={{ color: '#dc2626', margin: '0 0 0.5rem 0', fontSize: '1.15rem' }}>
              Confirm Tanker Milk Rejection
            </h3>
            <p style={{ fontSize: '0.88rem', color: '#475569', marginBottom: '1rem' }}>
              Are you sure you want to REJECT Tanker <strong>{activeTanker.tanker_number}</strong>? This tanker will be blocked from unloading bay and rerouted directly to weighbridge for Tare weighing and departure.
            </p>

            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem', color: '#1e293b' }}>
              Rejection Reason <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              required
              rows={3}
              placeholder="Specify the lab test failure, off-flavor, high temperature, or adulteration reason..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid #f87171', borderRadius: 4, fontSize: '0.85rem' }}
            />

            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {quickRejectionReasons.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRejectionReason(r)}
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    cursor: 'pointer',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button type="button" onClick={() => setShowRejectModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRejection()}
                disabled={submitting}
                className="btn btn-danger"
                style={{ backgroundColor: '#dc2626', borderColor: '#b91c1c' }}
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
