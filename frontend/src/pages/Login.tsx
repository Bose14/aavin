import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import Captcha from '../components/Captcha';

export default function Login() {
  const navigate = useNavigate();
  const { profile, loading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaValid, setCaptchaValid] = useState(false);

  useEffect(() => {
    if (!authLoading && profile) {
      navigate(profile.role === 'superadmin' ? '/superadmin' : profile.role === 'admin' ? '/admin' : '/unit', { replace: true });
    }
  }, [profile, authLoading, navigate]);

  const handleVerify = useCallback((valid: boolean) => setCaptchaValid(valid), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!captchaValid) { setError('Please complete the captcha first'); return; }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-brand">🥛 Aavin Internal Portal</div>
        <h1>Welcome back</h1>
        <p className="auth-subtitle">Sign in with your credentials</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@aavin.gov.in" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <Captcha onVerify={handleVerify} />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading || !captchaValid} className="btn-primary">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
