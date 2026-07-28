// Shared pg connection pool. DATABASE_URL is loaded from the repo-root .env
// via `dotenv -e ../../.env` in the npm scripts (see package.json) — this
// module just reads it from process.env, it never loads dotenv itself.

import { Pool, types } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (expected to be loaded from the repo-root .env)');
}

// node-postgres returns BIGINT (OID 20) columns as strings by default, since
// JS numbers can't safely represent the full 64-bit range. Every id column
// in this schema used to be BIGSERIAL — it's UUID now (see the
// uuid-primary-keys migration), compared as plain strings with no parser
// needed. This setting only matters anymore for the two remaining kinds of
// real bigint values: the dormant `*_legacy` columns that migration kept
// around for recovery (never read by application code), and COUNT(*)
// aggregates (Postgres always returns those as bigint regardless of the
// counted column's type) — parsing those as real numbers instead of strings
// keeps arithmetic on them (`count + 1`, etc.) working without an explicit
// Number() at every call site. This is a process-wide setting on the `pg`
// module, so it must run before any query.
types.setTypeParser(20, (value: string) => parseInt(value, 10));

export const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  // Errors on idle clients (e.g. connection dropped by the server) must be
  // handled here or they crash the process per node-postgres's docs.
  console.error('[db] Unexpected error on idle client', err);
});
