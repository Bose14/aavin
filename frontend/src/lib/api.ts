import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { supabase } from '../supabase';

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _authRetried?: boolean;
}

const EXPIRY_BUFFER_MS = 60_000;
let refreshPromise: Promise<string | null> | null = null;

/** Returns true when a Supabase session is missing expires_at or expires within the safety buffer. */
export function isSessionExpiringSoon(expiresAt?: number, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return true;
  return expiresAt * 1000 - nowMs < EXPIRY_BUFFER_MS;
}

/** Extracts an API error message from Axios or standard Error instances. */
export function getApiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const serverMsg = (err.response?.data as { error?: unknown } | undefined)?.error;
    if (typeof serverMsg === 'string' && serverMsg.trim()) return serverMsg;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Coalesces concurrent session refreshes so parallel API calls share one refreshSession() request. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = supabase.auth
      .refreshSession()
      .then(({ data, error }) => (error || !data.session?.access_token ? null : data.session.access_token))
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/** Returns a fresh access token, proactively refreshing when the cached JWT is stale or expiring soon. */
export async function getValidAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  if (!isSessionExpiringSoon(session.expires_at)) return session.access_token;

  const refreshed = await refreshAccessToken();
  return refreshed ?? session.access_token;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL as string,
});

// Attach a fresh JWT to every request
api.interceptors.request.use(async (config) => {
  if (!config.headers.Authorization) {
    const token = await getValidAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// On 401, attempt one session refresh + retry; if refresh fails, clear dead local session
api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || !error.config) {
      return Promise.reject(error);
    }

    const originalConfig = error.config as RetryableRequestConfig;
    if (originalConfig._authRetried) {
      return Promise.reject(error);
    }
    originalConfig._authRetried = true;

    const prevAuth = typeof originalConfig.headers.Authorization === 'string'
      ? originalConfig.headers.Authorization
      : '';
    const prevToken = prevAuth.startsWith('Bearer ') ? prevAuth.slice(7) : '';

    const freshToken = await refreshAccessToken();
    if (!freshToken) {
      // Session is revoked or refresh token expired: clear local state so UI returns to /login
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return Promise.reject(error);
    }

    // Avoid infinite retry/sign-out loops if frontend and backend validate against different projects
    if (freshToken === prevToken) {
      return Promise.reject(error);
    }

    originalConfig.headers.Authorization = `Bearer ${freshToken}`;
    return api.request(originalConfig);
  },
);

export default api;
