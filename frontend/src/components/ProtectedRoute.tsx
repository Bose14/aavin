import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface Props {
  children: React.ReactNode;
  role?: 'admin' | 'unit';
}

export default function ProtectedRoute({ children, role }: Props) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  // If profile not set yet, redirect to complete registration
  if (!profile) return <Navigate to="/register-profile" replace />;

  // Role-based guard
  if (role && profile.role !== role) {
    return <Navigate to={profile.role === 'admin' ? '/admin' : '/unit'} replace />;
  }

  return <>{children}</>;
}
