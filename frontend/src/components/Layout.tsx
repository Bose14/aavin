import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { ReactNode } from 'react';

interface NavItem { to: string; label: string; }

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/admin/units', label: 'Units' },
  { to: '/admin/milk', label: 'Milk Records' },
  { to: '/admin/tanker', label: 'Tanker Records' },
];

const unitNav: NavItem[] = [
  { to: '/unit', label: 'Dashboard' },
  { to: '/unit/milk-entry', label: 'Milk Entry' },
  { to: '/unit/tanker', label: 'Tanker Dispatch' },
  { to: '/unit/records', label: 'My Records' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const nav = profile?.role === 'admin' ? adminNav : unitNav;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">🥛</span>
          <span className="brand-name">Aavin</span>
        </div>
        <nav className="sidebar-nav">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin' || item.to === '/unit'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-pill">
            <span className="user-name">{profile?.full_name ?? 'User'}</span>
            <span className={`role-badge ${profile?.role}`}>{profile?.role}</span>
          </div>
          <button onClick={handleSignOut} className="btn-signout">Sign out</button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
