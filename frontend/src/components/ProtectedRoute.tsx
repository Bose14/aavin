import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  role?: string | string[];
  allowPasswordChange?: boolean;
}

export function roleHome(role: string) {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'admin') return '/admin';
  if (role === 'gate') return '/gate';
  if (role === 'qc') return '/qc';
  if (role === 'unloading') return '/unloading';
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
    const allowed = Array.isArray(role) ? role.includes(profile.role) : profile.role === role;
    if (!allowed) {
      return <Navigate to={roleHome(profile.role)} replace />;
    }
  }

  return <>{children}</>;
}
