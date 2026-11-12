import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import {
  calcRateFromChart,
  formatDateDDMMYYYY,
  formatFatSnf,
  formatINR,
  formatLitres,
  getEffectiveSellingRate,
  getLocalTodayIso,
} from '../../lib/format';
import { computeEntryValuation } from '../../lib/procurement';
import {
  enqueueOfflineMilkEntry,
  listOfflineMilkEntries,
  syncOfflineMilkEntries,
} from '../../lib/offlineQueue';
import { InfoTooltip, StatusBadge } from '../../components/UiPrimitives';

const REJECTION_REASONS = ['Sour', 'Adulterated', 'Low Fat/SNF', 'High Temperature', 'Other'];

interface ExistingEntry {
  id: string;
  date: string;
  shift: 'AM' | 'PM';
  fat_pct: number;
  snf_pct: number;
  quantity_litres: number;
  rejection_qty: number | null;
  rejection_reason?: string | null;
  temperature: number | null;
  rate_per_litre: number;
  rate_override?: boolean;
  rate_override_reason?: string | null;
}

export default function MilkEntry() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings, sellingRates } = useZoneSettings();

  const [date, setDate] = useState(() => getLocalTodayIso());
  const [shift, setShift] = useState<'AM' | 'PM'>(() => (new Date().getHours() < 12 ? 'AM' : 'PM'));
  const [fatPct, setFatPct] = useState('');
  const [snfPct, setSnfPct] = useState('');
  const [qtyStr, setQtyStr] = useState('');
  const [rejStr, setRejStr] = useState('0');
  const [rejReason, setRejReason] = useState('');
  const [temperature, setTemperature] = useState('');

  const [overrideRate, setOverrideRate] = useState(false);
  const [manualRateStr, setManualRateStr] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

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

  useEffect(() => {
    if (!savedBanner?.canUndo) return;
    const timer = window.setTimeout(() => {
      setSavedBanner(prev => (prev ? { ...prev, canUndo: false } : null));
    }, 5 * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [savedBanner?.id, savedBanner?.canUndo]);

  // Sync offline listener
  useEffect(() => {
    const refresh = () => setOfflineCount(listOfflineMilkEntries().length);
    window.addEventListener('aavin-offline-queue-changed', refresh);
    return () => window.removeEventListener('aavin-offline-queue-changed', refresh);
  }, []);

  // Load entry when editId is supplied in URL
  useEffect(() => {
    const editIdParam = searchParams.get('editId');
    if (!editIdParam) return;
    api.get<ExistingEntry[]>('/milk', { params: { from: '2020-01-01', to: '2099-12-31' } })
      .then(res => {
        const match = res.data.find(r => r.id === editIdParam);
        if (match) {
          setEditingId(match.id);
          setDate(match.date);
          setShift(match.shift);
          setFatPct(Number(match.fat_pct).toFixed(2));
          setSnfPct(Number(match.snf_pct).toFixed(2));
          setQtyStr(String(match.quantity_litres));
          setRejStr(String(match.rejection_qty ?? 0));
          setRejReason(match.rejection_reason ?? '');
          setTemperature(match.temperature != null ? String(match.temperature) : '');
          if (match.rate_override) {
            setOverrideRate(true);
            setManualRateStr(String(match.rate_per_litre));
            setOverrideReason(match.rate_override_reason ?? '');
          }
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // Proactive duplicate detection for selected (date, shift)
  useEffect(() => {
    if (editingId || !date || !shift) {
      setExistingForSlot(null);
      return;
    }
    let cancelled = false;
    api.get<ExistingEntry[]>('/milk', { params: { from: date, to: date, shift } })
      .then(res => {
        if (cancelled) return;
        const match = res.data.find(r => r.date === date && r.shift === shift) ?? null;
        setExistingForSlot(match);
      })
      .catch(() => {
        if (!cancelled) setExistingForSlot(null);
      });
    return () => { cancelled = true; };
  }, [date, shift, editingId]);

  const fatNum = parseFloat(fatPct);
  const snfNum = parseFloat(snfPct);
  const qtyNum = parseFloat(qtyStr);
  const rejNum = parseFloat(rejStr || '0');

  const chartRate = useMemo(() => {
    if (!Number.isFinite(fatNum) || !Number.isFinite(snfNum)) return 0;
    return calcRateFromChart(fatNum, snfNum, settings);
  }, [fatNum, snfNum, settings]);

  const appliedRate = overrideRate ? (parseFloat(manualRateStr) || 0) : chartRate;
  const effectiveSellingRate = getEffectiveSellingRate(date || getLocalTodayIso(), sellingRates);

  const valuation = useMemo(
    () =>
      computeEntryValuation({
        quantityLitres: qtyNum,
        rejectionQty: rejNum,
        ratePerLitre: appliedRate,
        sellingRate: effectiveSellingRate,
        rejectionPaymentRule: settings.rejection_payment_rule,
      }),
    [qtyNum, rejNum, appliedRate, effectiveSellingRate, settings.rejection_payment_rule],
  );

  // Live validation errors (blocking) + warnings (non-blocking)
  const validationErrors: string[] = [];
  if (fatPct !== '' && (!Number.isFinite(fatNum) || fatNum < settings.fat_min || fatNum > settings.fat_max)) {
    validationErrors.push(`Fat % must be between ${formatFatSnf(settings.fat_min)} and ${formatFatSnf(settings.fat_max)}.`);
  }
  if (snfPct !== '' && (!Number.isFinite(snfNum) || snfNum < settings.snf_min || snfNum > settings.snf_max)) {
    validationErrors.push(`SNF % must be between ${formatFatSnf(settings.snf_min)} and ${formatFatSnf(settings.snf_max)}.`);
  }
  if (qtyStr !== '' && (!Number.isFinite(qtyNum) || qtyNum <= 0)) {
    validationErrors.push('Quantity must be greater than 0 litres.');
  }
  if (rejStr !== '' && (rejNum < 0 || (Number.isFinite(qtyNum) && rejNum > qtyNum))) {
    validationErrors.push('Rejection quantity cannot exceed collected quantity.');
  }
  if (Number.isFinite(rejNum) && rejNum > 0 && !rejReason.trim()) {
    validationErrors.push('Please select a Rejection Reason when rejection is greater than 0.');
  }
  if (overrideRate && (!overrideReason.trim() || appliedRate <= 0)) {
    validationErrors.push('Please enter a valid override rate and reason.');
  }

  const qualityWarnings: string[] = [];
  if (Number.isFinite(fatNum) && fatNum >= settings.fat_min && fatNum < settings.fat_benchmark) {
    qualityWarnings.push(`Fat % (${formatFatSnf(fatNum)}%) is below benchmark (${formatFatSnf(settings.fat_benchmark)}%).`);
  }
  if (Number.isFinite(snfNum) && snfNum >= settings.snf_min && snfNum < settings.snf_benchmark) {
    qualityWarnings.push(`SNF % (${formatFatSnf(snfNum)}%) is below benchmark (${formatFatSnf(settings.snf_benchmark)}%).`);
  }
  if (valuation.rejectionPct >= settings.rejection_warn_pct) {
    qualityWarnings.push(`High rejection (${valuation.rejectionPct.toFixed(1)}%) exceeds ${settings.rejection_warn_pct}% warning threshold.`);
  }

  const requiredFilled =
    Boolean(date) &&
    fatPct !== '' &&
    snfPct !== '' &&
    qtyStr !== '' &&
    Number.isFinite(fatNum) &&
    Number.isFinite(snfNum) &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    appliedRate > 0;

  const isFormValid = requiredFilled && validationErrors.length === 0 && !existingForSlot;

  const loadExistingIntoEditor = (entry: ExistingEntry) => {
    setEditingId(entry.id);
    setExistingForSlot(null);
    setDate(entry.date);
    setShift(entry.shift);
    setFatPct(Number(entry.fat_pct).toFixed(2));
    setSnfPct(Number(entry.snf_pct).toFixed(2));
    setQtyStr(String(entry.quantity_litres));
    setRejStr(String(entry.rejection_qty ?? 0));
    setRejReason(entry.rejection_reason ?? '');
    setTemperature(entry.temperature != null ? String(entry.temperature) : '');
    if (entry.rate_override) {
      setOverrideRate(true);
      setManualRateStr(String(entry.rate_per_litre));
      setOverrideReason(entry.rate_override_reason ?? '');
    } else {
      setOverrideRate(false);
      setManualRateStr('');
      setOverrideReason('');
    }
    setError('');
  };

  const resetForNext = (flipShift = false) => {
    setEditingId(null);
    setExistingForSlot(null);
    setFatPct('');
    setSnfPct('');
    setQtyStr('');
    setRejStr('0');
    setRejReason('');
    setTemperature('');
    setOverrideRate(false);
    setManualRateStr('');
    setOverrideReason('');
    if (flipShift) {
      setShift(prev => (prev === 'AM' ? 'PM' : 'AM'));
    }
  };

  const submitEntry = async (addNext: boolean) => {
    if (!isFormValid) return;
    setError('');
    setLoading(true);

    const payload = {
      date,
      shift,
      fat_pct: +fatNum.toFixed(2),
      snf_pct: +snfNum.toFixed(2),
      quantity_litres: +qtyNum.toFixed(2),
      rejection_qty: +(rejNum || 0).toFixed(2),
      rejection_reason: rejNum > 0 ? rejReason : undefined,
      temperature: temperature ? parseFloat(temperature) : undefined,
      rate_per_litre: +appliedRate.toFixed(2),
      rate_override: overrideRate,
      rate_override_reason: overrideRate ? overrideReason.trim() : undefined,
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine && !editingId) {
        enqueueOfflineMilkEntry(payload);
        setSavedBanner({
          id: null,
          offline: true,
          message: t('pendingSync'),
          canUndo: false,
        });
        resetForNext(addNext);
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
      } else {
        const res = await api.post<ExistingEntry>('/milk', payload);
        setSavedBanner({
          id: res.data.id,
          offline: false,
          message: t('savedUndoBanner'),
          canUndo: true,
        });
        if (addNext) resetForNext(true);
        else resetForNext(false);
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { error?: string; existing_id?: string } };
        message?: string;
      };
      if (!axiosErr.response && !editingId) {
        // Network dropped offline mid-submit -> queue safely
        enqueueOfflineMilkEntry(payload);
        setSavedBanner({
          id: null,
          offline: true,
          message: t('pendingSync'),
          canUndo: false,
        });
        resetForNext(addNext);
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
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Could not undo entry');
    }
  };

  const handleSyncOffline = async () => {
    const res = await syncOfflineMilkEntries();
    if (res.failed.length > 0) {
      setError(res.failed.map(f => f.error).join('; '));
    }
  };

  const unitLabel = profile?.units ? `${profile.units.name} · ${profile.units.unit_code}` : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{editingId ? t('editEntry') : t('milkEntryTitle')}</h1>
          <p className="page-subtitle">
            {unitLabel ? `${unitLabel} · ` : ''}{t('milkEntrySubtitle')}
          </p>
        </div>
        <div className="header-actions">
          {offlineCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <StatusBadge tone="amber">{t('pendingSync')} ({offlineCount})</StatusBadge>
              <button type="button" className="btn-secondary btn-sm" onClick={handleSyncOffline}>
                {t('syncNow')}
              </button>
            </div>
          )}
        </div>
      </div>

      {savedBanner && (
        <div className={savedBanner.offline ? 'warning-banner' : 'success-banner'}>
          <div>
            <strong>{savedBanner.offline ? t('pendingSync') : savedBanner.message}</strong>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {savedBanner.id && savedBanner.canUndo && (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => navigate(`/unit/milk-entry?editId=${savedBanner.id}`)}
                >
                  {t('editEntry')}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={handleUndo}>
                  {t('undoSave')}
                </button>
              </>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => navigate('/unit/records')}>
              {t('navMyRecords')}
            </button>
          </div>
        </div>
      )}

      {existingForSlot && (
        <div className="warning-banner" role="alert">
          <span>
            A {shift === 'AM' ? 'Morning (AM)' : 'Evening (PM)'} entry for{' '}
            <strong>{formatDateDDMMYYYY(date)}</strong> already exists. Edit it?
          </span>
          <button
            type="button"
            className="btn-primary"
            style={{ width: 'auto' }}
            onClick={() => loadExistingIntoEditor(existingForSlot)}
          >
            {t('editEntry')}
          </button>
        </div>
      )}

      <div className="card form-card" style={{ maxWidth: 780 }}>
        <form onSubmit={handleSubmit} className="entry-form">
          <div className="form-section">
            <div className="form-row">
              <div className="form-group">
                <label>
                  {t('dateLabel')} <span className="hint">({formatDateDDMMYYYY(date)})</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  disabled={Boolean(editingId)}
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('shiftLabel')}</label>
                <select
                  value={shift}
                  onChange={e => setShift(e.target.value as 'AM' | 'PM')}
                  disabled={Boolean(editingId)}
                >
                  <option value="AM">{t('morningShift')}</option>
                  <option value="PM">{t('eveningShift')}</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  {t('fatLabel')}{' '}
                  <span className="hint">
                    ({formatFatSnf(settings.fat_min)}–{formatFatSnf(settings.fat_max)}, target ≥ {formatFatSnf(settings.fat_benchmark)})
                  </span>
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={settings.fat_min}
                  max={settings.fat_max}
                  value={fatPct}
                  onChange={e => setFatPct(e.target.value)}
                  placeholder="e.g. 4.50"
                  required
                />
              </div>
              <div className="form-group">
                <label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {t('snfLabel')}
                    <InfoTooltip text={t('tipSnf')} label={t('snfLabel')} />
                  </span>
                  <span className="hint">
                    ({formatFatSnf(settings.snf_min)}–{formatFatSnf(settings.snf_max)}, target ≥ {formatFatSnf(settings.snf_benchmark)})
                  </span>
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={settings.snf_min}
                  max={settings.snf_max}
                  value={snfPct}
                  onChange={e => setSnfPct(e.target.value)}
                  placeholder="e.g. 8.40"
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>{t('quantityLabel')}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0.1"
                  value={qtyStr}
                  onChange={e => setQtyStr(e.target.value)}
                  placeholder="e.g. 250.0"
                  required
                />
              </div>
              <div className="form-group">
                <label>{t('rejectionLabel')}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={rejStr}
                  onChange={e => setRejStr(e.target.value)}
                />
              </div>
            </div>

            <div className="form-row">
              {Number.isFinite(rejNum) && rejNum > 0 && (
                <div className="form-group">
                  <label>{t('rejectionReasonLabel')}</label>
                  <select value={rejReason} onChange={e => setRejReason(e.target.value)} required>
                    <option value="">{t('selectReason')}</option>
                    {REJECTION_REASONS.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-group">
                <label>{t('temperatureLabel')} <span className="hint">(optional)</span></label>
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
          </div>

          {validationErrors.length > 0 && (
            <div className="error-banner" role="alert">
              <div>
                {validationErrors.map((msg, i) => (
                  <p key={i} style={{ margin: '0.1rem 0' }}>• {msg}</p>
                ))}
              </div>
            </div>
          )}

          {qualityWarnings.length > 0 && (
            <div className="warning-banner">
              <div>
                {qualityWarnings.map((w, i) => (
                  <p key={i} style={{ margin: '0.1rem 0' }}>⚠ {w}</p>
                ))}
              </div>
            </div>
          )}

          <div className="procurement-section">
            <div className="form-section-header">
              <div>
                <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {t('procurementSection')}
                  <InfoTooltip text={t('tipProcurementCost')} label={t('procurementSection')} />
                </h2>
                <p className="chart-subtitle">
                  Rule: <strong>{settings.rejection_payment_rule === 'gross' ? 'GROSS quantity paid (rejection loss tracked separately)' : 'NET accepted quantity paid'}</strong>
                </p>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={overrideRate}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setOverrideRate(checked);
                    if (checked && !manualRateStr && chartRate > 0) {
                      setManualRateStr(chartRate.toFixed(2));
                    }
                  }}
                />
                {t('overrideRateToggle')}
              </label>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>
                  {overrideRate ? 'Rate (₹/L) — Manual Override' : t('rateAutoLabel')}
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="1"
                  value={overrideRate ? manualRateStr : (chartRate > 0 ? chartRate.toFixed(2) : '')}
                  onChange={e => setManualRateStr(e.target.value)}
                  readOnly={!overrideRate}
                  disabled={!overrideRate}
                  placeholder="Enter Fat & SNF to calculate"
                />
              </div>
              <div className="form-group">
                <label>{t('procurementValueLabel')}</label>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={valuation.procurementCost > 0 ? formatINR(valuation.procurementCost) : '₹0'}
                />
              </div>
            </div>

            {overrideRate && (
              <div className="form-group">
                <label>{t('overrideReasonLabel')}</label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={e => setOverrideReason(e.target.value)}
                  placeholder={t('overrideReasonPlaceholder')}
                  required
                />
              </div>
            )}

            <div className="valuation-grid">
              <div className="valuation-item">
                <span className="valuation-label">
                  {t('netAccepted')} <InfoTooltip text={t('tipNetQuantity')} label={t('netAccepted')} />
                </span>
                <span className="valuation-value">{formatLitres(valuation.netQty, 1)}</span>
                <span className="valuation-sub">
                  {valuation.rejectionQty > 0
                    ? `${formatLitres(valuation.rejectionQty, 1)} rej (${valuation.rejectionPct.toFixed(1)}%)`
                    : 'No rejection'}
                </span>
              </div>

              <div className="valuation-item">
                <span className="valuation-label">{t('procurementCost')}</span>
                <span className="valuation-value">{formatINR(valuation.procurementCost)}</span>
                <span className="valuation-sub">
                  {appliedRate > 0 ? `@ ₹${appliedRate.toFixed(2)}/L` : 'Enter Fat & SNF'}
                </span>
              </div>

              {settings.rejection_payment_rule === 'gross' && (
                <div className="valuation-item">
                  <span className="valuation-label">{t('rejectionLossLabel')}</span>
                  <span className={`valuation-value ${valuation.rejectionLoss > 0 ? 'profit-neg' : ''}`}>
                    {formatINR(valuation.rejectionLoss)}
                  </span>
                  <span className="valuation-sub">Paid on rejected litres</span>
                </div>
              )}

              {settings.show_unit_profit && (
                <>
                  <div className="valuation-item">
                    <span className="valuation-label">{t('estRevenue')}</span>
                    <span className="valuation-value">{formatINR(valuation.estimatedRevenue)}</span>
                    <span className="valuation-sub">@ ₹{effectiveSellingRate}/L</span>
                  </div>
                  <div
                    className="valuation-item"
                    style={valuation.estimatedProfit < 0 ? { borderColor: '#fecaca', background: '#fef2f2' } : undefined}
                  >
                    <span className="valuation-label">{t('projectedProfitLabel')}</span>
                    <span className={`valuation-value ${valuation.estimatedProfit < 0 ? 'profit-neg' : valuation.estimatedProfit > 0 ? 'profit-pos' : ''}`}>
                      {formatINR(valuation.estimatedProfit, { showPlus: valuation.estimatedProfit > 0 })}
                    </span>
                    <span className="valuation-sub">
                      {valuation.marginPct !== null ? `${valuation.marginPct}% margin` : 'Enter details'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button type="submit" disabled={loading || !isFormValid} className="btn-primary" style={{ flex: 2 }}>
              {loading ? t('saving') : editingId ? t('save') : t('submitEntry')}
            </button>
            {!editingId && (
              <button
                type="button"
                disabled={loading || !isFormValid}
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => void submitEntry(true)}
              >
                {t('saveAndAddNext')}
              </button>
            )}
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => resetForNext(false)}
              >
                {t('cancel')}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
