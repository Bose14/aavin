import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import {
  formatDateDDMMYYYY,
  formatFatSnf,
  formatLitres,
  getLocalTodayIso,
  triggerBlobDownload,
} from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

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
  transit_loss_qty?: number | null;
  receipt_status?: string;
}

interface StockSummary {
  collected_net_qty: number;
  dispatched_qty: number;
  available_stock_qty: number;
}

export default function TankerDispatch() {
  const { t } = useTranslation();
  const { settings } = useZoneSettings();

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);

  const [date, setDate] = useState(() => getLocalTodayIso());
  const [tankerNumber, setTankerNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [dispatchTime, setDispatchTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [quantity, setQuantity] = useState('');
  const [destination, setDestination] = useState(settings.destinations[0] ?? 'Salem Dairy');
  const [dispatchFat, setDispatchFat] = useState('');
  const [dispatchSnf, setDispatchSnf] = useState('');

  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [warningMsg, setWarningMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Dispatch | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const [dRes, sRes] = await Promise.all([
        api.get<Dispatch[]>('/tanker'),
        api.get<StockSummary>('/tanker/stock'),
      ]);
      setDispatches(dRes.data);
      setStock(sRes.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load tanker dispatches');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const qtyNum = parseFloat(quantity);
  const exceedsStock = stock != null && Number.isFinite(qtyNum) && qtyNum > stock.available_stock_qty;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setWarningMsg('');
    setLoading(true);
    try {
      const res = await api.post<Dispatch & { stock_warning?: string | null }>('/tanker', {
        date,
        tanker_number: tankerNumber.trim().toUpperCase(),
        driver_name: driverName.trim() || undefined,
        seal_number: sealNumber.trim() || undefined,
        dispatch_time: dispatchTime || undefined,
        quantity_dispatched: parseFloat(quantity),
        destination: destination || undefined,
        dispatch_fat_pct: dispatchFat ? parseFloat(dispatchFat) : undefined,
        dispatch_snf_pct: dispatchSnf ? parseFloat(dispatchSnf) : undefined,
      });
      if (res.data.stock_warning) setWarningMsg(res.data.stock_warning);
      setTankerNumber('');
      setDriverName('');
      setSealNumber('');
      setQuantity('');
      setDispatchFat('');
      setDispatchSnf('');
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Dispatch failed');
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/tanker/${deleteTarget.id}`);
      setDeleteTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to delete dispatch');
    } finally {
      setDeleting(false);
    }
  };

  const columns: DataColumn<Dispatch>[] = [
    { key: 'date', header: t('colDate'), sortValue: r => r.date, render: r => formatDateDDMMYYYY(r.date) },
    {
      key: 'tanker',
      header: t('tankerNumber'),
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
          {r.dispatch_time && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{r.dispatch_time}</div>}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Dispatched',
      sortValue: r => Number(r.quantity_dispatched),
      render: r => formatLitres(Number(r.quantity_dispatched), 1),
      footerCell: (
        <strong>{formatLitres(dispatches.reduce((s, r) => s + Number(r.quantity_dispatched), 0), 1)}</strong>
      ),
    },
    {
      key: 'quality',
      header: 'Fat / SNF',
      render: r =>
        r.dispatch_fat_pct != null && r.dispatch_snf_pct != null
          ? `${formatFatSnf(r.dispatch_fat_pct)}% / ${formatFatSnf(r.dispatch_snf_pct)}%`
          : '—',
    },
    {
      key: 'dest',
      header: t('destination'),
      sortValue: r => r.destination ?? '',
      render: r => r.destination || '—',
    },
    {
      key: 'receipt',
      header: 'Dairy Receipt / Loss',
      render: r => {
        if (r.received_qty == null) return <StatusBadge tone="amber">In Transit</StatusBadge>;
        const loss = r.transit_loss_qty ?? (Number(r.quantity_dispatched) - Number(r.received_qty));
        return (
          <div>
            <StatusBadge tone="green">Received {formatLitres(Number(r.received_qty), 1)}</StatusBadge>
            <div style={{ fontSize: '0.75rem', color: loss > 0 ? '#b91c1c' : '#047857', marginTop: 3 }}>
              {loss >= 0 ? `Loss: ${formatLitres(loss, 1)}` : `Gain: ${formatLitres(Math.abs(loss), 1)}`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      render: r => (
        <button type="button" onClick={() => setDeleteTarget(r)} className="btn-danger btn-sm">
          Delete
        </button>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{t('tankerTitle')}</h1>
          <p className="page-subtitle">{t('tankerSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void triggerBlobDownload('/export/tanker', { format: 'xlsx' }, 'tanker_dispatches.xlsx')}
          >
            {t('exportXlsx')}
          </button>
        </div>
      </div>

      {stock && (
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">{t('availableStock')}</p>
            <p className="stat-value profit-pos">{formatLitres(stock.available_stock_qty, 1)}</p>
            <p className="stat-sub">{t('collectedMinusDispatched')}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Total Net Collected</p>
            <p className="stat-value">{formatLitres(stock.collected_net_qty, 1)}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Already Dispatched</p>
            <p className="stat-value">{formatLitres(stock.dispatched_qty, 1)}</p>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}
      {warningMsg && <div className="warning-banner"><span>⚠ {warningMsg}</span></div>}

      <div className="card form-card">
        <h2>Record New Tanker Dispatch</h2>
        <form onSubmit={handleSubmit} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>{t('dateLabel')} <span className="hint">({formatDateDDMMYYYY(date)})</span></label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>{t('tankerNumber')}</label>
              <input
                type="text"
                value={tankerNumber}
                onChange={e => setTankerNumber(e.target.value)}
                placeholder="e.g. TN-28-AB-1234"
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('driverName')}</label>
              <input
                type="text"
                value={driverName}
                onChange={e => setDriverName(e.target.value)}
                placeholder="Driver full name"
              />
            </div>
            <div className="form-group">
              <label>{t('sealNumber')}</label>
              <input
                type="text"
                value={sealNumber}
                onChange={e => setSealNumber(e.target.value)}
                placeholder="e.g. AAV-SEAL-884"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('dispatchTime')}</label>
              <input type="time" value={dispatchTime} onChange={e => setDispatchTime(e.target.value)} />
            </div>
            <div className="form-group">
              <label>{t('destination')}</label>
              <select value={destination} onChange={e => setDestination(e.target.value)}>
                {settings.destinations.map(dest => (
                  <option key={dest} value={dest}>{dest}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('qtyDispatched')}</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 2000"
                required
              />
            </div>
            <div className="form-row" style={{ gap: '0.6rem' }}>
              <div className="form-group">
                <label>{t('dispatchFat')}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={dispatchFat}
                  onChange={e => setDispatchFat(e.target.value)}
                  placeholder="4.50"
                />
              </div>
              <div className="form-group">
                <label>{t('dispatchSnf')}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={dispatchSnf}
                  onChange={e => setDispatchSnf(e.target.value)}
                  placeholder="8.40"
                />
              </div>
            </div>
          </div>

          {exceedsStock && (
            <div className="warning-banner" style={{ marginBottom: 0 }}>
              <span>⚠ {t('stockExceedWarn')} (Available: {formatLitres(stock.available_stock_qty, 1)})</span>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? t('saving') : t('dispatchBtn')}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <h2>Recent Dispatches</h2>
        {listLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={dispatches}
            columns={columns}
            getRowKey={r => r.id}
            emptyMessage="No tanker dispatches recorded yet."
            showTotalsRow
          />
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Tanker Dispatch?"
        message={
          deleteTarget
            ? `Delete dispatch ${deleteTarget.tanker_number} (${formatLitres(Number(deleteTarget.quantity_dispatched), 1)} on ${formatDateDDMMYYYY(deleteTarget.date)})? This cannot be undone and will add the volume back to available stock.`
            : ''
        }
        confirmLabel="Delete Dispatch"
        danger
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
