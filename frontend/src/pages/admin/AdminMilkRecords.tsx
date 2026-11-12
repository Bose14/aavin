import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
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
import { ErrorBanner, InfoTooltip, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
}

interface MilkRecord {
  id: string;
  unit_id: string;
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
  entered_by?: string;
  units: { name: string; unit_code: string } | null;
}

interface CorrectionRequestItem {
  id: string;
  milk_entry_id: string;
  unit_id: string;
  requested_by_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  changes: Record<string, unknown>;
}

export default function AdminMilkRecords() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { settings } = useZoneSettings();

  const [records, setRecords] = useState<MilkRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRequestItem[]>([]);

  const [unitId, setUnitId] = useState(() => searchParams.get('unit_id') || '');
  const [shiftFilter, setShiftFilter] = useState(() => searchParams.get('shift') || 'ALL');
  const [qualityFilter, setQualityFilter] = useState(() => searchParams.get('quality') || 'all');
  const [from, setFrom] = useState(() => searchParams.get('from') || '');
  const [to, setTo] = useState(() => searchParams.get('to') || '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // Bulk upload state
  const [uploading, setUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    inserted: number;
    skipped: number;
    errors: Array<{ row: number; error: string }>;
  } | null>(null);

  // Audit modal
  const [auditTarget, setAuditTarget] = useState<MilkRecord | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (unitId) params.unit_id = unitId;
      if (shiftFilter !== 'ALL') params.shift = shiftFilter;

      const [rRes, uRes, cRes] = await Promise.all([
        api.get<MilkRecord[]>('/milk', { params }),
        api.get<Unit[]>('/units'),
        api.get<CorrectionRequestItem[]>('/milk/correction-requests').catch(() => ({ data: [] as CorrectionRequestItem[] })),
      ]);
      setRecords(rRes.data);
      setUnits(uRes.data);
      setCorrections(cRes.data.filter(c => c.status === 'pending'));
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load milk records');
    } finally {
      setLoading(false);
    }
  }, [from, to, unitId, shiftFilter]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

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

  const handleVerify = async (r: MilkRecord) => {
    try {
      await api.patch(`/milk/${r.id}/verify`);
      setActionMsg(`Verified entry for ${r.units?.name ?? ''} on ${formatDateDDMMYYYY(r.date)} (${r.shift}).`);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Verification failed');
    }
  };

  const handleResolveCorrection = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await api.patch(`/milk/correction-requests/${id}`, { status });
      setActionMsg(`Correction request ${status}.`);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Could not update correction request');
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

  const handleBulkFileChange = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError('');
    setBulkResult(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await api.post<{
        inserted: number;
        skipped: number;
        errors: Array<{ row: number; error: string }>;
      }>('/milk/bulk', { fileBase64: base64 });
      setBulkResult(res.data);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Bulk upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (endpoint: string, format: 'xlsx' | 'csv' | 'pdf') => {
    try {
      await triggerBlobDownload(
        endpoint,
        {
          from,
          to,
          unit_id: unitId,
          shift: shiftFilter === 'ALL' ? '' : shiftFilter,
          quality: qualityFilter === 'all' ? '' : qualityFilter,
          format,
        },
        `milk_records.${format}`,
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Download failed');
    }
  };

  const columns: DataColumn<MilkRecord>[] = [
    {
      key: 'date',
      header: 'Date',
      sortValue: r => r.date,
      searchValue: r => formatDateDDMMYYYY(r.date),
      render: r => formatDateDDMMYYYY(r.date),
      footerCell: <strong>Totals ({filteredRecords.length})</strong>,
    },
    {
      key: 'unit',
      header: 'Unit',
      sortValue: r => r.units?.name ?? '',
      searchValue: r => `${r.units?.name ?? ''} ${r.units?.unit_code ?? ''}`,
      render: r => (
        <span>
          {r.units?.name ?? '—'} <span className="unit-code">{r.units?.unit_code}</span>
        </span>
      ),
    },
    {
      key: 'shift',
      header: 'Shift',
      sortValue: r => r.shift,
      render: r => <span className={`badge ${r.shift}`}>{r.shift}</span>,
    },
    {
      key: 'fat',
      header: 'Fat %',
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
          SNF % <InfoTooltip text={t('tipSnf')} label="SNF %" />
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
      header: 'Gross (L)',
      sortValue: r => Number(r.quantity_litres),
      render: r => formatLitres(Number(r.quantity_litres), 1),
      footerCell: <strong>{formatLitres(totals.grossQty, 1)}</strong>,
    },
    {
      key: 'rej',
      header: 'Rej (L / %)',
      sortValue: r => Number(r.rejection_qty ?? 0),
      render: r => {
        const pct = r.rejection_pct ?? (r.quantity_litres > 0 ? (Number(r.rejection_qty ?? 0) / Number(r.quantity_litres)) * 100 : 0);
        const tone = pct >= settings.rejection_danger_pct ? 'red' : pct >= settings.rejection_warn_pct ? 'amber' : 'grey';
        return (
          <div>
            <span>{formatLitres(Number(r.rejection_qty ?? 0), 1)} </span>
            <StatusBadge tone={tone}>{pct.toFixed(1)}%</StatusBadge>
            {r.rejection_reason && <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{r.rejection_reason}</div>}
          </div>
        );
      },
      footerCell: <strong>{formatLitres(totals.rejectionQty, 1)} ({totals.rejectionPct.toFixed(1)}%)</strong>,
    },
    {
      key: 'net',
      header: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Net Qty <InfoTooltip text={t('tipNetQuantity')} label="Net Qty" />
        </span>
      ),
      sortValue: r => Number(r.net_quantity),
      render: r => <strong>{formatLitres(Number(r.net_quantity), 1)}</strong>,
      footerCell: <strong>{formatLitres(totals.netQty, 1)}</strong>,
    },
    {
      key: 'rate',
      header: 'Rate',
      sortValue: r => Number(r.rate_per_litre),
      render: r => (
        <div>
          <span>₹{Number(r.rate_per_litre).toFixed(2)}</span>
          {r.rate_override && <div style={{ marginTop: 2 }}><StatusBadge tone="amber">Override</StatusBadge></div>}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount (₹)',
      sortValue: r => Number(r.procurement_cost),
      render: r => formatINR(Number(r.procurement_cost)),
      footerCell: <strong>{formatINR(totals.procurementCost)}</strong>,
    },
    {
      key: 'profit',
      header: 'Profit / Loss',
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
    },
    {
      key: 'entered_by',
      header: 'Entered By',
      sortValue: r => r.entered_by ?? '',
      render: r => <span style={{ fontSize: '0.8rem' }}>{r.entered_by || 'Staff'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: r => r.status ?? 'submitted',
      render: r =>
        r.status === 'verified'
          ? <StatusBadge tone="green">Verified</StatusBadge>
          : <StatusBadge tone="indigo">Submitted</StatusBadge>,
    },
    {
      key: 'actions',
      header: 'Actions',
      render: r => (
        <div className="action-row">
          {r.status !== 'verified' && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => void handleVerify(r)}>
              Verify
            </button>
          )}
          <button type="button" className="btn-link" onClick={() => void openAuditModal(r)}>
            History
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Milk Collection Records</h1>
          <p className="page-subtitle">Filter, verify, audit, bulk upload, and export zone milk entries</p>
        </div>
        <div className="header-actions">
          <select value={unitId} onChange={e => setUnitId(e.target.value)} aria-label="Filter by unit">
            <option value="">All Units</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.unit_code})
              </option>
            ))}
          </select>
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
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
          <button type="button" onClick={() => void handleDownload('/export/milk', 'csv')} className="btn-secondary">
            {t('exportCsv')}
          </button>
          <button type="button" onClick={() => void handleDownload('/export/milk', 'xlsx')} className="btn-secondary">
            {t('exportXlsx')}
          </button>
          <button type="button" onClick={() => void handleDownload('/export/milk/pdf', 'pdf')} className="btn-primary" style={{ width: 'auto' }}>
            {t('exportPdf')}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}
      {actionMsg && <div className="success-banner"><span>{actionMsg}</span></div>}

      {/* Bulk Excel Upload & Template */}
      <div className="card form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Bulk Upload via Excel Template</h2>
            <p className="chart-subtitle">Download the formatted template, enter rows with dd-mm-yyyy dates, and upload here.</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void triggerBlobDownload('/export/milk/template', {}, 'milk_bulk_upload_template.xlsx')}
            >
              Download Excel Template
            </button>
            <label className="btn-primary" style={{ width: 'auto', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              {uploading ? 'Uploading…' : 'Upload .xlsx / .csv'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  void handleBulkFileChange(file);
                }}
              />
            </label>
          </div>
        </div>
        {bulkResult && (
          <div className={bulkResult.skipped > 0 ? 'warning-banner' : 'success-banner'} style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            <div>
              <strong>Bulk upload complete:</strong> {bulkResult.inserted} inserted, {bulkResult.skipped} skipped.
              {bulkResult.errors.length > 0 && (
                <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: '0.8rem' }}>
                  {bulkResult.errors.slice(0, 8).map((er, i) => (
                    <li key={i}>Row {er.row}: {er.error}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pending Correction Requests */}
      {corrections.length > 0 && (
        <div className="card form-card" style={{ borderColor: '#fde68a', background: '#fffbeb' }}>
          <h2>Pending Correction Requests ({corrections.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {corrections.map(c => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  background: '#ffffff',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 8,
                  border: '1px solid #fde68a',
                }}
              >
                <div style={{ fontSize: '0.85rem' }}>
                  <strong>{c.requested_by_name}</strong> — {c.reason}
                  <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{formatDateTimeDDMMYYYY(c.created_at)}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void handleResolveCorrection(c.id, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => void handleResolveCorrection(c.id, 'rejected')}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} cols={10} />
      ) : (
        <div className="card table-card">
          <div className="table-summary-strip">
            <span>Entries: <strong>{filteredRecords.length}</strong></span>
            <span>Gross Qty: <strong>{formatLitres(totals.grossQty, 1)}</strong></span>
            <span>Net Qty: <strong>{formatLitres(totals.netQty, 1)}</strong></span>
            <span>Weighted Avg Fat/SNF: <strong>{formatFatSnf(totals.avgFat)}% / {formatFatSnf(totals.avgSnf)}%</strong></span>
            <span>Total Cost: <strong>{formatINR(totals.procurementCost)}</strong></span>
            <span>
              Projected Profit:{' '}
              <strong className={totals.estimatedProfit >= 0 ? 'profit-pos' : 'profit-neg'}>
                {formatINR(totals.estimatedProfit, { showPlus: totals.estimatedProfit > 0 })}
              </strong>
            </span>
          </div>

          <DataTable
            rows={filteredRecords}
            columns={columns}
            getRowKey={r => r.id}
            getRowClassName={r => {
              const flag = isRowFlagged(r);
              return flag === 'danger' ? 'row-danger' : flag === 'warn' ? 'row-warn' : '';
            }}
            emptyMessage="No milk records match these filters."
            showTotalsRow
          />
        </div>
      )}

      {/* Audit History Modal */}
      {auditTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">
              Audit History — {auditTarget.units?.name ?? ''} ({formatDateDDMMYYYY(auditTarget.date)} {auditTarget.shift})
            </h3>
            {loadingAudit ? (
              <p className="modal-body-text">Loading audit log…</p>
            ) : auditLogs.length === 0 ? (
              <p className="modal-body-text">No modifications recorded yet.</p>
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
