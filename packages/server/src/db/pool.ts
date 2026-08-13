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

// node-postgres's default parser for DATE (OID 1082) returns a JS Date,
// which JSON.stringify then serializes as a full ISO datetime (e.g.
// "2024-06-14T00:00:00.000Z") instead of the "YYYY-MM-DD" the column
// actually holds. Every DATE column in this schema (currently only
// sessions.played_at) round-trips through updateSessionLogSchema's
// z.string().date(), which requires the plain "YYYY-MM-DD" form, so
// leaving the default parser in place makes any PATCH that echoes back a
// previously-fetched played_at fail validation. Returning the raw text
// keeps it in the same format the client sent and the schema expects.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  // Errors on idle clients (e.g. connection dropped by the server) must be
  // handled here or they crash the process per node-postgres's docs.
  console.error('[db] Unexpected error on idle client', err);
});
