import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || supabaseUrl.startsWith('your_')) {
  throw new Error('SUPABASE_URL is missing or placeholder in backend/.env');
}

if (!supabaseServiceKey || supabaseServiceKey.startsWith('your_')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or placeholder in backend/.env');
}

const serverAuthOptions = {
  autoRefreshToken: false,
  persistSession: false,
  detectSessionInUrl: false,
};

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: serverAuthOptions,
});

/**
 * Creates a per-request Supabase client scoped to the caller's JWT so RLS
 * policies using auth.uid() still work as a fallback.
 */
export function createUserScopedClient(accessToken: string) {
  return createClient(supabaseUrl!, supabaseServiceKey!, {
    auth: serverAuthOptions,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
