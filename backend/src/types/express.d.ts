import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  role: 'superadmin' | 'admin' | 'unit';
  zone_id: string;
  unit_id: string | null;
  full_name: string | null;
  sub_role?: string | null;
  is_active?: boolean | null;
}

declare global {
  namespace Express {
    interface Request {
      user: User;
      profile: UserProfile;
    }
  }
}
