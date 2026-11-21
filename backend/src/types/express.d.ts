import type { User } from '@supabase/supabase-js';

export type TeamCode = 'ADMIN' | 'GATE' | 'QC' | 'UNLOADING' | 'BMC';

/** Role used by the API, derived from the user's team. */
export type UserRole = 'admin' | 'gate' | 'qc' | 'unloading' | 'bmc';

export interface UserProfile {
  /** users.id (numeric, as a string) */
  id: string;
  /** Public identifier, e.g. US00ASCF123 */
  id_token: string;
  /** Supabase Auth user id (uuid) */
  auth_user_id: string;
  role: UserRole;
  team_id: string;
  team_code: TeamCode;
  dairy_unit_id: string;
  bmc_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  sub_role: string | null;
  is_active: boolean;
  must_change_password: boolean;
  shift: 'Morning' | 'Evening' | 'General' | null;
}

declare global {
  namespace Express {
    interface Request {
      user: User;
      profile: UserProfile;
    }
  }
}
