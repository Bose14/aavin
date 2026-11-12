import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import {
  formatDateDDMMYYYY,
  formatDateTimeDDMMYYYY,
  formatFatSnf,
  formatINR,
  formatLitres,
  triggerBlobDownload,
} from '../../lib/format';
import { summarizeMilkEntries } from '../../lib/procurement';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import {
  ErrorBanner,
  InfoTooltip,
  StatusBadge,
  TableSkeleton,
} from '../../components/UiPrimitives';

interface MilkRecord {
  id: string;
  date: string;
  shift: 'AM' | 'PM';
  fat_pct: number;
  snf_pct: number;
  quantity_litres: number;
  rejection_qty: number | null;
  rejection_reason?: string | null;
  rejection_pct?: number;
  net_quantity: number;
  rate_per_litre: number;
  rate_override?: boolean;
  rate_override_reason?: string | null;
  procurement_cost: number;
  rejection_loss?: number;
  revenue: number | null;
  profit: number | null;
  status?: string;
  is_locked?: boolean;
  entered_by?: string;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  changes: Record<string, unknown>;
}

export default function UnitRecords() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { settings } = useZoneSettings();

  const [records, setRecords] = useState<MilkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [from, setFrom] = useState(() => searchParams.get('from') || '');
  const [to, setTo] = useState(() => searchParams.get('to') || '');
  const [shiftFilter, setShiftFilter] = useState(() => searchParams.get('shift') || 'ALL');
  const [qualityFilter, setQualityFilter] = useState(() => searchParams.get('quality') || 'all');

  const [editTarget, setEditTarget] = useState<MilkRecord | null>(null);
  const [editFat, setEditFat] = useState('');
  const [editSnf, setEditSnf] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editRej, setEditRej] = useState('');
  const [editRejReason, setEditRejReason] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [correctionTarget, setCorrectionTarget] = useState<MilkRecord | null>(null);
  const [corrReason, setCorrReason] = useState('');
  const [corrDetails, setCorrDetails] = useState('');
  const [savingCorr, setSavingCorr] = useState(false);

  const [auditTarget, setAuditTarget] = useState<MilkRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [actionMsg, setActionMsg] = useState('');

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (shiftFilter !== 'ALL') params.shift = shiftFilter;
      const res = await api.get<MilkRecord[]>('/milk', { params });
      setRecords(res.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load milk records');
    } finally {
      setLoading(false);
    }
  }, [from, to, shiftFilter]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  const isRowFlagged = useCallback(
    (r: MilkRecord) => {
      const qty = Number(r.quantity_litres);
      const rej = Number(r.rejection_qty ?? 0);
      const rejPct = qty > 0 ? (rej / qty) * 100 : 0;
      const badFat = Number(r.fat_pct) < settings.fat_benchmark;
      const badSnf = Number(r.snf_pct) < settings.snf_benchmark;
      if (rejPct >= settings.rejection_danger_pct || badFat || badSnf) return 'danger';
      if (rejPct >= settings.rejection_warn_pct) return 'warn';
      return 'ok';
    },
    [settings],
  );

  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const flag = isRowFlagged(r);
      if (qualityFilter === 'flagged') return flag !== 'ok';
      if (qualityFilter === 'ok') return flag === 'ok';
      return true;
    });
  }, [records, qualityFilter, isRowFlagged]);

  const totals = useMemo(
    () =>
      summarizeMilkEntries(filteredRecords, {
        rejectionPaymentRule: settings.rejection_payment_rule,
      }),
    [filteredRecords, settings.rejection_payment_rule],
  );

  const openEditModal = (r: MilkRecord) => {
    setEditTarget(r);
    setEditFat(Number(r.fat_pct).toFixed(2));
    setEditSnf(Number(r.snf_pct).toFixed(2));
    setEditQty(String(r.quantity_litres));
    setEditRej(String(r.rejection_qty ?? 0));
    setEditRejReason(r.rejection_reason ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      await api.patch(`/milk/${editTarget.id}`, {
        fat_pct: parseFloat(editFat),
        snf_pct: parseFloat(editSnf),
        quantity_litres: parseFloat(editQty),
        rejection_qty: parseFloat(editRej || '0'),
        rejection_reason: parseFloat(editRej || '0') > 0 ? (editRejReason || 'Other') : null,
      });
      setEditTarget(null);
      setActionMsg('Record updated and logged in audit trail.');
      await fetchRecords();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRequestCorrection = async () => {
    if (!correctionTarget || !corrReason.trim()) return;
    setSavingCorr(true);
    try {
      await api.post(`/milk/${correctionTarget.id}/correction-request`, {
        reason: `${corrReason.trim()}${corrDetails ? ` (${corrDetails.trim()})` : ''}`,
      });
      setCorrectionTarget(null);
      setCorrReason('');
      setCorrDetails('');
      setActionMsg('Correction request submitted to Zone Admin for approval.');
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Request failed');
    } finally {
      setSavingCorr(false);
    }
  };

  const openAuditModal = async (r: MilkRecord) => {
    setAuditTarget(r);
    setLoadingAudit(true);
    try {
      const res = await api.get<AuditEntry[]>('/settings/audit-logs', {
        params: { entity_id: r.id, limit: '25' },
      });
      setAuditLogs(res.data);
    } catch {
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleExport = async (format: 'xlsx' | 'csv') => {
    try {
      await triggerBlobDownload(
        '/export/milk',
        {
          from,
          to,
          shift: shiftFilter === 'ALL' ? '' : shiftFilter,
          quality: qualityFilter === 'all' ? '' : qualityFilter,
          format,
        },
        `${profile?.units?.unit_code || 'UNIT'}_milk_records.${format}`,
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Export failed');
    }
  };

  const showProfitCol = settings.show_unit_profit && records.some(r => r.profit !== null);

  const columns: DataColumn<MilkRecord>[] = [
    {
      key: 'date',
      header: t('colDate'),
      sortValue: r => r.date,
      searchValue: r => formatDateDDMMYYYY(r.date),
      render: r => formatDateDDMMYYYY(r.date),
      footerCell: <strong>Totals ({filteredRecords.length})</strong>,
    },
    {
      key: 'shift',
      header: t('colShift'),
      sortValue: r => r.shift,
      render: r => <span className={`badge ${r.shift}`}>{r.shift}</span>,
    },
    {
      key: 'fat',
      header: t('colFat'),
      sortValue: r => Number(r.fat_pct),
      render: r => (
        <span className={Number(r.fat_pct) < settings.fat_benchmark ? 'profit-neg' : undefined}>
          {formatFatSnf(r.fat_pct, true)}
        </span>
      ),
      footerCell: <strong>{formatFatSnf(totals.avgFat, true)}</strong>,
    },
    {
      key: 'snf',
      header: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {t('colSnf')} <InfoTooltip text={t('tipSnf')} label={t('colSnf')} />
        </span>
      ),
      sortValue: r => Number(r.snf_pct),
      render: r => (
        <span className={Number(r.snf_pct) < settings.snf_benchmark ? 'profit-neg' : undefined}>
          {formatFatSnf(r.snf_pct, true)}
        </span>
      ),
      footerCell: <strong>{formatFatSnf(totals.avgSnf, true)}</strong>,
    },
    {
      key: 'qty',
      header: t('colQty'),
      sortValue: r => Number(r.quantity_litres),
      render: r => formatLitres(Number(r.quantity_litres), 1),
      footerCell: <strong>{formatLitres(totals.grossQty, 1)}</strong>,
    },
    {
      key: 'rej',
      header: t('colRej'),
      sortValue: r => Number(r.rejection_qty ?? 0),
      searchValue: r => r.rejection_reason ?? '',
      render: r => (
        <div>
          <span>{formatLitres(Number(r.rejection_qty ?? 0), 1)}</span>
          {r.rejection_reason && (
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{r.rejection_reason}</div>
          )}
        </div>
      ),
      footerCell: <strong>{formatLitres(totals.rejectionQty, 1)}</strong>,
    },
    {
      key: 'rej_pct',
      header: t('colRejPct'),
      sortValue: r => Number(r.rejection_pct ?? 0),
      render: r => {
        const pct = r.rejection_pct ?? (r.quantity_litres > 0 ? ((Number(r.rejection_qty ?? 0) / Number(r.quantity_litres)) * 100) : 0);
        const tone = pct >= settings.rejection_danger_pct ? 'red' : pct >= settings.rejection_warn_pct ? 'amber' : 'grey';
        return <StatusBadge tone={tone}>{pct.toFixed(1)}%</StatusBadge>;
      },
      footerCell: <strong>{totals.rejectionPct.toFixed(1)}%</strong>,
    },
    {
      key: 'net_qty',
      header: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {t('colNetQty')} <InfoTooltip text={t('tipNetQuantity')} label={t('colNetQty')} />
        </span>
      ),
      sortValue: r => Number(r.net_quantity),
      render: r => <strong>{formatLitres(Number(r.net_quantity), 1)}</strong>,
      footerCell: <strong>{formatLitres(totals.netQty, 1)}</strong>,
    },
    {
      key: 'rate',
      header: t('colRate'),
      sortValue: r => Number(r.rate_per_litre),
      render: r => (
        <span>
          ₹{Number(r.rate_per_litre).toFixed(2)}
          {r.rate_override && <StatusBadge tone="amber">Override</StatusBadge>}
        </span>
      ),
    },
    {
      key: 'proc_value',
      header: t('colProcValue'),
      sortValue: r => Number(r.procurement_cost),
      render: r => formatINR(Number(r.procurement_cost)),
      footerCell: <strong>{formatINR(totals.procurementCost)}</strong>,
    },
  ];

  if (showProfitCol) {
    columns.push({
      key: 'profit',
      header: t('colProfitLoss'),
      sortValue: r => Number(r.profit ?? 0),
      render: r => {
        const val = Number(r.profit ?? 0);
        return <span className={val >= 0 ? 'profit-pos' : 'profit-neg'}>{formatINR(val, { showPlus: val > 0 })}</span>;
      },
      footerCell: (
        <strong className={totals.estimatedProfit >= 0 ? 'profit-pos' : 'profit-neg'}>
          {formatINR(totals.estimatedProfit, { showPlus: totals.estimatedProfit > 0 })}
        </strong>
      ),
    });
  }

  columns.push(
    {
      key: 'status',
      header: t('colStatus'),
      sortValue: r => r.status ?? 'submitted',
      render: r => {
        if (r.status === 'verified') return <StatusBadge tone="green">{t('statusVerified')}</StatusBadge>;
        if (r.is_locked) return <StatusBadge tone="grey">{t('statusLocked')}</StatusBadge>;
        return <StatusBadge tone="indigo">{t('statusSubmitted')}</StatusBadge>;
      },
    },
    {
      key: 'created_at',
      header: t('colEnteredAt'),
      sortValue: r => r.created_at,
      render: r => <span style={{ fontSize: '0.78rem', color: '#475569' }}>{formatDateTimeDDMMYYYY(r.created_at)}</span>,
    },
    {
      key: 'actions',
      header: t('colActions'),
      render: r => (
        <div className="action-row">
          {!r.is_locked && r.status !== 'verified' ? (
            <button type="button" className="btn-secondary btn-sm" onClick={() => openEditModal(r)}>
              {t('editEntry')}
            </button>
          ) : (
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCorrectionTarget(r)}>
              {t('requestCorrection')}
            </button>
          )}
          <button type="button" className="btn-link" onClick={() => void openAuditModal(r)}>
            History
          </button>
        </div>
      ),
    },
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('myRecordsTitle')}</h1>
          <p className="page-subtitle">
            {profile?.units ? `${profile.units.name} · ${profile.units.unit_code} — ` : ''}
            {t('myRecordsSubtitle')}
          </p>
        </div>
        <div className="header-actions">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
          <select value={shiftFilter} onChange={e => setShiftFilter(e.target.value)} aria-label="Filter by shift">
            <option value="ALL">All Shifts</option>
            <option value="AM">AM Only</option>
            <option value="PM">PM Only</option>
          </select>
          <select value={qualityFilter} onChange={e => setQualityFilter(e.target.value)} aria-label="Filter by quality">
            <option value="all">All Quality</option>
            <option value="flagged">High Rej / Low Quality</option>
            <option value="ok">Standard OK</option>
          </select>
          <button type="button" onClick={() => void handleExport('csv')} className="btn-secondary">{t('exportCsv')}</button>
          <button type="button" onClick={() => void handleExport('xlsx')} className="btn-secondary">{t('exportXlsx')}</button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchRecords} />}
      {actionMsg && <div className="success-banner"><span>{actionMsg}</span></div>}

      {loading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : (
        <div className="card table-card">
          <div className="table-summary-strip">
            <span>Entries: <strong>{filteredRecords.length}</strong></span>
            <span>Collected: <strong>{formatLitres(totals.grossQty, 1)}</strong></span>
            <span>Net Accepted: <strong>{formatLitres(totals.netQty, 1)}</strong></span>
            <span>Avg Fat/SNF: <strong>{formatFatSnf(totals.avgFat)}% / {formatFatSnf(totals.avgSnf)}%</strong></span>
            <span>Procurement Value: <strong>{formatINR(totals.procurementCost)}</strong></span>
          </div>

          <DataTable
            rows={filteredRecords}
            columns={columns}
            getRowKey={r => r.id}
            getRowClassName={r => {
              const flag = isRowFlagged(r);
              return flag === 'danger' ? 'row-danger' : flag === 'warn' ? 'row-warn' : '';
            }}
            emptyMessage={t('noDataAddFirst')}
            emptyActionLabel={t('navMilkEntry')}
            onEmptyAction={() => navigate('/unit/milk-entry')}
            showTotalsRow
          />
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Edit Entry — {formatDateDDMMYYYY(editTarget.date)} ({editTarget.shift})</h3>
            <div className="entry-form" style={{ marginTop: '0.75rem' }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Fat %</label>
                  <input type="number" step="0.01" inputMode="decimal" value={editFat} onChange={e => setEditFat(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>SNF %</label>
                  <input type="number" step="0.01" inputMode="decimal" value={editSnf} onChange={e => setEditSnf(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Quantity (L)</label>
                  <input type="number" step="0.1" inputMode="decimal" value={editQty} onChange={e => setEditQty(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Rejection (L)</label>
                  <input type="number" step="0.1" inputMode="decimal" value={editRej} onChange={e => setEditRej(e.target.value)} />
                </div>
              </div>
              {parseFloat(editRej || '0') > 0 && (
                <div className="form-group">
                  <label>Rejection Reason</label>
                  <select value={editRejReason} onChange={e => setEditRejReason(e.target.value)}>
                    <option value="Sour">Sour</option>
                    <option value="Adulterated">Adulterated</option>
                    <option value="Low Fat/SNF">Low Fat/SNF</option>
                    <option value="High Temperature">High Temperature</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>{t('cancel')}</button>
              <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                {savingEdit ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Correction Modal */}
      {correctionTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Request Correction — {formatDateDDMMYYYY(correctionTarget.date)} ({correctionTarget.shift})</h3>
            <p className="modal-body-text">
              This entry is locked (older than {settings.edit_lock_hours}h or verified). Describe the correction needed for Zone Admin review.
            </p>
            <div className="entry-form">
              <div className="form-group">
                <label>Reason</label>
                <input
                  type="text"
                  value={corrReason}
                  onChange={e => setCorrReason(e.target.value)}
                  placeholder="e.g. Lab register Fat was 4.60%, mistyped as 4.20%"
                  required
                />
              </div>
              <div className="form-group">
                <label>Requested Values <span className="hint">(optional)</span></label>
                <input
                  type="text"
                  value={corrDetails}
                  onChange={e => setCorrDetails(e.target.value)}
                  placeholder="e.g. Fat: 4.60, Qty: 260 L"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setCorrectionTarget(null)}>{t('cancel')}</button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={savingCorr || !corrReason.trim()}
                onClick={() => void handleRequestCorrection()}
              >
                {savingCorr ? t('saving') : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {auditTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Audit History — {formatDateDDMMYYYY(auditTarget.date)} ({auditTarget.shift})</h3>
            {loadingAudit ? (
              <p className="modal-body-text">Loading audit log…</p>
            ) : auditLogs.length === 0 ? (
              <p className="modal-body-text">No edit history recorded yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.75rem' }}>
                {auditLogs.map(log => (
                  <div key={log.id} style={{ padding: '0.65rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong>{log.actor_name} — {log.action}</strong>
                      <span style={{ color: '#6b7280' }}>{formatDateTimeDDMMYYYY(log.created_at)}</span>
                    </div>
                    <pre style={{ fontSize: '0.74rem', color: '#475569', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(log.changes, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setAuditTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
