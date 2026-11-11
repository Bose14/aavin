import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/** Trims whitespace and accidental surrounding quotes from env values. */
export function cleanEnvValue(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Extracts the Supabase API key role without verifying the signature. */
export function getSupabaseKeyRole(key: string): string | null {
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_secret_')) return 'service_role';

  const parts = key.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Returns a diagnostic message when the backend key lacks service_role admin privileges. */
export function detectServiceKeyIssue(key: string): string | null {
  const role = getSupabaseKeyRole(key);
  if (role === 'anon' || role === 'publishable') {
    return 'SUPABASE_SERVICE_ROLE_KEY is set to a public anon/publishable key instead of the service_role secret key';
  }
  if (role && role !== 'service_role') {
    return `SUPABASE_SERVICE_ROLE_KEY has role "${role}" instead of "service_role"`;
  }
  return null;
}

const supabaseUrl = cleanEnvValue(process.env.SUPABASE_URL);
const supabaseServiceKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || supabaseUrl.startsWith('your_')) {
  throw new Error('SUPABASE_URL is missing or placeholder in backend/.env');
}

if (!supabaseServiceKey || supabaseServiceKey.startsWith('your_')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing or placeholder in backend/.env');
}

export const serviceKeyIssue = detectServiceKeyIssue(supabaseServiceKey);
if (serviceKeyIssue) {
  console.error('[supabase] Misconfiguration:', serviceKeyIssue);
}

/** Builds a consistent actionable error message when the backend lacks a service_role key. */
export function buildServiceKeyError(detail: string | null = serviceKeyIssue): string {
  const reason = detail ?? 'SUPABASE_SERVICE_ROLE_KEY does not have admin (service_role) privileges';
  return `${reason}. Update SUPABASE_SERVICE_ROLE_KEY in Render/backend env with the service_role key and redeploy.`;
}

/** Maps Supabase admin auth errors (such as 403 not_admin) to actionable HTTP responses. */
export function formatAdminAuthError(
  err: { message: string; code?: string },
  keyIssue: string | null = serviceKeyIssue,
): { status: number; error: string } {
  if (err.code === 'not_admin' || err.message === 'User not allowed') {
    return {
      status: 500,
      error: buildServiceKeyError(keyIssue),
    };
  }
  return { status: 400, error: err.message };
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
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: serverAuthOptions,
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
