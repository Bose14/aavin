import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LanguageContext';
import { listOfflineMilkEntries, syncOfflineMilkEntries } from '../lib/offlineQueue';
import type { TranslationKey } from '../i18n/translations';

interface NavItem {
  to: string;
  labelKey?: TranslationKey;
  fallbackLabel: string;
}

const superAdminNav: NavItem[] = [
  { to: '/superadmin', fallbackLabel: 'User Management' },
];

const adminNav: NavItem[] = [
  { to: '/admin', labelKey: 'navDashboard', fallbackLabel: 'Dashboard' },
  { to: '/admin/units', labelKey: 'navUnits', fallbackLabel: 'Units' },
  { to: '/admin/users', labelKey: 'navUsers', fallbackLabel: 'Users' },
  { to: '/admin/milk', labelKey: 'navMilkRecords', fallbackLabel: 'Milk Records' },
  { to: '/admin/tanker', labelKey: 'navTankerRecords', fallbackLabel: 'Tanker Records' },
  { to: '/admin/settings', labelKey: 'navSettings', fallbackLabel: 'Settings' },
];

const unitNav: NavItem[] = [
  { to: '/unit', labelKey: 'navDashboard', fallbackLabel: 'Dashboard' },
  { to: '/unit/milk-entry', labelKey: 'navMilkEntry', fallbackLabel: 'Milk Entry' },
  { to: '/unit/tanker', labelKey: 'navTankerDispatch', fallbackLabel: 'Tanker Dispatch' },
  { to: '/unit/records', labelKey: 'navMyRecords', fallbackLabel: 'My Records' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();

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

  const nav = profile?.role === 'superadmin' ? superAdminNav
    : profile?.role === 'admin' ? adminNav
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

  const unitLabel = profile?.units ? `${profile.units.name} · ${profile.units.unit_code}` : null;

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <span className="brand-logo">🥛</span>
          <span className="brand-name">{t('appName')}</span>
        </div>
        <div className="lang-toggle" role="group" aria-label="Language">
          <button type="button" className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
          <button type="button" className={`lang-btn ${lang === 'ta' ? 'active' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
        </div>
      </header>

      {drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="brand-logo">🥛</span>
            <span className="brand-name">{t('appName')}</span>
          </div>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={`lang-btn ${lang === 'ta' ? 'active' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
          </div>
        </div>

        <nav className="sidebar-nav">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={['/admin', '/unit', '/superadmin'].includes(item.to)}
              onClick={() => setDrawerOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.labelKey ? t(item.labelKey) : item.fallbackLabel}
            </NavLink>
          ))}
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
            {unitLabel && <span className="user-zone">{unitLabel}</span>}
            {profile?.zones?.name && (
              <span className="user-zone">{profile.zones.name} Zone</span>
            )}
          </div>
          <button onClick={handleSignOut} className="btn-signout">{t('signOut')}</button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
