import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
  dairy_unit_id: string | null;
  bmc_id: string | null;
  full_name: string | null;
  email?: string | null;
  sub_role?: 'operator' | 'supervisor' | null;
  is_active?: boolean;
  must_change_password?: boolean;
  dairy_units?: { name: string } | null;
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

  // The profile is loaded once per signed-in user: startup and the auth listener both ask for it,
  // so concurrent requests share one call and an already-loaded user is not fetched again.
  const inflightRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const loadedForRef = useRef<string | null>(null);

  const loadProfile = (authUser: User, force = false): Promise<void> => {
    if (!force && loadedForRef.current === authUser.id) return Promise.resolve();
    if (inflightRef.current?.id === authUser.id) return inflightRef.current.promise;
    const promise = fetchProfile(authUser).then((ok) => {
      if (ok) loadedForRef.current = authUser.id;
    }).finally(() => {
      if (inflightRef.current?.promise === promise) inflightRef.current = null;
    });
    inflightRef.current = { id: authUser.id, promise };
    return promise;
  };

  const fetchProfile = async (authUser: User): Promise<boolean> => {
    const { data, error } = await supabase
      .from('users')
      .select(
        'id, id_token, dairy_unit_id, bmc_id, full_name, email, sub_role, is_active, must_change_password, ' +
          'teams(code, active), dairy_units(name), bmcs(id_token, name, bmc_code, is_active)',
      )
      .eq('auth_user_id', authUser.id)
      .maybeSingle();

    if (error || !data) {
      setProfile(null);
      return false;
    }

    const raw = data as unknown as Record<string, unknown>;
    const team = first(raw.teams as One<{ code: UserProfile['team_code']; active: boolean }>);
    const dairy_units = first(raw.dairy_units as One<{ name: string }>);
    const bmcs = first(raw.bmcs as One<NonNullable<UserProfile['bmcs']>>);

    const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
    const userActive = meta.is_active !== false && raw.is_active !== false;
    const bmcActive = !bmcs || bmcs.is_active !== false;
    const teamActive = !team || team.active !== false || team.code === 'ADMIN';

    if (!team || !userActive || !bmcActive || !teamActive) {
      setAuthError(
        !team
          ? 'Your account has no team assigned. Contact your dairy unit admin.'
          : !bmcActive
            ? 'Your BMC has been deactivated. Contact your dairy unit admin.'
            : !teamActive
              ? 'Your team has been deactivated. Contact your dairy unit admin.'
              : 'Your account has been deactivated. Contact your dairy unit admin.',
      );
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setUser(null);
      setSession(null);
      setProfile(null);
      return false;
    }

    const mustChange = meta.must_change_password === true || raw.must_change_password === true;
    const subRoleRaw = raw.sub_role as string | undefined;

    setAuthError('');
    setProfile({
      id: String(raw.id),
      id_token: String(raw.id_token),
      role: ROLE_BY_TEAM[team.code],
      team_code: team.code,
      dairy_unit_id: raw.dairy_unit_id != null ? String(raw.dairy_unit_id) : null,
      bmc_id: raw.bmc_id != null ? String(raw.bmc_id) : null,
      full_name: (raw.full_name as string | null) ?? null,
      email: (raw.email as string | null) ?? null,
      sub_role: subRoleRaw === 'supervisor' ? 'supervisor' : subRoleRaw === 'operator' ? 'operator' : null,
      is_active: true,
      must_change_password: mustChange,
      dairy_units,
      bmcs,
    });
    return true;
  };

  const refreshProfile = async () => {
    const { data: { user: latestUser } } = await supabase.auth.getUser();
    if (latestUser) {
      setUser(latestUser);
      await loadProfile(latestUser, true);
    } else if (user) {
      await loadProfile(user, true);
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
      if (activeSession?.user) await loadProfile(activeSession.user);
      setLoading(false);
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: string, nextSession: Session | null) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        // Token refreshes and the initial event do not change who the user is
        if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
        await loadProfile(nextSession.user, event === 'USER_UPDATED');
      } else {
        loadedForRef.current = null;
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    loadedForRef.current = null;
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
