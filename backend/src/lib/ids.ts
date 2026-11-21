/**
 * Public identifiers.
 *
 * Every table has `id` (1, 2, 3 ... used for joins) and `id_token`
 * (2 letters + "00" + 4 capitals + 3 digits, e.g. US00ASCF123).
 * URLs and forms use `id_token`; both forms are accepted wherever a record is looked up.
 */
export const ID_TOKEN_RE = /^[A-Z]{2}00[A-Z]{4}[0-9]{3}$/;

export function isIdToken(value: unknown): value is string {
  return typeof value === 'string' && ID_TOKEN_RE.test(value.trim().toUpperCase());
}

/** Returns the column and value to filter on for an id or an id_token, or null if neither. */
export function idLookup(value: unknown): { column: 'id' | 'id_token'; value: string } | null {
  const raw = String(value ?? '').trim();
  if (/^[0-9]+$/.test(raw)) return { column: 'id', value: raw };
  const token = raw.toUpperCase();
  if (ID_TOKEN_RE.test(token)) return { column: 'id_token', value: token };
  return null;
}
