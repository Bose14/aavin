import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { TankerTimeline } from '../../components/TankerTimeline';
import { TankerDetailDrawer } from '../../components/TankerDetailDrawer';

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
}

export default function TankerDispatch() {
  const { t, lang } = useTranslation();
  const { settings } = useZoneSettings();

  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [stock, setStock] = useState<StockSummary | null>(null);

  // Form State
  const [date, setDate] = useState(() => getLocalTodayIso());
  const [tankerNumber, setTankerNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [dcNumber, setDcNumber] = useState('');
  const [outletSealNo, setOutletSealNo] = useState('');
  const [dispatchTime, setDispatchTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [dispatchAmPm, setDispatchAmPm] = useState<'AM' | 'PM'>('AM');
  const [destination, setDestination] = useState(settings.destinations[0] ?? 'Namakkal Dairy');

  // Multi-Compartment Form State (Default 3 compartments)
  const [compartments, setCompartments] = useState<CompartmentFormItem[]>([
    {
      compartment_no: 1,
      compartment_name: 'Front Compartment (Comp 1)',
      quantity_litres: '3000',
      capacity_litres: '5000',
      fat_pct: '4.30',
      snf_pct: '8.45',
      seal_number: 'CMP-1-789',
      milk_type: 'Raw Cow Milk',
      temperature: '4.0',
    },
    {
      compartment_no: 2,
      compartment_name: 'Middle Compartment (Comp 2)',
      quantity_litres: '3000',
      capacity_litres: '5000',
      fat_pct: '4.25',
      snf_pct: '8.42',
      seal_number: 'CMP-2-790',
      milk_type: 'Raw Cow Milk',
      temperature: '4.0',
    },
    {
      compartment_no: 3,
      compartment_name: 'Rear Compartment (Comp 3)',
      quantity_litres: '3000',
      capacity_litres: '5000',
      fat_pct: '4.20',
      snf_pct: '8.40',
      seal_number: 'CMP-3-791',
      milk_type: 'Raw Cow Milk',
      temperature: '4.0',
    },
  ]);

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

  // Compartment Quick Presets (1, 2, or 3 compartments)
  const setPresetCompartments = (count: number) => {
    const defaultLitres = count === 1 ? '9000' : count === 2 ? '4500' : '3000';
    const names = [
      'Front Compartment (Comp 1)',
      'Middle Compartment (Comp 2)',
      'Rear Compartment (Comp 3)',
    ];
    if (count === 2) {
      names[1] = 'Rear Compartment (Comp 2)';
    }
    const newItems: CompartmentFormItem[] = [];
    const validCount = Math.min(Math.max(count, 1), 3);
    for (let i = 1; i <= validCount; i++) {
      newItems.push({
        compartment_no: i,
        compartment_name: names[i - 1] || `Compartment ${i}`,
        quantity_litres: defaultLitres,
        capacity_litres: '5000',
        fat_pct: (4.30 - (i - 1) * 0.05).toFixed(2),
        snf_pct: (8.45 - (i - 1) * 0.02).toFixed(2),
        seal_number: `CMP-${i}-78${8 + i}`,
        milk_type: 'Raw Cow Milk',
        temperature: '4.0',
      });
    }
    setCompartments(newItems);
  };

  const addCompartment = () => {
    setCompartments((prev) => {
      const nextNo = prev.length + 1;
      const names = [
        'Front Compartment (Comp 1)',
        'Middle Compartment (Comp 2)',
        'Rear Compartment (Comp 3)',
        'Auxiliary Compartment (Comp 4)',
        'Rear Auxiliary Compartment (Comp 5)',
      ];
      return [
        ...prev,
        {
          compartment_no: nextNo,
          compartment_name: names[nextNo - 1] || `Compartment ${nextNo}`,
          quantity_litres: '3000',
          capacity_litres: '5000',
          fat_pct: '4.20',
          snf_pct: '8.40',
          seal_number: `CMP-${nextNo}-79${nextNo}`,
          milk_type: 'Raw Cow Milk',
          temperature: '4.0',
        },
      ];
    });
  };

  const removeCompartment = (index: number) => {
    if (compartments.length <= 1) return;
    setCompartments((prev) => {
      const updated = prev.filter((_, idx) => idx !== index);
      const names = [
        'Front Compartment (Comp 1)',
        'Middle Compartment (Comp 2)',
        'Rear Compartment (Comp 3)',
      ];
      if (updated.length === 2) {
        names[1] = 'Rear Compartment (Comp 2)';
      }
      return updated.map((item, idx) => ({
        ...item,
        compartment_no: idx + 1,
        compartment_name: names[idx] || `Compartment ${idx + 1}`,
      }));
    });
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

  const exceedsStock = stock != null && totalCompartmentLitres > stock.available_stock_qty;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setWarningMsg('');

    if (!tankerNumber.trim()) {
      setError('Lorry / Tanker number is required');
      return;
    }
    if (!driverName.trim()) {
      setError('Driver name is mandatory');
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
    if (totalCompartmentLitres <= 0) {
      setError('Please enter positive milk volume for at least one compartment');
      return;
    }

    // Verify all active compartments have quantity
    for (const c of compartments) {
      const q = parseFloat(c.quantity_litres);
      if (!q || q <= 0) {
        setError(`Please enter a valid milk quantity for ${c.compartment_name}`);
        return;
      }
    }

    setLoading(true);
    try {
      const structuredCompartments = compartments.map((c) => ({
        compartment_no: c.compartment_no,
        compartment_name: c.compartment_name.trim(),
        quantity_litres: parseFloat(c.quantity_litres),
        capacity_litres: c.capacity_litres ? parseFloat(c.capacity_litres) : null,
        fat_pct: c.fat_pct ? parseFloat(c.fat_pct) : null,
        snf_pct: c.snf_pct ? parseFloat(c.snf_pct) : null,
        dipstick_cm: c.dipstick_cm ? parseFloat(c.dipstick_cm) : null,
        seal_number: c.seal_number.trim() || null,
        milk_type: c.milk_type || 'Raw Cow Milk',
        temperature: c.temperature ? parseFloat(c.temperature) : null,
      }));

      const res = await api.post<Dispatch & { stock_warning?: string | null }>('/tanker', {
        date,
        tanker_number: tankerNumber.trim().toUpperCase(),
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim() || undefined,
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

      if (res.data.stock_warning) setWarningMsg(res.data.stock_warning);

      setSuccessMsg(
        `✓ Lorry ${tankerNumber.trim().toUpperCase()} (DC #${dcNumber.trim().toUpperCase()}) with ${compartments.length} compartments (${totalCompartmentLitres.toLocaleString('en-IN')} L) dispatched successfully! On the way to ${destination}.`
      );

      // Reset Form to fresh state
      setTankerNumber('');
      setDriverName('');
      setDriverPhone('');
      setDcNumber('');
      setOutletSealNo('');
      setPresetCompartments(3);

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
            onClick={() => {
              setSelectedTrip(r);
              setDrawerOpen(true);
            }}
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
    <div className="page" style={{ maxWidth: '1100px', margin: '0 auto', padding: '16px' }}>
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>
            {lang === 'ta' ? 'பால் டேங்கர் லாரி அனுப்புதல் (BMC Outward)' : 'Tanker Milk Dispatch (BMC Outward)'}
          </h1>
          <p className="page-subtitle" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Record outgoing milk tanker with lorry number, driver details, Delivery Challan (DC No), and individual compartment breakdown
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void triggerBlobDownload('/export/tanker', { format: 'xlsx' }, 'tanker_dispatches.xlsx')}
            style={{ fontSize: '13px', padding: '6px 12px' }}
          >
            {t('exportXlsx')}
          </button>
        </div>
      </div>

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
            <p className="stat-label">Total Net Collected at BMC</p>
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

      {/* Recent Dispatches Table (Placed above Dispatch Entry Form) */}
      <div className="card table-card" style={{ padding: '20px', marginBottom: '24px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
          Recent Tanker Dispatches
        </h2>
        {listLoading ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={dispatches}
            columns={columns}
            getRowKey={(r) => r.id}
            emptyMessage="No tanker dispatches recorded yet."
            showTotalsRow
          />
        )}
      </div>

      {/* Main Dispatch Form Card */}
      <div className="card form-card" style={{ padding: '20px', marginBottom: '24px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>
              🚛 Tanker Lorry Dispatch Entry Form
            </h2>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Fill lorry details, DC invoice, and compartment volumes. Dispatched tankers sync instantly to Dairy Plant Admin &amp; Gate teams.
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          {/* SECTION 1: LORRY & DRIVER PARTICULARS */}
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>
            1. LORRY &amp; DRIVER PARTICULARS
          </div>

          <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '14px' }}>
            <div className="form-group">
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                Lorry / Tanker Number *
              </label>
              <input
                type="text"
                value={tankerNumber}
                onChange={(e) => setTankerNumber(e.target.value.toUpperCase())}
                placeholder="e.g. TN-28-AB-1234"
                required
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '14px' }}
              />
            </div>

            <div className="form-group">
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                Driver Name *
              </label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="e.g. R. Murugan"
                required
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div className="form-group">
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                Driver Mobile (+91)
              </label>
              <input
                type="tel"
                value={driverPhone}
                onChange={(e) => setDriverPhone(e.target.value)}
                placeholder="9876543210"
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div className="form-group">
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>
                DC No (Delivery Challan / Invoice No) *
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
                Destination Dairy *
              </label>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px', backgroundColor: '#ffffff' }}
              >
                {settings.destinations.map((dest) => (
                  <option key={dest} value={dest}>{dest}</option>
                ))}
              </select>
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
                  Specify volume and tested quality per individual compartment
                </span>
              </div>

              {/* Quick Presets & Add (Max 3 compartments) */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Presets:</span>
                {[1, 2, 3].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPresetCompartments(count)}
                    className="btn btn-secondary btn-sm"
                    style={{
                      fontSize: '11px',
                      padding: '3px 8px',
                      backgroundColor: compartments.length === count ? '#e0f2fe' : '#ffffff',
                      borderColor: compartments.length === count ? '#0284c7' : '#cbd5e1',
                      color: compartments.length === count ? '#0369a1' : '#475569',
                      fontWeight: 700,
                    }}
                  >
                    {count} Comp
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addCompartment}
                  className="btn btn-secondary btn-sm"
                  style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    color: '#16a34a',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                  title="Add compartment"
                >
                  + Add
                </button>
              </div>
            </div>

            {/* Compartment Cards Grid */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              {compartments.map((comp, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '14px 16px',
                    borderRadius: '8px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          backgroundColor: '#0f172a',
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
                    </div>

                    {compartments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCompartment(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#334155', marginBottom: '3px' }}>
                        Quantity (Litres) *
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="e.g. 4500"
                        value={comp.quantity_litres}
                        onChange={(e) => updateCompartment(idx, 'quantity_litres', e.target.value)}
                        required
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontWeight: 700, fontSize: '13px' }}
                      />
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

                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#475569', marginBottom: '3px' }}>
                        Milk Type
                      </label>
                      <select
                        value={comp.milk_type}
                        onChange={(e) => updateCompartment(idx, 'milk_type', e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '12px', backgroundColor: '#ffffff' }}
                      >
                        <option value="Raw Cow Milk">Raw Cow Milk</option>
                        <option value="Buffalo Milk">Buffalo Milk</option>
                        <option value="Mixed Milk">Mixed Milk</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
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

          {exceedsStock && (
            <div className="warning-banner" style={{ marginBottom: '16px' }}>
              <span>⚠ Dispatched volume exceeds available stock at BMC ({formatLitres(stock.available_stock_qty, 1)})</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || totalCompartmentLitres <= 0}
            className="btn-primary"
            style={{
              width: '100%',
              padding: '12px',
              fontSize: '15px',
              fontWeight: 800,
              backgroundColor: '#16a34a',
              borderColor: '#15803d',
              cursor: loading || totalCompartmentLitres <= 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Dispatching Tanker…' : '🚛 Confirm & Dispatch Tanker to Dairy Plant'}
          </button>
        </form>
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
    </div>
  );
}
