import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  role?: 'superadmin' | 'admin' | 'unit';
}

function roleHome(role: string) {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'admin') return '/admin';
  return '/unit';
}

export default function ProtectedRoute({ children, role }: Props) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return <Navigate to="/login" replace />;

  if (role && profile.role !== role) {
    return <Navigate to={roleHome(profile.role)} replace />;
  }

  return <>{children}</>;
}
