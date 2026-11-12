import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

export default function ChangePassword() {
  const { profile, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (authErr) throw authErr;

      await api.post('/users/complete-password-change').catch(() => {});
      await refreshProfile();

      const home = profile?.role === 'superadmin' ? '/superadmin' : profile?.role === 'admin' ? '/admin' : '/unit';
      navigate(home, { replace: true });
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">🥛 Aavin Security Setup</div>
        <h1>Set your new password</h1>
        <p className="auth-subtitle">
          For account security, please replace your temporary password before continuing.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>New Password <span className="hint">(minimum 8 characters)</span></label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter a strong new password"
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your new password"
              required
              minLength={8}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Updating password…' : 'Update Password & Continue'}
          </button>
          <button
            type="button"
            className="btn-signout"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
