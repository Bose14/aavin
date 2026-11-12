import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export interface UserProfile {
  id: string;
  role: 'superadmin' | 'admin' | 'unit';
  zone_id: string | null;
  unit_id: string | null;
  full_name: string | null;
  sub_role?: 'operator' | 'supervisor' | null;
  is_active?: boolean;
  must_change_password?: boolean;
  zones?: { name: string } | null;
  units?: { name: string; unit_code: string; is_active?: boolean } | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string;
  clearAuthError: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const fetchProfile = async (authUser: User) => {
    // Try extended columns first; fall back cleanly if patch_v2_ux.sql hasn't been applied yet
    let { data, error } = await supabase
      .from('profiles')
      .select('id, role, zone_id, unit_id, full_name, sub_role, is_active, must_change_password, zones(name), units(name, unit_code, is_active)')
      .eq('id', authUser.id)
      .single();

    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('column'))) {
      const fb = await supabase
        .from('profiles')
        .select('id, role, zone_id, unit_id, full_name, zones(name), units(name, unit_code, is_active)')
        .eq('id', authUser.id)
        .single();
      data = fb.data as unknown as typeof data;
      error = fb.error;
    }

    if (error) {
      if (error.code === 'PGRST116') setProfile(null);
      return;
    }
    if (!data) {
      setProfile(null);
      return;
    }

    const raw = data as unknown as Record<string, unknown>;
    const rawZones = raw.zones as { name: string } | { name: string }[] | null | undefined;
    const zones = Array.isArray(rawZones) ? (rawZones[0] ?? null) : (rawZones ?? null);
    const rawUnits = raw.units as { name: string; unit_code: string; is_active?: boolean } | { name: string; unit_code: string; is_active?: boolean }[] | null | undefined;
    const units = Array.isArray(rawUnits) ? (rawUnits[0] ?? null) : (rawUnits ?? null);

    const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const userActive = meta.is_active !== false && raw.is_active !== false;
    const unitActive = !units || units.is_active !== false;

    if (!userActive || !unitActive) {
      setAuthError(
        !unitActive
          ? 'Your collection unit has been deactivated. Contact your zone admin.'
          : 'Your account has been deactivated. Contact your zone admin.',
      );
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setUser(null);
      setSession(null);
      setProfile(null);
      return;
    }

    const mustChange = meta.must_change_password === true || raw.must_change_password === true;
    const subRoleRaw = (raw.sub_role ?? meta.sub_role) as string | undefined;

    setAuthError('');
    setProfile({
      id: String(raw.id),
      role: raw.role as UserProfile['role'],
      zone_id: (raw.zone_id as string | null) ?? null,
      unit_id: (raw.unit_id as string | null) ?? null,
      full_name: (raw.full_name as string | null) ?? null,
      sub_role: subRoleRaw === 'supervisor' ? 'supervisor' : subRoleRaw === 'operator' ? 'operator' : null,
      is_active: true,
      must_change_password: mustChange,
      zones,
      units,
    });
  };

  const refreshProfile = async () => {
    const { data: { user: latestUser } } = await supabase.auth.getUser();
    if (latestUser) {
      setUser(latestUser);
      await fetchProfile(latestUser);
    } else if (user) {
      await fetchProfile(user);
    }
  };

  useEffect(() => {
    const initSession = async () => {
      const { data: { session: cachedSession } } = await supabase.auth.getSession();
      let activeSession = cachedSession;

      if (activeSession?.expires_at && activeSession.expires_at * 1000 <= Date.now()) {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          activeSession = null;
        } else {
          activeSession = data.session;
        }
      }

      setSession(activeSession);
      setUser(activeSession?.user ?? null);
      if (activeSession?.user) await fetchProfile(activeSession.user);
      setLoading(false);
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event: unknown, nextSession: Session | null) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) await fetchProfile(nextSession.user);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        authError,
        clearAuthError: () => setAuthError(''),
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
