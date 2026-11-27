import api from './api';
import { queryClient } from './queryClient';

export const STALE = {
  /** Reference data that rarely changes (BMC list, settings). */
  reference: 5 * 60_000,
  /** Lists and dashboards. */
  list: 30_000,
} as const;

/**
 * Drop-in replacement for `api.get(url, { params })` that goes through the shared query cache.
 * Returns `{ data }` like axios so call sites barely change.
 */
export async function cachedGet<T>(
  url: string,
  params?: Record<string, unknown>,
  staleTime: number = STALE.list,
): Promise<{ data: T }> {
  const data = await queryClient.fetchQuery({
    queryKey: ['api', url, params ?? {}],
    queryFn: async () => (await api.get<T>(url, { params })).data,
    staleTime,
  });
  return { data };
}
