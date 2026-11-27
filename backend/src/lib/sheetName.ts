/** Excel sheet name for a report period: "01-10" within one month, "2026-01-01 to 2026-12-31" across months. */
export function periodSheetName(from: string, to: string): string {
  return from.slice(0, 7) === to.slice(0, 7) ? `${from.slice(8, 10)}-${to.slice(8, 10)}` : `${from} to ${to}`;
}
