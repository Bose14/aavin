import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
import {
  calcRateFromChart,
  formatDateDDMMYYYY,
  formatFatSnf,
  formatINR,
  formatLitres,
  getLocalTodayIso,
} from '../../lib/format';
import {
  enqueueOfflineMilkEntry,
  listOfflineMilkEntries,
  syncOfflineMilkEntries,
} from '../../lib/offlineQueue';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Society {
  id: string;
  code: string;
  name: string;
}

interface ExistingEntry {
  id: string;
  date: string;
  shift: 'AM' | 'PM';
}

interface RecentEntry {
  id: string;
  date: string;
  shift: 'AM' | 'PM';
  dispatch_date?: string | null;
  cans?: number | null;
  quantity_litres: number;
  fat_pct: number;
  snf_pct: number;
  rate_per_litre: number;
  status?: string;
  is_locked?: boolean;
}

interface RowInput {
  cans: string;
  litres: string;
  fat: string;
  snf: string;
}

const EMPTY_ROW: RowInput = { cans: '', litres: '', fat: '', snf: '' };

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function MilkEntry() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings } = useDairyUnitSettings();

  const [date, setDate] = useState(() => getLocalTodayIso());
  const [shift, setShift] = useState<'AM' | 'PM'>(() => (new Date().getHours() < 12 ? 'AM' : 'PM'));
  const [dispatchDate, setDispatchDate] = useState('');
  const [dispatchTouched, setDispatchTouched] = useState(false);
  const [temperature, setTemperature] = useState('');

  const [societies, setSocieties] = useState<Society[]>([]);
  const [societiesLoading, setSocietiesLoading] = useState(true);
  const [rows, setRows] = useState<Record<string, RowInput>>({});
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');

  const [showModal, setShowModal] = useState(() => Boolean(searchParams.get('editId')));
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RecentEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(() => searchParams.get('editId'));
  const [existingForSlot, setExistingForSlot] = useState<ExistingEntry | null>(null);
  const [offlineCount, setOfflineCount] = useState(() => listOfflineMilkEntries().length);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedBanner, setSavedBanner] = useState<{
    id: string | null;
    offline: boolean;
    message: string;
    canUndo: boolean;
  } | null>(null);

  // Dispatch date follows the collection date until the operator changes it:
  // morning milk usually goes the same day, evening milk the next day.
  useEffect(() => {
    if (!dispatchTouched) setDispatchDate(addDays(date, shift === 'PM' ? 1 : 0));
  }, [date, shift, dispatchTouched]);

  useEffect(() => {
    if (!savedBanner?.canUndo) return;
    const timer = window.setTimeout(() => {
      setSavedBanner(prev => (prev ? { ...prev, canUndo: false } : null));
    }, 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [savedBanner?.id, savedBanner?.canUndo]);

  useEffect(() => {
    const refresh = () => setOfflineCount(listOfflineMilkEntries().length);
    window.addEventListener('aavin-offline-queue-changed', refresh);
    return () => window.removeEventListener('aavin-offline-queue-changed', refresh);
  }, []);

  // The BMC's societies, in the order they are collected
  useEffect(() => {
    let cancelled = false;
    setSocietiesLoading(true);
    api.get<Society[]>('/societies')
      .then(res => { if (!cancelled) setSocieties(res.data || []); })
      .catch(() => { if (!cancelled) setError('Could not load the society list. Please refresh.'); })
      .finally(() => { if (!cancelled) setSocietiesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const from = addDays(getLocalTodayIso(), -60);
      const to = addDays(getLocalTodayIso(), 2);
      const res = await api.get<RecentEntry[]>('/milk', { params: { from, to } });
      setRecent(res.data || []);
    } catch {
      // the list is a convenience; the form still works without it
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecent();
  }, [fetchRecent]);

  // Load an entry for editing
  const loadForEdit = useCallback((entryId: string) => {
    setError('');
    api.get<{
      entry: { id: string; date: string; shift: 'AM' | 'PM'; dispatch_date: string | null; temperature: number | null };
      lines: Array<{ society_id: string; cans: number; litres: number; fat_pct: number; snf_pct: number }>;
    }>(`/milk/${entryId}/lines`)
      .then(res => {
        const { entry, lines } = res.data;
        setEditingId(entry.id);
        setDate(entry.date);
        setShift(entry.shift);
        setDispatchTouched(true);
        setDispatchDate(entry.dispatch_date ?? entry.date);
        setTemperature(entry.temperature != null ? String(entry.temperature) : '');
        const next: Record<string, RowInput> = {};
        for (const l of lines) {
          next[String(l.society_id)] = {
            cans: l.cans ? String(l.cans) : '',
            litres: String(l.litres),
            fat: String(l.fat_pct),
            snf: String(l.snf_pct),
          };
        }
        setRows(next);
        setAddedIds(lines.map(l => String(l.society_id)));
        setShowModal(true);
        if (lines.length === 0) {
          setError('This entry was saved before society-wise entry existed. Enter the societies again and save to replace it.');
        }
      })
      .catch(() => setError('Could not load this entry.'));
  }, []);

  useEffect(() => {
    const editIdParam = searchParams.get('editId');
    if (editIdParam) loadForEdit(editIdParam);
  }, [searchParams, loadForEdit]);

  // Duplicate (date, shift) detection
  useEffect(() => {
    if (editingId || !date || !shift) {
      setExistingForSlot(null);
      return;
    }
    let cancelled = false;
    api.get<ExistingEntry[]>('/milk', { params: { from: date, to: date, shift } })
      .then(res => {
        if (cancelled) return;
        setExistingForSlot(res.data.find(r => r.date === date && r.shift === shift) ?? null);
      })
      .catch(() => { if (!cancelled) setExistingForSlot(null); });
    return () => { cancelled = true; };
  }, [date, shift, editingId]);

  const setCell = (societyId: string, key: keyof RowInput, value: string) => {
    setRows(prev => ({ ...prev, [societyId]: { ...(prev[societyId] ?? EMPTY_ROW), [key]: value } }));
  };

  // Per-row calculations and checks
  const computed = useMemo(() => {
    const byId = new Map(societies.map(s => [s.id, s]));
    const shown = addedIds.map(id => byId.get(id)).filter((s): s is Society => Boolean(s));
    return shown.map(s => {
      const r = rows[s.id] ?? EMPTY_ROW;
      const litres = num(r.litres);
      const fat = num(r.fat);
      const snf = num(r.snf);
      const cans = r.cans.trim() === '' ? 0 : Number(r.cans);
      const touched = r.cans.trim() !== '' || r.litres.trim() !== '' || r.fat.trim() !== '' || r.snf.trim() !== '';
      let problem = '';
      if (touched) {
        if (!(litres > 0)) problem = 'Enter litres';
        else if (!Number.isFinite(fat)) problem = 'Enter fat %';
        else if (!Number.isFinite(snf)) problem = 'Enter SNF %';
        else if (fat < settings.fat_min || fat > settings.fat_max) {
          problem = `Fat must be ${formatFatSnf(settings.fat_min)}–${formatFatSnf(settings.fat_max)}`;
        } else if (snf < settings.snf_min || snf > settings.snf_max) {
          problem = `SNF must be ${formatFatSnf(settings.snf_min)}–${formatFatSnf(settings.snf_max)}`;
        } else if (!Number.isInteger(cans) || cans < 0) problem = 'Cans must be a whole number';
      }
      const ok = touched && !problem;
      const rate = ok ? calcRateFromChart(fat, snf, settings) : 0;
      return {
        society: s,
        touched,
        ok,
        problem,
        cans: ok ? cans : 0,
        litres: ok ? litres : 0,
        fat: ok ? fat : 0,
        snf: ok ? snf : 0,
        ltFat: ok ? Math.round(litres * fat * 10) / 1000 : 0,
        ltSnf: ok ? Math.round(litres * snf * 10) / 1000 : 0,
        // Lactometer reading implied by fat and SNF: SNF = LR/4 + 0.2 x Fat + 0.36
        lr: ok ? Math.round(4 * (snf - 0.2 * fat - 0.36) * 10) / 10 : 0,
        rate,
        amount: ok ? round2(litres * rate) : 0,
      };
    });
  }, [societies, addedIds, rows, settings]);

  const totals = useMemo(() => {
    const ok = computed.filter(c => c.ok);
    const litres = ok.reduce((s, c) => s + c.litres, 0);
    const ltFat = ok.reduce((s, c) => s + (c.litres * c.fat) / 100, 0);
    const ltSnf = ok.reduce((s, c) => s + (c.litres * c.snf) / 100, 0);
    return {
      societies: ok.length,
      cans: ok.reduce((s, c) => s + c.cans, 0),
      litres,
      ltFat,
      ltSnf,
      fat: litres > 0 ? (ltFat / litres) * 100 : 0,
      snf: litres > 0 ? (ltSnf / litres) * 100 : 0,
      amount: ok.reduce((s, c) => s + c.amount, 0),
    };
  }, [computed]);

  const problemRows = computed.filter(c => c.problem);
  const tempNum = temperature.trim() === '' ? null : Number(temperature);
  const isFormValid =
    Boolean(date) &&
    totals.societies > 0 &&
    problemRows.length === 0 &&
    (tempNum === null || Number.isFinite(tempNum)) &&
    !existingForSlot &&
    !societiesLoading;

  const resetForNext = (flipShift = false) => {
    setEditingId(null);
    setExistingForSlot(null);
    setRows({});
    setAddedIds([]);
    setTemperature('');
    setDispatchTouched(false);
    if (flipShift) {
      if (shift === 'AM') setShift('PM');
      else {
        setShift('AM');
        setDate(addDays(date, 1));
      }
    }
  };

  const submitEntry = async (addNext: boolean) => {
    if (!isFormValid) return;
    setError('');
    setLoading(true);

    const payload = {
      date,
      shift,
      dispatch_date: dispatchDate || undefined,
      temperature: tempNum ?? undefined,
      lines: computed
        .filter(c => c.ok)
        .map(c => ({
          society_id: c.society.id,
          cans: c.cans,
          litres: round2(c.litres),
          fat_pct: round2(c.fat),
          snf_pct: round2(c.snf),
        })),
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine && !editingId) {
        enqueueOfflineMilkEntry(payload);
        setSavedBanner({ id: null, offline: true, message: t('pendingSync'), canUndo: false });
        resetForNext(addNext);
        if (!addNext) setShowModal(false);
        setLoading(false);
        return;
      }

      if (editingId) {
        await api.patch(`/milk/${editingId}`, payload);
        setSavedBanner({
          id: editingId,
          offline: false,
          message: `Updated ${shift} entry for ${formatDateDDMMYYYY(date)}.`,
          canUndo: true,
        });
        resetForNext(addNext);
        if (!addNext) closeModal();
        void fetchRecent();
      } else {
        const res = await api.post<ExistingEntry>('/milk', payload);
        setSavedBanner({ id: res.data.id, offline: false, message: t('savedUndoBanner'), canUndo: true });
        resetForNext(addNext);
        if (!addNext) setShowModal(false);
        void fetchRecent();
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { error?: string } };
        message?: string;
      };
      if (!axiosErr.response && !editingId) {
        enqueueOfflineMilkEntry(payload);
        setSavedBanner({ id: null, offline: true, message: t('pendingSync'), canUndo: false });
        resetForNext(addNext);
        if (!addNext) setShowModal(false);
      } else if (axiosErr.response?.status === 409) {
        setError(axiosErr.response.data?.error || `Entry for ${formatDateDDMMYYYY(date)} (${shift}) already exists.`);
      } else {
        setError(axiosErr.response?.data?.error || axiosErr.message || 'Submission failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitEntry(false);
  };

  const handleUndo = async () => {
    if (!savedBanner?.id) return;
    try {
      await api.delete(`/milk/${savedBanner.id}`);
      setSavedBanner(null);
      setError('');
      void fetchRecent();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Could not undo entry');
    }
  };

  const handleSyncOffline = async () => {
    const res = await syncOfflineMilkEntries();
    if (res.failed.length > 0) setError(res.failed.map(f => f.error).join('; '));
  };

  const availableSocieties = useMemo(
    () => societies.filter(s => !addedIds.includes(s.id)),
    [societies, addedIds],
  );

  const addSocietyRow = (id: string) => {
    if (!id) return;
    setAddedIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    window.setTimeout(() => document.getElementById(`litres-${id}`)?.focus(), 50);
  };

  const removeSocietyRow = (id: string) => {
    setAddedIds(prev => prev.filter(x => x !== id));
    setRows(prev => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleAddSociety = async () => {
    setAddError('');
    try {
      const res = await api.post<Society>('/societies', { code: newCode.trim(), name: newName.trim() });
      setSocieties(prev => [...prev, res.data]);
      setAddedIds(prev => [...prev, res.data.id]);
      setNewCode('');
      setNewName('');
      setShowAdd(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setAddError(e.response?.data?.error || e.message || 'Could not add society');
    }
  };

  const openCreate = () => {
    resetForNext(false);
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    resetForNext(false);
    setError('');
    setShowModal(false);
    if (searchParams.get('editId')) navigate('/bmc/milk-entry', { replace: true });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/milk/${deleteTarget.id}`);
      setDeleteTarget(null);
      void fetchRecent();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e.response?.data?.error || e.message || 'Failed to delete entry');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataColumn<RecentEntry>[] = [
    {
      key: 'date',
      header: 'Collection date',
      sortValue: r => `${r.date}-${r.shift}`,
      render: r => formatDateDDMMYYYY(r.date),
    },
    {
      key: 'shift',
      header: t('shiftLabel'),
      render: r => (r.shift === 'AM' ? 'Morning' : 'Evening'),
    },
    {
      key: 'dispatch',
      header: 'Dispatch date',
      render: r => (r.dispatch_date ? formatDateDDMMYYYY(r.dispatch_date) : '—'),
    },
    { key: 'cans', header: 'Cans', align: 'right', render: r => (r.cans != null ? String(r.cans) : '—') },
    {
      key: 'litres',
      header: 'Litres',
      align: 'right',
      sortValue: r => Number(r.quantity_litres),
      render: r => formatLitres(Number(r.quantity_litres), 1),
    },
    {
      key: 'quality',
      header: 'Fat / SNF',
      render: r => `${formatFatSnf(Number(r.fat_pct))}% / ${formatFatSnf(Number(r.snf_pct))}%`,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sortValue: r => Number(r.quantity_litres) * Number(r.rate_per_litre),
      render: r => formatINR(Number(r.quantity_litres) * Number(r.rate_per_litre)),
    },
    {
      key: 'status',
      header: 'Status',
      render: r => (
        <StatusBadge tone={r.status === 'verified' ? 'green' : 'amber'}>
          {r.status === 'verified' ? 'Verified' : 'Submitted'}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: r => (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={Boolean(r.is_locked)} onClick={() => loadForEdit(r.id)}>
            Edit
          </button>
          <button type="button" className="btn-danger btn-sm" disabled={Boolean(r.is_locked)} onClick={() => setDeleteTarget(r)}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  const unitLabel = profile?.bmcs ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code}` : null;
  const cell = { padding: '4px 6px', whiteSpace: 'nowrap' as const };
  const input = {
    width: '100%', height: 34, padding: '0 8px', borderRadius: 6,
    border: '1px solid #cbd5e1', fontSize: 14, textAlign: 'right' as const,
  };

  const sectionTitle = {
    fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', marginBottom: '10px',
  };
  const labelStyle = { fontSize: '12px', fontWeight: 700, color: '#1e293b' };

  return (
    <div className="page" style={{ maxWidth: '1100px', margin: '0 auto', padding: '16px' }}>
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>{t('milkEntryTitle')}</h1>
          {unitLabel && (
            <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>{unitLabel}</div>
          )}
        </div>
        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {offlineCount > 0 && (
            <>
              <StatusBadge tone="amber">{t('pendingSync')} ({offlineCount})</StatusBadge>
              <button type="button" className="btn-secondary btn-sm" onClick={handleSyncOffline}>{t('syncNow')}</button>
            </>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
            style={{
              backgroundColor: '#16a34a', borderColor: '#15803d', color: '#ffffff', fontWeight: 700,
              fontSize: '13px', padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}
          >
            🥛 + Create Milk Entry
          </button>
        </div>
      </div>

      {savedBanner && (
        <div className={savedBanner.offline ? 'warning-banner' : 'success-banner'} style={{ marginBottom: '16px' }}>
          <div><strong>{savedBanner.offline ? t('pendingSync') : savedBanner.message}</strong></div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {savedBanner.id && savedBanner.canUndo && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => loadForEdit(savedBanner.id!)}>
                  {t('editEntry')}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={handleUndo}>{t('undoSave')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {!showModal && error && <p className="auth-error" style={{ marginBottom: '16px' }}>{error}</p>}

      <div className="card table-card" style={{ padding: '20px', marginBottom: '24px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>Recent Milk Entries</h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            style={{
              backgroundColor: '#16a34a', borderColor: '#15803d', color: '#ffffff', fontWeight: 700,
              fontSize: '12px', padding: '6px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
            }}
          >
            🥛 + Create Milk Entry
          </button>
        </div>
        {listLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={recent}
            columns={columns}
            getRowKey={r => r.id}
            emptyMessage="No milk entries yet. Click '+ Create Milk Entry' above to record a shift."
          />
        )}
      </div>

      {showModal && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: '16px', overflowY: 'auto',
          }}
          onClick={closeModal}
        >
          <div
            className="modal-dialog card"
            style={{
              backgroundColor: '#ffffff', borderRadius: '12px', maxWidth: '1000px', width: '100%', maxHeight: '92vh',
              overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #cbd5e1', padding: '24px',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  🥛 {editingId ? 'Edit Milk Entry' : 'Milk Collection Entry Form'}
                </h2>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Select the societies you collected from and enter cans, litres, fat and SNF. Rate, amount and totals are calculated.
                </span>
              </div>
              <button
                type="button"
                onClick={closeModal}
                title="Close"
                style={{
                  background: '#f1f5f9', border: 'none', borderRadius: '6px', width: '32px', height: '32px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#64748b', cursor: 'pointer', fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>

            {existingForSlot && (
              <div className="warning-banner" role="alert" style={{ marginBottom: '16px' }}>
                <span>
                  A {shift === 'AM' ? 'Morning (AM)' : 'Evening (PM)'} entry for <strong>{formatDateDDMMYYYY(date)}</strong> already exists. Edit it?
                </span>
                <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => loadForEdit(existingForSlot.id)}>
                  {t('editEntry')}
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="entry-form">
              <div style={sectionTitle}>1. COLLECTION DETAILS</div>
              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                <div className="form-group">
                  <label style={labelStyle}>Collection Date * <span className="hint">({formatDateDDMMYYYY(date)})</span></label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} disabled={Boolean(editingId)} required />
                </div>
                <div className="form-group">
                  <label style={labelStyle}>{t('shiftLabel')} *</label>
                  <select value={shift} onChange={e => setShift(e.target.value as 'AM' | 'PM')} disabled={Boolean(editingId)}>
                    <option value="AM">{t('morningShift')}</option>
                    <option value="PM">{t('eveningShift')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label style={labelStyle}>Dispatch Date</label>
                  <input
                    type="date"
                    value={dispatchDate}
                    min={date}
                    onChange={e => { setDispatchTouched(true); setDispatchDate(e.target.value); }}
                  />
                </div>
                <div className="form-group">
                  <label style={labelStyle}>{t('temperatureLabel')} <span className="hint">(optional)</span></label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={temperature}
                    onChange={e => setTemperature(e.target.value)}
                    placeholder="e.g. 4.5"
                  />
                </div>
              </div>

              <div style={sectionTitle}>2. SOCIETY-WISE COLLECTION</div>
              <div>
                <div style={{ marginBottom: 8 }}>
                  <span className="hint">
                    Fat {formatFatSnf(settings.fat_min)}–{formatFatSnf(settings.fat_max)}, SNF {formatFatSnf(settings.snf_min)}–{formatFatSnf(settings.snf_max)}.
                  </span>
                </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <select
                value=""
                onChange={e => addSocietyRow(e.target.value)}
                disabled={societiesLoading || availableSocieties.length === 0}
                style={{ height: 38, minWidth: 260, padding: '0 10px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 14 }}
              >
                <option value="">
                  {availableSocieties.length === 0 ? 'All societies added' : '+ Select society to add…'}
                </option>
                {availableSocieties.map(sc => (
                  <option key={sc.id} value={sc.id}>{sc.name} ({sc.code})</option>
                ))}
              </select>
              {availableSocieties.length > 1 && (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setAddedIds(prev => [...prev, ...availableSocieties.map(sc => sc.id)])}>
                  Add all ({availableSocieties.length})
                </button>
              )}
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820, fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', textAlign: 'right' }}>
                    <th style={{ ...cell, textAlign: 'left', position: 'sticky', left: 0, background: '#f1f5f9' }}>Society</th>
                    <th style={{ ...cell, width: 80 }}>Cans</th>
                    <th style={{ ...cell, width: 100 }}>Litres</th>
                    <th style={cell}>LR</th>
                    <th style={{ ...cell, width: 80 }}>Fat %</th>
                    <th style={{ ...cell, width: 80 }}>SNF %</th>
                    <th style={cell}>Lt Fat (kg)</th>
                    <th style={cell}>Lt SNF (kg)</th>
                    <th style={cell}>Rate ₹/L</th>
                    <th style={cell}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {societiesLoading && (
                    <tr><td colSpan={10} style={{ ...cell, textAlign: 'center', color: '#64748b', padding: 16 }}>Loading societies…</td></tr>
                  )}
                  {!societiesLoading && computed.length === 0 && (
                    <tr><td colSpan={10} style={{ ...cell, textAlign: 'center', color: '#64748b', padding: 16 }}>
                      {societies.length === 0
                        ? 'No societies yet. Use “Society not in the list?” below.'
                        : 'Select a society from the dropdown above to start.'}
                    </td></tr>
                  )}
                  {computed.map(c => {
                    const r = rows[c.society.id] ?? EMPTY_ROW;
                    return (
                      <tr key={c.society.id} style={{ borderTop: '1px solid #e2e8f0', background: c.problem ? '#fef2f2' : c.ok ? '#f0fdf4' : undefined }}>
                        <td style={{ ...cell, position: 'sticky', left: 0, background: c.problem ? '#fef2f2' : c.ok ? '#f0fdf4' : '#ffffff', fontWeight: 600 }}>
                          <button
                            type="button"
                            onClick={() => removeSocietyRow(c.society.id)}
                            aria-label={`Remove ${c.society.name}`}
                            title="Remove"
                            style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', marginRight: 6, fontSize: 16 }}
                          >
                            ✕
                          </button>
                          {c.society.name}
                          <div style={{ fontSize: 11, color: c.problem ? '#b91c1c' : '#94a3b8', fontWeight: 400 }}>
                            {c.problem || c.society.code}
                          </div>
                        </td>
                        <td style={cell}>
                          <input style={input} type="number" inputMode="numeric" min="0" step="1" value={r.cans} onChange={e => setCell(c.society.id, 'cans', e.target.value)} />
                        </td>
                        <td style={cell}>
                          <input id={`litres-${c.society.id}`} style={input} type="number" inputMode="decimal" min="0" step="0.1" value={r.litres} onChange={e => setCell(c.society.id, 'litres', e.target.value)} />
                        </td>
                        <td style={{ ...cell, textAlign: 'right', color: '#475569' }}>{c.ok ? fmt(c.lr, 1) : '–'}</td>
                        <td style={cell}>
                          <input style={input} type="number" inputMode="decimal" step="0.1" value={r.fat} onChange={e => setCell(c.society.id, 'fat', e.target.value)} />
                        </td>
                        <td style={cell}>
                          <input style={input} type="number" inputMode="decimal" step="0.1" value={r.snf} onChange={e => setCell(c.society.id, 'snf', e.target.value)} />
                        </td>
                        <td style={{ ...cell, textAlign: 'right', color: '#475569' }}>{c.ok ? fmt(c.ltFat, 3) : '–'}</td>
                        <td style={{ ...cell, textAlign: 'right', color: '#475569' }}>{c.ok ? fmt(c.ltSnf, 3) : '–'}</td>
                        <td style={{ ...cell, textAlign: 'right', color: '#475569' }}>{c.ok ? fmt(c.rate) : '–'}</td>
                        <td style={{ ...cell, textAlign: 'right', fontWeight: 600 }}>{c.ok ? formatINR(c.amount) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#e2e8f0', fontWeight: 700, textAlign: 'right', borderTop: '2px solid #94a3b8' }}>
                    <td style={{ ...cell, textAlign: 'left', position: 'sticky', left: 0, background: '#e2e8f0' }}>
                      Total ({totals.societies} {totals.societies === 1 ? 'society' : 'societies'})
                    </td>
                    <td style={cell}>{totals.cans}</td>
                    <td style={cell}>{fmt(totals.litres, 1)}</td>
                    <td style={cell} />
                    <td style={cell}>{totals.litres > 0 ? fmt(totals.fat) : '–'}</td>
                    <td style={cell}>{totals.litres > 0 ? fmt(totals.snf) : '–'}</td>
                    <td style={cell}>{fmt(totals.ltFat, 3)}</td>
                    <td style={cell}>{fmt(totals.ltSnf, 3)}</td>
                    <td style={cell}>{totals.litres > 0 ? fmt(totals.amount / totals.litres) : '–'}</td>
                    <td style={cell}>{formatINR(totals.amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: 10 }}>
              {!showAdd ? (
                <button type="button" className="btn-secondary btn-sm" onClick={() => setShowAdd(true)}>Society not in the list? Add new</button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input style={{ ...input, width: 120, textAlign: 'left' }} placeholder="Code" value={newCode} onChange={e => setNewCode(e.target.value)} />
                  <input style={{ ...input, width: 220, textAlign: 'left' }} placeholder="Society name" value={newName} onChange={e => setNewName(e.target.value)} />
                  <button type="button" className="btn-primary btn-sm" style={{ width: 'auto' }} disabled={!newCode.trim() || !newName.trim()} onClick={() => void handleAddSociety()}>
                    Add
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => { setShowAdd(false); setAddError(''); }}>Cancel</button>
                  {addError && <span style={{ color: '#b91c1c', fontSize: 13 }}>{addError}</span>}
                </div>
              )}
            </div>
          </div>


              {error && <p className="auth-error" style={{ marginTop: '12px' }}>{error}</p>}

              <div style={{ display: 'flex', gap: '12px', marginTop: '18px', flexWrap: 'wrap' }}>
                <button type="button" onClick={closeModal} className="btn-secondary" style={{ flex: 1, padding: '12px', fontSize: '14px', fontWeight: 700 }}>
                  {t('cancel')}
                </button>
                {!editingId && (
                  <button
                    type="button"
                    disabled={loading || !isFormValid}
                    className="btn-secondary"
                    style={{ flex: 1, padding: '12px', fontSize: '14px', fontWeight: 700 }}
                    onClick={() => void submitEntry(true)}
                  >
                    {t('saveAndAddNext')}
                  </button>
                )}
                <button
                  type="submit"
                  disabled={loading || !isFormValid}
                  className="btn-primary"
                  style={{
                    flex: 2, padding: '12px', fontSize: '15px', fontWeight: 800, backgroundColor: '#16a34a', borderColor: '#15803d',
                    cursor: loading || !isFormValid ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? t('saving') : editingId ? t('save') : '🥛 Submit Milk Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Milk Entry?"
        message={
          deleteTarget
            ? `Delete the ${deleteTarget.shift === 'AM' ? 'morning' : 'evening'} entry of ${formatDateDDMMYYYY(deleteTarget.date)} (${formatLitres(Number(deleteTarget.quantity_litres), 1)})? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete Entry"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
