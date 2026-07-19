// Shared Postgres error-code predicates. Every service that runs an INSERT/
// UPDATE that can hit a DB constraint (UNIQUE, CHECK) needs to translate the
// raw driver error into a clean AppError instead of letting a `{code:
// "23505", ...}` shape leak to the client — this was previously duplicated
// verbatim in services/encounters.ts, services/campaigns.ts, and
// services/characters.ts (flagged by the Phase 1 pre-merge review).
// Consolidated here so there is exactly one definition to keep in sync with
// Postgres's error-code table (https://www.postgresql.org/docs/current/errcodes-appendix.html).

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}
