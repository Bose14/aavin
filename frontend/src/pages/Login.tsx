import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LanguageContext';
import Captcha from '../components/Captcha';

export default function Login() {
  const navigate = useNavigate();
  const { profile, loading: authLoading, authError, clearAuthError } = useAuth();
  const { lang, setLang } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaValid, setCaptchaValid] = useState(false);

  useEffect(() => {
    if (!authLoading && profile) {
      if (profile.must_change_password) {
        navigate('/change-password', { replace: true });
        return;
      }
      navigate(profile.role === 'superadmin' ? '/superadmin' : profile.role === 'admin' ? '/admin' : '/unit', { replace: true });
    }
  }, [profile, authLoading, navigate]);

  const handleVerify = useCallback((valid: boolean) => setCaptchaValid(valid), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!captchaValid) { setError('Please complete the captcha first'); return; }
    clearAuthError();
    setError('');
    setLoading(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) setError(signInErr.message);
    setLoading(false);
  };

  const displayError = error || authError;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div className="auth-brand" style={{ marginBottom: 0 }}>🥛 Aavin Internal Portal</div>
          <div className="lang-toggle" role="group" aria-label="Language">
            <button type="button" className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={`lang-btn ${lang === 'ta' ? 'active' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
          </div>
        </div>
        <h1>{lang === 'ta' ? 'நல்வரவு' : 'Welcome back'}</h1>
        <p className="auth-subtitle">
          {lang === 'ta' ? 'உங்கள் கணக்கு விவரங்களுடன் உள்நுழையவும்' : 'Sign in with your credentials'}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>{lang === 'ta' ? 'மின்னஞ்சல் (Email)' : 'Email'}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@aavin.gov.in" required />
          </div>
          <div className="form-group">
            <label>{lang === 'ta' ? 'கடவுச்சொல் (Password)' : 'Password'}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <Captcha onVerify={handleVerify} />
          {displayError && <p className="auth-error">{displayError}</p>}
          <button type="submit" disabled={loading || !captchaValid} className="btn-primary">
            {loading ? (lang === 'ta' ? 'உள்நுழைகிறது…' : 'Signing in…') : (lang === 'ta' ? 'உள்நுழை' : 'Sign in')}
          </button>
        </form>
      </div>
    </div>
  );
}
