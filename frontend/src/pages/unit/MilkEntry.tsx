import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { chartRange, lookupRate, milkTypeLabel } from '../../lib/rateChart';
import type { RateChartGrid } from '../../lib/rateChart';
import {
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
  temperature?: number | null;
  quantity_litres: number;
  fat_pct: number;
  snf_pct: number;
  rate_per_litre: number;
  status?: string;
  is_locked?: boolean;
}

interface RowInput {
  litres: string;
  fat: string;
  snf: string;
}

const EMPTY_ROW: RowInput = { litres: '', fat: '', snf: '' };

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


/** The rate chart for the BMC's milk on the entry date: undefined while loading, null when none is set. */
type ChartState = RateChartGrid | null | undefined;

/** Validates the shift's litres / fat / SNF and works out LR, rate, amount, Lt Fat and Lt SNF. */
function evaluateRow(r: RowInput, chart: ChartState) {
  const litres = num(r.litres);
  const fat = num(r.fat);
  const snf = num(r.snf);
  const touched = r.litres.trim() !== '' || r.fat.trim() !== '' || r.snf.trim() !== '';
  let problem = '';
  let rate = 0;
  if (!(litres > 0)) problem = 'Enter litres';
  else if (!Number.isFinite(fat)) problem = 'Enter fat %';
  else if (!Number.isFinite(snf)) problem = 'Enter SNF %';
  else if (chart === undefined) problem = 'Loading rate chart…';
  else if (chart === null) problem = 'No rate chart for this date. Ask the admin to add one.';
  else {
    const found = lookupRate(chart, fat, snf);
    if (found == null) {
      const g = chartRange(chart);
      problem = `No rate for this Fat/SNF. Chart covers Fat ${formatFatSnf(g.fatMin)}–${formatFatSnf(g.fatMax)}, SNF ${formatFatSnf(g.snfMin)}–${formatFatSnf(g.snfMax)}`;
    } else rate = found;
  }
  const ok = !problem;
  return {
    touched,
    ok,
    problem,
    litres: ok ? litres : 0,
    fat: ok ? fat : 0,
    snf: ok ? snf : 0,
    ltFat: ok ? Math.round(litres * fat * 10) / 1000 : 0,
    ltSnf: ok ? Math.round(litres * snf * 10) / 1000 : 0,
    // Lactometer reading implied by fat and SNF: SNF = LR/4 + 0.2 x Fat + 0.36
    lr: ok ? Math.round(4 * (snf - 0.2 * fat - 0.36) * 10) / 10 : 0,
    rate: ok ? rate : 0,
    amount: ok ? round2(litres * rate) : 0,
  };
}

export default function MilkEntry() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bmcId = profile?.bmc_id ?? null;

  const [date, setDate] = useState(() => getLocalTodayIso());
  const [shift, setShift] = useState<'AM' | 'PM'>(() => (new Date().getHours() < 12 ? 'AM' : 'PM'));
  const [dispatchDate, setDispatchDate] = useState('');
  const [dispatchTouched, setDispatchTouched] = useState(false);
  const [temperature, setTemperature] = useState('');

  const [chart, setChart] = useState<ChartState>(undefined);
  const [milkType, setMilkType] = useState<string>('COW');
  const [row, setRow] = useState<RowInput>(EMPTY_ROW);

  const [showModal, setShowModal] = useState(() => Boolean(searchParams.get('editId')));
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const recentRef = useRef<RecentEntry[]>([]);
  recentRef.current = recent;
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

  // The rate chart that prices this BMC's milk on the entry date
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    setChart(undefined);
    api.get<{ milk_type: string; chart: (RateChartGrid & { id: string }) | null }>('/rates/chart', { params: { date, bmc_id: bmcId ?? undefined } })
      .then(res => { if (!cancelled) { setMilkType(res.data.milk_type); setChart(res.data.chart); } })
      .catch(() => { if (!cancelled) setChart(null); });
    return () => { cancelled = true; };
  }, [date, bmcId]);

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

  // Open an entry for editing (taken from the register; fetched when it is not in the list yet)
  const loadForEdit = useCallback(async (entryId: string) => {
    setError('');
    try {
      let entry = recentRef.current.find(r => String(r.id) === String(entryId));
      if (!entry) {
        const res = await api.get<RecentEntry[]>('/milk', { params: { from: addDays(getLocalTodayIso(), -400), to: addDays(getLocalTodayIso(), 2) } });
        entry = (res.data || []).find(r => String(r.id) === String(entryId));
      }
      if (!entry) { setError('Could not find this entry.'); return; }
      setEditingId(String(entry.id));
      setDate(entry.date);
      setShift(entry.shift);
      setDispatchTouched(true);
      setDispatchDate(entry.dispatch_date ?? entry.date);
      setTemperature(entry.temperature != null ? String(entry.temperature) : '');
      setRow({ litres: String(entry.quantity_litres), fat: String(entry.fat_pct), snf: String(entry.snf_pct) });
      setShowModal(true);
    } catch {
      setError('Could not load this entry.');
    }
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

  // Calculations and checks for this shift's entry
  const calc = useMemo(() => evaluateRow(row, chart), [row, chart]);
  const tempNum = temperature.trim() === '' ? null : Number(temperature);
  const isFormValid =
    Boolean(date) &&
    calc.ok &&
    (tempNum === null || Number.isFinite(tempNum)) &&
    !existingForSlot;

  const resetForNext = (flipShift = false) => {
    setEditingId(null);
    setExistingForSlot(null);
    setRow(EMPTY_ROW);
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
      quantity_litres: round2(calc.litres),
      fat_pct: round2(calc.fat),
      snf_pct: round2(calc.snf),
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
                  <th style={th}>LITRES</th>
                  <th style={th}>FAT / SNF</th>
                  <th style={th}>RATE</th>
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
                    <td style={{ ...td, fontWeight: 700, color: '#0f172a' }}>{formatLitres(Number(r.quantity_litres), 1)}</td>
                    <td style={{ ...td, color: '#475569' }}>{formatFatSnf(Number(r.fat_pct))}% / {formatFatSnf(Number(r.snf_pct))}%</td>
                    <td style={{ ...td, color: '#475569' }}>₹{Number(r.rate_per_litre).toFixed(2)}</td>
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
              backgroundColor: '#ffffff', borderRadius: 8, width: '100%', maxWidth: 820, maxHeight: '92vh',
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

            <div className="sheet-modal-body" style={{ padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
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
                <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>BMC</label>
                  <span style={{ backgroundColor: '#fef9c3', border: '1px solid #fde047', padding: '2px 8px', borderRadius: 3, fontWeight: 700, fontSize: '0.85rem', color: '#1e293b' }}>
                    {unitLabel ?? '—'}
                  </span>
                </div>

                <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Collection Date <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={Boolean(editingId)} style={{ ...smallInput, width: 170 }} />
                  <span style={{ marginLeft: 10, fontSize: '0.8rem', color: '#64748b' }}>({formatDateDDMMYYYY(date)})</span>
                </div>

                <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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

                <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={rowLabel}>Dispatch Date</label>
                  <input
                    type="date"
                    value={dispatchDate}
                    min={date}
                    onChange={e => { setDispatchTouched(true); setDispatchDate(e.target.value); }}
                    style={{ ...smallInput, width: 170 }}
                  />
                </div>

                <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
                    Milk Collected
                    <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#64748b', marginLeft: 10 }}>
                      {milkTypeLabel(milkType)} milk
                      {chart ? (() => { const g = chartRange(chart); return ` · Rate chart: Fat ${formatFatSnf(g.fatMin)}–${formatFatSnf(g.fatMax)}, SNF ${formatFatSnf(g.snfMin)}–${formatFatSnf(g.snfMax)}`; })() : chart === null ? ' · no rate chart for this date' : ''}
                    </span>
                  </div>

                  <div className="milk-entry-grid">
                    <label>
                      <span className="milk-entry-label">Litres <span style={{ color: '#ef4444' }}>*</span></span>
                      <input
                        id="entry-litres" type="number" inputMode="decimal" min="0" step="0.1" required
                        value={row.litres} onChange={e => setRow(r => ({ ...r, litres: e.target.value }))}
                        style={{ ...smallInput, width: '100%', height: 34 }}
                      />
                    </label>
                    <label>
                      <span className="milk-entry-label">LR</span>
                      <input readOnly tabIndex={-1} value={calc.ok ? fmt(calc.lr, 1) : ''} style={{ ...smallInput, width: '100%', height: 34, background: '#f1f5f9' }} />
                    </label>
                    <label>
                      <span className="milk-entry-label">Fat % <span style={{ color: '#ef4444' }}>*</span></span>
                      <input
                        type="number" inputMode="decimal" min="0" step="0.1" required
                        value={row.fat} onChange={e => setRow(r => ({ ...r, fat: e.target.value }))}
                        style={{ ...smallInput, width: '100%', height: 34 }}
                      />
                    </label>
                    <label>
                      <span className="milk-entry-label">SNF % <span style={{ color: '#ef4444' }}>*</span></span>
                      <input
                        type="number" inputMode="decimal" min="0" step="0.1" required
                        value={row.snf} onChange={e => setRow(r => ({ ...r, snf: e.target.value }))}
                        style={{ ...smallInput, width: '100%', height: 34 }}
                      />
                    </label>
                    <label>
                      <span className="milk-entry-label">Rate (₹/L)</span>
                      <input readOnly tabIndex={-1} value={calc.ok ? fmt(calc.rate) : ''} style={{ ...smallInput, width: '100%', height: 34, background: '#f1f5f9' }} />
                    </label>
                    <label>
                      <span className="milk-entry-label">Amount (₹)</span>
                      <input readOnly tabIndex={-1} value={calc.ok ? fmt(calc.amount) : ''} style={{ ...smallInput, width: '100%', height: 34, background: '#f1f5f9', fontWeight: 700 }} />
                    </label>
                    <label>
                      <span className="milk-entry-label">Lt. Fat</span>
                      <input readOnly tabIndex={-1} value={calc.ok ? fmt(calc.ltFat, 3) : ''} style={{ ...smallInput, width: '100%', height: 34, background: '#f1f5f9' }} />
                    </label>
                    <label>
                      <span className="milk-entry-label">Lt. SNF</span>
                      <input readOnly tabIndex={-1} value={calc.ok ? fmt(calc.ltSnf, 3) : ''} style={{ ...smallInput, width: '100%', height: 34, background: '#f1f5f9' }} />
                    </label>
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.8rem', color: calc.touched && calc.problem ? '#b91c1c' : '#64748b', minHeight: 18 }}>
                    {calc.touched && calc.problem ? calc.problem : 'LR, Rate, Amount, Lt. Fat and Lt. SNF are calculated from the litres, fat and SNF.'}
                  </div>
                </div>

                {error && <p className="auth-error" style={{ marginTop: '12px' }}>{error}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                  <button type="button" onClick={closeModal} className="btn btn-secondary" style={{ padding: '6px 16px' }}>
                    {t('cancel')}
                  </button>
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
