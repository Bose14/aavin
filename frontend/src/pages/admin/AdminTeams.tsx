import { useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import { ErrorBanner, StatusBadge, ConfirmDialog, TableSkeleton } from '../../components/UiPrimitives';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';

interface TeamItem {
  id: string;
  code: 'GATE' | 'QC' | 'UNLOADING';
  name: string;
  active: boolean;
  owned_stages: string[];
  description: string;
  active_user_count: number;
  waiting_tankers_count: number;
}

interface TeamUserRecord {
  id: string;
  full_name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: 'gate' | 'qc' | 'unloading' | string;
  team_id: string | null;
  team: { id: string; code: 'GATE' | 'QC' | 'UNLOADING'; name: string } | null;
  shift: 'Morning' | 'Evening' | 'General';
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

const STAGE_LABELS_EN: Record<string, string> = {
  vehicle_entered: '1. Vehicle Entered',
  gross_weight: '2. Gross Weight',
  qc_completed: '3. QC Completed',
  unloaded: '4. Unloaded',
  tare_weight: '5. Tare Weight',
  cip_completed: '6. CIP Completed',
  vehicle_exit: '7. Vehicle Exit',
};

const STAGE_LABELS_TA: Record<string, string> = {
  vehicle_entered: '1. வாகனம் நுழைவு',
  gross_weight: '2. மொத்த எடை (Gross)',
  qc_completed: '3. QC பரிசோதனை',
  unloaded: '4. பால் இறக்குதல்',
  tare_weight: '5. காலி எடை (Tare)',
  cip_completed: '6. CIP தூய்மைப்படுத்துதல்',
  vehicle_exit: '7. வாகனம் வெளியேறுதல்',
};

const TEAM_COLOR_CONFIG: Record<string, { tone: 'indigo' | 'amber' | 'blue'; border: string; bg: string; dot: string }> = {
  GATE: { tone: 'indigo', border: '#818cf8', bg: '#f5f3ff', dot: '#4f46e5' },
  QC: { tone: 'amber', border: '#fbbf24', bg: '#fffbeb', dot: '#d97706' },
  UNLOADING: { tone: 'blue', border: '#60a5fa', bg: '#eff6ff', dot: '#2563eb' },
};

function generateRandomPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  let p = '';
  p += upper[Math.floor(Math.random() * upper.length)];
  p += lower[Math.floor(Math.random() * lower.length)];
  p += digits[Math.floor(Math.random() * digits.length)];
  p += special[Math.floor(Math.random() * special.length)];
  const all = upper + lower + digits + special;
  for (let i = 0; i < 6; i++) {
    p += all[Math.floor(Math.random() * all.length)];
  }
  return p;
}

export default function AdminTeams() {
  const { lang } = useTranslation();

  // Teams & User list state
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [teamUsers, setTeamUsers] = useState<TeamUserRecord[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Team List Filters
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterShift, setFilterShift] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Team Deactivate confirmation modal
  const [targetTeam, setTargetTeam] = useState<TeamItem | null>(null);
  const [toggling, setToggling] = useState(false);
  const [blockedWarning, setBlockedWarning] = useState<string | null>(null);

  // Seeding test users
  const [seeding, setSeeding] = useState(false);

  // Add User Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTeam, setAddTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [addUserId, setAddUserId] = useState('AV_GT_001');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addShift, setAddShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [addPassword, setAddPassword] = useState(() => generateRandomPassword());
  const [showPassword, setShowPassword] = useState(false);
  const [addForceChange, setAddForceChange] = useState(true);
  const [savingUser, setSavingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');
  const [userCreatedAlert, setUserCreatedAlert] = useState<{
    name: string;
    username: string;
    email: string;
    team: string;
    password?: string;
  } | null>(null);

  // Edit User Modal State
  const [editTarget, setEditTarget] = useState<TeamUserRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editUserId, setEditUserId] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editShift, setEditShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [editActive, setEditActive] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Move Team Modal State
  const [moveTarget, setMoveTarget] = useState<TeamUserRecord | null>(null);
  const [newTeam, setNewTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [moveReason, setMoveReason] = useState('');
  const [movingTeam, setMovingTeam] = useState(false);
  const [moveError, setMoveError] = useState('');

  const fetchTeams = async () => {
    setLoadingTeams(true);
    setError('');
    try {
      const res = await api.get<TeamItem[]>('/teams');
      setTeams(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load plant teams');
    } finally {
      setLoadingTeams(false);
    }
  };

  const fetchTeamUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await api.get<TeamUserRecord[]>('/teams/users');
      setTeamUsers(res.data);
    } catch (err: any) {
      console.warn('Failed to load team users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchNextUserId = async (teamCode: 'GATE' | 'QC' | 'UNLOADING') => {
    try {
      const res = await api.get<{ next_user_id: string }>(`/teams/next-user-id?team=${teamCode}`);
      if (res.data?.next_user_id) {
        setAddUserId(res.data.next_user_id);
      }
    } catch {
      const pfx = teamCode === 'GATE' ? 'GT' : teamCode === 'QC' ? 'QC' : 'UL';
      setAddUserId(`AV_${pfx}_001`);
    }
  };

  useEffect(() => {
    void fetchTeams();
    void fetchTeamUsers();
  }, []);

  const openAddUserModal = (preselectedTeam?: 'GATE' | 'QC' | 'UNLOADING') => {
    const target = preselectedTeam || 'GATE';
    setAddTeam(target);
    setAddName('');
    setAddEmail('');
    setAddPhone('');
    setAddShift('General');
    setAddPassword(generateRandomPassword());
    setShowPassword(false);
    setAddForceChange(true);
    setAddUserError('');
    setShowAddModal(true);
    void fetchNextUserId(target);
  };

  const handleTeamChangeInModal = (t: 'GATE' | 'QC' | 'UNLOADING') => {
    setAddTeam(t);
    void fetchNextUserId(t);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddUserError('');
    if (!addName.trim()) {
      setAddUserError('Operator full name is required');
      return;
    }
    if (!addEmail.trim()) {
      setAddUserError('Email address is required');
      return;
    }

    setSavingUser(true);
    try {
      const payload = {
        full_name: addName.trim(),
        username: addUserId.trim().toUpperCase() || undefined,
        email: addEmail.trim().toLowerCase(),
        phone: addPhone.trim() || undefined,
        team: addTeam,
        user_type: 'plant',
        shift: addShift,
        password: addPassword.trim(),
        force_password_change: addForceChange,
      };

      const res = await api.post('/teams/users', payload);
      const created = res.data;

      setUserCreatedAlert({
        name: created.full_name || addName,
        username: created.username || addUserId,
        email: created.email || addEmail,
        team: addTeam,
        password: created.temp_password || addPassword,
      });

      setShowAddModal(false);
      setSuccessMsg(
        lang === 'ta'
          ? `பயனர் ${created.full_name} (${created.username}) வெற்றிகரமாக உருவாக்கப்பட்டார்!`
          : `Team operator ${created.full_name} (${created.username}) created successfully!`
      );

      await Promise.all([fetchTeams(), fetchTeamUsers()]);
    } catch (err: any) {
      setAddUserError(err.response?.data?.error || err.message || 'Failed to create team operator');
    } finally {
      setSavingUser(false);
    }
  };

  const openEditModal = (u: TeamUserRecord) => {
    setEditTarget(u);
    setEditName(u.full_name || '');
    setEditUserId(u.username || '');
    setEditPhone(u.phone ? u.phone.replace('+91', '').trim() : '');
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
        shift: editShift,
        is_active: editActive,
      });

      setSuccessMsg(
        lang === 'ta'
          ? `பயனர் விவரங்கள் வெற்றிகரமாக புதுப்பிக்கப்பட்டன!`
          : `Operator details for ${editName} updated successfully!`
      );
      setEditTarget(null);
      await Promise.all([fetchTeams(), fetchTeamUsers()]);
    } catch (err: any) {
      setEditError(err.response?.data?.error || err.message || 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const openMoveModal = (u: TeamUserRecord) => {
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
      setMoveError('A reason for moving team is mandatory');
      return;
    }
    setMovingTeam(true);
    setMoveError('');
    try {
      await api.post(`/users/${moveTarget.id}/move-team`, {
        new_team: newTeam,
        reason: moveReason.trim(),
      });

      setSuccessMsg(
        lang === 'ta'
          ? `${moveTarget.full_name} வெற்றிகரமாக ${newTeam} குழுவிற்கு மாற்றப்பட்டார்!`
          : `${moveTarget.full_name} moved to ${newTeam} team successfully!`
      );
      setMoveTarget(null);
      await Promise.all([fetchTeams(), fetchTeamUsers()]);
    } catch (err: any) {
      setMoveError(err.response?.data?.error || err.message || 'Failed to move user');
    } finally {
      setMovingTeam(false);
    }
  };

  const handleToggleClick = (team: TeamItem) => {
    if (team.active && team.waiting_tankers_count > 0) {
      setBlockedWarning(
        lang === 'ta'
          ? `மன்னிக்கவும்! ${team.name} குழுவை முடக்க முடியாது. தற்போது ${team.waiting_tankers_count} டேங்கர்கள் இந்தக் குழுவின் பணிக்காக காத்திருக்கின்றன. அவற்றை முடித்த பின்னரே முடக்க முடியும்.`
          : `Cannot deactivate ${team.name}: ${team.waiting_tankers_count} tanker(s) are currently waiting on this team. Complete or reassign waiting tankers before deactivating the team.`
      );
      return;
    }
    setTargetTeam(team);
  };

  const handleConfirmToggle = async () => {
    if (!targetTeam) return;
    setToggling(true);
    setError('');
    setSuccessMsg('');
    try {
      const nextActive = !targetTeam.active;
      await api.patch(`/teams/${targetTeam.code}/status`, { active: nextActive });
      setSuccessMsg(
        lang === 'ta'
          ? `${targetTeam.name} வெற்றிகரமாக ${nextActive ? 'செயல்படுத்தப்பட்டது' : 'முடக்கப்பட்டது'}`
          : `${targetTeam.name} has been successfully ${nextActive ? 'activated' : 'deactivated'}`
      );
      setTargetTeam(null);
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update team status');
      setTargetTeam(null);
    } finally {
      setToggling(false);
    }
  };

  const handleSeedUsers = async () => {
    setSeeding(true);
    setError('');
    setSuccessMsg('');
    try {
      await api.post('/teams/seed-users');
      setSuccessMsg(
        lang === 'ta'
          ? 'மாதிரி பயனர்கள் (gate_test, qc_test, unloading_test) வெற்றிகரமாக உருவாக்கப்பட்டனர்!'
          : 'Test operators (gate_test, qc_test, unloading_test) created successfully with default password!'
      );
      await Promise.all([fetchTeams(), fetchTeamUsers()]);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to seed test users');
    } finally {
      setSeeding(false);
    }
  };

  // Filtered Team Users
  const filteredUsers = useMemo(() => {
    let list = [...teamUsers];
    if (filterTeam) {
      const t = filterTeam.toUpperCase();
      list = list.filter((u) => u.team?.code === t || u.role.toUpperCase() === t);
    }
    if (filterShift) {
      list = list.filter((u) => u.shift === filterShift);
    }
    if (filterStatus === 'active') {
      list = list.filter((u) => u.is_active);
    } else if (filterStatus === 'inactive') {
      list = list.filter((u) => !u.is_active);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          (u.username || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.phone || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [teamUsers, filterTeam, filterShift, filterStatus, searchQuery]);

  // Data Table Columns for Team Users
  const userColumns: DataColumn<TeamUserRecord>[] = [
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
          {u.username || '—'}
        </code>
      ),
    },
    {
      key: 'name',
      header: 'Operator Name',
      sortValue: (u) => u.full_name,
      render: (u) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.full_name}</div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</div>
        </div>
      ),
    },
    {
      key: 'team',
      header: 'Team',
      sortValue: (u) => u.team?.name || u.role,
      render: (u) => {
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
            {tCode}
          </span>
        );
      },
    },
    {
      key: 'shift',
      header: 'Shift',
      sortValue: (u) => u.shift,
      render: (u) => (
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
          {u.shift === 'Morning' ? '🌅 Morning' : u.shift === 'Evening' ? '🌇 Evening' : '🕒 General'}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'Mobile Phone',
      sortValue: (u) => u.phone || '',
      render: (u) => <span>{u.phone || '—'}</span>,
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
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(u);
            }}
            className="btn-secondary btn-sm"
            style={{ padding: '3px 8px', fontSize: '0.78rem' }}
            title="Edit operator details"
          >
            ✏️ Edit
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openMoveModal(u);
            }}
            className="btn-secondary btn-sm"
            style={{ padding: '3px 8px', fontSize: '0.78rem' }}
            title="Move operator to another plant team"
          >
            🔄 Move
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      {/* 1. TOP PAGE HEADER WITH "ADD USER" BUTTON */}
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
            {lang === 'ta' ? 'தொழிற்சாலை குழுக்கள் மேலாண்மை' : 'Plant Teams Management'}
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
            {lang === 'ta'
              ? 'நுழைவாயில் (GATE), தரக்கட்டுப்பாடு (QC) மற்றும் இறக்குதல் (UNLOADING) குழுக்களின் செயல்பாடுகள் மற்றும் பயனர்கள்'
              : 'Configure plant teams, monitor stage ownership, active staff counts, and tankers waiting per team'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Prominent "Add user" button */}
          <button
            type="button"
            onClick={() => openAddUserModal()}
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              fontWeight: 700,
              padding: '0.55rem 1.15rem',
              fontSize: '0.9rem',
              background: '#2563eb',
              boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
            }}
          >
            ➕ {lang === 'ta' ? 'பயனர் சேர் (Add User)' : 'Add User'}
          </button>

          <button
            type="button"
            onClick={() => {
              void fetchTeams();
              void fetchTeamUsers();
            }}
            className="btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
          >
            🔄 {lang === 'ta' ? 'புதுப்பி' : 'Refresh'}
          </button>

          <button
            type="button"
            onClick={handleSeedUsers}
            disabled={seeding}
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: '#ecfdf5',
              borderColor: '#a7f3d0',
              color: '#065f46',
            }}
          >
            🌱 {seeding ? (lang === 'ta' ? 'உருவாக்குகிறது...' : 'Seeding...') : (lang === 'ta' ? 'மாதிரி பயனர்கள்' : 'Seed Test Users')}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTeams} />}

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
                <div>Unique User ID: <code style={{ background: '#d1fae5', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{userCreatedAlert.username}</code></div>
                <div>Team: <strong>{userCreatedAlert.team}</strong></div>
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

      {/* 2. TEAMS SUMMARY CARDS */}
      {loadingTeams ? (
        <div style={{ textAlign: 'center', padding: '2.5rem', color: '#64748b' }}>
          {lang === 'ta' ? 'குழுக்கள் ஏற்றப்படுகின்றன...' : 'Loading plant teams...'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.25rem',
            marginBottom: '2rem',
          }}
        >
          {teams.map((team) => {
            const cfg = TEAM_COLOR_CONFIG[team.code] || { tone: 'indigo', border: '#cbd5e1', bg: '#f8fafc', dot: '#475569' };
            const stageLabels = lang === 'ta' ? STAGE_LABELS_TA : STAGE_LABELS_EN;

            return (
              <div
                key={team.id || team.code}
                className="card"
                style={{
                  background: '#ffffff',
                  border: `1px solid ${team.active ? cfg.border : '#e2e8f0'}`,
                  borderTop: `4px solid ${team.active ? cfg.dot : '#94a3b8'}`,
                  borderRadius: 10,
                  padding: '1.25rem',
                  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.07)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: team.active ? cfg.dot : '#94a3b8',
                            display: 'inline-block',
                          }}
                        />
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: cfg.dot }}>
                          {team.code} TEAM
                        </span>
                      </div>
                      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                        {team.name}
                      </h2>
                    </div>

                    <StatusBadge tone={team.active ? 'green' : 'grey'}>
                      {team.active ? (lang === 'ta' ? 'செயலில்' : 'Active') : (lang === 'ta' ? 'முடக்கப்பட்டது' : 'Inactive')}
                    </StatusBadge>
                  </div>

                  {/* Metrics */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.65rem',
                      margin: '0.85rem 0',
                      padding: '0.65rem',
                      background: '#f8fafc',
                      borderRadius: 8,
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                        {lang === 'ta' ? 'செயலில் உள்ள பயனர்கள்' : 'Active Operators'}
                      </div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>
                        {team.active_user_count}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                        {lang === 'ta' ? 'காத்திருக்கும் டேங்கர்கள்' : 'Tankers Waiting'}
                      </div>
                      <div
                        style={{
                          fontSize: '1.35rem',
                          fontWeight: 700,
                          color: team.waiting_tankers_count > 0 ? '#ea580c' : '#059669',
                          marginTop: '0.15rem',
                        }}
                      >
                        {team.waiting_tankers_count}
                      </div>
                    </div>
                  </div>

                  {/* Owned Stages */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.4rem' }}>
                      {lang === 'ta' ? 'குழுவின் கட்டாய பொறுப்புகள்:' : 'Owned Pipeline Stages:'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {team.owned_stages.map((stKey) => (
                        <div
                          key={stKey}
                          style={{
                            fontSize: '0.78rem',
                            color: '#334155',
                            background: '#f1f5f9',
                            padding: '0.3rem 0.55rem',
                            borderRadius: 5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                          }}
                        >
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                          <span>{stageLabels[stKey] || stKey}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => openAddUserModal(team.code)}
                      style={{ fontSize: '0.82rem', padding: '0.45rem 0.65rem', justifyContent: 'center' }}
                    >
                      + {lang === 'ta' ? 'பயனர் சேர்' : 'Add User'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setFilterTeam(team.code);
                        const el = document.getElementById('team-users-section');
                        if (el) el.scrollIntoView({ behavior: 'smooth' });
                      }}
                      style={{ fontSize: '0.82rem', padding: '0.45rem 0.65rem', justifyContent: 'center' }}
                    >
                      👁️ {lang === 'ta' ? 'பயனர்கள்' : 'View Users'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleClick(team)}
                    className={team.active ? 'btn-secondary' : 'btn-primary'}
                    style={{
                      fontSize: '0.8rem',
                      padding: '0.4rem',
                      color: team.active ? '#dc2626' : undefined,
                      borderColor: team.active ? '#fca5a5' : undefined,
                      background: team.active ? '#fef2f2' : undefined,
                      width: '100%',
                      justifyContent: 'center',
                    }}
                  >
                    {team.active
                      ? lang === 'ta' ? 'குழுவை முடக்கு' : 'Deactivate Team'
                      : lang === 'ta' ? 'குழுவை செயல்படுத்து' : 'Activate Team'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. SHOW ENTIRE TEAM LIST SECTION */}
      <div id="team-users-section" className="card" style={{ padding: '1.5rem', marginTop: '1rem', background: '#ffffff', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {lang === 'ta' ? 'தொழிற்சாலை குழு பயனர்கள் பட்டியல்' : 'Plant Team Members & Operators'} ({filteredUsers.length})
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              {lang === 'ta'
                ? 'அனைத்து குழுக்களின் பதிவு செய்யப்பட்ட பயனர்கள் மற்றும் தனித்துவ பயனர் எண்கள் (Unique User ID)'
                : 'All registered operators across Gate, QC, and Unloading teams with structured unique user IDs'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => openAddUserModal(filterTeam as any || 'GATE')}
            className="btn-primary"
            style={{ fontSize: '0.84rem', padding: '0.45rem 0.95rem' }}
          >
            ➕ {lang === 'ta' ? 'புதிய பயனர்' : 'Add New Operator'}
          </button>
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

          {(filterTeam || filterShift || filterStatus !== 'all' || searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setFilterTeam('');
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
              {filterTeam
                ? `No operators registered for ${filterTeam} team yet.`
                : 'No team operators found matching criteria.'}
            </div>
            <button
              type="button"
              onClick={() => openAddUserModal((filterTeam as any) || 'GATE')}
              className="btn-primary"
              style={{ marginTop: '0.75rem', fontSize: '0.84rem', padding: '0.45rem 0.95rem' }}
            >
              + Create First {filterTeam || 'Plant'} Operator
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

      {/* 4. ADD USER MODAL WITH UNIQUE USER ID */}
      {showAddModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                  {lang === 'ta' ? 'புதிய தொழிற்சாலை பணியாளர் சேர்' : 'Add Plant Team User'}
                </h3>
                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                  {lang === 'ta'
                    ? 'குழுவைத் தேர்வு செய்து தனித்துவ அடையாள எண்ணை (AV_IT_001) ஒதுக்கவும்'
                    : 'Assign team, generate a structured Unique User ID (e.g. AV_IT_001) and set credentials'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '1.25rem' }}
              >
                ✕
              </button>
            </div>

            {addUserError && <ErrorBanner message={addUserError} />}

            <form onSubmit={handleCreateUser} className="entry-form" style={{ marginTop: '0.75rem' }}>
              {/* Row 1: Team Dropdown & Unique User ID */}
              <div className="form-row">
                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'குழு (Select Team)' : 'Select Team'} *
                  </label>
                  <select
                    value={addTeam}
                    onChange={(e) => handleTeamChangeInModal(e.target.value as any)}
                    required
                    style={{ fontWeight: 600 }}
                  >
                    <option value="GATE">GATE — Vehicle Entry & Weighbridge</option>
                    <option value="QC">QC — Quality Testing & CIP</option>
                    <option value="UNLOADING">UNLOAD — Silo & Milk Reception</option>
                  </select>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontWeight: 600 }}>
                      Unique User ID *
                    </label>
                    <button
                      type="button"
                      onClick={() => void fetchNextUserId(addTeam)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        fontWeight: 600,
                        padding: 0,
                      }}
                    >
                      ⚡ Auto-Generate
                    </button>
                  </div>
                  <input
                    value={addUserId}
                    onChange={(e) => setAddUserId(e.target.value.toUpperCase())}
                    placeholder="e.g. AV_IT_001"
                    required
                    style={{ fontWeight: 700, letterSpacing: '0.04em' }}
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                    Format example: <code>AV_IT_001</code>, <code>AV_GT_001</code>. Stored in database.
                  </span>
                </div>
              </div>

              {/* Row 2: Full Name & Shift */}
              <div className="form-row">
                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'முழு பெயர்' : 'Full Name'} *
                  </label>
                  <input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="e.g. Raman K"
                    required
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'பணி முறை (Shift)' : 'Shift'} *
                  </label>
                  <select
                    value={addShift}
                    onChange={(e) => setAddShift(e.target.value as any)}
                    required
                  >
                    <option value="Morning">Morning (AM)</option>
                    <option value="Evening">Evening (PM)</option>
                    <option value="General">General (Full Day)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Email & Phone */}
              <div className="form-row">
                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'மின்னஞ்சல்' : 'Email Address'} *
                  </label>
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                    placeholder="e.g. raman.gate@aavin.internal"
                    required
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'அலைபேசி எண்' : 'Mobile Number (+91)'}
                  </label>
                  <input
                    type="tel"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                    placeholder="9876543210"
                    maxLength={10}
                  />
                </div>
              </div>

              {/* Row 4: Password with Auto-generate */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 600 }}>
                    {lang === 'ta' ? 'கடவுச்சொல்' : 'Initial Password'} *
                  </label>
                  <button
                    type="button"
                    onClick={() => setAddPassword(generateRandomPassword())}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    🎲 New Password
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    required
                    style={{ flex: 1, fontFamily: 'monospace' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="btn-secondary"
                    style={{ padding: '0 0.65rem', fontSize: '0.8rem' }}
                  >
                    {showPassword ? '🙈 Hide' : '👁️ Show'}
                  </button>
                </div>
              </div>

              {/* Force Password Change Checkbox */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: '#475569', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={addForceChange}
                  onChange={(e) => setAddForceChange(e.target.checked)}
                />
                <span>Require password change at first login</span>
              </label>

              {/* Modal Buttons */}
              <div className="modal-actions" style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={savingUser}
                  style={{ minWidth: 140 }}
                >
                  {savingUser ? 'Creating…' : 'Create User'}
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
              Edit Operator — {editTarget.full_name}
            </h3>

            {editError && <ErrorBanner message={editError} />}

            <div className="entry-form">
              <div className="form-group">
                <label>Full Name</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>

              <div className="form-group">
                <label>Unique User ID</label>
                <input
                  value={editUserId}
                  onChange={(e) => setEditUserId(e.target.value.toUpperCase())}
                  placeholder="e.g. AV_IT_001"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Number</label>
                  <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="9876543210" />
                </div>
                <div className="form-group">
                  <label>Shift</label>
                  <select value={editShift} onChange={(e) => setEditShift(e.target.value as any)}>
                    <option value="Morning">Morning</option>
                    <option value="Evening">Evening</option>
                    <option value="General">General</option>
                  </select>
                </div>
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

      {/* 7. DEACTIVATE / ACTIVATE CONFIRMATION MODAL */}
      <ConfirmDialog
        open={Boolean(targetTeam)}
        title={
          targetTeam?.active
            ? (lang === 'ta' ? `${targetTeam?.name} குழுவை முடக்கவா?` : `Deactivate ${targetTeam?.name}?`)
            : (lang === 'ta' ? `${targetTeam?.name} குழுவை செயல்படுத்தவா?` : `Activate ${targetTeam?.name}?`)
        }
        message={
          targetTeam?.active
            ? (lang === 'ta'
                ? `இந்தக் குழுவை முடக்கினால் புதிய பணிகள் தடுக்கப்படும். தொடர விரும்புகிறீர்களா?`
                : `Are you sure you want to deactivate ${targetTeam?.name}? Operators in this team will not be able to record new stages until reactivated.`)
            : (lang === 'ta'
                ? `இந்தக் குழுவை மீண்டும் செயல்படுத்த விரும்புகிறீர்களா?`
                : `Re-activate ${targetTeam?.name} so operators can record their owned pipeline stages?`)
        }
        confirmLabel={
          targetTeam?.active
            ? (lang === 'ta' ? 'முடக்கு' : 'Deactivate')
            : (lang === 'ta' ? 'செயல்படுத்து' : 'Activate')
        }
        danger={targetTeam?.active}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setTargetTeam(null)}
      />

      {/* 8. BLOCKED WARNING MODAL */}
      {blockedWarning && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                {lang === 'ta' ? 'முடக்க இயலாது' : 'Deactivation Blocked'}
              </h3>
            </div>
            <p style={{ color: '#475569', fontSize: '0.9rem', lineHeight: 1.5, margin: '0.75rem 0 1.25rem' }}>
              {blockedWarning}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setBlockedWarning(null)}
                style={{ width: 'auto', padding: '0.5rem 1.25rem' }}
              >
                {lang === 'ta' ? 'சரி' : 'Understood'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
