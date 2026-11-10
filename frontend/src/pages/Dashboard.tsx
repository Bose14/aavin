import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate('/login');
  }, [user, loading, navigate]);

  if (loading) return <div className="loading">Loading…</div>;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Dashboard</h1>
        <div className="user-info">
          <span>{user?.email}</span>
          <button onClick={signOut} className="btn-secondary">Sign out</button>
        </div>
      </header>
      <main>
        <p>Welcome! You are signed in.</p>
      </main>
    </div>
  );
}
