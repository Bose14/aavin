import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import api from '../../lib/api';
import { useZoneSettings } from '../../hooks/useZoneSettings';
import { formatDateDDMMYYYY, getLocalTodayIso } from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Unit {
  id: string;
  name: string;
  bmc_code: string;
  location: string | null;
  is_active: boolean;
  users_count: number;
  last_record_date: string | null;
  submitted_today: boolean;
  created_at: string;
}

export default function AdminBmcs() {
  const { settings } = useZoneSettings();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'submitted' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [name, setName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Unit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<Unit | null>(null);
  const [toggling, setToggling] = useState(false);

  const todayISO = getLocalTodayIso();

  const fetchUnits = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const resUnits = await api.get<Unit[]>('/bmcs');
      setUnits(resUnits.data);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load units');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void fetchUnits();
  }, [fetchUnits]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !unitCode.trim()) return;
    setError('');
    setSaving(true);
    try {
      await api.post('/bmcs', {
        name: name.trim(),
        bmc_code: unitCode.trim().toUpperCase(),
      });
      setName('');
      setUnitCode('');
      setShowAddModal(false);
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create unit');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (u: Unit) => {
    setEditTarget(u);
    setEditName(u.name);
    setEditCode(u.bmc_code);
    setEditLocation(u.location ?? settings.locations[0] ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setError('');
    try {
      await api.patch(`/bmcs/${editTarget.id}`, {
        name: editName.trim(),
        bmc_code: editCode.trim().toUpperCase(),
        location: editLocation.trim() || null,
      });
      setEditTarget(null);
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update unit');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await api.patch(`/bmcs/${toggleTarget.id}`, { is_active: !toggleTarget.is_active });
      setToggleTarget(null);
      await fetchUnits();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update unit status');
    } finally {
      setToggling(false);
    }
  };

  const totalBMCs = units.length;
  const activeBMCs = units.filter(u => u.is_active).length;
  const submittedTodayCount = units.filter(u => u.is_active && u.submitted_today).length;
  const pendingTodayCount = activeBMCs - submittedTodayCount;

  const filteredUnits = useMemo(() => {
    return units.filter((u) => {
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
      if (statusFilter === 'submitted' && (!u.is_active || !u.submitted_today)) return false;
      if (statusFilter === 'pending' && (!u.is_active || u.submitted_today)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = u.name.toLowerCase().includes(q);
        const matchCode = u.bmc_code.toLowerCase().includes(q);
        const matchLoc = (u.location || '').toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchLoc) return false;
      }
      return true;
    });
  }, [units, statusFilter, searchQuery]);

  const columns: DataColumn<Unit>[] = [
    {
      key: 'name',
      header: 'Unit Name',
      sortValue: u => u.name,
      render: u => (
        <div>
          <strong>{u.name}</strong>
          {u.is_active && !u.submitted_today && (
            <div style={{ marginTop: 3 }}>
              <StatusBadge tone="amber">Not submitted today ({formatDateDDMMYYYY(todayISO)})</StatusBadge>
            </div>
          )}
        </div>
      ),
    },
    { key: 'code', header: 'Code', sortValue: u => u.bmc_code, render: u => <code>{u.bmc_code}</code> },
    { key: 'location', header: 'Taluk / Village', sortValue: u => u.location ?? '', render: u => u.location || '—' },
    { key: 'users', header: 'Users', sortValue: u => u.users_count, render: u => u.users_count },
    {
      key: 'last_record',
      header: 'Last Record Date',
      sortValue: u => u.last_record_date ?? '',
      render: u => (u.last_record_date ? formatDateDDMMYYYY(u.last_record_date) : 'No entries yet'),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: u => (u.is_active ? 1 : 0),
      render: u => (
        <StatusBadge tone={u.is_active ? 'green' : 'grey'}>
          {u.is_active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: u => (
        <div className="action-row">
          <button type="button" onClick={() => openEdit(u)} className="btn-secondary btn-sm">
            Edit
          </button>
          <button
            type="button"
            onClick={() => setToggleTarget(u)}
            className={u.is_active ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}
          >
            {u.is_active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1>BMC Administration Dashboard</h1>
          <p className="page-subtitle">
            Monitor Bulk Milk Chilling Centres (BMCs), daily procurement reporting, and outward tanker dispatches
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setName('');
            setUnitCode('');
            setError('');
            setShowAddModal(true);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: 'auto', height: '38px', padding: '0 1rem' }}
        >
          <span>+ Add New BMC</span>
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchUnits} />}

      {/* Top KPI Dashboard Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #0284c7', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Total Registered BMCs
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0284c7', marginTop: '4px' }}>
            {totalBMCs}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Bulk milk chilling centres
          </div>
        </div>

        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid #16a34a', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Active BMCs
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>
            {activeBMCs} <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>({totalBMCs > 0 ? Math.round((activeBMCs / totalBMCs) * 100) : 0}%)</span>
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
            Operational units in zone
          </div>
        </div>
      </div>

      {/* Create New BMC Modal (Matching Uploaded Dialog Style) */}
      {showAddModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowAddModal(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            padding: '16px',
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              maxWidth: '430px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid #e2e8f0',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                  Create New BMC
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                  Fill in the basic BMC details to create a new chilling centre
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Close"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#94a3b8',
                  fontSize: '20px',
                  lineHeight: 1,
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleCreate}>
              {/* BMC Name Field */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                  BMC Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 21h18M3 7v14M21 7v14M6 7V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v3M9 11h2M13 11h2M9 15h2M13 15h2" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter BMC name"
                    required
                    style={{
                      width: '100%',
                      height: '42px',
                      paddingLeft: '38px',
                      paddingRight: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      color: '#0f172a',
                      outline: 'none',
                      backgroundColor: '#ffffff',
                    }}
                  />
                </div>
              </div>

              {/* BMC Code Field */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                  BMC Code <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="9" x2="20" y2="9" />
                      <line x1="4" y1="15" x2="20" y2="15" />
                      <line x1="10" y1="3" x2="8" y2="21" />
                      <line x1="16" y1="3" x2="14" y2="21" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder="Enter BMC code (e.g. RNK-001)"
                    required
                    style={{
                      width: '100%',
                      height: '42px',
                      paddingLeft: '38px',
                      paddingRight: '12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      color: '#0f172a',
                      outline: 'none',
                      backgroundColor: '#ffffff',
                    }}
                  />
                </div>
              </div>

              {/* Modal Actions Footer (Image 3 Style: Cancel on Left, Create on Right) */}
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'space-between',
                  paddingTop: '16px',
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  style={{
                    flex: 1,
                    height: '42px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#334155',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim() || !unitCode.trim()}
                  style={{
                    flex: 1,
                    height: '42px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#3b82f6',
                    color: '#ffffff',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: saving || !name.trim() || !unitCode.trim() ? 'not-allowed' : 'pointer',
                    opacity: saving || !name.trim() || !unitCode.trim() ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Creating…' : 'Create BMC'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '12px 16px', marginBottom: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', marginRight: '4px' }}>Filter:</span>
            <button
              type="button"
              className={statusFilter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{ fontSize: '12px', height: '32px', padding: '0 10px', width: 'auto' }}
              onClick={() => setStatusFilter('all')}
            >
              All ({totalBMCs})
            </button>
            <button
              type="button"
              className={statusFilter === 'active' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{ fontSize: '12px', height: '32px', padding: '0 10px', width: 'auto' }}
              onClick={() => setStatusFilter('active')}
            >
              Active ({activeBMCs})
            </button>
            <button
              type="button"
              className={statusFilter === 'pending' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{ fontSize: '12px', height: '32px', padding: '0 10px', width: 'auto' }}
              onClick={() => setStatusFilter('pending')}
            >
              Pending Today ({pendingTodayCount})
            </button>
            <button
              type="button"
              className={statusFilter === 'submitted' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{ fontSize: '12px', height: '32px', padding: '0 10px', width: 'auto' }}
              onClick={() => setStatusFilter('submitted')}
            >
              Submitted Today ({submittedTodayCount})
            </button>
            <button
              type="button"
              className={statusFilter === 'inactive' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              style={{ fontSize: '12px', height: '32px', padding: '0 10px', width: 'auto' }}
              onClick={() => setStatusFilter('inactive')}
            >
              Inactive ({totalBMCs - activeBMCs})
            </button>
          </div>

          <div style={{ minWidth: '240px' }}>
            <input
              type="search"
              placeholder="🔍 Search BMC name, code, village…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                height: '32px',
                padding: '0 10px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            />
          </div>
        </div>
      </div>

      <div className="card table-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>All BMCs in Your Zone ({filteredUnits.length})</h2>
          {pendingTodayCount > 0 && (
            <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 600 }}>
              ⚠️ {pendingTodayCount} active BMC(s) have not submitted today's milk procurement
            </span>
          )}
        </div>
        {loadingList ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={filteredUnits}
            columns={columns}
            getRowKey={u => u.id}
            getRowClassName={u => (u.is_active && !u.submitted_today ? 'row-warn' : '')}
            emptyMessage="No BMCs found matching your filter or search."
          />
        )}
      </div>

      {/* Edit BMC Modal */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Edit BMC — {editTarget.name}</h3>
            <div className="entry-form" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label>BMC Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>BMC Code</label>
                <input value={editCode} onChange={e => setEditCode(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Location (Taluk / Village)</label>
                <select
                  value={settings.locations.includes(editLocation) ? editLocation : '__custom__'}
                  onChange={e => setEditLocation(e.target.value === '__custom__' ? '' : e.target.value)}
                >
                  {settings.locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                  <option value="__custom__">Other / Custom…</option>
                </select>
                {!settings.locations.includes(editLocation) && (
                  <input
                    style={{ marginTop: '0.45rem' }}
                    value={editLocation}
                    onChange={e => setEditLocation(e.target.value)}
                    placeholder="Enter village or taluk"
                  />
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={savingEdit || !editName.trim() || !editCode.trim()}
                onClick={() => void handleSaveEdit()}
              >
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate / Activate Confirmation */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? `Deactivate ${toggleTarget.name}?` : `Activate ${toggleTarget?.name}?`}
        message={
          toggleTarget?.is_active
            ? `Deactivate ${toggleTarget.name}? Its ${toggleTarget.users_count} ${toggleTarget.users_count === 1 ? 'user' : 'users'} will not be able to log in. Existing records are kept.`
            : `Re-activate ${toggleTarget?.name}? Its assigned users will be allowed to log in again.`
        }
        confirmLabel={toggleTarget?.is_active ? 'Deactivate Unit' : 'Activate Unit'}
        danger={Boolean(toggleTarget?.is_active)}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
}
