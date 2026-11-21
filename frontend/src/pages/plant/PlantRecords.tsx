import { useEffect, useState, useMemo } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { TankerTimeline } from '../../components/TankerTimeline';
import { ErrorBanner } from '../../components/UiPrimitives';
import { formatDateDDMMYYYY, formatLitres, formatFatSnf } from '../../lib/format';

export default function PlantRecords() {
  const { profile } = useAuth();
  const { lang } = useTranslation();
  const [tankers, setTankers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);

  const teamCode = (profile?.role || '').toUpperCase();
  const teamTitle =
    teamCode === 'GATE'
      ? lang === 'ta' ? 'நுழைவாயில் பதிவுகள்' : 'Gate Operations Records'
      : teamCode === 'QC'
      ? lang === 'ta' ? 'QC ஆய்வகப் பதிவுகள்' : 'QC Laboratory Records'
      : teamCode === 'UNLOADING'
      ? lang === 'ta' ? 'இறக்குதல் பதிவுகள்' : 'Unloading Bay Records'
      : lang === 'ta' ? 'செயல்பாட்டுப் பதிவுகள்' : 'Plant Operations Records';

  const fetchRecords = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<any[]>('/tanker', {
        params: { status: 'all', from: filterDate || undefined, to: filterDate || undefined },
      });
      setTankers(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecords();
  }, [filterDate]);

  const filteredTankers = useMemo(() => {
    let list = tankers;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => {
        const tNo = String(t.tanker_number || '').toLowerCase();
        const dName = String(t.driver_name || '').toLowerCase();
        const uName = String(t.bmcs?.name || '').toLowerCase();
        const gp = String(t.gate_pass_no || t.exit_gate_pass_no || '').toLowerCase();
        return tNo.includes(q) || dName.includes(q) || uName.includes(q) || gp.includes(q);
      });
    }
    return list;
  }, [tankers, search]);

  return (
    <div className="page" style={{ padding: '1.5rem', maxWidth: 1400, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            {teamTitle}
          </h1>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchRecords} />}

      {/* Filter and Search Bar */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem', background: '#ffffff', borderRadius: 8 }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 240px' }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'ta' ? 'டேங்கர் எண், ஓட்டுநர், பாஸ் எண் தேடுக...' : 'Search tanker no., driver, gate pass...'}
              style={{ width: '100%', padding: '0.6rem 0.85rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
          </div>
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.85rem', color: '#475569', fontWeight: 500 }}>
              {lang === 'ta' ? 'தேதி:' : 'Date:'}
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              style={{ padding: '0.55rem 0.75rem', borderRadius: 6, border: '1px solid #cbd5e1' }}
            />
            {filterDate && (
              <button
                type="button"
                onClick={() => setFilterDate('')}
                className="btn-secondary btn-sm"
                style={{ padding: '0.55rem 0.85rem' }}
              >
                {lang === 'ta' ? 'அனைத்தும்' : 'Clear'}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={fetchRecords}
            className="btn-secondary btn-sm"
            style={{ padding: '0.55rem 1rem' }}
          >
            {lang === 'ta' ? 'புதுப்பி' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Table & Timeline */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTrip ? '1fr 380px' : '1fr', gap: '1.5rem' }}>
        <div className="card" style={{ background: '#ffffff', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>{lang === 'ta' ? 'தேதி' : 'Date'}</th>
                  <th style={{ padding: '0.75rem 1rem' }}>{lang === 'ta' ? 'டேங்கர் எண்' : 'Tanker / Unit'}</th>
                  <th style={{ padding: '0.75rem 1rem' }}>{lang === 'ta' ? 'அனுப்பப்பட்ட அளவு' : 'Dispatched'}</th>
                  <th style={{ padding: '0.75rem 1rem' }}>{lang === 'ta' ? 'நிலை' : 'Stage / Status'}</th>
                  <th style={{ padding: '0.75rem 1rem' }}>{lang === 'ta' ? 'குழு விவரங்கள்' : 'Team Details'}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                      {lang === 'ta' ? 'ஏற்றப்படுகிறது...' : 'Loading records...'}
                    </td>
                  </tr>
                ) : filteredTankers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
                      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🥛</div>
                      <strong>{lang === 'ta' ? 'பதிவுகள் எதுவும் இல்லை' : 'No records found'}</strong>
                      <p style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
                        {lang === 'ta' ? 'தேர்ந்தெடுக்கப்பட்ட வடிகட்டிகளுக்கு பதிவுகள் இல்லை' : 'No processed tankers matching current filter'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredTankers.map((t) => {
                    const isSelected = selectedTrip?.id === t.id;
                    const journey = t.journey;
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTrip(isSelected ? null : t)}
                        style={{
                          borderBottom: '1px solid #f1f5f9',
                          cursor: 'pointer',
                          background: isSelected ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600 }}>{formatDateDDMMYYYY(t.date)}</div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{t.dispatch_time || '—'}</div>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <strong style={{ color: '#0f172a' }}>{t.tanker_number}</strong>
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                            {t.bmcs?.name || 'Unit'} {t.bmcs?.bmc_code ? `(${t.bmcs.bmc_code})` : ''}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                          <div style={{ fontWeight: 600 }}>{formatLitres(t.quantity_dispatched)}</div>
                          <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                            Fat {formatFatSnf(t.dispatch_fat_pct, true)} · SNF {formatFatSnf(t.dispatch_snf_pct, true)}
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.6rem',
                              borderRadius: 999,
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              background: journey?.stageColor?.bg || '#f1f5f9',
                              color: journey?.stageColor?.text || '#334155',
                              border: `1px solid ${journey?.stageColor?.border || '#cbd5e1'}`,
                            }}
                          >
                            {journey?.tripStatusLabel || t.trip_status}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.82rem' }}>
                          {teamCode === 'GATE' && (
                            <div>
                              <div>Gross: {t.gross_weight_kg ? `${t.gross_weight_kg} kg` : '—'}</div>
                              <div>Tare: {t.tare_weight_kg ? `${t.tare_weight_kg} kg` : '—'}</div>
                            </div>
                          )}
                          {teamCode === 'QC' && (
                            <div>
                              <div>QC: {t.qc_status ? (t.qc_status === 'accepted' ? '✓ Accepted' : '✗ Rejected') : '—'}</div>
                              <div>CIP: {t.cip_status || '—'}</div>
                            </div>
                          )}
                          {teamCode === 'UNLOADING' && (
                            <div>
                              <div>Unloaded: {t.unloaded_litres ? formatLitres(t.unloaded_litres) : '—'}</div>
                              <div>Bay: {t.unloading_bay || '—'}</div>
                            </div>
                          )}
                          {!['GATE', 'QC', 'UNLOADING'].includes(teamCode) && (
                            <div>Waiting: {journey?.waitingTeamLabel || '—'}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side Timeline Drawer */}
        {selectedTrip && (
          <div className="card" style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', height: 'fit-content' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                  {selectedTrip.tanker_number}
                </h3>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  {selectedTrip.bmcs?.name} · {formatDateDDMMYYYY(selectedTrip.date)}
                </span>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setSelectedTrip(null)}
                style={{ padding: '0.25rem 0.5rem', minWidth: 'auto' }}
              >
                ✕
              </button>
            </div>

            <TankerTimeline
              journey={selectedTrip.journey}
              tankerNumber={selectedTrip.tanker_number}
              variant="compact"
            />
          </div>
        )}
      </div>
    </div>
  );
}
