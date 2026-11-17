import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { normalizeIndianPhone, formatDateDDMMYYYY } from '../../lib/format';
import { DataTable } from '../../components/DataTable';
import type { DataColumn } from '../../components/DataTable';
import { ConfirmDialog, ErrorBanner, StatusBadge, TableSkeleton } from '../../components/UiPrimitives';
import { useTranslation } from '../../context/LanguageContext';

interface Unit {
  id: string;
  name: string;
  unit_code: string;
  last_record_date?: string | null;
}

interface UserRecord {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  unit_id: string | null;
  team_id?: string | null;
  shift?: 'Morning' | 'Evening' | 'General' | null;
  username?: string | null;
  sub_role?: 'operator' | 'supervisor';
  is_active?: boolean;
  must_change_password?: boolean;
  last_sign_in_at?: string | null;
  created_at?: string;
  units: { name: string; unit_code: string } | null;
  team: { id: string; code: string; name: string } | null;
}

const TEAM_DESCRIPTIONS: Record<string, { en: string; ta: string }> = {
  GATE: {
    en: 'Owned stages: Vehicle Entry, Gross Weight, Tare Weight, Vehicle Exit (Gate pass & weighbridge operations)',
    ta: 'பொறுப்புகள்: வாகனம் நுழைவு, மொத்த எடை (Gross), காலி எடை (Tare), வாகனம் வெளியேறுதல்',
  },
  QC: {
    en: 'Owned stages: QC Test, CIP Completed (Milk lab quality inspection, fat/SNF verification & tanker sanitization)',
    ta: 'பொறுப்புகள்: QC ஆய்வக பரிசோதனை, CIP டேங்கர் தூய்மைப்படுத்துதல்',
  },
  UNLOADING: {
    en: 'Owned stages: Unloaded (Bay allocation, silo reception & unloading quantity tracking)',
    ta: 'பொறுப்புகள்: பால் இறக்குதல், சிலோ சேமிப்பு மற்றும் இறக்கும் அளவு கண்காணிப்பு',
  },
};

function genPassword() {
  return Math.random().toString(36).slice(-5) + 'A@' + Math.floor(100 + Math.random() * 900);
}

export default function AdminUsers() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { lang } = useTranslation();
  const fullNameRef = useRef<HTMLInputElement>(null);
  const formCardRef = useRef<HTMLDivElement>(null);

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Form states
  const [userType, setUserType] = useState<'unit' | 'plant'>('unit');
  const [selectedTeam, setSelectedTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [shift, setShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [unitId, setUnitId] = useState('');
  const [subRole, setSubRole] = useState<'operator' | 'supervisor'>('operator');
  const [password, setPassword] = useState(() => genPassword());
  const [forceChange, setForceChange] = useState(true);

  // Table filters
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterUnit, setFilterUnit] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Status & Feedback
  const [error, setError] = useState('');
  const [onboardingResult, setOnboardingResult] = useState<{
    message: string;
    tempPassword?: string;
    inviteLink?: string | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<UserRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editUnitId, setEditUnitId] = useState('');
  const [editShift, setEditShift] = useState<'Morning' | 'Evening' | 'General'>('General');
  const [editUsername, setEditUsername] = useState('');
  const [editSubRole, setEditSubRole] = useState<'operator' | 'supervisor'>('operator');
  const [savingEdit, setSavingEdit] = useState(false);

  // Reset Password modal
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [resetTempPwd, setResetTempPwd] = useState('');
  const [resetting, setResetting] = useState(false);

  // Deactivate confirm
  const [toggleTarget, setToggleTarget] = useState<UserRecord | null>(null);
  const [toggling, setToggling] = useState(false);

  // Move Team modal
  const [moveTarget, setMoveTarget] = useState<UserRecord | null>(null);
  const [moveToTeam, setMoveToTeam] = useState<'GATE' | 'QC' | 'UNLOADING'>('GATE');
  const [moveReason, setMoveReason] = useState('');
  const [moveError, setMoveError] = useState('');
  const [movingTeam, setMovingTeam] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const [uRes, unRes] = await Promise.all([
        api.get<UserRecord[]>('/users'),
        api.get<Unit[]>('/units'),
      ]);
      setUsers(uRes.data);
      setUnits(unRes.data);
      if (unRes.data.length > 0 && !unitId) setUnitId(unRes.data[0].id);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load users');
    } finally {
      setLoadingList(false);
    }
  }, [unitId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Handle URL query parameters (e.g. ?action=new&team=GATE or ?team=QC)
  useEffect(() => {
    const actionParam = searchParams.get('action');
    const teamParam = searchParams.get('team');

    if (teamParam) {
      const upper = teamParam.toUpperCase();
      if (['GATE', 'QC', 'UNLOADING'].includes(upper)) {
        setFilterTeam(upper);
        setSelectedTeam(upper as any);
      }
    }

    if (actionParam === 'new') {
      setUserType('plant');
      if (teamParam) {
        const upper = teamParam.toUpperCase();
        if (['GATE', 'QC', 'UNLOADING'].includes(upper)) {
          setSelectedTeam(upper as any);
        }
      }
      setTimeout(() => {
        formCardRef.current?.scrollIntoView({ behavior: 'smooth' });
        fullNameRef.current?.focus();
      }, 200);
    }
  }, [searchParams]);

  const normalizedPhonePreview = phone.trim() ? normalizeIndianPhone(phone) : null;
  const emailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setOnboardingResult(null);

    if (!emailValid) {
      setError(lang === 'ta' ? 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடவும்.' : 'Please enter a valid email address.');
      return;
    }
    if (phone.trim() && !normalizedPhonePreview) {
      setError(lang === 'ta' ? 'தொலைபேசி எண் 10 இலக்க இந்திய எண்ணாக (+91) இருக்க வேண்டும்.' : 'Phone must be a valid 10-digit Indian mobile number (+91).');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        full_name: fullName.trim(),
        email: email.trim(),
        phone: normalizedPhonePreview || undefined,
        user_type: userType,
        temp_password: password,
        force_password_change: forceChange,
      };

      if (userType === 'plant') {
        payload.team = selectedTeam;
        payload.role = selectedTeam.toLowerCase();
        payload.shift = shift;
        if (username.trim()) payload.username = username.trim();
      } else {
        payload.role = 'unit';
        payload.unit_id = unitId;
        payload.sub_role = subRole;
      }

      const res = await api.post<{
        temp_password?: string;
        invite_link?: string | null;
      }>('/users/create', payload);

      setOnboardingResult({
        message: lang === 'ta'
          ? `${fullName.trim()} கணக்கு வெற்றிகரமாக உருவாக்கப்பட்டது! ${forceChange ? 'முதல் உள்நுழைவில் கடவுச்சொல்லை மாற்ற வேண்டும்.' : ''}`
          : `Account created for ${fullName.trim()}. ${forceChange ? 'User will be required to set a new password on first login.' : ''}`,
        tempPassword: res.data.temp_password || password,
        inviteLink: res.data.invite_link ?? null,
      });

      setFullName('');
      setEmail('');
      setPhone('');
      setUsername('');
      setPassword(genPassword());
      await fetchAll();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (u: UserRecord) => {
    setEditTarget(u);
    setEditName(u.full_name ?? '');
    setEditPhone(u.phone ?? '');
    setEditUnitId(u.unit_id ?? (units[0]?.id || ''));
    setEditShift(u.shift ?? 'General');
    setEditUsername(u.username ?? '');
    setEditSubRole(u.sub_role ?? 'operator');
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    if (editPhone.trim() && !normalizeIndianPhone(editPhone)) {
      setError(lang === 'ta' ? 'தொலைபேசி எண் 10 இலக்க இந்திய எண்ணாக (+91) இருக்க வேண்டும்.' : 'Phone must be a valid 10-digit Indian mobile number (+91).');
      return;
    }
    setSavingEdit(true);
    setError('');
    try {
      const payload: any = {
        full_name: editName.trim(),
        phone: editPhone.trim() ? normalizeIndianPhone(editPhone) : null,
      };

      if (editTarget.role === 'unit') {
        payload.unit_id = editUnitId;
        payload.sub_role = editSubRole;
      } else {
        payload.shift = editShift;
        payload.username = editUsername.trim() || null;
      }

      await api.patch(`/users/${editTarget.id}`, payload);
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
        message: lang === 'ta'
          ? `${resetTarget.full_name ?? resetTarget.email} கடவுச்சொல் மாற்றப்பட்டது. அடுத்த உள்நுழைவில் புதிய கடவுச்சொல்லை அமைக்க வேண்டும்.`
          : `Password reset for ${resetTarget.full_name ?? resetTarget.email}. User must change password on next login.`,
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

  const openMoveModal = (u: UserRecord) => {
    setMoveTarget(u);
    const curUpper = (u.role || '').toUpperCase();
    const nextChoice = curUpper === 'GATE' ? 'QC' : curUpper === 'QC' ? 'UNLOADING' : 'GATE';
    setMoveToTeam(nextChoice);
    setMoveReason('');
    setMoveError('');
  };

  const handleConfirmMoveTeam = async () => {
    if (!moveTarget) return;
    if (!moveReason.trim()) {
      setMoveError(lang === 'ta' ? 'குழு மாற்றத்திற்கான காரணம் கட்டாயமாகும்.' : 'Reason is mandatory to move a user to another team.');
      return;
    }

    setMovingTeam(true);
    setMoveError('');
    try {
      await api.post(`/users/${moveTarget.id}/move-team`, {
        new_team: moveToTeam,
        reason: moveReason.trim(),
      });
      setMoveTarget(null);
      await fetchAll();
    } catch (err: any) {
      setMoveError(err.response?.data?.error || err.message || 'Failed to move user');
    } finally {
      setMovingTeam(false);
    }
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    let result = users;

    // Team Filter
    if (filterTeam) {
      const fUpper = filterTeam.toUpperCase();
      if (fUpper === 'UNIT') {
        result = result.filter((u) => u.role === 'unit');
      } else {
        result = result.filter((u) => (u.role || '').toUpperCase() === fUpper || u.team?.code === fUpper);
      }
    }

    // Unit Filter
    if (filterUnit) {
      result = result.filter((u) => u.unit_id === filterUnit);
    }

    // Status Filter
    if (filterStatus === 'active') {
      result = result.filter((u) => u.is_active !== false);
    } else if (filterStatus === 'inactive') {
      result = result.filter((u) => u.is_active === false);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((u) => {
        const nameMatch = (u.full_name || '').toLowerCase().includes(q);
        const emailMatch = (u.email || '').toLowerCase().includes(q);
        const phoneMatch = (u.phone || '').toLowerCase().includes(q);
        const userMatch = (u.username || '').toLowerCase().includes(q);
        const unitMatch = (u.units?.name || '').toLowerCase().includes(q);
        const teamMatch = (u.team?.name || '').toLowerCase().includes(q);
        return nameMatch || emailMatch || phoneMatch || userMatch || unitMatch || teamMatch;
      });
    }

    return result;
  }, [users, filterTeam, filterUnit, filterStatus, searchQuery]);

  // Determine empty message based on filter
  const getEmptyMessage = () => {
    if (filterTeam === 'GATE') {
      return lang === 'ta' ? 'நுழைவாயில் பயனர்கள் இல்லை. முதல் நுழைவாயில் பயனரை உருவாக்கவும்.' : 'No Gate users yet. Create the first Gate user.';
    }
    if (filterTeam === 'QC') {
      return lang === 'ta' ? 'QC ஆய்வக பயனர்கள் இல்லை. முதல் QC பயனரை உருவாக்கவும்.' : 'No QC users yet. Create the first QC user.';
    }
    if (filterTeam === 'UNLOADING') {
      return lang === 'ta' ? 'இறக்குதல் பயனர்கள் இல்லை. முதல் இறக்குதல் பயனரை உருவாக்கவும்.' : 'No Unloading users yet. Create the first Unloading user.';
    }
    if (filterTeam === 'UNIT') {
      return lang === 'ta' ? 'பி.எம்.சி பணியாளர்கள் இல்லை. முதல் பி.எம்.சி பணியாளரை உருவாக்கவும்.' : 'No BMC staff users yet. Create the first BMC user.';
    }
    return lang === 'ta' ? 'பயனர்கள் எவரும் இல்லை' : 'No users found matching current filters';
  };

  const columns: DataColumn<UserRecord>[] = [
    {
      key: 'name',
      header: lang === 'ta' ? 'பெயர் / விவரம்' : 'Name',
      sortValue: (u) => u.full_name ?? '',
      searchValue: (u) => `${u.full_name ?? ''} ${u.email ?? ''} ${u.phone ?? ''} ${u.username ?? ''}`,
      render: (u) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <strong style={{ color: '#0f172a' }}>{u.full_name ?? '—'}</strong>
            {u.username && (
              <span
                style={{
                  fontSize: '0.72rem',
                  background: '#f1f5f9',
                  color: '#475569',
                  padding: '0.1rem 0.4rem',
                  borderRadius: 4,
                  fontWeight: 600,
                }}
              >
                @{u.username}
              </span>
            )}
          </div>
          {u.email && <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{u.email}</div>}
        </div>
      ),
    },
    {
      key: 'team_or_unit',
      header: lang === 'ta' ? 'குழு / பி.எம்.சி' : 'Team / BMC',
      sortValue: (u) => u.team?.name || u.units?.name || '',
      render: (u) => {
        const roleUpper = (u.role || '').toUpperCase();
        if (['GATE', 'QC', 'UNLOADING'].includes(roleUpper)) {
          return (
            <div>
              <span style={{ fontWeight: 600, color: '#0f172a' }}>
                {roleUpper === 'GATE'
                  ? 'Gate Operations'
                  : roleUpper === 'QC'
                  ? 'Quality Control (QC)'
                  : 'Milk Unloading'}
              </span>
              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Plant Operations Team</div>
            </div>
          );
        }
        return u.units ? (
          <div>
            <span style={{ fontWeight: 600, color: '#0f172a' }}>{u.units.name}</span>{' '}
            <span className="unit-code">{u.units.unit_code}</span>
          </div>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        );
      },
    },
    {
      key: 'role',
      header: lang === 'ta' ? 'பங்கு' : 'Role Badge',
      sortValue: (u) => u.role,
      render: (u) => {
        const r = (u.role || '').toUpperCase();
        if (r === 'GATE') {
          return (
            <span
              style={{
                background: '#e0e7ff',
                color: '#3730a3',
                padding: '0.2rem 0.6rem',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              GATE
            </span>
          );
        }
        if (r === 'QC') {
          return (
            <span
              style={{
                background: '#fef3c7',
                color: '#92400e',
                padding: '0.2rem 0.6rem',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              QC
            </span>
          );
        }
        if (r === 'UNLOADING') {
          return (
            <span
              style={{
                background: '#dbeafe',
                color: '#1e40af',
                padding: '0.2rem 0.6rem',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              UNLOADING
            </span>
          );
        }
        if (r === 'ADMIN') {
          return (
            <span
              style={{
                background: '#f1f5f9',
                color: '#334155',
                padding: '0.2rem 0.6rem',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              ADMIN
            </span>
          );
        }
        return (
          <StatusBadge tone={u.sub_role === 'supervisor' ? 'indigo' : 'grey'}>
            {u.sub_role === 'supervisor' ? 'Supervisor' : 'Operator'}
          </StatusBadge>
        );
      },
    },
    {
      key: 'phone',
      header: lang === 'ta' ? 'தொலைபேசி' : 'Phone',
      sortValue: (u) => u.phone ?? '',
      render: (u) => u.phone ?? '—',
    },
    {
      key: 'shift',
      header: lang === 'ta' ? 'வேளை (Shift)' : 'Shift',
      sortValue: (u) => u.shift ?? '',
      render: (u) => {
        if (!u.shift) return <span style={{ color: '#94a3b8' }}>—</span>;
        return (
          <span
            style={{
              padding: '0.15rem 0.5rem',
              borderRadius: 4,
              fontSize: '0.76rem',
              fontWeight: 600,
              background: u.shift === 'Morning' ? '#fef3c7' : u.shift === 'Evening' ? '#e0f2fe' : '#f1f5f9',
              color: u.shift === 'Morning' ? '#92400e' : u.shift === 'Evening' ? '#0369a1' : '#475569',
            }}
          >
            {u.shift}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: lang === 'ta' ? 'நிலை' : 'Status',
      sortValue: (u) => (u.is_active === false ? 0 : 1),
      render: (u) => (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <StatusBadge tone={u.is_active === false ? 'grey' : 'green'}>
            {u.is_active === false
              ? lang === 'ta' ? 'முடக்கப்பட்டது' : 'Inactive'
              : lang === 'ta' ? 'செயலில்' : 'Active'}
          </StatusBadge>
          {u.must_change_password && (
            <StatusBadge tone="amber">
              {lang === 'ta' ? 'கடவுச்சொல் மாற்றம் தேவை' : 'Pwd change required'}
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      key: 'last_login',
      header: lang === 'ta' ? 'கடைசி உள்நுழைவு' : 'Last Login',
      sortValue: (u) => u.last_sign_in_at || u.created_at || '',
      render: (u) => {
        if (u.last_sign_in_at) {
          return (
            <span style={{ fontSize: '0.78rem', color: '#475569' }}>
              {formatDateDDMMYYYY(u.last_sign_in_at.slice(0, 10))}
            </span>
          );
        }
        if (u.created_at) {
          return (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Created: {formatDateDDMMYYYY(u.created_at.slice(0, 10))}
            </span>
          );
        }
        return <span style={{ color: '#94a3b8' }}>Never</span>;
      },
    },
    {
      key: 'actions',
      header: lang === 'ta' ? 'செயல்கள்' : 'Actions',
      render: (u) => (
        <div className="action-row" style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => openEditModal(u)}>
            {lang === 'ta' ? 'திருத்து' : 'Edit'}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setResetTarget(u);
              setResetTempPwd(genPassword());
            }}
          >
            {lang === 'ta' ? 'கடவுச்சொல் மாற்று' : 'Reset Password'}
          </button>
          {['gate', 'qc', 'unloading', 'GATE', 'QC', 'UNLOADING'].includes(u.role) && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              style={{ background: '#f5f3ff', borderColor: '#c4b5fd', color: '#6d28d9' }}
              onClick={() => openMoveModal(u)}
            >
              🔄 {lang === 'ta' ? 'குழு மாற்று' : 'Move Team'}
            </button>
          )}
          <button
            type="button"
            className={u.is_active === false ? 'btn-secondary btn-sm' : 'btn-danger btn-sm'}
            onClick={() => setToggleTarget(u)}
          >
            {u.is_active === false
              ? lang === 'ta' ? 'செயல்படுத்து' : 'Activate'
              : lang === 'ta' ? 'முடக்கு' : 'Deactivate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
            {lang === 'ta' ? 'பயனர்கள் மேலாண்மை' : 'Manage Portal Users'}
          </h1>
          <p className="page-subtitle" style={{ color: '#64748b' }}>
            {lang === 'ta'
              ? 'மையப் பணியாளர்கள் மற்றும் தொழிற்சாலைக் குழுக்களின் (GATE, QC, UNLOADING) பயனர் கணக்குகள்'
              : 'Create and manage Unit staff and Plant Operations team accounts with shift and stage-level permissions'}
          </p>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchAll} />}

      {onboardingResult && (
        <div className="success-banner" style={{ flexDirection: 'column', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <strong>{onboardingResult.message}</strong>
          {onboardingResult.tempPassword && (
            <div style={{ fontSize: '0.84rem', marginTop: '0.25rem' }}>
              Temporary Password: <code>{onboardingResult.tempPassword}</code>
            </div>
          )}
          {onboardingResult.inviteLink && (
            <div style={{ fontSize: '0.8rem', wordBreak: 'break-all', marginTop: '0.25rem' }}>
              Setup Link:{' '}
              <a href={onboardingResult.inviteLink} target="_blank" rel="noreferrer">
                {onboardingResult.inviteLink}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Create User Form Card */}
      <div ref={formCardRef} className="card form-card" style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: '#0f172a' }}>
          {lang === 'ta' ? 'புதிய பயனர் கணக்கு உருவாக்குதல்' : 'Create User Account'}
        </h2>

        {/* User Type Switcher */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
            {lang === 'ta' ? 'பயனர் வகை (User Type)' : 'User Type'}
          </label>
          <div style={{ display: 'inline-flex', borderRadius: 6, border: '1px solid #cbd5e1', overflow: 'hidden' }}>
            <button
              type="button"
              onClick={() => setUserType('unit')}
              style={{
                padding: '0.55rem 1.25rem',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                background: userType === 'unit' ? '#2563eb' : '#f8fafc',
                color: userType === 'unit' ? '#ffffff' : '#475569',
              }}
            >
              🥛 {lang === 'ta' ? 'பி.எம்.சி பணியாளர் (BMC Staff)' : 'BMC Staff'}
            </button>
            <button
              type="button"
              onClick={() => setUserType('plant')}
              style={{
                padding: '0.55rem 1.25rem',
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                background: userType === 'plant' ? '#2563eb' : '#f8fafc',
                color: userType === 'plant' ? '#ffffff' : '#475569',
              }}
            >
              🏭 {lang === 'ta' ? 'தொழிற்சாலை குழு (Plant Team)' : 'Plant Team'}
            </button>
          </div>
        </div>

        <form onSubmit={handleCreate} className="entry-form">
          {/* Row 1: Full Name & Optional Username */}
          <div className="form-row">
            <div className="form-group">
              <label>{lang === 'ta' ? 'முழு பெயர்' : 'Full Name'}</label>
              <input
                ref={fullNameRef}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Murugan K"
                required
              />
            </div>
            {userType === 'plant' && (
              <div className="form-group">
                <label>
                  {lang === 'ta' ? 'பயனர்பெயர் (Username - விருப்பத்தேர்வு)' : 'Username (Optional)'}
                </label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. gate_op1"
                />
              </div>
            )}
            <div className="form-group">
              <label>
                {lang === 'ta' ? 'தொலைபேசி' : 'Phone'} <span className="hint">(+91, 10 digits)</span>
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 9876543210"
              />
              {phone.trim() && !normalizedPhonePreview && (
                <span className="auth-error">
                  {lang === 'ta' ? 'சரியான 10 இலக்க இந்திய எண்ணை உள்ளிடவும்' : 'Enter a valid 10-digit Indian mobile number'}
                </span>
              )}
            </div>
          </div>

          {/* Row 2: Email & Assignment (Unit or Team) */}
          <div className="form-row">
            <div className="form-group">
              <label>{lang === 'ta' ? 'மின்னஞ்சல்' : 'Email'}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@aavin.gov.in"
                required
              />
              {!emailValid && (
                <span className="auth-error">
                  {lang === 'ta' ? 'தவறான மின்னஞ்சல் வடிவம்' : 'Invalid email format'}
                </span>
              )}
            </div>

            {userType === 'unit' ? (
              <div className="form-group">
                <label>{lang === 'ta' ? 'ஒதுக்கப்பட்ட பி.எம்.சி' : 'Assigned BMC'}</label>
                <select value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
                  {units.length === 0 ? (
                    <option value="">No BMCs yet — create a BMC first</option>
                  ) : (
                    units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.unit_code})
                      </option>
                    ))
                  )}
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label>{lang === 'ta' ? 'தொழிற்சாலை குழு (Team)' : 'Plant Team'}</label>
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value as any)}
                  required
                >
                  <option value="GATE">GATE — Vehicle Entry & Weighbridge</option>
                  <option value="QC">QC — Quality Testing & CIP</option>
                  <option value="UNLOADING">UNLOADING — Milk Reception & Silo Bay</option>
                </select>
                <div
                  style={{
                    fontSize: '0.78rem',
                    color: '#475569',
                    background: '#f8fafc',
                    padding: '0.45rem 0.65rem',
                    borderRadius: 6,
                    marginTop: '0.35rem',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  ℹ️ {TEAM_DESCRIPTIONS[selectedTeam]?.[lang === 'ta' ? 'ta' : 'en']}
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Role / Shift & Password */}
          <div className="form-row">
            {userType === 'unit' ? (
              <div className="form-group">
                <label>{lang === 'ta' ? 'பணியாளர் பொறுப்பு' : 'Staff Role'}</label>
                <select value={subRole} onChange={(e) => setSubRole(e.target.value as any)}>
                  <option value="operator">Operator (Daily entry &amp; dispatch)</option>
                  <option value="supervisor">Supervisor (Unit oversight &amp; review)</option>
                </select>
              </div>
            ) : (
              <div className="form-group">
                <label>{lang === 'ta' ? 'பணி வேளை (Shift)' : 'Work Shift'}</label>
                <select value={shift} onChange={(e) => setShift(e.target.value as any)}>
                  <option value="Morning">Morning Shift (காலை வேளை)</option>
                  <option value="Evening">Evening Shift (மாலை வேளை)</option>
                  <option value="General">General Shift (பொது வேளை)</option>
                </select>
              </div>
            )}

            <div className="form-group">
              <label>
                {lang === 'ta' ? 'தற்காலிக கடவுச்சொல்' : 'Temporary Password'}{' '}
                <button type="button" onClick={() => setPassword(genPassword())} className="btn-link">
                  generate
                </button>
              </label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '0.82rem', fontWeight: 400 }}>
                <input type="checkbox" checked={forceChange} onChange={(e) => setForceChange(e.target.checked)} />
                {lang === 'ta'
                  ? 'முதல் உள்நுழைவில் புதிய கடவுச்சொல் அமைப்பதை கட்டாயமாக்கு'
                  : 'Require user to set a new password on first login'}
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || (userType === 'unit' && units.length === 0)}
            className="btn-primary"
            style={{ width: 'auto', padding: '0.65rem 1.5rem', marginTop: '0.5rem' }}
          >
            {saving
              ? lang === 'ta' ? 'உருவாக்குகிறது…' : 'Creating…'
              : lang === 'ta' ? 'பயனர் கணக்கை உருவாக்கு' : 'Create User Account'}
          </button>
        </form>
      </div>

      {/* Users List & Filters */}
      <div className="card table-card" style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              {lang === 'ta' ? 'பயனர்கள் பட்டியல்' : 'Portal Users Accounts'}
            </h2>
            <p style={{ color: '#64748b', fontSize: '0.84rem', margin: '0.2rem 0 0' }}>
              {filteredUsers.length} {lang === 'ta' ? 'பயனர்கள் காணப்படுகின்றனர்' : 'total accounts found'}
            </p>
          </div>

          {/* Filters Bar */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Team Filter */}
            <select
              value={filterTeam}
              onChange={(e) => setFilterTeam(e.target.value)}
              style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            >
              <option value="">{lang === 'ta' ? 'அனைத்து குழுக்களும்' : 'All Teams & Roles'}</option>
              <option value="GATE">Gate Operations (GATE)</option>
              <option value="QC">Quality Control (QC)</option>
              <option value="UNLOADING">Milk Unloading</option>
              <option value="UNIT">BMC Staff Only</option>
            </select>

            {/* BMC Filter */}
            <select
              value={filterUnit}
              onChange={(e) => setFilterUnit(e.target.value)}
              style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            >
              <option value="">{lang === 'ta' ? 'அனைத்து பி.எம்.சிகளும்' : 'All BMCs'}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              style={{ padding: '0.45rem 0.65rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
            >
              <option value="all">{lang === 'ta' ? 'அனைத்து நிலைகளும்' : 'All Status'}</option>
              <option value="active">{lang === 'ta' ? 'செயலில் உள்ளவை' : 'Active Only'}</option>
              <option value="inactive">{lang === 'ta' ? 'முடக்கப்பட்டவை' : 'Inactive Only'}</option>
            </select>

            {/* Search Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'ta' ? 'தேடுக...' : 'Search name, email, phone...'}
              style={{ padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.84rem', minWidth: 180 }}
            />

            {(filterTeam || filterUnit || filterStatus !== 'all' || searchQuery) && (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setFilterTeam('');
                  setFilterUnit('');
                  setFilterStatus('all');
                  setSearchQuery('');
                }}
              >
                ✕ {lang === 'ta' ? 'அழி' : 'Clear'}
              </button>
            )}
          </div>
        </div>

        {loadingList ? (
          <TableSkeleton rows={4} cols={7} />
        ) : (
          <DataTable
            rows={filteredUsers}
            columns={columns}
            getRowKey={(u) => u.id}
            emptyMessage={getEmptyMessage()}
            emptyActionLabel={lang === 'ta' ? 'புதிய பயனர் சேர்' : 'Create user'}
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
            <h3 className="modal-title">
              {lang === 'ta' ? 'பயனர் திருத்துதல்' : 'Edit User'} — {editTarget.full_name}
            </h3>
            <div className="entry-form" style={{ marginTop: '0.75rem' }}>
              <div className="form-group">
                <label>{lang === 'ta' ? 'முழு பெயர்' : 'Full Name'}</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>{lang === 'ta' ? 'தொலைபேசி' : 'Phone'} (+91)</label>
                <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="9876543210" />
              </div>

              {editTarget.role === 'unit' ? (
                <>
                  <div className="form-group">
                    <label>{lang === 'ta' ? 'ஒதுக்கப்பட்ட பி.எம்.சி' : 'Assigned BMC'}</label>
                    <select value={editUnitId} onChange={(e) => setEditUnitId(e.target.value)}>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.unit_code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>{lang === 'ta' ? 'பங்கு' : 'Role'}</label>
                    <select value={editSubRole} onChange={(e) => setEditSubRole(e.target.value as any)}>
                      <option value="operator">Operator</option>
                      <option value="supervisor">Supervisor</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>{lang === 'ta' ? 'பயனர்பெயர்' : 'Username'}</label>
                    <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>{lang === 'ta' ? 'பணி வேளை (Shift)' : 'Work Shift'}</label>
                    <select value={editShift} onChange={(e) => setEditShift(e.target.value as any)}>
                      <option value="Morning">Morning Shift</option>
                      <option value="Evening">Evening Shift</option>
                      <option value="General">General Shift</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>
                {lang === 'ta' ? 'ரத்து' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto' }}
                disabled={savingEdit}
                onClick={() => void handleSaveEdit()}
              >
                {savingEdit ? (lang === 'ta' ? 'சேமிக்கிறது…' : 'Saving…') : (lang === 'ta' ? 'மாற்றங்களைச் சேமி' : 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      <ConfirmDialog
        open={Boolean(resetTarget)}
        title={
          lang === 'ta'
            ? `${resetTarget?.full_name ?? 'பயனர்'} கடவுச்சொல்லை மாற்றவா?`
            : `Reset Password for ${resetTarget?.full_name ?? 'User'}?`
        }
        message={
          lang === 'ta'
            ? `புதிய தற்காலிக கடவுச்சொல் (${resetTempPwd}) அமைக்கப்பட்டு பயனர் அடுத்த உள்நுழைவில் கட்டாயம் புதிய கடவுச்சொல் அமைக்க வேண்டும்.`
            : `A new temporary password (${resetTempPwd}) will be set and the user will be forced to choose a new password on their next login.`
        }
        confirmLabel={lang === 'ta' ? 'கடவுச்சொல் மாற்று' : 'Reset Password'}
        loading={resetting}
        onConfirm={() => void handleConfirmResetPassword()}
        onCancel={() => setResetTarget(null)}
      />

      {/* Deactivate / Activate User Modal */}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={
          toggleTarget?.is_active === false
            ? lang === 'ta' ? `${toggleTarget?.full_name} செயல்படுத்தவா?` : `Activate ${toggleTarget?.full_name}?`
            : lang === 'ta' ? `${toggleTarget?.full_name} முடக்கவா?` : `Deactivate ${toggleTarget?.full_name}?`
        }
        message={
          toggleTarget?.is_active === false
            ? lang === 'ta'
              ? `${toggleTarget?.full_name} மீண்டும் உள்நுழைய அனுமதிக்கவா?`
              : `Allow ${toggleTarget?.full_name} to sign in again?`
            : lang === 'ta'
              ? `${toggleTarget?.full_name} கணக்கை முடக்கினால் அவர்கள் உடனடியாக வெளியேற்றப்படுவார்கள். பழைய பதிவுகள் பாதுகாக்கப்படும்.`
              : `Deactivate ${toggleTarget?.full_name}? They will immediately be blocked from logging in, while all past records remain preserved.`
        }
        confirmLabel={
          toggleTarget?.is_active === false
            ? lang === 'ta' ? 'செயல்படுத்து' : 'Activate User'
            : lang === 'ta' ? 'முடக்கு' : 'Deactivate User'
        }
        danger={toggleTarget?.is_active !== false}
        loading={toggling}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />

      {/* Move User to Another Team Modal (Reason Mandatory) */}
      {moveTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 480 }}>
            <h3 className="modal-title" style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              {lang === 'ta' ? 'குழு மாற்றம்' : 'Move User to Another Team'} — {moveTarget.full_name}
            </h3>
            <p style={{ fontSize: '0.86rem', color: '#64748b', marginTop: '0.25rem', marginBottom: '1rem' }}>
              {lang === 'ta' ? 'தற்போதைய குழு:' : 'Current Team:'}{' '}
              <strong style={{ color: '#0f172a' }}>{(moveTarget.role || '').toUpperCase()}</strong>
            </p>

            {moveError && <div className="auth-error" style={{ marginBottom: '0.75rem' }}>{moveError}</div>}

            <div className="entry-form">
              <div className="form-group">
                <label>{lang === 'ta' ? 'புதிய குழுவை தேர்வு செய்க' : 'Select New Team'}</label>
                <select
                  value={moveToTeam}
                  onChange={(e) => setMoveToTeam(e.target.value as any)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
                >
                  <option value="GATE">GATE — Vehicle Entry & Weighbridge</option>
                  <option value="QC">QC — Quality Testing & CIP</option>
                  <option value="UNLOADING">UNLOADING — Milk Reception & Silo Bay</option>
                </select>
                <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.3rem' }}>
                  ℹ️ {TEAM_DESCRIPTIONS[moveToTeam]?.[lang === 'ta' ? 'ta' : 'en']}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label>
                  {lang === 'ta' ? 'மாற்றத்திற்கான கட்டாய காரணம்' : 'Mandatory Reason for Transfer'}{' '}
                  <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <textarea
                  rows={3}
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder={
                    lang === 'ta'
                      ? 'எ.கா. பணி வேளை மாற்றம் அல்லது ஆட்கள் பற்றாக்குறை காரணமாக மாற்றப்படுகிறது...'
                      : 'e.g. Transferred due to staff shortage in evening unloading shift...'
                  }
                  style={{ width: '100%', padding: '0.6rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.86rem' }}
                  required
                />
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setMoveTarget(null)}
                disabled={movingTeam}
              >
                {lang === 'ta' ? 'ரத்து' : 'Cancel'}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ width: 'auto', background: '#6d28d9', borderColor: '#5b21b6' }}
                disabled={movingTeam || !moveReason.trim()}
                onClick={() => void handleConfirmMoveTeam()}
              >
                {movingTeam ? (lang === 'ta' ? 'மாற்றுகிறது…' : 'Moving…') : (lang === 'ta' ? 'குழுவை மாற்று' : 'Confirm Transfer')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
