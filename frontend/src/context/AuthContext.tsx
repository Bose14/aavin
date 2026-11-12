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
  zones?: { name: string } | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, zone_id, unit_id, full_name, zones(name)')
      .eq('id', userId)
      .single();
    if (error) {
      if (error.code === 'PGRST116') setProfile(null);
      return;
    }
    if (!data) {
      setProfile(null);
      return;
    }
    const rawZones = (data as unknown as { zones?: { name: string } | { name: string }[] | null }).zones;
    const zones = Array.isArray(rawZones) ? (rawZones[0] ?? null) : (rawZones ?? null);
    setProfile({
      id: data.id,
      role: data.role as UserProfile['role'],
      zone_id: data.zone_id,
      unit_id: data.unit_id,
      full_name: data.full_name,
      zones,
    });
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    const initSession = async () => {
      const { data: { session: cachedSession } } = await supabase.auth.getSession();
      let activeSession = cachedSession;

      // Refresh expired initial sessions immediately rather than loading stale JWTs from storage
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
      if (activeSession?.user) await fetchProfile(activeSession.user.id);
      setLoading(false);
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event: unknown, session: Session | null) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) await fetchProfile(session.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
