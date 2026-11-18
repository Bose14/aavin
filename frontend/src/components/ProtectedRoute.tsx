import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  role?: string | string[];
  allowPasswordChange?: boolean;
}

export function roleHome(role: string) {
  const r = (role || '').toLowerCase();
  if (r === 'superadmin') return '/superadmin';
  if (r === 'admin') return '/admin/tanker';
  if (r === 'gate') return '/gate';
  if (r === 'qc') return '/qc';
  if (r === 'unloading') return '/unloading';
  return '/unit';
}

export default function ProtectedRoute({ children, role, allowPasswordChange = false }: Props) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/login" replace />;

  if (profile.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  if (role) {
    const userRole = (profile.role || '').toLowerCase();
    const allowedRoles = Array.isArray(role)
      ? role.map((x) => x.toLowerCase())
      : [role.toLowerCase()];
    if (!allowedRoles.includes(userRole)) {
      return <Navigate to={roleHome(profile.role)} replace />;
    }
  }

  return <>{children}</>;
}
