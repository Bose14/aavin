import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  role: 'superadmin' | 'admin' | 'unit' | 'gate' | 'qc' | 'unloading' | 'GATE' | 'QC' | 'UNLOADING';
  zone_id: string;
  unit_id: string | null;
  full_name: string | null;
  sub_role?: string | null;
  is_active?: boolean | null;
  team_id?: string | null;
  shift?: 'Morning' | 'Evening' | 'General' | null;
  username?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user: User;
      profile: UserProfile;
    }
  }
}
