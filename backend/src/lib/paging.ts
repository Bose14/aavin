/**
 * PostgREST silently caps every response at 1,000 rows (no error, no warning).
 * These helpers page through a query with .range() so list/report endpoints
 * never lose rows once the data grows past that cap.
 *
 * The query MUST have a deterministic order (end with a unique column such as
 * `id`), otherwise rows can repeat or go missing between pages.
 */

export const PAGE_SIZE = 1000;
export const MAX_ROWS = 200_000; // hard safety stop against runaway loops

interface PageResult<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
}

type RangeQuery<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

/** Fetch every row of a query by walking .range() windows. */
export async function fetchAllPages<T = Record<string, unknown>>(
  buildPage: RangeQuery<T>,
  pageSize: number = PAGE_SIZE,
): Promise<PageResult<T>> {
  const all: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}

/** Split a long id list into chunks so `.in()` filters stay under URL limits. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run a paged query once per id chunk and concatenate the results. */
export async function fetchAllByIds<T = Record<string, unknown>>(
  ids: string[],
  buildPage: (idChunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
  const all: T[] = [];
  for (const part of chunk(ids)) {
    const res = await fetchAllPages<T>((from, to) => buildPage(part, from, to));
    if (res.error) return { data: null, error: res.error };
    all.push(...(res.data ?? []));
  }
  return { data: all, error: null };
}
