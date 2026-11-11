import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import ZoneSelect from '../components/ZoneSelect';

interface Unit { id: string; name: string; unit_code: string; }

export default function RegisterProfile() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState<'admin' | 'unit'>('unit');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already has profile → redirect
  useEffect(() => {
    if (profile) navigate(profile.role === 'admin' ? '/admin' : '/unit');
  }, [profile, navigate]);

  // Load units when zone selected and role is unit
  useEffect(() => {
    if (!zoneId || role !== 'unit') { setUnits([]); setUnitId(''); return; }
    supabase
      .from('units')
      .select('id, name, unit_code')
      .eq('zone_id', zoneId)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setUnits(data ?? []));
  }, [zoneId, role]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!user) { setError('Not logged in'); return; }
    if (!zoneId) { setError('Select a zone'); return; }
    if (role === 'unit' && !unitId) { setError('Select a unit'); return; }
    setLoading(true);

    const { error: err } = await supabase.from('profiles').insert({
      id: user.id,
      role,
      zone_id: zoneId,
      unit_id: role === 'unit' ? unitId : null,
      full_name: fullName,
      phone,
    });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    await refreshProfile();
    navigate(role === 'admin' ? '/admin' : '/unit');
  };

  return (
    <div className="auth-container">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <div className="auth-brand">🥛 Aavin</div>
        <h1>Complete your profile</h1>
        <p className="auth-subtitle">Tell us about your role</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your name" required />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" />
          </div>
          <div className="form-group">
            <label>Role</label>
            <select value={role} onChange={e => setRole(e.target.value as 'admin' | 'unit')} required>
              <option value="unit">Unit (Village Collection Point)</option>
              <option value="admin">Admin (Zone Manager)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Zone</label>
            <ZoneSelect value={zoneId} onChange={e => setZoneId(e.target.value)} required />
          </div>
          {role === 'unit' && (
            <div className="form-group">
              <label>Unit</label>
              <select value={unitId} onChange={e => setUnitId(e.target.value)} required disabled={!zoneId || units.length === 0}>
                <option value="">{!zoneId ? 'Select zone first' : units.length === 0 ? 'No units in this zone yet' : 'Select unit…'}</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.unit_code})</option>)}
              </select>
            </div>
          )}
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Saving…' : 'Save & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
