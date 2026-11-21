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
import { ConfirmDialog, StatusBadge } from '../../components/UiPrimitives';

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
  const [search, setSearch] = useState('');
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

  const unitLabel = profile?.bmcs ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code}` : null;

  const q = search.trim().toLowerCase();
  const filteredRecent = recent.filter(r =>
    !q ||
    formatDateDDMMYYYY(r.date).includes(q) ||
    r.date.includes(q) ||
    (r.shift === 'AM' ? 'morning' : 'evening').includes(q),
  );

  // Gate-screen look: slate sheet table, label-left forms, dark title bar
  const th = { padding: '10px 12px' } as const;
  const td = { padding: '10px 12px' } as const;
  const rowLabel = { width: 220, fontWeight: 600, color: '#1e293b', fontSize: '0.9rem' } as const;
  const smallInput = {
    height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3,
  } as const;
  const cellInput = {
    width: '100%', height: 28, padding: '2px 6px', border: '1px solid #94a3b8', borderRadius: 2, textAlign: 'right' as const,
  };
  const sh = { padding: '8px 10px', whiteSpace: 'nowrap' as const, textAlign: 'right' as const };
  const sd = { padding: '6px 10px', whiteSpace: 'nowrap' as const, textAlign: 'right' as const, color: '#475569' };

  return (
    <div className="page" style={{ maxWidth: '1180px', margin: '0 auto', padding: '1.25rem' }}>
      <div
        className="page-header"
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem',
          marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Milk Collection Entry (BMC Collection)
          </h1>
          {unitLabel && (
            <div style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600, marginTop: '2px' }}>{unitLabel}</div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {offlineCount > 0 && (
            <>
              <StatusBadge tone="amber">{t('pendingSync')} ({offlineCount})</StatusBadge>
              <button type="button" className="btn-secondary btn-sm" onClick={handleSyncOffline}>{t('syncNow')}</button>
            </>
          )}
          <button
            type="button"
            onClick={openCreate}
            className="btn btn-primary"
            style={{ height: '38px', padding: '0 1rem', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.88rem', fontWeight: 600 }}
          >
            + New Milk Entry
          </button>
        </div>
      </div>

      {!showModal && error && <p className="auth-error" style={{ marginBottom: '1rem' }}>{error}</p>}
      {savedBanner && (
        <div className={savedBanner.offline ? 'warning-banner' : 'success-banner'} style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span><strong>{savedBanner.offline ? t('pendingSync') : savedBanner.message}</strong></span>
          <span style={{ display: 'flex', gap: '0.5rem' }}>
            {savedBanner.id && savedBanner.canUndo && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => loadForEdit(savedBanner.id!)}>{t('editEntry')}</button>
                <button type="button" className="btn-danger btn-sm" onClick={handleUndo}>{t('undoSave')}</button>
              </>
            )}
            <button type="button" onClick={() => setSavedBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
          </span>
        </div>
      )}

      <div
        className="card"
        style={{
          backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #cbd5e1',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '1.25rem', minHeight: '350px',
        }}
      >
        <div style={{ marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
            📋 BMC Milk Collection Register ({filteredRecent.length} Entries)
          </h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>Search Entries:</span>
          <input
            type="text"
            placeholder="Filter by date, Morning / Evening..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 260, height: 32, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: '0.85rem' }}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}>
              Clear
            </button>
          )}
        </div>

        {listLoading ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>Loading entries…</div>
        ) : filteredRecent.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🥛</div>
            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>No milk entries yet</div>
            <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}>
              Click “+ New Milk Entry” to record a morning or evening collection.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                  <th style={th}>COLLECTION DATE</th>
                  <th style={th}>SHIFT</th>
                  <th style={th}>DISPATCH DATE</th>
                  <th style={th}>CANS</th>
                  <th style={th}>LITRES</th>
                  <th style={th}>FAT / SNF</th>
                  <th style={th}>AMOUNT</th>
                  <th style={th}>STATUS</th>
                  <th style={{ ...th, textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecent.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => { if (!r.is_locked) loadForEdit(r.id); }}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: r.is_locked ? 'default' : 'pointer', backgroundColor: '#ffffff' }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#ffffff')}
                  >
                    <td style={{ ...td, fontWeight: 700, color: '#0f172a' }}>
                      <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3 }}>
                        {formatDateDDMMYYYY(r.date)}
                      </span>
                    </td>
                    <td style={{ ...td, color: '#334155' }}>{r.shift === 'AM' ? 'Morning' : 'Evening'}</td>
                    <td style={{ ...td, color: '#475569' }}>{r.dispatch_date ? formatDateDDMMYYYY(r.dispatch_date) : '—'}</td>
                    <td style={{ ...td, color: '#475569' }}>{r.cans != null ? r.cans : '—'}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#0f172a' }}>{formatLitres(Number(r.quantity_litres), 1)}</td>
                    <td style={{ ...td, color: '#475569' }}>{formatFatSnf(Number(r.fat_pct))}% / {formatFatSnf(Number(r.snf_pct))}%</td>
                    <td style={{ ...td, fontWeight: 700, color: '#0f172a' }}>{formatINR(Number(r.quantity_litres) * Number(r.rate_per_litre))}</td>
                    <td style={td}>
                      <StatusBadge tone={r.status === 'verified' ? 'green' : 'amber'}>{r.status === 'verified' ? 'Verified' : 'Submitted'}</StatusBadge>
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        disabled={Boolean(r.is_locked)}
                        onClick={e => { e.stopPropagation(); loadForEdit(r.id); }}
                        className="btn btn-primary btn-sm"
                        style={{ backgroundColor: '#16a34a', borderColor: '#15803d', fontWeight: 700, padding: '4px 12px', marginRight: 6 }}
                      >
                        📝 Edit
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(r.is_locked)}
                        onClick={e => { e.stopPropagation(); setDeleteTarget(r); }}
                        className="btn-danger btn-sm"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem',
          }}
          onClick={closeModal}
        >
          <div
            style={{
              backgroundColor: '#ffffff', borderRadius: 8, width: '100%', maxWidth: 1000, maxHeight: '92vh',
              display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              style={{
                backgroundColor: '#52525b', color: '#ffffff', padding: '0.5rem 1rem', fontSize: '0.88rem', fontWeight: 700,
                letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>{editingId ? 'EDIT MILK COLLECTION DETAILS' : 'MILK COLLECTION DETAILS'}</span>
              <button type="button" onClick={closeModal} style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.2rem', cursor: 'pointer' }}>
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
              {existingForSlot && (
                <div className="warning-banner" role="alert" style={{ marginBottom: '1rem' }}>
                  <span>
                    A {shift === 'AM' ? 'Morning (AM)' : 'Evening (PM)'} entry for <strong>{formatDateDDMMYYYY(date)}</strong> already exists. Edit it?
                  </span>
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => loadForEdit(existingForSlot.id)}>
                    {t('editEntry')}
                  </button>
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>BMC</label>
                  <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                    {unitLabel ?? '—'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Collection Date <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={Boolean(editingId)} style={{ ...smallInput, width: 170 }} />
                  <span style={{ marginLeft: 10, fontSize: '0.8rem', color: '#64748b' }}>({formatDateDDMMYYYY(date)})</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Shift <span style={{ color: '#ef4444' }}>*</span></label>
                  <select
                    value={shift}
                    onChange={e => setShift(e.target.value as 'AM' | 'PM')}
                    disabled={Boolean(editingId)}
                    style={{ ...smallInput, width: 170, backgroundColor: '#ffffff' }}
                  >
                    <option value="AM">{t('morningShift')}</option>
                    <option value="PM">{t('eveningShift')}</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Dispatch Date</label>
                  <input
                    type="date"
                    value={dispatchDate}
                    min={date}
                    onChange={e => { setDispatchTouched(true); setDispatchDate(e.target.value); }}
                    style={{ ...smallInput, width: 170 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Temperature(°C)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={temperature}
                    onChange={e => setTemperature(e.target.value)}
                    placeholder="e.g. 4.5"
                    style={{ ...smallInput, width: 150 }}
                  />
                </div>

                <div style={{ marginTop: '1.5rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#334155', marginBottom: '0.75rem' }}>
                    Society Wise Collection
                    <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#64748b', marginLeft: 10 }}>
                      Fat {formatFatSnf(settings.fat_min)}–{formatFatSnf(settings.fat_max)}, SNF {formatFatSnf(settings.snf_min)}–{formatFatSnf(settings.snf_max)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                    <select
                      value=""
                      onChange={e => addSocietyRow(e.target.value)}
                      disabled={societiesLoading || availableSocieties.length === 0}
                      style={{ ...smallInput, height: 30, minWidth: 260, backgroundColor: '#ffffff' }}
                    >
                      <option value="">
                        {availableSocieties.length > 0
                          ? '+ Select society to add…'
                          : societies.length === 0
                            ? 'No societies for this BMC yet'
                            : 'All societies added'}
                      </option>
                      {availableSocieties.map(sc => (
                        <option key={sc.id} value={sc.id}>{sc.name} ({sc.code})</option>
                      ))}
                    </select>
                    {availableSocieties.length > 1 && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddedIds(prev => [...prev, ...availableSocieties.map(sc => sc.id)])}>
                        Add all ({availableSocieties.length})
                      </button>
                    )}
                  </div>

                  <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 4 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, fontSize: '13px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                          <th style={{ ...sh, textAlign: 'left', position: 'sticky', left: 0, background: '#f8fafc' }}>SOCIETY NAME</th>
                          <th style={{ ...sh, width: 70 }}>CANS</th>
                          <th style={{ ...sh, width: 90 }}>LITRES</th>
                          <th style={sh}>LR</th>
                          <th style={{ ...sh, width: 70 }}>FAT</th>
                          <th style={{ ...sh, width: 70 }}>SNF</th>
                          <th style={sh}>RATE</th>
                          <th style={sh}>AMOUNT</th>
                          <th style={sh}>LT.FAT</th>
                          <th style={sh}>LT.SNF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {societiesLoading && (
                          <tr><td colSpan={10} style={{ ...sd, textAlign: 'center', padding: 16 }}>Loading societies…</td></tr>
                        )}
                        {!societiesLoading && computed.length === 0 && (
                          <tr>
                            <td colSpan={10} style={{ ...sd, textAlign: 'center', padding: 16 }}>
                              {societies.length === 0
                                ? 'This BMC has no societies yet. Click “Society not in the list? Add new” below to add the first one.'
                                : 'Select a society from the dropdown above to start.'}
                            </td>
                          </tr>
                        )}
                        {computed.map(c => {
                          const r = rows[c.society.id] ?? EMPTY_ROW;
                          const bg = c.problem ? '#fef2f2' : c.ok ? '#f0fdf4' : '#ffffff';
                          return (
                            <tr key={c.society.id} style={{ borderBottom: '1px solid #f1f5f9', background: bg }}>
                              <td style={{ ...sd, textAlign: 'left', position: 'sticky', left: 0, background: bg, fontWeight: 600, color: '#0f172a' }}>
                                <button
                                  type="button"
                                  onClick={() => removeSocietyRow(c.society.id)}
                                  aria-label={`Remove ${c.society.name}`}
                                  title="Remove"
                                  style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', marginRight: 6, fontSize: 14 }}
                                >
                                  ✕
                                </button>
                                {c.society.name}
                                <div style={{ fontSize: 11, color: c.problem ? '#b91c1c' : '#94a3b8', fontWeight: 400 }}>
                                  {c.problem || c.society.code}
                                </div>
                              </td>
                              <td style={sd}><input style={cellInput} type="number" inputMode="numeric" min="0" step="1" value={r.cans} onChange={e => setCell(c.society.id, 'cans', e.target.value)} /></td>
                              <td style={sd}><input id={`litres-${c.society.id}`} style={cellInput} type="number" inputMode="decimal" min="0" step="0.1" value={r.litres} onChange={e => setCell(c.society.id, 'litres', e.target.value)} /></td>
                              <td style={sd}>{c.ok ? fmt(c.lr, 1) : '–'}</td>
                              <td style={sd}><input style={cellInput} type="number" inputMode="decimal" step="0.1" value={r.fat} onChange={e => setCell(c.society.id, 'fat', e.target.value)} /></td>
                              <td style={sd}><input style={cellInput} type="number" inputMode="decimal" step="0.1" value={r.snf} onChange={e => setCell(c.society.id, 'snf', e.target.value)} /></td>
                              <td style={sd}>{c.ok ? fmt(c.rate) : '–'}</td>
                              <td style={{ ...sd, fontWeight: 700, color: '#0f172a' }}>{c.ok ? formatINR(c.amount) : '–'}</td>
                              <td style={sd}>{c.ok ? fmt(c.ltFat, 3) : '–'}</td>
                              <td style={sd}>{c.ok ? fmt(c.ltSnf, 3) : '–'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: '#f1f5f9', fontWeight: 700, borderTop: '2px solid #cbd5e1', color: '#0f172a' }}>
                          <td style={{ ...sd, textAlign: 'left', position: 'sticky', left: 0, background: '#f1f5f9', color: '#0f172a' }}>
                            TOTAL ({totals.societies})
                          </td>
                          <td style={{ ...sd, color: '#0f172a' }}>{totals.cans}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{fmt(totals.litres, 1)}</td>
                          <td style={sd} />
                          <td style={{ ...sd, color: '#0f172a' }}>{totals.litres > 0 ? fmt(totals.fat) : '–'}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{totals.litres > 0 ? fmt(totals.snf) : '–'}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{totals.litres > 0 ? fmt(totals.amount / totals.litres) : '–'}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{formatINR(totals.amount)}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{fmt(totals.ltFat, 3)}</td>
                          <td style={{ ...sd, color: '#0f172a' }}>{fmt(totals.ltSnf, 3)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    {!showAdd ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdd(true)}>Society not in the list? Add new</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input style={{ ...smallInput, width: 120 }} placeholder="Code" value={newCode} onChange={e => setNewCode(e.target.value)} />
                        <input style={{ ...smallInput, width: 220 }} placeholder="Society name" value={newName} onChange={e => setNewName(e.target.value)} />
                        <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} disabled={!newCode.trim() || !newName.trim()} onClick={() => void handleAddSociety()}>
                          Add
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowAdd(false); setAddError(''); }}>Cancel</button>
                        {addError && <span style={{ color: '#b91c1c', fontSize: 13 }}>{addError}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {error && <p className="auth-error" style={{ marginTop: '12px' }}>{error}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                  <button type="button" onClick={closeModal} className="btn btn-secondary" style={{ padding: '6px 16px' }}>
                    {t('cancel')}
                  </button>
                  {!editingId && (
                    <button
                      type="button"
                      disabled={loading || !isFormValid}
                      onClick={() => void submitEntry(true)}
                      className="btn btn-secondary"
                      style={{ padding: '6px 16px' }}
                    >
                      {t('saveAndAddNext')}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={loading || !isFormValid}
                    style={{
                      backgroundColor: '#65a30d', color: '#ffffff', border: 'none', borderRadius: 3, padding: '6px 20px',
                      fontWeight: 700, fontSize: '0.88rem', cursor: loading || !isFormValid ? 'not-allowed' : 'pointer',
                      opacity: loading || !isFormValid ? 0.7 : 1,
                    }}
                  >
                    {loading ? 'Saving…' : editingId ? 'Update' : 'Submit'}
                  </button>
                </div>
              </form>
            </div>
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
