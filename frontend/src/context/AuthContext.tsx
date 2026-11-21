import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export interface UserProfile {
  /** users.id */
  id: string;
  /** Public identifier, e.g. US00ASCF123 */
  id_token: string;
  /** Derived from the user's team */
  role: 'admin' | 'bmc' | 'gate' | 'qc' | 'unloading';
  team_code: 'ADMIN' | 'GATE' | 'QC' | 'UNLOADING' | 'BMC';
  zone_id: string | null;
  bmc_id: string | null;
  full_name: string | null;
  email?: string | null;
  sub_role?: 'operator' | 'supervisor' | null;
  is_active?: boolean;
  must_change_password?: boolean;
  zones?: { name: string } | null;
  bmcs?: { id_token: string; name: string; bmc_code: string; is_active?: boolean } | null;
}

const ROLE_BY_TEAM: Record<string, UserProfile['role']> = {
  ADMIN: 'admin',
  GATE: 'gate',
  QC: 'qc',
  UNLOADING: 'unloading',
  BMC: 'bmc',
};

type One<T> = T | T[] | null | undefined;
function first<T>(value: One<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
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
    const { data, error } = await supabase
      .from('users')
      .select(
        'id, id_token, zone_id, bmc_id, full_name, email, sub_role, is_active, must_change_password, ' +
          'teams(code, active), zones(name), bmcs(id_token, name, bmc_code, is_active)',
      )
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (error || !data) {
      setProfile(null);
      return;
    }

    const raw = data as unknown as Record<string, unknown>;
    const team = first(raw.teams as One<{ code: UserProfile['team_code']; active: boolean }>);
    const zones = first(raw.zones as One<{ name: string }>);
    const bmcs = first(raw.bmcs as One<NonNullable<UserProfile['bmcs']>>);

    const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const userActive = meta.is_active !== false && raw.is_active !== false;
    const bmcActive = !bmcs || bmcs.is_active !== false;
    const teamActive = !team || team.active !== false || team.code === 'ADMIN';

    if (!team || !userActive || !bmcActive || !teamActive) {
      setAuthError(
        !team
          ? 'Your account has no team assigned. Contact your zone admin.'
          : !bmcActive
            ? 'Your BMC has been deactivated. Contact your zone admin.'
            : !teamActive
              ? 'Your team has been deactivated. Contact your zone admin.'
              : 'Your account has been deactivated. Contact your zone admin.',
      );
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setUser(null);
      setSession(null);
      setProfile(null);
      return;
    }

    const mustChange = meta.must_change_password === true || raw.must_change_password === true;
    const subRoleRaw = raw.sub_role as string | undefined;

    setAuthError('');
    setProfile({
      id: String(raw.id),
      id_token: String(raw.id_token),
      role: ROLE_BY_TEAM[team.code],
      team_code: team.code,
      zone_id: raw.zone_id != null ? String(raw.zone_id) : null,
      bmc_id: raw.bmc_id != null ? String(raw.bmc_id) : null,
      full_name: (raw.full_name as string | null) ?? null,
      email: (raw.email as string | null) ?? null,
      sub_role: subRoleRaw === 'supervisor' ? 'supervisor' : subRoleRaw === 'operator' ? 'operator' : null,
      is_active: true,
      must_change_password: mustChange,
      zones,
      bmcs,
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
