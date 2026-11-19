import { useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import { ErrorBanner, StatusBadge, ConfirmDialog, TableSkeleton } from '../../components/UiPrimitives';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { normalizeIndianPhone } from '../../lib/format';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
}

interface MergedUserRecord {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  unit_id: string | null;
  team_id: string | null;
  team: { id: string; code: 'GATE' | 'QC' | 'UNLOADING'; name: string } | null;
  units: { name: string; unit_code: string } | null;
  shift: 'Morning' | 'Evening' | 'General' | null;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  user_type?: 'plant' | 'unit' | 'admin';
}

const TEAM_COLOR_CONFIG: Record<string, { tone: 'indigo' | 'amber' | 'blue'; border: string; bg: string; dot: string }> = {
  GATE: { tone: 'indigo', border: '#818cf8', bg: '#f5f3ff', dot: '#4f46e5' },
  QC: { tone: 'amber', border: '#fbbf24', bg: '#fffbeb', dot: '#d97706' },
  UNLOADING: { tone: 'blue', border: '#60a5fa', bg: '#eff6ff', dot: '#2563eb' },
};

const DEFAULT_PASSWORD = 'Aavin123';

export default function AdminTeams() {
  const { lang } = useTranslation();

  // State: Users, BMC Units
  const [teamUsers, setTeamUsers] = useState<MergedUserRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Scope & Filters
  const [userScope, setUserScope] = useState<'all' | 'plant' | 'unit' | 'admin'>('all');
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterUnit, setFilterUnit] = useState<string>('');
  const [filterShift, setFilterShift] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Seeding test users
  const [seeding, setSeeding] = useState(false);

  // Add User Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addUserType, setAddUserType] = useState<'plant' | 'unit'>('plant');
  const [addTeam, setAddTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [addUnitId, setAddUnitId] = useState('');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addPassword, setAddPassword] = useState(DEFAULT_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [userCreatedAlert, setUserCreatedAlert] = useState<{
    name: string;
    username: string;
    email: string;
    teamOrUnit: string;
    password?: string;
  } | null>(null);

  // Edit User Modal State
  const [editTarget, setEditTarget] = useState<MergedUserRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editUserId, setEditUserId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editUnitId, setEditUnitId] = useState('');
  const [editShift, setEditShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Move Team Modal State
  const [moveTarget, setMoveTarget] = useState<MergedUserRecord | null>(null);
  const [newTeam, setNewTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [moveReason, setMoveReason] = useState('');
  const [movingTeam, setMovingTeam] = useState(false);
  const [moveError, setMoveError] = useState('');

  // Reset Password Modal State
  const [resetTarget, setResetTarget] = useState<MergedUserRecord | null>(null);
  const [resetTempPwd, setResetTempPwd] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Toggle User Active Status State
  const [toggleUserTarget, setToggleUserTarget] = useState<MergedUserRecord | null>(null);
  const [togglingUser, setTogglingUser] = useState(false);

  // Copy helper
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = (text: string, key = 'default') => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    });
  };

  const fetchUnits = async () => {
    try {
      const res = await api.get<Unit[]>('/units');
      setUnits(res.data || []);
      if (res.data && res.data.length > 0 && !addUnitId) {
        setAddUnitId(res.data[0].id);
      }
    } catch (err) {
      console.warn('Failed to load BMC units:', err);
    }
  };

  const fetchAllUsers = async () => {
    setLoadingUsers(true);
    try {
      // Fetch users from /users (which contains both unit staff and plant team operators)
      const res = await api.get<{ users: MergedUserRecord[] } | MergedUserRecord[]>('/users');
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.users || [];

      // If /users returned empty, fallback to /teams/users
      let list = rawList;
      if (list.length === 0) {
        const teamsUsersRes = await api.get<MergedUserRecord[]>('/teams/users');
        list = teamsUsersRes.data || [];
      }

      // Enrich user type
      const enriched: MergedUserRecord[] = list.map((u: any) => {
        const roleLower = (u.role || '').toLowerCase();
        let uType: 'plant' | 'unit' | 'admin' = 'unit';
        if (['gate', 'qc', 'unloading'].includes(roleLower) || u.team_id || u.team) {
          uType = 'plant';
        } else if (['admin', 'superadmin'].includes(roleLower)) {
          uType = 'admin';
        }
        return {
          ...u,
          user_type: uType,
          full_name: u.full_name || 'Staff User',
          is_active: u.is_active !== false,
        };
      });

      setTeamUsers(enriched);
    } catch (err: any) {
      console.warn('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    void fetchUnits();
    void fetchAllUsers();
  }, []);

  const openAddUserModal = (preselectedTeam?: 'GATE' | 'QC' | 'UNLOADING') => {
    setAddUserType(preselectedTeam ? 'plant' : 'plant');
    setAddTeam(preselectedTeam || 'GATE');
    setAddName('');
    setAddEmail('');
    setAddPhone('');
    setAddPassword(DEFAULT_PASSWORD);
    setShowPassword(false);
    setAddUserError('');
    if (units.length > 0) setAddUnitId(units[0].id);
    setShowAddModal(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddUserError('');
    if (!addName.trim()) {
      setAddUserError('Full name is required');
      return;
    }
    if (!addEmail.trim()) {
      setAddUserError('Email address is required');
      return;
    }
    if (!addPassword.trim() || addPassword.trim().length < 6) {
      setAddUserError('Password must be at least 6 characters');
      return;
    }
    if (addUserType === 'unit' && !addUnitId) {
      setAddUserError('Please select a BMC unit');
      return;
    }

    setSavingUser(true);
    try {
      if (addUserType === 'plant') {
        const payload = {
          full_name: addName.trim(),
          email: addEmail.trim().toLowerCase(),
          phone: addPhone.trim() || undefined,
          team: addTeam,
          shift: 'General',
          password: addPassword.trim(),
          force_password_change: true,
        };

        const res = await api.post('/teams/users', payload);
        const created = res.data;

        setUserCreatedAlert({
          name: created.full_name || addName,
          username: created.username || '',
          email: created.email || payload.email,
          teamOrUnit: `Team ${addTeam}`,
          password: created.temp_password || addPassword,
        });
      } else {
        // BMC Unit User
        const payload = {
          full_name: addName.trim(),
          email: addEmail.trim().toLowerCase(),
          phone: addPhone.trim() || undefined,
          unit_id: addUnitId,
          password: addPassword.trim(),
          force_password_change: true,
        };

        const res = await api.post('/users/create', payload);
        const created = res.data;
        const assignedUnit = units.find((u) => u.id === addUnitId);

        setUserCreatedAlert({
          name: created.full_name || addName,
          username: created.username || addEmail,
          email: created.email || addEmail,
          teamOrUnit: `BMC: ${assignedUnit?.name || 'Assigned BMC'}`,
          password: created.temp_password || addPassword,
        });
      }

      setShowAddModal(false);
      setSuccessMsg(
        lang === 'ta'
          ? `பயனர் ${addName} வெற்றிகரமாக உருவாக்கப்பட்டார்!`
          : `User ${addName} created successfully!`
      );

      await fetchAllUsers();
    } catch (err: any) {
      setAddUserError(err.response?.data?.error || err.message || 'Failed to create user');
    } finally {
      setSavingUser(false);
    }
  };

  const openEditModal = (u: MergedUserRecord) => {
    setEditTarget(u);
    setEditName(u.full_name || '');
    setEditUserId(u.username || '');
    setEditPhone(u.phone ? u.phone.replace('+91', '').trim() : '');
    setEditUnitId(u.unit_id || (units[0]?.id ?? ''));
    setEditShift(u.shift || 'General');
    setEditActive(u.is_active !== false);
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await api.patch(`/users/${editTarget.id}`, {
        full_name: editName.trim(),
        username: editUserId.trim().toUpperCase() || null,
        phone: editPhone.trim() || null,
        unit_id: editTarget.user_type === 'unit' ? editUnitId : undefined,
        shift: editTarget.user_type === 'plant' ? editShift : undefined,
        is_active: editActive,
      });

      setSuccessMsg(
        lang === 'ta'
          ? `பயனர் விவரங்கள் வெற்றிகரமாக புதுப்பிக்கப்பட்டன!`
          : `Details for ${editName} updated successfully!`
      );
      setEditTarget(null);
      await fetchAllUsers();
    } catch (err: any) {
      setEditError(err.response?.data?.error || err.message || 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const openMoveModal = (u: MergedUserRecord) => {
    setMoveTarget(u);
    const curr = (u.team?.code || u.role || 'GATE').toUpperCase() as 'GATE' | 'QC' | 'UNLOADING';
    const next = curr === 'GATE' ? 'QC' : curr === 'QC' ? 'UNLOADING' : 'GATE';
    setNewTeam(next);
    setMoveReason('');
    setMoveError('');
  };

  const handleConfirmMove = async () => {
    if (!moveTarget) return;
    if (!moveReason.trim()) {
      setMoveError('Reason is required for the audit log');
      return;
    }

    setMovingTeam(true);
    setMoveError('');
    try {
      await api.post(`/users/${moveTarget.id}/move-team`, {
        target_team: newTeam,
        reason: moveReason.trim(),
      });

      setSuccessMsg(
        lang === 'ta'
          ? `${moveTarget.full_name} வெற்றிகரமாக ${newTeam} குழுவிற்கு மாற்றப்பட்டார்!`
          : `Moved ${moveTarget.full_name} to ${newTeam} team successfully!`
      );
      setMoveTarget(null);
      await fetchAllUsers();
    } catch (err: any) {
      setMoveError(err.response?.data?.error || err.message || 'Failed to move user');
    } finally {
      setMovingTeam(false);
    }
  };


  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetting(true);
    setResetError('');
    try {
      const res = await api.post<{ temp_password?: string; temporaryPassword?: string }>(
        `/users/${resetTarget.id}/reset-password`
      );
      const tempPwd = res.data?.temp_password || res.data?.temporaryPassword || DEFAULT_PASSWORD;
      setResetTempPwd(tempPwd);
    } catch (err: any) {
      setResetError(err.response?.data?.error || err.message || 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleToggleUserStatus = async () => {
    if (!toggleUserTarget) return;
    setTogglingUser(true);
    try {
      const nextActive = !toggleUserTarget.is_active;
      await api.patch(`/users/${toggleUserTarget.id}`, { is_active: nextActive });
      setSuccessMsg(
        lang === 'ta'
          ? `பயனர் ${toggleUserTarget.full_name} ${nextActive ? 'செயல்படுத்தப்பட்டார்' : 'முடக்கப்பட்டார்'}!`
          : `User ${toggleUserTarget.full_name} ${nextActive ? 'activated' : 'deactivated'} successfully!`
      );
      setToggleUserTarget(null);
      await fetchAllUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update user status');
    } finally {
      setTogglingUser(false);
    }
  };

  const handleSeedUsers = async () => {
    setSeeding(true);
    try {
      await api.post('/teams/seed-users');
      setSuccessMsg(
        lang === 'ta'
          ? 'மாதிரி பயனர்கள் (gate_test, qc_test, unloading_test) வெற்றிகரமாக உருவாக்கப்பட்டனர்!'
          : 'Test operators (gate_test, qc_test, unloading_test) seeded successfully!'
      );
      await fetchAllUsers();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to seed test users');
    } finally {
      setSeeding(false);
    }
  };

  // User counts per scope
  const scopeCounts = useMemo(() => {
    return {
      all: teamUsers.length,
      plant: teamUsers.filter((u) => u.user_type === 'plant').length,
      unit: teamUsers.filter((u) => u.user_type === 'unit').length,
      admin: teamUsers.filter((u) => u.user_type === 'admin').length,
    };
  }, [teamUsers]);

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    let list = [...teamUsers];

    // Scope filter
    if (userScope !== 'all') {
      list = list.filter((u) => u.user_type === userScope);
    }

    // Team Filter
    if (filterTeam) {
      const t = filterTeam.toUpperCase();
      list = list.filter((u) => {
        const uTeam = (u.team?.code || u.role || '').toUpperCase();
        return uTeam === t;
      });
    }

    // BMC Unit Filter
    if (filterUnit) {
      list = list.filter((u) => u.unit_id === filterUnit);
    }

    // Shift Filter
    if (filterShift) {
      list = list.filter((u) => u.shift === filterShift);
    }

    // Status Filter
    if (filterStatus === 'active') {
      list = list.filter((u) => u.is_active);
    } else if (filterStatus === 'inactive') {
      list = list.filter((u) => !u.is_active);
    }

    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q) ||
          (u.units?.name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [teamUsers, userScope, filterTeam, filterUnit, filterShift, filterStatus, searchQuery]);

  // Data Table Columns
  const userColumns: DataColumn<MergedUserRecord>[] = [
    {
      key: 'username',
      header: 'Unique User ID',
      sortValue: (u) => u.username || '',
      render: (u) => (
        <code
          style={{
            fontWeight: 700,
            fontSize: '0.82rem',
            background: '#f1f5f9',
            color: '#1e293b',
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
          }}
        >
          {u.username || (u.units?.unit_code ? `BMC_${u.units.unit_code}` : '—')}
        </code>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortValue: (u) => u.full_name,
      render: (u) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.full_name}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</div>
        </div>
      ),
    },
    {
      key: 'team_or_unit',
      header: 'Role & Team / BMC',
      sortValue: (u) => u.team?.name || u.units?.name || u.role,
      render: (u) => {
        if (u.user_type === 'plant') {
          const tCode = (u.team?.code || u.role).toUpperCase();
          const cfg = TEAM_COLOR_CONFIG[tCode] || { tone: 'indigo', border: '#cbd5e1', bg: '#f8fafc', dot: '#475569' };
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: '0.76rem',
                fontWeight: 700,
                background: cfg.bg,
                border: `1px solid ${cfg.border}`,
                color: cfg.dot,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot }} />
              {tCode} TEAM
            </span>
          );
        }
        if (u.user_type === 'unit') {
          return (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: '0.76rem',
                fontWeight: 600,
                background: '#f0fdf4',
                border: '1px solid #86efac',
                color: '#166534',
              }}
            >
              🏢 {u.units?.name ? `BMC: ${u.units.name}` : 'BMC Staff'}
            </span>
          );
        }
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: 6,
              fontSize: '0.76rem',
              fontWeight: 700,
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#334155',
            }}
          >
            🛡️ Admin
          </span>
        );
      },
    },
    {
      key: 'shift',
      header: 'Shift',
      sortValue: (u) => u.shift || '',
      render: (u) =>
        u.user_type === 'plant' && u.shift ? (
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
            {u.shift === 'Morning' ? '🌅 Morning' : u.shift === 'Evening' ? '🌇 Evening' : '🕒 General'}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
    {
      key: 'phone',
      header: 'Mobile Phone',
      sortValue: (u) => u.phone || '',
      render: (u) => <span>{normalizeIndianPhone(u.phone || '') || u.phone || '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortValue: (u) => (u.is_active ? 1 : 0),
      render: (u) => (
        <StatusBadge tone={u.is_active ? 'green' : 'grey'}>
          {u.is_active ? 'Active' : 'Inactive'}
        </StatusBadge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      render: (u) => (
        <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
          {/* Edit */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => openEditModal(u)}
            title="Edit user details"
            style={{ width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}
          >
            ✏️
          </button>

          {/* Move Team (plant operators only) */}
          {u.user_type === 'plant' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openMoveModal(u)}
              title="Move to another plant team"
              style={{ width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}
            >
              ⇄
            </button>
          )}

          {/* Reset Password */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setResetTarget(u);
              setResetTempPwd('');
              setResetError('');
            }}
            title="Reset Password"
            style={{ width: '30px', height: '30px', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}
          >
            🔑
          </button>

          {/* Toggle Active Status */}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setToggleUserTarget(u)}
            title={u.is_active ? 'Deactivate user' : 'Activate user'}
            style={{
              width: '30px',
              height: '30px',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.85rem',
              color: u.is_active ? '#dc2626' : '#16a34a',
            }}
          >
            {u.is_active ? '⏻' : '✓'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {/* 1. PAGE HEADER WITH TOP "ADD USER" BUTTON */}
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
            {lang === 'ta' ? 'குழுக்கள் & பயனர்கள்' : 'Teams & Users'}
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
            {lang === 'ta'
              ? 'தொழிற்சாலை குழுக்கள் (Gate, QC, Unloading) மற்றும் பி.எம்.சி பணியாளர்களின் ஒருங்கிணைந்த மேலாண்மை'
              : 'Unified management of plant operational teams (Gate, QC, Unloading), plant operators, and BMC staff'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Prominent "Add User" button */}
          <button
            type="button"
            onClick={() => openAddUserModal()}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontWeight: 700,
              padding: '0 1.15rem',
              height: '38px',
              fontSize: '0.9rem',
              background: '#2563eb',
              boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
              width: 'auto',
            }}
          >
            ➕ {lang === 'ta' ? 'பயனர் சேர் (Add User)' : 'Add User'}
          </button>

          <button
            type="button"
            onClick={() => {
              void fetchUnits();
              void fetchAllUsers();
            }}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', height: '38px', padding: '0 0.85rem', width: 'auto' }}
          >
            🔄 {lang === 'ta' ? 'புதுப்பி' : 'Refresh'}
          </button>

          <button
            type="button"
            onClick={handleSeedUsers}
            disabled={seeding}
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: '#ecfdf5',
              borderColor: '#a7f3d0',
              color: '#065f46',
              height: '38px',
              padding: '0 0.85rem',
              width: 'auto',
            }}
          >
            🌱 {seeding ? (lang === 'ta' ? 'உருவாக்குகிறது...' : 'Seeding...') : (lang === 'ta' ? 'மாதிரி பயனர்கள்' : 'Seed Test Users')}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAllUsers} />}

      {/* User Created Credentials Notice Banner */}
      {userCreatedAlert && (
        <div
          className="card"
          style={{
            marginBottom: '1.25rem',
            padding: '1rem 1.25rem',
            background: '#ecfdf5',
            border: '1px solid #10b981',
            borderRadius: 8,
            color: '#065f46',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
                <span>✅</span>
                <span>User Created Successfully!</span>
              </div>
              <div style={{ marginTop: '0.4rem', fontSize: '0.85rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
                <div>Name: <strong>{userCreatedAlert.name}</strong></div>
                <div>User ID: <code style={{ background: '#d1fae5', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{userCreatedAlert.username}</code></div>
                <div>Assignment: <strong>{userCreatedAlert.teamOrUnit}</strong></div>
                <div>Email: <strong>{userCreatedAlert.email}</strong></div>
                {userCreatedAlert.password && (
                  <div>Temp Password: <code style={{ background: '#d1fae5', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{userCreatedAlert.password}</code></div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUserCreatedAlert(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065f46', fontSize: '1.1rem' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {successMsg && !userCreatedAlert && (
        <div
          className="success-banner"
          style={{
            marginBottom: '1.25rem',
            padding: '0.85rem 1.25rem',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 8,
            color: '#166534',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}
          >
            ✕
          </button>
        </div>
      )}


      {/* 3. SHOW ENTIRE USER DIRECTORY & INTERNAL TEAM USERS MANAGEMENT */}
      <div id="team-users-section" className="card" style={{ padding: '1.5rem', background: '#ffffff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {lang === 'ta' ? 'உள் குழு பயனர்கள் மேலாண்மை' : 'Internal Team Users Management'} ({filteredUsers.length})
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              {lang === 'ta'
                ? 'அனைத்து குழுக்களின் பதிவு செய்யப்பட்ட பயனர்கள், தனித்துவ அடையாள எண் (AV_IT_001) மற்றும் பி.எம்.சி பணியாளர்கள்'
                : 'All registered operators across Gate, QC, Unloading teams, and BMC collection staff'}
            </p>
          </div>

          {/* Scope Segmented Tabs */}
          <div style={{ display: 'flex', gap: '0.35rem', background: '#f1f5f9', padding: '3px', borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => {
                setUserScope('all');
                setFilterTeam('');
                setFilterUnit('');
              }}
              style={{
                border: 'none',
                background: userScope === 'all' ? '#ffffff' : 'transparent',
                fontWeight: userScope === 'all' ? 700 : 500,
                color: userScope === 'all' ? '#0f172a' : '#64748b',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: userScope === 'all' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              All Users ({scopeCounts.all})
            </button>
            <button
              type="button"
              onClick={() => setUserScope('plant')}
              style={{
                border: 'none',
                background: userScope === 'plant' ? '#ffffff' : 'transparent',
                fontWeight: userScope === 'plant' ? 700 : 500,
                color: userScope === 'plant' ? '#0f172a' : '#64748b',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: userScope === 'plant' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              Plant Teams ({scopeCounts.plant})
            </button>
            <button
              type="button"
              onClick={() => setUserScope('unit')}
              style={{
                border: 'none',
                background: userScope === 'unit' ? '#ffffff' : 'transparent',
                fontWeight: userScope === 'unit' ? 700 : 500,
                color: userScope === 'unit' ? '#0f172a' : '#64748b',
                padding: '0.35rem 0.75rem',
                borderRadius: 6,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: userScope === 'unit' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              BMC Staff ({scopeCounts.unit})
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.65rem',
            alignItems: 'center',
            marginBottom: '1rem',
            padding: '0.75rem',
            background: '#f8fafc',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          {/* Search */}
          <div style={{ flex: '1 1 200px' }}>
            <input
              type="search"
              placeholder="Search by name, ID (e.g. AV_IT_001), phone, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            />
          </div>

          {/* Team Filter */}
          <select
            value={filterTeam}
            onChange={(e) => setFilterTeam(e.target.value)}
            style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
          >
            <option value="">All Teams (GATE, QC, UNLOAD)</option>
            <option value="GATE">Gate Operations (GATE)</option>
            <option value="QC">Quality Control (QC)</option>
            <option value="UNLOADING">Milk Unloading (UNLOAD)</option>
          </select>

          {/* BMC Unit Filter */}
          {units.length > 0 && (
            <select
              value={filterUnit}
              onChange={(e) => setFilterUnit(e.target.value)}
              style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            >
              <option value="">All BMCs</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  BMC: {u.name} ({u.unit_code})
                </option>
              ))}
            </select>
          )}

          {/* Shift Filter */}
          <select
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
            style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
          >
            <option value="">All Shifts</option>
            <option value="Morning">Morning</option>
            <option value="Evening">Evening</option>
            <option value="General">General</option>
          </select>

          {/* Status Filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
          >
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          {(filterTeam || filterUnit || filterShift || filterStatus !== 'all' || searchQuery || userScope !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setUserScope('all');
                setFilterTeam('');
                setFilterUnit('');
                setFilterShift('');
                setFilterStatus('all');
                setSearchQuery('');
              }}
              className="btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.45rem 0.65rem' }}
            >
              ✕ Clear Filters
            </button>
          )}
        </div>

        {/* User Table */}
        {loadingUsers ? (
          <TableSkeleton rows={4} cols={7} />
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#64748b' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>👥</div>
            <div style={{ fontWeight: 600, color: '#1e293b' }}>
              No users found matching current filters.
            </div>
            <button
              type="button"
              onClick={() => openAddUserModal((filterTeam as any) || 'GATE')}
              className="btn-primary"
              style={{ marginTop: '0.75rem', fontSize: '0.84rem', padding: '0.45rem 0.95rem' }}
            >
              + Create User
            </button>
          </div>
        ) : (
          <DataTable
            rows={filteredUsers}
            columns={userColumns}
            getRowKey={(u) => u.id}
            searchable={false}
            pageSize={15}
          />
        )}
      </div>

      {/* 4. ADD USER MODAL */}
      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                {lang === 'ta' ? 'புதிய பயனர் சேர்' : 'Add New User'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1.25rem' }}
              >
                ✕
              </button>
            </div>

            {/* Type Tabs */}
            <div style={{ display: 'flex', gap: 0, background: '#f1f5f9', borderRadius: 8, padding: 3, marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => setAddUserType('plant')}
                style={{
                  flex: 1,
                  border: 'none',
                  background: addUserType === 'plant' ? '#ffffff' : 'transparent',
                  fontWeight: addUserType === 'plant' ? 700 : 500,
                  color: addUserType === 'plant' ? '#0f172a' : '#64748b',
                  padding: '0.4rem 0',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: addUserType === 'plant' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                🏭 Plant Team (Gate / QC / Unloading)
              </button>
              <button
                type="button"
                onClick={() => setAddUserType('unit')}
                style={{
                  flex: 1,
                  border: 'none',
                  background: addUserType === 'unit' ? '#ffffff' : 'transparent',
                  fontWeight: addUserType === 'unit' ? 700 : 500,
                  color: addUserType === 'unit' ? '#0f172a' : '#64748b',
                  padding: '0.4rem 0',
                  borderRadius: 6,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: addUserType === 'unit' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                🏢 BMC Unit Staff
              </button>
            </div>

            {addUserError && <ErrorBanner message={addUserError} />}

            <form onSubmit={handleCreateUser} className="entry-form">
              {/* Full Name */}
              <div className="form-group">
                <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'முழு பெயர்' : 'Full Name'} *</label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Raman K"
                  required
                />
              </div>

              {/* Email */}
              <div className="form-group">
                <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'மின்னஞ்சல்' : 'Email Address'} *</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder={addUserType === 'plant' ? 'e.g. raman@aavin.internal' : 'e.g. kumar@bmc.aavin.in'}
                  required
                />
              </div>

              {/* Phone */}
              <div className="form-group">
                <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'அலைபேசி எண்' : 'Mobile Number (+91)'}</label>
                <input
                  type="tel"
                  value={addPhone}
                  onChange={(e) => setAddPhone(e.target.value)}
                  placeholder="9876543210"
                  maxLength={10}
                />
              </div>

              {/* Team (plant) OR BMC Unit (unit) */}
              {addUserType === 'plant' ? (
                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'குழு' : 'Team'} *</label>
                  <select
                    value={addTeam}
                    onChange={(e) => setAddTeam(e.target.value as any)}
                    required
                    style={{ fontWeight: 600 }}
                  >
                    <option value="GATE">GATE — Vehicle Entry &amp; Weighbridge</option>
                    <option value="QC">QC — Quality Testing &amp; CIP</option>
                    <option value="UNLOADING">UNLOADING — Silo &amp; Milk Reception</option>
                  </select>
                </div>
              ) : (
                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'பி.எம்.சி அலகு' : 'BMC Unit'} *</label>
                  {units.length === 0 ? (
                    <p style={{ fontSize: '0.84rem', color: '#94a3b8', margin: 0 }}>No BMC units found. Add units first.</p>
                  ) : (
                    <select
                      value={addUnitId}
                      onChange={(e) => setAddUnitId(e.target.value)}
                      required
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.unit_code})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Password */}
              <div className="form-group">
                <label style={{ fontWeight: 600 }}>{lang === 'ta' ? 'கடவுச்சொல்' : 'Password'} *</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    required
                    minLength={6}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="btn-secondary"
                    style={{ padding: '0 0.85rem', fontSize: '0.82rem', whiteSpace: 'nowrap' }}
                  >
                    {showPassword ? '🙈 Hide' : '👁️ Show'}
                  </button>
                </div>
                <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  Default: <code>Aavin123</code> — user can change after first login.
                </span>
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingUser} style={{ minWidth: 130 }}>
                  {savingUser ? 'Creating…' : `Create ${addUserType === 'plant' ? 'Operator' : 'BMC User'}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. EDIT USER MODAL */}
      {editTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              Edit User — {editTarget.full_name}
            </h3>

            {editError && <ErrorBanner message={editError} />}

            <div className="entry-form">
              <div className="form-group">
                <label>Full Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label>Unique User ID / Username</label>
                <input
                  value={editUserId}
                  onChange={(e) => setEditUserId(e.target.value.toUpperCase())}
                  placeholder="e.g. AV_IT_001"
                />
              </div>

              {editTarget.user_type === 'unit' && units.length > 0 && (
                <div className="form-group">
                  <label>Assign to BMC</label>
                  <select value={editUnitId} onChange={(e) => setEditUnitId(e.target.value)}>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.unit_code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Number</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="9876543210" />
                </div>
                {editTarget.user_type === 'plant' && (
                  <div className="form-group">
                    <label>Shift</label>
                    <select value={editShift} onChange={(e) => setEditShift(e.target.value as any)}>
                      <option value="Morning">Morning</option>
                      <option value="Evening">Evening</option>
                      <option value="General">General</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Account Status</label>
                <select value={editActive ? 'active' : 'inactive'} onChange={(e) => setEditActive(e.target.value === 'active')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingEdit || !editName.trim()}
                  onClick={() => void handleSaveEdit()}
                >
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. MOVE TEAM MODAL */}
      {moveTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              Move {moveTarget.full_name} to Another Team
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.84rem', color: '#64748b' }}>
              Current Team: <strong>{(moveTarget.team?.code || moveTarget.role).toUpperCase()}</strong>
            </p>

            {moveError && <ErrorBanner message={moveError} />}

            <div className="entry-form">
              <div className="form-group">
                <label>Select New Team</label>
                <select value={newTeam} onChange={(e) => setNewTeam(e.target.value as any)}>
                  <option value="GATE">GATE — Vehicle Entry & Weighbridge</option>
                  <option value="QC">QC — Quality Testing & CIP</option>
                  <option value="UNLOADING">UNLOAD — Silo & Milk Reception</option>
                </select>
              </div>

              <div className="form-group">
                <label>Reason for Moving (Required for Audit Log) *</label>
                <textarea
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="e.g. Shift reallocation or skill coverage"
                  rows={3}
                  required
                />
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setMoveTarget(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={movingTeam || !moveReason.trim()}
                  onClick={() => void handleConfirmMove()}
                >
                  {movingTeam ? 'Moving…' : 'Confirm Move'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. RESET PASSWORD MODAL */}
      {resetTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 460 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              Reset Password — {resetTarget.full_name}
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 1rem 0' }}>
              Generate a temporary password for this user. They will be forced to change it on their next login.
            </p>

            {resetError && <ErrorBanner message={resetError} />}

            {resetTempPwd ? (
              <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1rem', borderRadius: 8, marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#065f46', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Temporary Password Generated:
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <code style={{ fontSize: '1.1rem', fontWeight: 700, color: '#047857', flex: 1, background: '#ffffff', padding: '0.4rem 0.65rem', borderRadius: 6, border: '1px solid #6ee7b7' }}>
                    {resetTempPwd}
                  </code>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => copyToClipboard(resetTempPwd, 'reset')}
                  >
                    {copiedKey === 'reset' ? 'Copied! ✓' : '📋 Copy'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setResetTarget(null);
                  setResetTempPwd('');
                }}
              >
                {resetTempPwd ? 'Done' : 'Cancel'}
              </button>
              {!resetTempPwd && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={resetting}
                  onClick={() => void handleResetPassword()}
                >
                  {resetting ? 'Resetting…' : 'Generate New Password'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 8. DEACTIVATE USER CONFIRMATION MODAL */}
      <ConfirmDialog
        open={Boolean(toggleUserTarget)}
        title={toggleUserTarget?.is_active ? `Deactivate ${toggleUserTarget?.full_name}?` : `Activate ${toggleUserTarget?.full_name}?`}
        message={
          toggleUserTarget?.is_active
            ? `Are you sure you want to deactivate ${toggleUserTarget?.full_name}? They will not be able to log in until reactivated.`
            : `Re-activate ${toggleUserTarget?.full_name}'s account so they can log in?`
        }
        confirmLabel={toggleUserTarget?.is_active ? 'Deactivate' : 'Activate'}
        danger={toggleUserTarget?.is_active}
        loading={togglingUser}
        onConfirm={() => void handleToggleUserStatus()}
        onCancel={() => setToggleUserTarget(null)}
      />


    </div>
  );
}
