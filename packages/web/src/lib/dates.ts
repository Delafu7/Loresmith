/** Formats a created_at/updated_at ISO timestamp for display, e.g. "Jul 28, 2026". */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
