import { QueryClient } from '@tanstack/react-query';

/**
 * One shared TanStack Query cache for the whole app.
 *  - reads through cachedGet() are de-duplicated and reused while fresh;
 *  - any successful write (see api.ts) clears the cache, so a screen never shows data older than the user's own change;
 *  - the cache is cleared on sign-out so one user's data can never appear for the next.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
