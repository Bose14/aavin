import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import TankerDetailsModal from '../../components/TankerDetailsModal';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
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
import { TankerTimeline } from '../../components/TankerTimeline';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';
import { Page, PageHeader } from '../../components/PageLayout';

interface CompartmentFormItem {
  compartment_no: number;
  compartment_name: string;
  quantity_litres: string;
  capacity_litres: string;
  fat_pct: string;
  snf_pct: string;
  dipstick_cm?: string;
  seal_number: string;
  milk_type: string;
  temperature: string;
  already_filled_litres?: number;
  available_litres?: number;
  loaded_by_bmc_name?: string | null;
  loaded_dc_no?: string | null;
  cell_key?: string;
}

interface Dispatch {
  id: string;
  date: string;
  tanker_number: string;
  driver_name?: string | null;
  seal_number?: string | null;
  dc_number?: string | null;
  dispatch_time?: string | null;
  quantity_dispatched: number;
  destination: string | null;
  dispatch_fat_pct?: number | null;
  dispatch_snf_pct?: number | null;
  received_qty?: number | null;
  receipt_time?: string | null;
  transit_loss_qty?: number | null;
  receipt_status?: string;
  compartments?: any[];
  stage_data?: any;
  journey?: any;
}

interface StockSummary {
  collected_net_qty: number;
  dispatched_qty: number;
  available_stock_qty: number;
  available_fat_pct?: number | null;
  available_snf_pct?: number | null;
}

export default function TankerDispatch() {
  const [detailTripId, setDetailTripId] = useState<string | null>(null);
  const { t, lang } = useTranslation();
  const { settings } = useDairyUnitSettings();

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);

  // Dialog Modals
  const [showDispatchModal, setShowDispatchModal] = useState(false);

  // Registered Tankers with Cell Capacity Tracking
  const [registeredTankers, setRegisteredTankers] = useState<any[]>([]);
  const [selectedTanker, setSelectedTanker] = useState<any | null>(null);

  // Form State
  const [date, setDate] = useState(() => getLocalTodayIso());
  const [tankerNumber, setTankerNumber] = useState('');
  const [dcNumber, setDcNumber] = useState('');
  const [outletSealNo, setOutletSealNo] = useState('');
  const [milkType, setMilkType] = useState<'Raw Cow Milk' | 'Skim Separated Milk'>('Raw Cow Milk');
  const [dispatchTime, setDispatchTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [dispatchAmPm, setDispatchAmPm] = useState<'AM' | 'PM'>('AM');
  // The tanker always goes to this admin's dairy unit (set when the tanker is registered)
  const destination = settings.destinations[0] ?? 'Namakkal Dairy';

  // Multi-Compartment Form State
  const [compartments, setCompartments] = useState<CompartmentFormItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [warningMsg, setWarningMsg] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Dispatch | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const [dRes, sRes, rRes] = await Promise.all([
        api.get<Dispatch[]>('/tanker'),
        api.get<StockSummary>('/tanker/stock'),
        api.get<any[]>('/tanker/registered'),
      ]);
      setDispatches(dRes.data);
      setStock(sRes.data);
      setRegisteredTankers(rRes.data || []);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load tanker dispatches');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Only registered tankers with available capacity that have not entered the plant are selectable
  const availableTankers = useMemo(() => {
    return registeredTankers.filter((t) => {
      if (t.is_at_plant) return false;
      if (t.is_full) return false;
      if (t.available_capacity != null && t.available_capacity <= 0) return false;
      return t.is_available_for_dispatch !== false;
    });
  }, [registeredTankers]);

  // Fat/SNF of the milk still at the BMC, used to pre-fill every cell (the BMC can edit them)
  const defaultFat = stock?.available_fat_pct != null ? String(stock.available_fat_pct) : '';
  const defaultSnf = stock?.available_snf_pct != null ? String(stock.available_snf_pct) : '';

  const handleTankerSelect = (vehNum: string) => {
    setTankerNumber(vehNum);
    const found = registeredTankers.find((t) => t.vehicle_number === vehNum);
    setSelectedTanker(found || null);

    const cells: any[] = Array.isArray(found?.cells) ? found.cells : [];
    setCompartments(
      cells.map((cell: any, idx: number) => {
        const avail = cell.available_litres != null ? cell.available_litres : cell.capacity || 0;
        return {
          compartment_no: idx + 1,
          compartment_name: cell.cell_name || `Compartment ${idx + 1}`,
          cell_key: cell.cell_key,
          quantity_litres: '',
          capacity_litres: String(cell.capacity || 0),
          fat_pct: defaultFat,
          snf_pct: defaultSnf,
          seal_number: '',
          milk_type: 'Raw Cow Milk',
          temperature: '4.0',
          already_filled_litres: cell.filled_litres || 0,
          available_litres: avail,
          loaded_by_bmc_name: cell.loaded_by_bmc_name,
          loaded_dc_no: cell.dc_number,
        };
      }),
    );
  };

  const updateCompartment = (index: number, field: keyof CompartmentFormItem, value: string) => {
    setCompartments((prev) => {
      const clone = [...prev];
      clone[index] = { ...clone[index], [field]: value };
      return clone;
    });
  };

  // Live Auto-Calculations
  const totalCompartmentLitres = useMemo(() => {
    return compartments.reduce((sum, c) => sum + (parseFloat(c.quantity_litres) || 0), 0);
  }, [compartments]);

  const weightedFat = useMemo(() => {
    if (totalCompartmentLitres <= 0) return 0;
    const sumFat = compartments.reduce((sum, c) => {
      const q = parseFloat(c.quantity_litres) || 0;
      const f = parseFloat(c.fat_pct) || 0;
      return sum + q * f;
    }, 0);
    return +(sumFat / totalCompartmentLitres).toFixed(2);
  }, [compartments, totalCompartmentLitres]);

  const weightedSnf = useMemo(() => {
    if (totalCompartmentLitres <= 0) return 0;
    const sumSnf = compartments.reduce((sum, c) => {
      const q = parseFloat(c.quantity_litres) || 0;
      const s = parseFloat(c.snf_pct) || 0;
      return sum + q * s;
    }, 0);
    return +(sumSnf / totalCompartmentLitres).toFixed(2);
  }, [compartments, totalCompartmentLitres]);

  const availableMilk = stock ? stock.available_stock_qty : null;
  const exceedsStock = availableMilk != null && totalCompartmentLitres > availableMilk + 0.0001;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setWarningMsg('');

    if (!tankerNumber.trim()) {
      setError('Please select a registered Lorry / Tanker Number');
      return;
    }
    if (!dcNumber.trim()) {
      setError('DC No (BMC Delivery Challan / Invoice No) is mandatory');
      return;
    }
    if (!outletSealNo.trim()) {
      setError('Outlet Seal No is mandatory for tanker dispatch security');
      return;
    }

    // Filter active compartments with entered milk volume
    const activeCompartments = compartments.filter((c) => {
      const q = parseFloat(c.quantity_litres);
      return !isNaN(q) && q > 0;
    });

    if (activeCompartments.length === 0) {
      setError('Please enter positive milk volume for at least one available compartment');
      return;
    }

    // Verify each active compartment does not exceed available space
    for (const c of activeCompartments) {
      const q = parseFloat(c.quantity_litres);
      const maxAvail = c.available_litres != null ? c.available_litres : (c.capacity_litres ? parseFloat(c.capacity_litres) : Infinity);
      if (q > maxAvail) {
        setError(`Quantity for ${c.compartment_name} (${q.toLocaleString('en-IN')} L) exceeds available cell capacity (${maxAvail.toLocaleString('en-IN')} L)`);
        return;
      }
    }

    if (availableMilk != null && totalCompartmentLitres > availableMilk + 0.0001) {
      setError(`Only ${availableMilk.toLocaleString('en-IN')} L of milk is available. You entered ${totalCompartmentLitres.toLocaleString('en-IN')} L.`);
      return;
    }

    setLoading(true);
    try {
      const structuredCompartments = activeCompartments.map((c) => ({
        compartment_no: c.compartment_no,
        compartment_name: c.compartment_name.trim(),
        cell_key: c.cell_key,
        quantity_litres: parseFloat(c.quantity_litres),
        capacity_litres: c.capacity_litres ? parseFloat(c.capacity_litres) : null,
        fat_pct: c.fat_pct ? parseFloat(c.fat_pct) : null,
        snf_pct: c.snf_pct ? parseFloat(c.snf_pct) : null,
        seal_number: c.seal_number.trim() || null,
        milk_type: milkType,
        temperature: c.temperature ? parseFloat(c.temperature) : null,
      }));

      await api.post<Dispatch>('/tanker', {
        date,
        tanker_number: tankerNumber.trim().toUpperCase(),
        dc_number: dcNumber.trim().toUpperCase(),
        seal_number: outletSealNo.trim().toUpperCase(),
        dispatch_time: `${dispatchTime} ${dispatchAmPm}`,
        dispatch_ampm: dispatchAmPm,
        quantity_dispatched: totalCompartmentLitres,
        dispatch_fat_pct: weightedFat > 0 ? weightedFat : undefined,
        dispatch_snf_pct: weightedSnf > 0 ? weightedSnf : undefined,
        destination: destination || 'Namakkal Dairy',
        compartments: structuredCompartments,
      });

      setSuccessMsg(
        `✓ Lorry ${tankerNumber.trim().toUpperCase()} (DC #${dcNumber.trim().toUpperCase()}) with ${activeCompartments.length} compartment(s) (${totalCompartmentLitres.toLocaleString('en-IN')} L) dispatched successfully! On the way to ${destination}.`
      );

      // Close modal and reset form
      setShowDispatchModal(false);
      setTankerNumber('');
      setSelectedTanker(null);
      setDcNumber('');
      setMilkType('Raw Cow Milk');
      setOutletSealNo('');
      setCompartments([]);

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
    {
      key: 'date',
      header: t('colDate'),
      sortValue: (r) => r.date,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{formatDateDDMMYYYY(r.date)}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>{r.dispatch_time || '—'}</div>
        </div>
      ),
    },
    {
      key: 'tanker',
      header: 'Lorry / DC No',
      sortValue: (r) => r.tanker_number,
      render: (r) => {
        const dc = r.dc_number || r.stage_data?.dc_number;
        const comps = r.compartments || r.journey?.compartments || r.stage_data?.compartments;
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong style={{ color: '#0f172a' }}>{r.tanker_number}</strong>
              {comps && comps.length > 0 && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    padding: '1px 5px',
                    borderRadius: '4px',
                    border: '1px solid #bbf7d0',
                  }}
                  title={comps.map((c: any) => `${c.compartment_name || 'Comp'}: ${c.quantity_litres}L`).join(', ')}
                >
                  {comps.length} Comp
                </span>
              )}
            </div>
            {dc && (
              <div style={{ fontSize: '11px', color: '#0284c7', fontWeight: 600 }}>
                DC #{dc}
              </div>
            )}
            {r.seal_number && (
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Seal: {r.seal_number}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'driver',
      header: 'Driver',
      sortValue: (r) => r.driver_name ?? '',
      render: (r) => (
        <div>
          <span style={{ fontWeight: 600 }}>{r.driver_name || '—'}</span>
          {r.stage_data?.driver_phone && (
            <div style={{ fontSize: '11px', color: '#64748b' }}>{r.stage_data.driver_phone}</div>
          )}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Dispatched (L)',
      align: 'right',
      sortValue: (r) => Number(r.quantity_dispatched),
      render: (r) => (
        <div style={{ textAlign: 'right' }}>
          <strong style={{ fontSize: '13px', color: '#0f172a' }}>
            {formatLitres(Number(r.quantity_dispatched), 1)}
          </strong>
        </div>
      ),
      footerCell: (
        <strong>{formatLitres(dispatches.reduce((s, r) => s + Number(r.quantity_dispatched), 0), 1)}</strong>
      ),
    },
    {
      key: 'quality',
      header: 'Fat / SNF',
      render: (r) =>
        r.dispatch_fat_pct != null && r.dispatch_snf_pct != null
          ? `${formatFatSnf(r.dispatch_fat_pct)}% / ${formatFatSnf(r.dispatch_snf_pct)}%`
          : '—',
    },
    {
      key: 'dest',
      header: t('destination'),
      sortValue: (r) => r.destination ?? '',
      render: (r) => <span>{r.destination || 'Namakkal Dairy'}</span>,
    },
    {
      key: 'progress',
      header: 'Plant Journey Progress',
      render: (r: any) =>
        r.journey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TankerTimeline
              journey={r.journey}
              variant="mini"
              onStepClick={() => {
                setSelectedTrip(r);
                setDrawerOpen(true);
              }}
            />
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '8px',
                backgroundColor: r.journey.stageColor?.badgeBg || '#f1f5f9',
                color: r.journey.stageColor?.badgeText || '#334155',
                fontWeight: 600,
              }}
            >
              {r.journey.tripStatusLabel}
            </span>
          </div>
        ) : (
          <StatusBadge tone="amber">On the way</StatusBadge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (r: any) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setDetailTripId(String(r.id))}
            className="btn btn-secondary btn-sm"
            title="View complete lorry details, compartments & live journey timeline"
          >
            Details
          </button>
          <button type="button" onClick={() => setDeleteTarget(r)} className="btn-danger btn-sm">
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader title={lang === 'ta' ? 'பால் டேங்கர் லாரி அனுப்புதல் (BMC Outward)' : 'Tanker Milk Dispatch (BMC Outward)'}>
        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError('');
              setShowDispatchModal(true);
            }}
            style={{
              fontWeight: 700,
              fontSize: '13px',
              padding: '8px 16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              maxWidth: '100%',
              whiteSpace: 'normal',
            }}
          >
            🚛 + Create Dispatch Entry
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void triggerBlobDownload('/export/tanker', { format: 'xlsx' }, 'tanker_dispatches.xlsx')}
            style={{ fontSize: '13px', padding: '6px 12px' }}
          >
            {t('exportXlsx')}
          </button>
        </div></PageHeader>

      {/* BMC Stock Summary Banner */}
      {stock && (
        <div className="stats-grid" style={{ marginBottom: '16px' }}>
          <div className="stat-card" style={{ borderLeft: '4px solid #16a34a' }}>
            <p className="stat-label">{t('availableStock')}</p>
            <p className="stat-value profit-pos" style={{ fontSize: '20px', fontWeight: 800 }}>
              {formatLitres(stock.available_stock_qty, 1)}
            </p>
            <p className="stat-sub">{t('collectedMinusDispatched')}</p>
          </div>
          <div className="stat-card" style={{ borderLeft: '4px solid #0284c7' }}>
            <p className="stat-label">Total Litres Collected</p>
            <p className="stat-value" style={{ fontSize: '20px', fontWeight: 800 }}>
              {formatLitres(stock.collected_net_qty, 1)}
            </p>
          </div>
          <div className="stat-card" style={{ borderLeft: '4px solid #64748b' }}>
            <p className="stat-label">Already Dispatched</p>
            <p className="stat-value" style={{ fontSize: '20px', fontWeight: 800 }}>
              {formatLitres(stock.dispatched_qty, 1)}
            </p>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}
      {successMsg && (
        <div
          className="success-banner"
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
            padding: '12px 16px',
            borderRadius: '6px',
            marginBottom: '16px',
            fontWeight: 600,
          }}
        >
          <span>{successMsg}</span>
        </div>
      )}
      {warningMsg && <div className="warning-banner" style={{ marginBottom: '16px' }}><span>⚠ {warningMsg}</span></div>}

      {/* Recent Dispatches Table (Displayed on main BMC front face) */}
      <div className="card card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
            Recent Tanker Dispatches
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setError('');
              setShowDispatchModal(true);
            }}
            style={{
              fontWeight: 700,
              fontSize: '12px',
              padding: '6px 14px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            🚛 + Create Dispatch Entry
          </button>
        </div>
        {listLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={dispatches}
            columns={columns}
            getRowKey={(r) => r.id}
            emptyMessage="No tanker dispatches recorded yet. Click '+ Create Dispatch Entry' above to dispatch milk."
            showTotalsRow
          />
        )}
      </div>

      {/* Dispatch Entry Modal Dialog */}
      {showDispatchModal && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '16px',
            overflowY: 'auto',
          }}
          onClick={() => setShowDispatchModal(false)}
        >
          <div
            className="modal-dialog card dispatch-modal"
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '12px',
              maxWidth: '920px',
              width: '100%',
              maxHeight: '92vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #cbd5e1',
              padding: '24px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  🚛 Tanker Lorry Dispatch Entry Form
                </h2>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  Select registered tanker, check available cell capacity, and enter Delivery Challan (DC No) and compartment volumes.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDispatchModal(false)}
                style={{
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: '6px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            {error && <ErrorBanner message={error} />}

            <form onSubmit={handleSubmit} className="entry-form">
              {/* Available milk at this BMC (collected via Milk Entry minus already dispatched) */}
              {stock && (
                <div
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                    backgroundColor: stock.available_stock_qty > 0 ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${stock.available_stock_qty > 0 ? '#86efac' : '#fecaca'}`,
                    borderRadius: '6px', padding: '10px 14px', marginBottom: '14px',
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#14532d', fontWeight: 700 }}>
                    Available milk to dispatch: <span style={{ fontSize: '17px' }}>{formatLitres(stock.available_stock_qty, 1)}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    Total Litres Collected {formatLitres(stock.collected_net_qty, 1)} − Dispatched {formatLitres(stock.dispatched_qty, 1)}
                  </div>
                </div>
              )}

              {/* SECTION 1: LORRY & INVOICE */}
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
                1. LORRY &amp; INVOICE
              </div>

              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                      Lorry / Tanker Number *
                    </label>
                  </div>
                  <select
                    value={tankerNumber}
                    onChange={(e) => handleTankerSelect(e.target.value)}
                    required
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '14px', backgroundColor: '#ffffff' }}
                  >
                    <option value="">-- Select Registered Tanker --</option>
                    {availableTankers.map((t) => (
                      <option key={t.id || t.vehicle_number} value={t.vehicle_number}>
                        {t.vehicle_number} — {t.available_capacity != null ? `${t.available_capacity.toLocaleString('en-IN')} L avail / ${t.total_capacity?.toLocaleString('en-IN')} L total` : `${t.total_capacity || 10000} L`} ({t.number_of_cells || 2} cells)
                      </option>
                    ))}
                  </select>
                  {availableTankers.length === 0 && (
                    <div style={{ fontSize: '11px', color: '#b45309', marginTop: '4px' }}>
                      No registered tankers currently available for dispatch. Tankers with 0 available space or currently inside the dairy processing centre will be unlocked after gate exit.
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>
                    Invoice No (DC No) *
                  </label>
                  <input
                    type="text"
                    value={dcNumber}
                    onChange={(e) => setDcNumber(e.target.value.toUpperCase())}
                    placeholder="e.g. DC-BMC-2026-001"
                    required
                    style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #38bdf8', fontWeight: 700, fontSize: '13px', backgroundColor: '#f0f9ff' }}
                  />
                </div>
              </div>

              {/* Tanker Live Capacity Overview if selected */}
              {selectedTanker && (
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '12px 16px',
                    marginBottom: '14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{selectedTanker.vehicle_number}</strong>
                      <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                        ({selectedTanker.contractor_name || selectedTanker.transporter_name || 'Registered Transporter'} · {selectedTanker.number_of_cells || selectedTanker.cells?.length || 2} Cells)
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                      <span>Total: <strong>{(selectedTanker.total_capacity || 0).toLocaleString('en-IN')} L</strong></span>
                      <span style={{ color: '#d97706' }}>Already Filled: <strong>{(selectedTanker.filled_capacity || 0).toLocaleString('en-IN')} L</strong></span>
                      <span style={{ color: '#16a34a' }}>Available Space: <strong>{(selectedTanker.available_capacity || selectedTanker.total_capacity || 0).toLocaleString('en-IN')} L</strong></span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '12px', color: '#334155', margin: '4px 0 6px' }}>
                    <span>
                      Driver: <strong>{selectedTanker.driver_name || '—'}</strong>
                      {selectedTanker.driver_phone ? ` · ${selectedTanker.driver_phone}` : ''}
                    </span>
                    <span>
                      Route:{' '}
                      <strong>
                        {Array.isArray(selectedTanker.route) && selectedTanker.route.length > 0
                          ? selectedTanker.route.map((b: { name: string }) => b.name).join(' → ')
                          : 'Any BMC'}
                      </strong>{' '}
                      → {destination}
                    </span>
                  </div>

                  {selectedTanker.filled_capacity > 0 && (
                    <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', padding: '6px 10px', fontSize: '12px', color: '#1e40af', marginTop: '6px' }}>
                      ℹ <strong>Multi-BMC Route Active:</strong> This tanker has {(selectedTanker.filled_capacity || 0).toLocaleString('en-IN')} L of milk from prior BMC loading. You can fill remaining empty cell(s) up to {(selectedTanker.available_capacity || 0).toLocaleString('en-IN')} L under your BMC Delivery Challan (DC No).
                    </div>
                  )}
                </div>
              )}

              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Outlet Seal No (Main Discharge Valve) *
                  </label>
                  <input
                    type="text"
                    value={outletSealNo}
                    onChange={(e) => setOutletSealNo(e.target.value.toUpperCase())}
                    placeholder="e.g. SL-OUT-8891"
                    required
                    style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Type of Milk *
                  </label>
                  <select
                    value={milkType}
                    onChange={(e) => setMilkType(e.target.value as 'Raw Cow Milk' | 'Skim Separated Milk')}
                    style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  >
                    <option value="Raw Cow Milk">RCM – Raw Cow Milk</option>
                    <option value="Skim Separated Milk">SSM – Skim Separated Milk</option>
                  </select>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Destination Dairy
                  </label>
                  <div style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontSize: '13px', fontWeight: 600 }}>
                    {destination}
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Dispatch Date *
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                    Dispatch Time *
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="time"
                      value={dispatchTime}
                      onChange={(e) => setDispatchTime(e.target.value)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                    />
                    <select
                      value={dispatchAmPm}
                      onChange={(e) => setDispatchAmPm(e.target.value as 'AM' | 'PM')}
                      style={{ width: '70px', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff', fontWeight: 700 }}
                    >
                      <option value="AM">AM</option>
                      <option value="PM">PM</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SECTION 2: COMPARTMENT DETAILS */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      2. LORRY COMPARTMENT DETAILS
                    </span>
                    <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>
                      Enter litres for each cell. Fat and SNF are filled from your collection and can be edited.
                    </span>
                  </div>

                </div>

                {compartments.length === 0 && (
                  <div style={{ fontSize: '12px', color: '#64748b', padding: '8px 0' }}>
                    Select a tanker above to see its cells.
                  </div>
                )}

                {/* Compartment Cards Grid */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                  {compartments.map((comp, idx) => {
                    const maxAvail = comp.available_litres != null ? comp.available_litres : (comp.capacity_litres ? parseFloat(comp.capacity_litres) : Infinity);
                    const isCellFull = comp.available_litres != null && comp.available_litres <= 0;
                    const qtyVal = parseFloat(comp.quantity_litres) || 0;
                    const isOverCap = qtyVal > maxAvail;

                    return (
                      <div
                        key={idx}
                        style={{
                          padding: '14px 16px',
                          borderRadius: '8px',
                          backgroundColor: isCellFull ? '#f1f5f9' : '#f8fafc',
                          border: isOverCap ? '1px solid #ef4444' : isCellFull ? '1px solid #e2e8f0' : '1px solid #cbd5e1',
                          opacity: isCellFull ? 0.75 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span
                              style={{
                                backgroundColor: isCellFull ? '#64748b' : '#0f172a',
                                color: '#ffffff',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              {comp.compartment_no}
                            </span>
                            <strong style={{ fontSize: '13px', color: '#1e293b' }}>
                              {comp.compartment_name}
                            </strong>
                            {comp.capacity_litres && (
                              <span style={{ fontSize: '11px', color: '#64748b' }}>
                                (Capacity: {Number(comp.capacity_litres).toLocaleString('en-IN')} L)
                              </span>
                            )}
                            {comp.already_filled_litres != null && comp.already_filled_litres > 0 && (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  backgroundColor: '#fef3c7',
                                  color: '#92400e',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  border: '1px solid #fde68a',
                                }}
                              >
                                Filled: {comp.already_filled_litres.toLocaleString('en-IN')} L by {comp.loaded_by_bmc_name || 'Prior BMC'} {comp.loaded_dc_no ? `(DC #${comp.loaded_dc_no})` : ''}
                              </span>
                            )}
                            {comp.available_litres != null && (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  backgroundColor: isCellFull ? '#fee2e2' : '#dcfce7',
                                  color: isCellFull ? '#991b1b' : '#166534',
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                }}
                              >
                                {isCellFull ? 'Cell Full' : `Available: ${comp.available_litres.toLocaleString('en-IN')} L`}
                              </span>
                            )}
                          </div>

                        </div>

                        {isCellFull ? (
                          <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic', padding: '6px 0' }}>
                            🔒 This cell is fully loaded by a prior BMC on this route. No additional milk volume can be filled here.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                                Quantity (Litres) *
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                max={maxAvail !== Infinity ? maxAvail : undefined}
                                placeholder={maxAvail !== Infinity ? `Max ${maxAvail}` : 'e.g. 4500'}
                                value={comp.quantity_litres}
                                onChange={(e) => updateCompartment(idx, 'quantity_litres', e.target.value)}
                                style={{
                                  width: '100%',
                                  padding: '6px 8px',
                                  borderRadius: '4px',
                                  border: isOverCap ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                  fontWeight: 700,
                                  fontSize: '13px',
                                }}
                              />
                              {isOverCap && (
                                <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 600 }}>
                                  Exceeds space ({maxAvail.toLocaleString('en-IN')} L)
                                </span>
                              )}
                            </div>

                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                                Fat %
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="4.30"
                                value={comp.fat_pct}
                                onChange={(e) => updateCompartment(idx, 'fat_pct', e.target.value)}
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                              />
                            </div>

                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                                SNF %
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                placeholder="8.45"
                                value={comp.snf_pct}
                                onChange={(e) => updateCompartment(idx, 'snf_pct', e.target.value)}
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                              />
                            </div>

                            <div>
                              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                                Top Seal No
                              </label>
                              <input
                                type="text"
                                placeholder="e.g. CMP-1-789"
                                value={comp.seal_number}
                                onChange={(e) => updateCompartment(idx, 'seal_number', e.target.value.toUpperCase())}
                                style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px' }}
                              />
                            </div>

                                                    </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Live Real-time Lorry Summary Bar */}
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '6px',
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px',
                    marginBottom: '16px',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '12px', color: '#1e40af', fontWeight: 600 }}>Total Lorry Dispatched Volume: </span>
                    <strong style={{ fontSize: '16px', color: '#1e3a8a' }}>
                      {formatLitres(totalCompartmentLitres)}
                    </strong>
                    <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '6px' }}>
                      ({compartments.length} Compartments)
                    </span>
                  </div>

                  <div style={{ fontSize: '12px', color: '#1e40af', fontWeight: 700 }}>
                    Weighted Average Quality: Fat {weightedFat.toFixed(2)}% · SNF {weightedSnf.toFixed(2)}%
                  </div>
                </div>
              </div>

              {exceedsStock && stock && (
                <div style={{ marginBottom: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '6px', padding: '10px 14px', fontSize: '13px', fontWeight: 600 }}>
                  ✕ You can send only the available milk. Available: {formatLitres(stock.available_stock_qty, 1)}, entered: {formatLitres(totalCompartmentLitres, 1)}. Reduce the litres to continue.
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowDispatchModal(false)}
                  className="btn-secondary"
                  style={{
                    flex: 1,
                    padding: '12px',
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || totalCompartmentLitres <= 0 || exceedsStock}
                  className="btn-primary"
                  style={{
                    flex: 2,
                    minWidth: 0,
                    whiteSpace: 'normal',
                    padding: '12px',
                    fontSize: '15px',
                    fontWeight: 800,
                    backgroundColor: 'var(--primary)',
                    borderColor: 'var(--primary-dark)',
                    cursor: loading || totalCompartmentLitres <= 0 || exceedsStock ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? 'Dispatching Tanker…' : '🚛 Confirm & Dispatch Tanker to Dairy Plant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


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

      <TankerDetailDrawer
        isOpen={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedTrip(null);
        }}
        trip={selectedTrip}
        onTripUpdated={() => void fetchAll()}
        isAdmin={false}
      />
      <TankerDetailsModal tripId={detailTripId} onClose={() => setDetailTripId(null)} />
    </Page>
  );
}
