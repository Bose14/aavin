import { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import {
  formatDateDDMMYYYY,
  formatFatSnf,
  formatLitres,
  triggerBlobDownload,
} from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
}

interface Dispatch {
  id: string;
  date: string;
  tanker_number: string;
  driver_name?: string | null;
  seal_number?: string | null;
  dispatch_time?: string | null;
  quantity_dispatched: number;
  destination: string | null;
  dispatch_fat_pct?: number | null;
  dispatch_snf_pct?: number | null;
  received_qty?: number | null;
  receipt_time?: string | null;
  received_fat_pct?: number | null;
  received_snf_pct?: number | null;
  transit_loss_qty?: number | null;
  transit_loss_pct?: number | null;
  fat_diff?: number | null;
  snf_diff?: number | null;
  units: { name: string; unit_code: string } | null;
}

export default function AdminTankerRecords() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<Dispatch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Receipt modal
  const [receiveTarget, setReceiveTarget] = useState<Dispatch | null>(null);
  const [recQty, setRecQty] = useState('');
  const [recTime, setRecTime] = useState('');
  const [recFat, setRecFat] = useState('');
  const [recSnf, setRecSnf] = useState('');
  const [savingReceipt, setSavingReceipt] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Dispatch | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (unitId) params.unit_id = unitId;

      const [rRes, uRes] = await Promise.all([
        api.get<Dispatch[]>('/tanker', { params }),
        api.get<Unit[]>('/units'),
      ]);
      setRecords(rRes.data);
      setUnits(uRes.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load tanker records');
    } finally {
      setLoading(false);
    }
  }, [from, to, unitId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const openReceiptModal = (d: Dispatch) => {
    setReceiveTarget(d);
    setRecQty(d.received_qty != null ? String(d.received_qty) : String(d.quantity_dispatched));
    setRecTime(d.receipt_time || '');
    setRecFat(d.received_fat_pct != null ? String(d.received_fat_pct) : (d.dispatch_fat_pct != null ? String(d.dispatch_fat_pct) : ''));
    setRecSnf(d.received_snf_pct != null ? String(d.received_snf_pct) : (d.dispatch_snf_pct != null ? String(d.dispatch_snf_pct) : ''));
  };

  const handleSaveReceipt = async () => {
    if (!receiveTarget) return;
    setSavingReceipt(true);
    setError('');
    try {
      await api.patch(`/tanker/${receiveTarget.id}/receive`, {
        received_qty: parseFloat(recQty),
        receipt_time: recTime || undefined,
        received_fat_pct: recFat ? parseFloat(recFat) : undefined,
        received_snf_pct: recSnf ? parseFloat(recSnf) : undefined,
      });
      setReceiveTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to log receipt');
    } finally {
      setSavingReceipt(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/tanker/${deleteTarget.id}`);
      setDeleteTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const totalDispatched = records.reduce((s, r) => s + Number(r.quantity_dispatched), 0);
  const receivedRecords = records.filter(r => r.received_qty != null);
  const totalReceived = receivedRecords.reduce((s, r) => s + Number(r.received_qty ?? 0), 0);
  const matchedDispatched = receivedRecords.reduce((s, r) => s + Number(r.quantity_dispatched), 0);
  const totalTransitLoss = +(matchedDispatched - totalReceived).toFixed(2);
  const transitLossPct = matchedDispatched > 0 ? +((totalTransitLoss / matchedDispatched) * 100).toFixed(2) : 0;

  const columns: DataColumn<Dispatch>[] = [
    { key: 'date', header: 'Date', sortValue: r => r.date, render: r => formatDateDDMMYYYY(r.date) },
    {
      key: 'unit',
      header: 'Unit',
      sortValue: r => r.units?.name ?? '',
      render: r => (
        <span>
          {r.units?.name ?? '—'} <span className="unit-code">{r.units?.unit_code}</span>
        </span>
      ),
    },
    {
      key: 'tanker',
      header: 'Tanker / Seal',
      sortValue: r => r.tanker_number,
      render: r => (
        <div>
          <strong>{r.tanker_number}</strong>
          {r.seal_number && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Seal: {r.seal_number}</div>}
        </div>
      ),
    },
    {
      key: 'driver',
      header: 'Driver / Time',
      sortValue: r => r.driver_name ?? '',
      render: r => (
        <div>
          <span>{r.driver_name || '—'}</span>
          {r.dispatch_time && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>Out: {r.dispatch_time}</div>}
        </div>
      ),
    },
    {
      key: 'dispatched',
      header: 'Dispatched',
      sortValue: r => Number(r.quantity_dispatched),
      render: r => (
        <div>
          <strong>{formatLitres(Number(r.quantity_dispatched), 1)}</strong>
          {r.dispatch_fat_pct != null && r.dispatch_snf_pct != null && (
            <div style={{ fontSize: '0.74rem', color: '#6b7280' }}>
              {formatFatSnf(r.dispatch_fat_pct)}% / {formatFatSnf(r.dispatch_snf_pct)}%
            </div>
          )}
        </div>
      ),
      footerCell: <strong>{formatLitres(totalDispatched, 1)}</strong>,
    },
    { key: 'dest', header: 'Destination', sortValue: r => r.destination ?? '', render: r => r.destination || '—' },
    {
      key: 'received',
      header: 'Dairy Receipt',
      sortValue: r => Number(r.received_qty ?? -1),
      render: r => {
        if (r.received_qty == null) return <StatusBadge tone="amber">Pending Receipt</StatusBadge>;
        return (
          <div>
            <StatusBadge tone="green">{formatLitres(Number(r.received_qty), 1)}</StatusBadge>
            {r.receipt_time && <div style={{ fontSize: '0.74rem', color: '#6b7280', marginTop: 2 }}>In: {r.receipt_time}</div>}
          </div>
        );
      },
      footerCell: <strong>{receivedRecords.length > 0 ? formatLitres(totalReceived, 1) : '—'}</strong>,
    },
    {
      key: 'loss',
      header: 'Transit Loss / Diff',
      sortValue: r => Number(r.transit_loss_qty ?? 0),
      render: r => {
        if (r.received_qty == null) return '—';
        const loss = r.transit_loss_qty ?? (Number(r.quantity_dispatched) - Number(r.received_qty));
        return (
          <div>
            <span className={loss > 0 ? 'profit-neg' : 'profit-pos'}>
              {loss >= 0 ? `-${formatLitres(loss, 1)}` : `+${formatLitres(Math.abs(loss), 1)}`}
            </span>
            {(r.fat_diff != null || r.snf_diff != null) && (
              <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                ΔFat {r.fat_diff ?? 0} / ΔSNF {r.snf_diff ?? 0}
              </div>
            )}
          </div>
        );
      },
      footerCell: (
        <strong className={totalTransitLoss > 0 ? 'profit-neg' : 'profit-pos'}>
          {receivedRecords.length > 0 ? `${formatLitres(totalTransitLoss, 1)} (${transitLossPct}%)` : '—'}
        </strong>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: r => (
        <div className="action-row">
          <button type="button" className="btn-secondary btn-sm" onClick={() => openReceiptModal(r)}>
            {r.received_qty != null ? 'Update Receipt' : 'Record Receipt'}
          </button>
          <button type="button" className="btn-danger btn-sm" onClick={() => setDeleteTarget(r)}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tanker Dispatch &amp; Receipt Records</h1>
          <p className="page-subtitle">Track dispatched tankers, dairy intake weights, Fat/SNF differences &amp; transit losses</p>
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
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From date" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To date" />
          <button
            type="button"
            onClick={() => void triggerBlobDownload('/export/tanker', { from, to, unit_id: unitId, format: 'csv' }, 'tanker_records.csv')}
            className="btn-secondary"
          >
            {t('exportCsv')}
          </button>
          <button
            type="button"
            onClick={() => void triggerBlobDownload('/export/tanker', { from, to, unit_id: unitId, format: 'xlsx' }, 'tanker_records.xlsx')}
            className="btn-secondary"
          >
            {t('exportXlsx')}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <p className="stat-label">Total Dispatched</p>
          <p className="stat-value">{formatLitres(totalDispatched, 1)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Received at Dairy</p>
          <p className="stat-value">{formatLitres(totalReceived, 1)}</p>
          <p className="stat-sub">{receivedRecords.length} of {records.length} tankers logged</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Transit Loss</p>
          <p className={`stat-value ${totalTransitLoss > 0 ? 'profit-neg' : 'profit-pos'}`}>
            {formatLitres(totalTransitLoss, 1)} ({transitLossPct}%)
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}

      {loading ? (
        <TableSkeleton rows={5} cols={9} />
      ) : (
        <div className="card table-card">
          <DataTable
            rows={records}
            columns={columns}
            getRowKey={r => r.id}
            getRowClassName={r => (r.transit_loss_pct != null && r.transit_loss_pct > 2 ? 'row-danger' : '')}
            emptyMessage="No tanker dispatches match these filters."
            showTotalsRow
          />
        </div>
      )}

      {/* Record Receipt Modal */}
      {receiveTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Record Dairy Receipt — {receiveTarget.tanker_number}</h3>
            <p className="modal-body-text">
              Dispatched {formatLitres(Number(receiveTarget.quantity_dispatched), 1)} on{' '}
              {formatDateDDMMYYYY(receiveTarget.date)}.
            </p>
            <div className="entry-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Received Quantity (L)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={recQty}
                    onChange={e => setRecQty(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Receipt Time</label>
                  <input type="time" value={recTime} onChange={e => setRecTime(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Received Fat %</label>
                  <input type="number" inputMode="decimal" step="0.01" value={recFat} onChange={e => setRecFat(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Received SNF %</label>
                  <input type="number" inputMode="decimal" step="0.01" value={recSnf} onChange={e => setRecSnf(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setReceiveTarget(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={savingReceipt || !recQty}
                onClick={() => void handleSaveReceipt()}
              >
                {savingReceipt ? 'Saving…' : 'Save Receipt'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Tanker Record?"
        message={
          deleteTarget
            ? `Remove dispatch ${deleteTarget.tanker_number} (${formatDateDDMMYYYY(deleteTarget.date)})? This restores the dispatched litres to available stock.`
            : ''
        }
        confirmLabel="Delete Record"
        danger
        loading={deleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
