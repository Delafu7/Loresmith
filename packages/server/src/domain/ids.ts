// Every entity id is a UUID (Phase 1's "Adapt the App" — see the
// uuid-primary-keys migration). Route params/socket payloads arrive as
// plain strings; this is the one shared format check used everywhere a
// route or socket handler used to do `Number.isInteger(Number(x))` against
// a bigint id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
