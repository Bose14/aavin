import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useTranslation } from '../../context/LanguageContext';
import { ErrorBanner, StatusBadge, ConfirmDialog } from '../../components/UiPrimitives';

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

export default function AdminTeams() {
  const navigate = useNavigate();
  const { lang } = useTranslation();

  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Deactivate confirmation modal
  const [targetTeam, setTargetTeam] = useState<TeamItem | null>(null);
  const [toggling, setToggling] = useState(false);

  // Warning modal when deactivation is blocked
  const [blockedWarning, setBlockedWarning] = useState<string | null>(null);

  // Seeding test users
  const [seeding, setSeeding] = useState(false);

  const fetchTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<TeamItem[]>('/teams');
      setTeams(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load plant teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTeams();
  }, []);

  const handleToggleClick = (team: TeamItem) => {
    // If attempting to deactivate and tankers are currently waiting:
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
      const msg = err.response?.data?.error || err.message || 'Failed to update team status';
      setError(msg);
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
      await fetchTeams();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to seed test users');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
            {lang === 'ta' ? 'தொழிற்சாலை குழுக்கள் மேலாண்மை' : 'Plant Teams Management'}
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
            {lang === 'ta'
              ? 'நுழைவாயில் (GATE), தரக்கட்டுப்பாடு (QC) மற்றும் இறக்குதல் (UNLOADING) குழுக்களின் செயல்பாடுகள் மற்றும் பயனர்கள்'
              : 'Configure plant teams, monitor stage ownership, active staff counts, and tankers waiting per team'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={fetchTeams}
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
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }}
          >
            🌱 {seeding ? (lang === 'ta' ? 'உருவாக்குகிறது...' : 'Seeding...') : (lang === 'ta' ? 'மாதிரி பயனர்களை உருவாக்கு' : 'Seed Plant Test Users')}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchTeams} />}

      {successMsg && (
        <div className="success-banner" style={{ marginBottom: '1.25rem', padding: '0.85rem 1.25rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, color: '#166534', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}>✕</button>
        </div>
      )}

      {/* Teams Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
          {lang === 'ta' ? 'குழுக்கள் ஏற்றப்படுகின்றன...' : 'Loading plant teams...'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>
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
                padding: '1.5rem',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.07)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                {/* Header: Team Name & Status Badge */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: team.active ? cfg.dot : '#94a3b8',
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.05em', color: cfg.dot }}>
                        {team.code} TEAM
                      </span>
                    </div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                      {team.name}
                    </h2>
                  </div>

                  <StatusBadge tone={team.active ? 'green' : 'grey'}>
                    {team.active ? (lang === 'ta' ? 'செயலில்' : 'Active') : (lang === 'ta' ? 'முடக்கப்பட்டது' : 'Inactive')}
                  </StatusBadge>
                </div>

                {/* KPI Metrics: Active Users & Waiting Tankers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', margin: '1rem 0', padding: '0.75rem', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                      {lang === 'ta' ? 'செயலில் உள்ள பயனர்கள்' : 'Active Operators'}
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0f172a', marginTop: '0.2rem' }}>
                      {team.active_user_count}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>
                      {lang === 'ta' ? 'காத்திருக்கும் டேங்கர்கள்' : 'Tankers Waiting'}
                    </div>
                    <div
                      style={{
                        fontSize: '1.4rem',
                        fontWeight: 700,
                        color: team.waiting_tankers_count > 0 ? '#ea580c' : '#059669',
                        marginTop: '0.2rem',
                      }}
                    >
                      {team.waiting_tankers_count}
                    </div>
                  </div>
                </div>

                {/* Owned Stages (Read-only list) */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.5rem' }}>
                    {lang === 'ta' ? 'குழுவின் கட்டாய பொறுப்புகள் (Stages):' : 'Owned Pipeline Stages:'}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {team.owned_stages.map((stKey) => (
                      <div
                        key={stKey}
                        style={{
                          fontSize: '0.82rem',
                          color: '#334155',
                          background: '#f1f5f9',
                          padding: '0.35rem 0.65rem',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>✓</span>
                        <span>{stageLabels[stKey] || stKey}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>
                    {team.description}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => navigate(`/admin/users?action=new&team=${team.code}`)}
                    style={{ fontSize: '0.84rem', padding: '0.5rem 0.75rem', justifyContent: 'center' }}
                  >
                    + {lang === 'ta' ? 'பயனர் சேர்' : 'Add User'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => navigate(`/admin/users?team=${team.code}`)}
                    style={{ fontSize: '0.84rem', padding: '0.5rem 0.75rem', justifyContent: 'center' }}
                  >
                    👁️ {lang === 'ta' ? 'பயனர்கள்' : 'View Users'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggleClick(team)}
                  className={team.active ? 'btn-secondary' : 'btn-primary'}
                  style={{
                    fontSize: '0.82rem',
                    padding: '0.45rem',
                    color: team.active ? '#dc2626' : undefined,
                    borderColor: team.active ? '#fca5a5' : undefined,
                    background: team.active ? '#fef2f2' : undefined,
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  {team.active
                    ? lang === 'ta' ? 'குழுவை முடக்கு (Deactivate)' : 'Deactivate Team'
                    : lang === 'ta' ? 'குழுவை செயல்படுத்து (Activate)' : 'Activate Team'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Confirmation Dialog for Toggle */}
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

      {/* Blocked Deactivation Modal */}
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
