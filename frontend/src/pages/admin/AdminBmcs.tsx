import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { cachedGet, STALE } from '../../lib/cachedGet';
import { useDairyUnitSettings } from '../../hooks/useDairyUnitSettings';
import { formatDateDDMMYYYY, getLocalTodayIso } from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';
import { Page, PageHeader } from '../../components/PageLayout';

interface Unit {
  id: string;
  name: string;
  bmc_code: string;
  location: string | null;
  milk_type?: 'COW' | 'BUFFALO';
  cc_code?: number | null;
  team_name?: string | null;
  capacity_litres?: number | null;
  opening_balance?: number | null;
  opening_balance_date?: string | null;
  is_active: boolean;
  users_count: number;
  last_record_date: string | null;
  submitted_today: boolean;
  created_at: string;
}

export default function AdminBmcs() {
  const { settings } = useDairyUnitSettings();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'submitted' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [name, setName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [capacity, setCapacity] = useState('');
  const [teamName, setTeamName] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userShift, setUserShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [createdLogin, setCreatedLogin] = useState<{ bmc: string; full_name: string; email: string; temp_password: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState<Unit | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editMilkType, setEditMilkType] = useState<'COW' | 'BUFFALO'>('COW');
  const [editCapacity, setEditCapacity] = useState('');
  const [editOpening, setEditOpening] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [toggleTarget, setToggleTarget] = useState<Unit | null>(null);
  const [toggling, setToggling] = useState(false);

  const todayISO = getLocalTodayIso();

  const fetchUnits = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const resUnits = await cachedGet<Unit[]>('/bmcs', undefined, STALE.reference);
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

  const resetCreateForm = () => {
    setName(''); setUnitCode(''); setCapacity(''); setTeamName('');
    setStep(1); setUserName(''); setUserEmail(''); setUserPhone(''); setUserShift('General');
  };

  const closeAddModal = () => {
    setShowAddModal(false);
    setCreatedLogin(null);
    setError('');
    resetCreateForm();
  };

  const teamOptions = Array.from(new Set(units.map(u => u.team_name).filter((t): t is string => !!t && t !== 'TEST'))).sort();

  /** Creates the BMC, and its first user too when `withUser` is set (one request: both or neither). */
  const submitCreate = async (withUser: boolean) => {
    if (!name.trim() || !unitCode.trim()) return;
    setError('');
    setSaving(true);
    try {
      const res = await api.post<{ first_user?: { full_name: string; email: string; temp_password: string } | null }>('/bmcs', {
        name: name.trim(),
        bmc_code: unitCode.trim().toUpperCase(),
        capacity_litres: capacity.trim() === '' ? null : capacity.trim(),
        team_name: teamName || null,
        first_user: withUser
          ? { full_name: userName.trim(), email: userEmail.trim(), phone: userPhone.trim() || null, shift: userShift }
          : null,
      });
      await fetchUnits();
      if (res.data.first_user) {
        setCreatedLogin({ bmc: name.trim(), ...res.data.first_user });
      } else {
        closeAddModal();
      }
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create BMC');
    } finally {
      setSaving(false);
    }
  };

  const step1Valid = name.trim() !== '' && unitCode.trim() !== '';
  const step2Valid = userName.trim() !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(userEmail.trim());

  const openEdit = (u: Unit) => {
    setEditTarget(u);
    setEditName(u.name);
    setEditCode(u.bmc_code);
    setEditLocation(u.location ?? settings.locations[0] ?? '');
    setEditMilkType(u.milk_type === 'BUFFALO' ? 'BUFFALO' : 'COW');
    setEditCapacity(u.capacity_litres != null ? String(u.capacity_litres) : '');
    setEditOpening(u.opening_balance != null ? String(u.opening_balance) : '');
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
        milk_type: editMilkType,
        capacity_litres: editCapacity.trim() === '' ? null : editCapacity.trim(),
        opening_balance: editOpening.trim() === '' ? null : editOpening.trim(),
        opening_balance_date: editTarget.opening_balance_date ?? undefined,
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
    <Page>
      <PageHeader title={<>BMC Administration Dashboard</>}>
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
        </button></PageHeader>

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
        <div style={{ backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', borderLeft: '4px solid var(--primary)', padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: 700 }}>
            Total Registered BMCs
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--primary)', marginTop: '4px' }}>
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
            Operational units in dairy unit
          </div>
        </div>
      </div>

      {/* Create New BMC (step 1: BMC details, step 2: first user) */}
      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            {createdLogin ? (
              <>
                <h3 className="modal-title">BMC created — {createdLogin.bmc}</h3>
                <div className="entry-form" style={{ marginTop: '0.75rem' }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    Share these login details with <strong>{createdLogin.full_name}</strong>. The password is shown only now and must be changed at first login.
                  </p>
                  <div className="form-group"><label>Email</label><input readOnly value={createdLogin.email} /></div>
                  <div className="form-group"><label>Temporary password</label><input readOnly value={createdLogin.temp_password} /></div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(`${createdLogin.email} / ${createdLogin.temp_password}`)}>Copy</button>
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={closeAddModal}>Done</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="modal-title">
                  {step === 1 ? 'New BMC — Step 1 of 2: BMC details' : `New BMC — Step 2 of 2: First user for ${name.trim()}`}
                </h3>
                {error && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
                {step === 1 ? (
                  <div className="entry-form" style={{ marginTop: '0.75rem' }}>
                    <div className="form-group">
                      <label>BMC Name *</label>
                      <input value={name} onChange={e => setName(e.target.value)} placeholder="Enter BMC name" autoFocus />
                    </div>
                    <div className="form-group">
                      <label>BMC Code (CC Code) *</label>
                      <input value={unitCode} onChange={e => setUnitCode(e.target.value)} inputMode="numeric" placeholder="e.g. 12" />
                    </div>
                    <div className="form-group">
                      <label>Capacity (litres)</label>
                      <input type="number" inputMode="decimal" min="0" step="1" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="e.g. 5000" />
                    </div>
                    <div className="form-group">
                      <label>Team</label>
                      <select value={teamName} onChange={e => setTeamName(e.target.value)}>
                        <option value="">— Select team —</option>
                        {teamOptions.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="entry-form" style={{ marginTop: '0.75rem' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
                      This user will be able to enter milk for this BMC. You can skip this and add users later from Teams &amp; Users.
                    </p>
                    <div className="form-group">
                      <label>Full name *</label>
                      <input value={userName} onChange={e => setUserName(e.target.value)} autoFocus />
                    </div>
                    <div className="form-group">
                      <label>Email *</label>
                      <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input value={userPhone} onChange={e => setUserPhone(e.target.value)} inputMode="tel" placeholder="10-digit mobile" />
                    </div>
                    <div className="form-group">
                      <label>Shift</label>
                      <select value={userShift} onChange={e => setUserShift(e.target.value as 'Morning' | 'Evening' | 'General')}>
                        <option value="General">General</option>
                        <option value="Morning">Morning</option>
                        <option value="Evening">Evening</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="modal-actions">
                  {step === 1 ? (
                    <>
                      <button type="button" className="btn-secondary" onClick={closeAddModal}>Cancel</button>
                      <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={!step1Valid} onClick={() => { setError(''); setStep(2); }}>Next</button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-secondary" disabled={saving} onClick={() => { setError(''); setStep(1); }}>Back</button>
                      <button type="button" className="btn-secondary" disabled={saving} onClick={() => void submitCreate(false)}>
                        {saving ? 'Creating…' : 'Skip & create BMC'}
                      </button>
                      <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={saving || !step2Valid} onClick={() => void submitCreate(true)}>
                        {saving ? 'Creating…' : 'Create BMC & user'}
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="card card-toolbar">
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
          <h2 style={{ margin: 0, fontSize: '16px' }}>All BMCs in Your Dairy Unit ({filteredUnits.length})</h2>
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
                <label>BMC Code (CC Code)</label>
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
              <div className="form-group">
                <label>Milk Type (decides the rate chart)</label>
                <select value={editMilkType} onChange={e => setEditMilkType(e.target.value as 'COW' | 'BUFFALO')}>
                  <option value="COW">Cow</option>
                  <option value="BUFFALO">Buffalo</option>
                </select>
              </div>
              <div className="form-group">
                <label>Capacity (litres)</label>
                <input type="number" inputMode="decimal" min="0" step="1" value={editCapacity} onChange={e => setEditCapacity(e.target.value)} placeholder="e.g. 5000" />
              </div>
              <div className="form-group">
                <label>Opening Balance (litres){editTarget?.opening_balance_date ? ` as on ${formatDateDDMMYYYY(editTarget.opening_balance_date)}` : ''}</label>
                <input type="number" inputMode="decimal" min="0" step="1" value={editOpening} onChange={e => setEditOpening(e.target.value)} placeholder="Stock at the BMC before the first entry" />
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
    </Page>
  );
}
