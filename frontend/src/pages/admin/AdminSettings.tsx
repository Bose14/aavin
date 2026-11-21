import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../../supabase';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from '../../context/LanguageContext';
import { ErrorBanner, StatusBadge } from '../../components/UiPrimitives';

export default function AdminSettings() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { lang, setLang } = useTranslation();

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Profile details state
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    }
  }, [profile?.full_name]);

  // Handle password change
  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 8) {
      setPasswordError(
        lang === 'ta'
          ? 'கடவுச்சொல் குறைந்தபட்சம் 8 எழுத்துக்கள் இருக்க வேண்டும்.'
          : 'New password must be at least 8 characters long.'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(
        lang === 'ta' ? 'கடவுச்சொற்கள் பொருந்தவில்லை.' : 'Passwords do not match. Please verify.'
      );
      return;
    }

    setUpdatingPassword(true);
    try {
      const { error: authErr } = await supabase.auth.updateUser({
        password: newPassword,
        data: { must_change_password: false },
      });
      if (authErr) throw authErr;

      await api.post('/users/complete-password-change').catch(() => {});
      await refreshProfile();

      setPasswordSuccess(
        lang === 'ta'
          ? 'உங்கள் கடவுச்சொல் வெற்றிகரமாக மாற்றப்பட்டது!'
          : 'Your account password has been updated successfully!'
      );
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordError((err as Error)?.message || 'Failed to update password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  // Handle profile name update
  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile?.id || !fullName.trim()) return;
    setProfileError('');
    setProfileSuccess('');
    setUpdatingProfile(true);

    try {
      await api.patch('/users/me/profile', { full_name: fullName.trim() });

      await refreshProfile();
      setProfileSuccess(
        lang === 'ta'
          ? 'சுயவிவரப் பெயர் வெற்றிகரமாக புதுப்பிக்கப்பட்டது!'
          : 'Profile name updated successfully!'
      );
    } catch (err: unknown) {
      setProfileError((err as Error)?.message || 'Failed to update profile name');
    } finally {
      setUpdatingProfile(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: '880px', margin: '0 auto' }}>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: '#0f172a' }}>
            {lang === 'ta' ? 'அமைப்புகள் (Settings)' : 'Settings'}
          </h1>
        </div>
      </div>

      {/* 1. PASSWORD & SECURITY */}
      <div
        className="card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px' }}>🔒</span>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
            {lang === 'ta' ? 'கடவுச்சொல் மாற்றம் (Change Password)' : 'Change Password'}
          </h2>
        </div>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
          {lang === 'ta'
            ? 'உங்கள் கணக்கின் பாதுகாப்பிற்காக புதிய கடவுச்சொல்லை உள்ளிடவும்'
            : 'Update your login password to keep your Aavin administration account secure'}
        </p>

        {passwordError && (
          <div style={{ marginBottom: '16px' }}>
            <ErrorBanner message={passwordError} />
          </div>
        )}

        {passwordSuccess && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              color: '#166534',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>✅</span>
            <span>{passwordSuccess}</span>
          </div>
        )}

        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'புதிய கடவுச்சொல் *' : 'New Password *'}{' '}
                <span style={{ fontWeight: 400, color: '#64748b', fontSize: '12px' }}>(min. 8 characters)</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={lang === 'ta' ? 'புதிய கடவுச்சொல்லை உள்ளிடவும்' : 'Enter new password'}
                  required
                  minLength={8}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 40px 0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '4px',
                    color: '#64748b',
                  }}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'கடவுச்சொல்லை உறுதிப்படுத்தவும் *' : 'Confirm New Password *'}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={lang === 'ta' ? 'கடவுச்சொல்லை மீண்டும் உள்ளிடவும்' : 'Re-enter new password'}
                  required
                  minLength={8}
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 40px 0 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Validation Checklist Pills */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px', fontSize: '12px' }}>
            <span style={{ color: newPassword.length >= 8 ? '#16a34a' : '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
              {newPassword.length >= 8 ? '✓' : '○'} At least 8 characters
            </span>
            <span
              style={{
                color: newPassword && confirmPassword && newPassword === confirmPassword ? '#16a34a' : '#94a3b8',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {newPassword && confirmPassword && newPassword === confirmPassword ? '✓' : '○'} Passwords match
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="submit"
              disabled={updatingPassword || newPassword.length < 8 || newPassword !== confirmPassword}
              className="btn btn-primary"
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                width: 'auto',
              }}
            >
              {updatingPassword
                ? lang === 'ta'
                  ? 'புதுப்பிக்கப்படுகிறது…'
                  : 'Updating Password…'
                : lang === 'ta'
                ? 'கடவுச்சொல்லைப் புதுப்பி'
                : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      {/* 2. PROFILE & ACCOUNT DETAILS */}
      <div
        className="card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px' }}>👤</span>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
            {lang === 'ta' ? 'கணக்கு மற்றும் சுயவிவர விவரங்கள்' : 'Account & Profile Information'}
          </h2>
        </div>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
          {lang === 'ta'
            ? 'உங்கள் கணக்கு விவரங்கள் மற்றும் நிர்வாக பாத்திரத் தகவல்கள்'
            : 'Your user profile information and administrative privileges'}
        </p>

        {profileError && (
          <div style={{ marginBottom: '16px' }}>
            <ErrorBanner message={profileError} />
          </div>
        )}

        {profileSuccess && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              color: '#166534',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>✅</span>
            <span>{profileSuccess}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'முழு பெயர் *' : 'Full Name *'}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
                required
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'மின்னஞ்சல் முகவரி' : 'Email Address'}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="email"
                  value={user?.email || 'admin@aavin.gov.in'}
                  disabled
                  style={{
                    width: '100%',
                    height: '40px',
                    padding: '0 12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    color: '#64748b',
                    fontSize: '14px',
                  }}
                />
                <StatusBadge tone="green">Verified</StatusBadge>
              </div>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'அணுகல் பங்கு' : 'Access Role'}
              </label>
              <input
                type="text"
                value={profile?.role ? profile.role.toUpperCase() + ' (Plant Administrator)' : 'ADMIN'}
                disabled
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#0369a1',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                {lang === 'ta' ? 'ஒன்றியம் / பால் பண்ணை' : 'Milk Producers Union / Dairy'}
              </label>
              <input
                type="text"
                value={profile?.zones?.name || 'Namakkal District Co-op Milk Producers Union'}
                disabled
                style={{
                  width: '100%',
                  height: '40px',
                  padding: '0 12px',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  backgroundColor: '#f8fafc',
                  color: '#475569',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="submit"
              disabled={updatingProfile || !fullName.trim()}
              className="btn btn-secondary"
              style={{
                height: '40px',
                padding: '0 20px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                width: 'auto',
              }}
            >
              {updatingProfile ? 'Saving…' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. APPLICATION & LANGUAGE PREFERENCES */}
      <div
        className="card"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          padding: '24px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '20px' }}>🌐</span>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
            {lang === 'ta' ? 'கணினி விருப்பத்தேர்வுகள்' : 'System & Language Preferences'}
          </h2>
        </div>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
          {lang === 'ta'
            ? 'போர்ட்டல் இடைமுக மொழி மற்றும் விருப்பங்களை தேர்வு செய்யவும்'
            : 'Choose your preferred display language for the Aavin portal'}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
            {lang === 'ta' ? 'இடைமுக மொழி:' : 'Portal Language:'}
          </span>
          <button
            type="button"
            className={lang === 'en' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setLang('en')}
            style={{ height: '36px', padding: '0 16px', borderRadius: '6px', fontSize: '13px', width: 'auto' }}
          >
            🇬🇧 English
          </button>
          <button
            type="button"
            className={lang === 'ta' ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setLang('ta')}
            style={{ height: '36px', padding: '0 16px', borderRadius: '6px', fontSize: '13px', width: 'auto' }}
          >
            🇮🇳 தமிழ் (Tamil)
          </button>
        </div>

        <div
          style={{
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
              Aavin Integrated Dairy Management System (IDMS)
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Namakkal Dairy Plant Edition · Current Session: {user?.email || 'admin'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="btn btn-secondary"
            style={{
              height: '34px',
              padding: '0 14px',
              color: '#dc2626',
              borderColor: '#fca5a5',
              background: '#fef2f2',
              fontSize: '12px',
              fontWeight: 600,
              width: 'auto',
            }}
          >
            ⏻ Sign Out of Session
          </button>
        </div>
      </div>
    </div>
  );
}
