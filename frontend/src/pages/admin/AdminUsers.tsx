import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { normalizeIndianPhone } from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
  last_record_date?: string | null;
}

interface UnitUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  unit_id: string | null;
  sub_role?: 'operator' | 'supervisor';
  is_active?: boolean;
  must_change_password?: boolean;
  units: { name: string; unit_code: string } | null;
}

function genPassword() {
  return Math.random().toString(36).slice(-5) + 'A@' + Math.floor(100 + Math.random() * 900);
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const fullNameRef = useRef<HTMLInputElement>(null);

  const [users, setUsers] = useState<UnitUser[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [unitId, setUnitId] = useState('');
  const [subRole, setSubRole] = useState<'operator' | 'supervisor'>('operator');
  const [password, setPassword] = useState(() => genPassword());
  const [forceChange, setForceChange] = useState(true);

  const [error, setError] = useState('');
  const [onboardingResult, setOnboardingResult] = useState<{
    message: string;
    tempPassword?: string;
    inviteLink?: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<UnitUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editUnitId, setEditUnitId] = useState('');
  const [editSubRole, setEditSubRole] = useState<'operator' | 'supervisor'>('operator');
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset Password modal
  const [resetTarget, setResetTarget] = useState<UnitUser | null>(null);
  const [resetTempPwd, setResetTempPwd] = useState('');
  const [resetting, setResetting] = useState(false);

  // Deactivate confirm
  const [toggleTarget, setToggleTarget] = useState<UnitUser | null>(null);
  const [toggling, setToggling] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const [uRes, unRes] = await Promise.all([
        api.get<UnitUser[]>('/users'),
        api.get<Unit[]>('/units'),
      ]);
      setUsers(uRes.data);
      setUnits(unRes.data);
      if (unRes.data.length > 0 && !unitId) setUnitId(unRes.data[0].id);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load unit users');
    } finally {
      setLoadingList(false);
    }
  }, [unitId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const normalizedPhonePreview = phone.trim() ? normalizeIndianPhone(phone) : null;
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setOnboardingResult(null);

    if (!emailValid) {
      setError('Please enter a valid email address.');
      return;
    }
    if (phone.trim() && !normalizedPhonePreview) {
      setError('Phone must be a valid 10-digit Indian mobile number (+91).');
      return;
    }

    setSaving(true);
    try {
      const res = await api.post<{
        temp_password?: string;
        invite_link?: string | null;
      }>('/users/create', {
        full_name: fullName.trim(),
        email: email.trim(),
        phone: normalizedPhonePreview || undefined,
        role: 'unit',
        sub_role: subRole,
        unit_id: unitId,
        temp_password: password,
        force_password_change: forceChange,
      });

      setOnboardingResult({
        message: `Account created for ${fullName.trim()}. ${forceChange ? 'User will be required to set a new password on first login.' : ''}`,
        tempPassword: res.data.temp_password || password,
        inviteLink: res.data.invite_link ?? null,
      });
      setFullName('');
      setEmail('');
      setPhone('');
      setPassword(genPassword());
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (u: UnitUser) => {
    setEditTarget(u);
    setEditName(u.full_name ?? '');
    setEditPhone(u.phone ?? '');
    setEditUnitId(u.unit_id ?? (units[0]?.id || ''));
    setEditSubRole(u.sub_role ?? 'operator');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    if (editPhone.trim() && !normalizeIndianPhone(editPhone)) {
      setError('Phone must be a valid 10-digit Indian mobile number (+91).');
      return;
    }
    setSavingEdit(true);
    setError('');
    try {
      await api.patch(`/users/${editTarget.id}`, {
        full_name: editName.trim(),
        phone: editPhone.trim() ? normalizeIndianPhone(editPhone) : null,
        unit_id: editUnitId,
        sub_role: editSubRole,
      });
      setEditTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmResetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setError('');
    try {
      const res = await api.post<{ temp_password: string; invite_link?: string | null }>(
        `/users/${resetTarget.id}/reset-password`,
        { temp_password: resetTempPwd || genPassword() },
      );
      setOnboardingResult({
        message: `Password reset for ${resetTarget.full_name ?? resetTarget.email}. User must change password on next login.`,
        tempPassword: res.data.temp_password,
        inviteLink: res.data.invite_link ?? null,
      });
      setResetTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Password reset failed');
    } finally {
      setResetting(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      await api.patch(`/users/${toggleTarget.id}`, {
        is_active: toggleTarget.is_active === false,
      });
      setToggleTarget(null);
      await fetchAll();
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Status change failed');
    } finally {
      setToggling(false);
    }
  };

  const hasUnits = units.length > 0;
  const hasUsers = users.length > 0;
  const hasAnyRecord = units.some(u => Boolean(u.last_record_date));

  const columns: DataColumn<UnitUser>[] = [
    {
      key: 'name',
      header: 'Name',
      sortValue: u => u.full_name ?? '',
      searchValue: u => `${u.full_name ?? ''} ${u.email ?? ''} ${u.phone ?? ''}`,
      render: u => (
        <div>
          <strong>{u.full_name ?? '—'}</strong>
          {u.email && <div style={{ fontSize: '0.76rem', color: '#6b7280' }}>{u.email}</div>}
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', sortValue: u => u.phone ?? '', render: u => u.phone ?? '—' },
    {
      key: 'unit',
      header: 'Assigned Unit',
      sortValue: u => u.units?.name ?? '',
      render: u =>
        u.units ? (
          <span>
            {u.units.name} <span className="unit-code">{u.units.unit_code}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'sub_role',
      header: 'Role',
      sortValue: u => u.sub_role ?? 'operator',
      render: u => (
        <StatusBadge tone={u.sub_role === 'supervisor' ? 'indigo' : 'grey'}>
          {u.sub_role === 'supervisor' ? 'Supervisor' : 'Operator'}
        </StatusBadge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: u => (u.is_active === false ? 0 : 1),
      render: u => (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <StatusBadge tone={u.is_active === false ? 'grey' : 'green'}>
            {u.is_active === false ? 'Inactive' : 'Active'}
          </StatusBadge>
          {u.must_change_password && <StatusBadge tone="amber">Pwd change required</StatusBadge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: u => (
        <div className="action-row">
          <button type="button" className="btn-secondary btn-sm" onClick={() => openEditModal(u)}>
            Edit
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setResetTarget(u);
              setResetTempPwd(genPassword());
            }}
          >
            Reset Password
          </button>
          <button
            type="button"
            className={u.is_active === false ? 'btn-secondary btn-sm' : 'btn-danger btn-sm'}
            onClick={() => setToggleTarget(u)}
          >
            {u.is_active === false ? 'Activate' : 'Deactivate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Manage Unit Users</h1>
          <p className="page-subtitle">Create multiple Operators &amp; Supervisors per unit with force-change-on-first-login security</p>
        </div>
      </div>

      {/* Onboarding Checklist */}
      <div className="card form-card" style={{ background: '#f8fafc' }}>
        <h2 style={{ marginBottom: '0.6rem' }}>Zone Onboarding Checklist</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <StatusBadge tone={hasUnits ? 'green' : 'amber'}>
            {hasUnits ? '✓' : '1.'} Add Unit {!hasUnits && '(Go to Units)'}
          </StatusBadge>
          <StatusBadge tone={hasUsers ? 'green' : 'amber'}>
            {hasUsers ? '✓' : '2.'} Add Unit User
          </StatusBadge>
          <StatusBadge tone={hasAnyRecord ? 'green' : 'amber'}>
            {hasAnyRecord ? '✓' : '3.'} First Milk Entry
          </StatusBadge>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}

      {onboardingResult && (
        <div className="success-banner" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <strong>{onboardingResult.message}</strong>
          {onboardingResult.tempPassword && (
            <div style={{ fontSize: '0.84rem' }}>
              Temporary Password: <code>{onboardingResult.tempPassword}</code>
            </div>
          )}
          {onboardingResult.inviteLink && (
            <div style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
              One-click Setup / Recovery Link:{' '}
              <a href={onboardingResult.inviteLink} target="_blank" rel="noreferrer">
                {onboardingResult.inviteLink}
              </a>
            </div>
          )}
        </div>
      )}

      <div className="card form-card">
        <h2>Create Unit Staff Account</h2>
        <form onSubmit={handleCreate} className="entry-form">
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input
                ref={fullNameRef}
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Murugan K"
                required
              />
            </div>
            <div className="form-group">
              <label>Phone <span className="hint">(+91, 10 digits)</span></label>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. 9876543210"
              />
              {phone.trim() && !normalizedPhonePreview && (
                <span className="auth-error">Enter a valid 10-digit Indian mobile number</span>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="staff@aavin.gov.in"
                required
              />
              {!emailValid && <span className="auth-error">Invalid email format</span>}
            </div>
            <div className="form-group">
              <label>Assigned Unit <span className="hint">(multiple users allowed per unit)</span></label>
              <select value={unitId} onChange={e => setUnitId(e.target.value)} required>
                {units.length === 0 ? (
                  <option value="">No units yet — create a unit first</option>
                ) : (
                  units.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.unit_code})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Staff Role</label>
              <select value={subRole} onChange={e => setSubRole(e.target.value as 'operator' | 'supervisor')}>
                <option value="operator">Operator (Daily entry &amp; dispatch)</option>
                <option value="supervisor">Supervisor (Unit oversight &amp; review)</option>
              </select>
            </div>
            <div className="form-group">
              <label>
                Temporary Password{' '}
                <button type="button" onClick={() => setPassword(genPassword())} className="btn-link">
                  generate
                </button>
              </label>
              <input value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.82rem', fontWeight: 400 }}>
                <input type="checkbox" checked={forceChange} onChange={e => setForceChange(e.target.checked)} />
                Require user to set a new password on first login
              </label>
            </div>
          </div>

          <button type="submit" disabled={saving || units.length === 0} className="btn-primary">
            {saving ? 'Creating…' : 'Create Unit User'}
          </button>
        </form>
      </div>

      <div className="card table-card">
        <h2>Unit Staff Accounts</h2>
        {loadingList ? (
          <TableSkeleton rows={4} cols={6} />
        ) : (
          <DataTable
            rows={users}
            columns={columns}
            getRowKey={u => u.id}
            emptyMessage="No unit users yet"
            emptyActionLabel={units.length === 0 ? 'Add First Unit' : 'Create first user'}
            onEmptyAction={() => {
              if (units.length === 0) navigate('/admin/units');
              else fullNameRef.current?.focus();
            }}
          />
        )}
      </div>

      {/* Edit User Modal */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h3 className="modal-title">Edit User — {editTarget.full_name}</h3>
            <div className="entry-form" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label>Full Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Phone (+91)</label>
                <input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="9876543210" />
              </div>
              <div className="form-group">
                <label>Assigned Unit</label>
                <select value={editUnitId} onChange={e => setEditUnitId(e.target.value)}>
                  {units.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.unit_code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={editSubRole} onChange={e => setEditSubRole(e.target.value as 'operator' | 'supervisor')}>
                  <option value="operator">Operator</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary" style={{ width: 'auto' }} disabled={savingEdit} onClick={() => void handleSaveEdit()}>
                {savingEdit ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      <ConfirmDialog
        open={Boolean(resetTarget)}
        title={`Reset Password for ${resetTarget?.full_name ?? 'User'}?`}
        message={`A new temporary password (${resetTempPwd}) will be set and the user will be forced to choose a new password on their next login.`}
        confirmLabel="Reset Password"
        loading={resetting}
        onConfirm={() => void handleConfirmResetPassword()}
        onCancel={() => setResetTarget(null)}
      />

      {/* Deactivate / Activate User Modal */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active === false ? `Activate ${toggleTarget?.full_name}?` : `Deactivate ${toggleTarget?.full_name}?`}
        message={
          toggleTarget?.is_active === false
            ? `Allow ${toggleTarget?.full_name} to sign in again?`
            : `Deactivate ${toggleTarget?.full_name}? They will immediately be blocked from logging in, while all past milk records they entered remain preserved.`
        }
        confirmLabel={toggleTarget?.is_active === false ? 'Activate User' : 'Deactivate User'}
        danger={toggleTarget?.is_active !== false}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
}
