import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LanguageContext';
import { listOfflineMilkEntries, syncOfflineMilkEntries } from '../lib/offlineQueue';
import type { TranslationKey } from '../i18n/translations';
import aavinLogo from '../assets/aavin-logo.png';

interface NavItem {
  to: string;
  labelKey?: TranslationKey;
  fallbackLabel: string;
  children?: NavItem[];
}

const adminNav: NavItem[] = [
  { to: '/admin/tanker', labelKey: 'navTankerRecords', fallbackLabel: 'Tanker Records' },
  { to: '/admin/reports', fallbackLabel: 'Reports' },
  { to: '/admin/tankers', labelKey: 'navTankers', fallbackLabel: 'Tankers' },
  {
    to: '/admin/bmcs', labelKey: 'navUnits', fallbackLabel: 'BMC',
    children: [
      { to: '/admin/bmcs', labelKey: 'navUnits', fallbackLabel: 'BMCs' },
      { to: '/admin/bmc-report', fallbackLabel: 'Detailed BMC Report' },
      { to: '/admin/bmc-receipts', fallbackLabel: 'BMC Receipts' },
      { to: '/admin/milk-ack', fallbackLabel: 'Milk Ack Report' },
      { to: '/admin/dmr-report', fallbackLabel: 'DMR Report' },
      { to: '/admin/bmc-dmr', fallbackLabel: 'BMC DMR Loss Report' },
    ],
  },
  { to: '/admin/users', labelKey: 'navTeamsAndUsers', fallbackLabel: 'Teams & Users' },
  { to: '/admin/rates', labelKey: 'navRateChart', fallbackLabel: 'Rate Chart' },
  { to: '/admin/analytics', labelKey: 'navAnalytics', fallbackLabel: 'Analytics' },
  { to: '/admin/settings', labelKey: 'navSettings', fallbackLabel: 'Settings' },
];

const unitNav: NavItem[] = [
  { to: '/bmc/tanker', labelKey: 'navTankerDispatch', fallbackLabel: 'Tanker Dispatch' },
  { to: '/bmc/milk-entry', labelKey: 'navMilkEntry', fallbackLabel: 'Milk Entry' },
  { to: '/bmc/analytics', labelKey: 'navAnalytics', fallbackLabel: 'Analytics' },
  { to: '/bmc/records', labelKey: 'navMyRecords', fallbackLabel: 'My Records' },
];

const gateNav: NavItem[] = [
  { to: '/gate', labelKey: 'navMilkReceiptEntry', fallbackLabel: 'Milk Receipt Entry' },
  { to: '/gate/gross-weight', labelKey: 'navGrossWeightEntry', fallbackLabel: 'Gross Weight Entry' },
  { to: '/gate/tare-weight', labelKey: 'navTareWeightEntry', fallbackLabel: 'Tare Weight Entry' },
  { to: '/gate/tanker-out', labelKey: 'navTankerOut', fallbackLabel: 'Tanker Out' },
  { to: '/gate/records', labelKey: 'navMyRecords', fallbackLabel: 'My Records' },
];

const qcNav: NavItem[] = [
  { to: '/qc', labelKey: 'navQcInspection', fallbackLabel: 'QC Inspection' },
  { to: '/qc/cip', labelKey: 'navCipSanitization', fallbackLabel: 'CIP Sanitization' },
  { to: '/qc/gate-pass', labelKey: 'navGatePass', fallbackLabel: 'Gate Pass' },
  { to: '/qc/records', labelKey: 'navMyRecords', fallbackLabel: 'My Records' },
];

const unloadingNav: NavItem[] = [
  { to: '/unloading', labelKey: 'navUnloadingQueue', fallbackLabel: 'Unloading Queue' },
  { to: '/unloading/records', labelKey: 'navMyRecords', fallbackLabel: 'My Records' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [pendingCount, setPendingCount] = useState(() => listOfflineMilkEntries().length);
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    const refreshQueue = () => setPendingCount(listOfflineMilkEntries().length);

    const handleOnline = async () => {
      setOnline(true);
      if (listOfflineMilkEntries().length > 0) {
        const res = await syncOfflineMilkEntries();
        refreshQueue();
        if (res.synced > 0) {
          setSyncMsg(`Synced ${res.synced} offline ${res.synced === 1 ? 'entry' : 'entries'}`);
          setTimeout(() => setSyncMsg(''), 5000);
        }
      }
    };

    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('aavin-offline-queue-changed', refreshQueue);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('aavin-offline-queue-changed', refreshQueue);
    };
  }, []);

  const userRole = (profile?.role || '').toLowerCase();
  const nav = userRole === 'admin' ? adminNav
    : userRole === 'gate' ? gateNav
    : userRole === 'qc' ? qcNav
    : userRole === 'unloading' ? unloadingNav
    : unitNav;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleManualSync = async () => {
    const res = await syncOfflineMilkEntries();
    setPendingCount(res.remaining);
    if (res.synced > 0) {
      setSyncMsg(`Synced ${res.synced} ${res.synced === 1 ? 'entry' : 'entries'}`);
      setTimeout(() => setSyncMsg(''), 4000);
    }
  };

  const unitLabel = profile?.bmcs ? `${profile.bmcs.name} · ${profile.bmcs.bmc_code}` : null;

  return (
    <div className="layout">
      <header className="mobile-topbar">
        <button
          type="button"
          className="mobile-menu-btn"
          aria-label="Open menu"
          onClick={() => setDrawerOpen(o => !o)}
        >
          ☰
        </button>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img
            src={aavinLogo}
            alt="Aavin"
            className="brand-logo"
            style={{ height: '30px', width: 'auto', objectFit: 'contain' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          {(!online || pendingCount > 0 || syncMsg) && (
            <span
              className={`status-pill ${!online || pendingCount > 0 ? 'amber' : 'green'}`}
              style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', cursor: online && pendingCount > 0 ? 'pointer' : 'default' }}
              onClick={online && pendingCount > 0 ? () => void handleManualSync() : undefined}
              title={online && pendingCount > 0 ? 'Click to sync queued offline entries' : !online ? 'Device is offline' : syncMsg}
            >
              {!online ? '⚡ Offline' : pendingCount > 0 ? `${pendingCount} queued` : '✓ Synced'}
            </span>
          )}
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={`lang-btn ${lang === 'ta' ? 'active' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
          </div>
        </div>
      </header>

      {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <img
              src={aavinLogo}
              alt="Aavin"
              className="brand-logo"
              style={{ height: '36px', width: 'auto', objectFit: 'contain' }}
            />
          </div>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={`lang-btn ${lang === 'ta' ? 'active' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map(item => {
            const label = item.labelKey ? t(item.labelKey) : item.fallbackLabel;
            if (!item.children) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  {label}
                </NavLink>
              );
            }
            const childActive = item.children.some(c => location.pathname === c.to);
            const open = openGroups[item.to] ?? childActive;
            return (
              <div key={item.to} className="nav-group">
                <button
                  type="button"
                  className={`nav-item nav-group-head ${childActive ? 'active-parent' : ''}`}
                  aria-expanded={open}
                  onClick={() => setOpenGroups(g => ({ ...g, [item.to]: !open }))}
                >
                  <span>{label}</span>
                  <span className={`nav-chevron ${open ? 'open' : ''}`} aria-hidden="true">⌃</span>
                </button>
                {open && (
                  <div className="nav-sub">
                    {item.children.map(c => (
                      <NavLink
                        key={c.to}
                        to={c.to}
                        end
                        onClick={() => setDrawerOpen(false)}
                        className={({ isActive }) => `nav-item nav-sub-item ${isActive ? 'active' : ''}`}
                      >
                        {c.labelKey ? t(c.labelKey) : c.fallbackLabel}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {(!online || pendingCount > 0 || syncMsg) && (
            <div style={{ marginBottom: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {!online && (
                <span className="status-pill amber">{t('offline')}</span>
              )}
              {pendingCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.35rem' }}>
                  <span className="status-pill amber">{pendingCount} queued</span>
                  {online && (
                    <button type="button" className="btn-link" onClick={handleManualSync}>
                      {t('syncNow')}
                    </button>
                  )}
                </div>
              )}
              {syncMsg && <span className="status-pill green">{syncMsg}</span>}
            </div>
          )}

          <div className="user-pill">
            <span className="user-name">{profile?.full_name ?? 'User'}</span>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.2rem' }}>
              <span className={`role-badge ${profile?.role}`}>{profile?.role}</span>
              {profile?.sub_role && (
                <span className="status-pill indigo" style={{ fontSize: '0.68rem', padding: '0.1rem 0.45rem' }}>
                  {profile.sub_role}
                </span>
              )}
            </div>
            {unitLabel && <span className="user-dairy-unit">{unitLabel}</span>}
            {profile?.dairy_units?.name && (
              <span className="user-dairy-unit">{profile.dairy_units.name} Dairy Unit</span>
            )}
          </div>
          <button onClick={handleSignOut} className="btn-signout">{t('signOut')}</button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
