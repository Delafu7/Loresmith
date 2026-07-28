// Every entity id is a UUID now (see the server's uuid-primary-keys
// migration). Route params arrive as plain strings; this is the shared
// format check used everywhere a page used to do
// `Number.isInteger(Number(params.x))` against a bigint id, mainly to gate
// a query's `enabled` flag until the param has actually loaded.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | undefined | null): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
