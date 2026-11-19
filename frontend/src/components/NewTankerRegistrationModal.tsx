import React, { useState } from 'react';
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
}

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess?: (tanker: RegisteredTankerData) => void;
  embedded?: boolean;
}

export default function NewTankerRegistrationModal({ isOpen = true, onClose, onSuccess, embedded = false }: Props) {
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [contractorName, setContractorName] = useState('');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [vehicleType, setVehicleType] = useState<'Registered' | 'Unregistered'>('Registered');
  const [numberOfCells, setNumberOfCells] = useState<1 | 2 | 3>(2);
  const [frontCellCapacity, setFrontCellCapacity] = useState('6500');
  const [middleCellCapacity, setMiddleCellCapacity] = useState('4500');
  const [backCellCapacity, setBackCellCapacity] = useState('5500');
  const [supplierName, setSupplierName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!embedded && !isOpen) return null;

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
      };

      const res = await api.post('/tanker/registration', payload);
      setSuccessMsg(`✓ Tanker ${payload.vehicle_number} registered successfully!`);
      if (onSuccess) onSuccess(res.data || payload);

      // Reset
      setVehicleNumber('');
      setContractorName('');
      setSupplierName('');
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

      <div style={{ padding: '1.25rem 1.5rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.75rem' }}>
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
                    backgroundColor: numberOfCells === num ? '#0284c7' : '#f1f5f9',
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
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1.25rem' }}>
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

          {/* Action button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '0.25rem' }}>
            <button
              type="submit"
              disabled={submitting}
              style={{
                backgroundColor: '#65a30d',
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
      }}
    >
      <div style={{ width: '100%', maxWidth: 580, boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
        {formContent}
      </div>
    </div>
  );
}
