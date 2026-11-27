import React, { useEffect, useState } from 'react';
import api from '../lib/api';

export interface RegisteredTankerData {
  id?: string;
  vehicle_number: string;
  contractor_name: string;
  from_date: string;
  vehicle_type: 'Registered' | 'Unregistered';
  number_of_cells: 1 | 2 | 3;
  front_cell_capacity: number;
  middle_cell_capacity?: number;
  back_cell_capacity?: number;
  supplier_name: string;
  driver_name?: string;
  driver_phone?: string;
  route_name?: string;
  route_bmc_ids?: string[];
  destination_id?: string | null;
}

interface DestinationOption {
  id: string;
  code: string;
  name: string;
}

interface BmcOption {
  id: string;
  name: string;
  bmc_code: string;
  is_active?: boolean;
}

interface Props {
  /** Existing tanker to edit (registering the same vehicle number updates it) */
  initial?: Partial<RegisteredTankerData> | null;
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess?: (tanker: RegisteredTankerData) => void;
  embedded?: boolean;
}

export default function NewTankerRegistrationModal({ isOpen = true, onClose, onSuccess, embedded = false, initial = null }: Props) {
  const [vehicleNumber, setVehicleNumber] = useState(initial?.vehicle_number ?? '');
  const [contractorName, setContractorName] = useState(initial?.contractor_name ?? '');
  const [driverName, setDriverName] = useState(initial?.driver_name ?? '');
  const [driverPhone, setDriverPhone] = useState(initial?.driver_phone ?? '');
  const [routeName, setRouteName] = useState(initial?.route_name ?? '');
  const [routeIds, setRouteIds] = useState<string[]>(initial?.route_bmc_ids ?? []);
  const [destinationId, setDestinationId] = useState(initial?.destination_id ?? '');
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [bmcs, setBmcs] = useState<BmcOption[]>([]);
  const [bmcsLoading, setBmcsLoading] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [vehicleType, setVehicleType] = useState<'Registered' | 'Unregistered'>('Registered');
  const [numberOfCells, setNumberOfCells] = useState<1 | 2 | 3>(initial?.number_of_cells ?? 2);
  const [frontCellCapacity, setFrontCellCapacity] = useState(String(initial?.front_cell_capacity ?? '6500'));
  const [middleCellCapacity, setMiddleCellCapacity] = useState(String(initial?.middle_cell_capacity || '4500'));
  const [backCellCapacity, setBackCellCapacity] = useState(String(initial?.back_cell_capacity || '5500'));
  const [supplierName, setSupplierName] = useState(initial?.supplier_name ?? '');
  const [bmcSearch, setBmcSearch] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!isOpen && !embedded) return;
    let cancelled = false;
    setBmcsLoading(true);
    api
      .get<BmcOption[]>('/bmcs')
      .then((r) => {
        if (!cancelled) setBmcs((r.data || []).filter((b) => b.is_active !== false));
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the BMC list');
      })
      .finally(() => {
        if (!cancelled) setBmcsLoading(false);
      });
    api
      .get<DestinationOption[]>('/tanker/destinations')
      .then((r) => {
        if (!cancelled) setDestinations(r.data || []);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the destinations');
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, embedded]);

  if (!embedded && !isOpen) return null;

  const toggleRoute = (id: string) =>
    setRouteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleNumber.trim()) {
      setError('Vehicle Number is required');
      return;
    }
    if (!contractorName.trim()) {
      setError('Contractor Name is required');
      return;
    }
    if (!supplierName.trim()) {
      setError('Supplier Name is required');
      return;
    }
    if (!driverName.trim()) {
      setError('Driver Name is required');
      return;
    }
    if (!routeName.trim()) {
      setError('Route Name is required');
      return;
    }
    if (routeIds.length === 0) {
      setError('Select at least one BMC for the tanker route');
      return;
    }
    if (destinations.length > 0 && !destinationId) {
      setError('Select the destination of the tanker');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      const payload: RegisteredTankerData = {
        vehicle_number: vehicleNumber.trim().toUpperCase(),
        contractor_name: contractorName.trim(),
        from_date: fromDate,
        vehicle_type: vehicleType,
        number_of_cells: numberOfCells,
        front_cell_capacity: Number(frontCellCapacity) || 0,
        middle_cell_capacity: numberOfCells === 3 ? (Number(middleCellCapacity) || 0) : 0,
        back_cell_capacity: numberOfCells >= 2 ? (Number(backCellCapacity) || 0) : 0,
        supplier_name: supplierName.trim(),
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim() || undefined,
        route_name: routeName.trim(),
        route_bmc_ids: routeIds,
        destination_id: destinationId || null,
      };

      const res = await api.post('/tanker/registration', payload);
      setSuccessMsg(`✓ Tanker ${payload.vehicle_number} registered successfully!`);
      if (onSuccess) onSuccess(res.data || payload);

      // Reset
      setVehicleNumber('');
      setContractorName('');
      setSupplierName('');
      setDriverName('');
      setDriverPhone('');
      setRouteName('');
      setRouteIds([]);
      setDestinationId('');
      if (!embedded && onClose) {
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to register tanker');
    } finally {
      setSubmitting(false);
    }
  };

  const formContent = (
    <div style={{ backgroundColor: '#ffffff', borderRadius: embedded ? 0 : 8, overflow: 'hidden' }}>
      {/* Authentic Aavin IDMS banner */}
      <div
        style={{
          backgroundColor: '#52525b',
          color: '#ffffff',
          padding: '0.5rem 1rem',
          fontSize: '0.88rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>NEW TANKER REGISTRATION</span>
        {!embedded && onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#ffffff', fontSize: '1.1rem', cursor: 'pointer' }}
          >
            ✕
          </button>
        )}
      </div>

      <div className="sheet-modal-body" style={{ padding: '1.25rem 1.5rem' }}>
        {error && (
          <div style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 4, marginBottom: '1rem', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}
        {successMsg && (
          <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 4, marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600 }}>
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* 1. Vehicle Number */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              1. Vehicle Number <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={vehicleNumber}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
              placeholder="e.g. TN28BF9717"
              required
              style={{
                width: 200,
                height: 28,
                padding: '2px 8px',
                border: '1px solid #94a3b8',
                borderRadius: 3,
                fontWeight: 700,
              }}
            />
          </div>

          {/* 2. Contractor Name */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              2. Contractor Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={contractorName}
              onChange={(e) => setContractorName(e.target.value)}
              placeholder="e.g. Murugan Transport"
              required
              style={{
                width: 250,
                height: 28,
                padding: '2px 8px',
                border: '1px solid #94a3b8',
                borderRadius: 3,
              }}
            />
          </div>

          {/* 3. From Date */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              3. From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{
                width: 160,
                height: 28,
                padding: '2px 8px',
                border: '1px solid #94a3b8',
                borderRadius: 3,
              }}
            />
          </div>

          {/* 4. Vehicle Type */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              4. Vehicle Type
            </label>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="radio"
                  name="vehicleType"
                  value="Registered"
                  checked={vehicleType === 'Registered'}
                  onChange={() => setVehicleType('Registered')}
                />
                <span>Registered</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="radio"
                  name="vehicleType"
                  value="Unregistered"
                  checked={vehicleType === 'Unregistered'}
                  onChange={() => setVehicleType('Unregistered')}
                />
                <span>Unregistered</span>
              </label>
            </div>
          </div>

          {/* 5. Number of Cells */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              5. Number of Cells
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {([1, 2, 3] as const).map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setNumberOfCells(num)}
                  style={{
                    backgroundColor: numberOfCells === num ? 'var(--primary)' : '#f1f5f9',
                    color: numberOfCells === num ? '#ffffff' : '#334155',
                    border: '1px solid #cbd5e1',
                    borderRadius: 3,
                    padding: '3px 14px',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  {num} Cell{num > 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* 6. Cell Capacities */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem', paddingTop: '4px' }}>
              6. Cell Capacities (Ltrs)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.82rem', width: 140, color: '#475569' }}>Front Cell Capacity:</span>
                <input
                  type="number"
                  value={frontCellCapacity}
                  onChange={(e) => setFrontCellCapacity(e.target.value)}
                  placeholder="e.g. 6500"
                  style={{ width: 120, height: 26, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                />
              </div>

              {numberOfCells === 3 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.82rem', width: 140, color: '#475569' }}>Middle Cell Capacity:</span>
                  <input
                    type="number"
                    value={middleCellCapacity}
                    onChange={(e) => setMiddleCellCapacity(e.target.value)}
                    placeholder="e.g. 4500"
                    style={{ width: 120, height: 26, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>
              )}

              {numberOfCells >= 2 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.82rem', width: 140, color: '#475569' }}>Back Cell Capacity:</span>
                  <input
                    type="number"
                    value={backCellCapacity}
                    onChange={(e) => setBackCellCapacity(e.target.value)}
                    placeholder="e.g. 5500"
                    style={{ width: 120, height: 26, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 7. Supplier Name */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              7. Supplier Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. Krishnampudur BMC"
              required
              style={{
                width: 250,
                height: 28,
                padding: '2px 8px',
                border: '1px solid #94a3b8',
                borderRadius: 3,
              }}
            />
          </div>

          {/* 8. Driver */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              8. Driver Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. R. Murugan"
              required
              style={{ width: 250, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
            />
          </div>

          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              9. Driver Mobile
            </label>
            <input
              type="tel"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
              placeholder="9876543210"
              style={{ width: 160, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
            />
          </div>

          {/* 10. Route name (shown in reports) */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              10. Route Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="e.g. Rasipuram Route 1"
              required
              style={{ width: 250, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
            />
          </div>

          {/* 11. Destination (where the milk goes) */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem' }}>
              11. Destination {destinations.length > 0 && <span style={{ color: '#ef4444' }}>*</span>}
            </label>
            <select
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              style={{ width: 250, height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3 }}
            >
              <option value="">{destinations.length === 0 ? 'No destinations set up' : 'Select destination…'}</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>{d.code} – {d.name}</option>
              ))}
            </select>
          </div>

          {/* 12. Route BMCs */}
          <div className="fl-row" style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <label style={{ width: 200, fontWeight: 600, color: '#1e293b', fontSize: '0.88rem', paddingTop: '4px' }}>
              12. Route (BMCs) <span style={{ color: '#ef4444' }}>*</span>
              <div style={{ fontWeight: 400, fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                BMCs this tanker collects from, then goes to your dairy unit.
              </div>
            </label>
            <div style={{ flex: 1 }}>
              <input
                type="text"
                value={bmcSearch}
                onChange={(e) => setBmcSearch(e.target.value)}
                placeholder="Search BMC…"
                style={{ width: '100%', height: 28, padding: '2px 8px', border: '1px solid #94a3b8', borderRadius: 3, marginBottom: 6 }}
              />
              <div style={{ maxHeight: 170, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 3, padding: '4px 8px' }}>
                {bmcsLoading && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Loading BMCs…</div>}
                {bmcs
                  .filter((b) => `${b.name} ${b.bmc_code}`.toLowerCase().includes(bmcSearch.trim().toLowerCase()))
                  .map((b) => (
                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', fontSize: '0.84rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={routeIds.includes(String(b.id))} onChange={() => toggleRoute(String(b.id))} />
                      <span>{b.name}</span>
                      <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{b.bmc_code}</span>
                    </label>
                  ))}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: 4 }}>{routeIds.length} selected</div>
            </div>
          </div>

          {/* Action button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '0.25rem' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 3,
                padding: '5px 18px',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1,
              }}
            >
              {submitting ? 'Registering…' : 'Register Tanker'}
            </button>
            {!embedded && onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  borderRadius: 3,
                  padding: '5px 14px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );

  if (embedded) {
    return formContent;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
        overflowY: 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 640, margin: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
        {formContent}
      </div>
    </div>
  );
}
