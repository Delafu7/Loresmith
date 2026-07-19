// Shared pg connection pool. DATABASE_URL is loaded from the repo-root .env
// via `dotenv -e ../../.env` in the npm scripts (see package.json) — this
// module just reads it from process.env, it never loads dotenv itself.

import { Pool, types } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (expected to be loaded from the repo-root .env)');
}

// node-postgres returns BIGINT/BIGSERIAL (OID 20) columns as strings by
// default, since JS numbers can't safely represent the full 64-bit range.
// Every id column in this schema is BIGSERIAL, and none of them will ever
// approach Number.MAX_SAFE_INTEGER, so parse them as real numbers instead —
// otherwise `row.owner_user_id === actorId` (a JS number from req.user.id or
// Number(req.params.x)) silently fails even when the ids are logically
// equal, which previously broke real authorization/ownership checks (e.g.
// letting a DM remove themselves from their own campaign's membership,
// since the "don't remove the owning DM" guard never matched). This is a
// process-wide setting on the `pg` module, so it must run before any query.
types.setTypeParser(20, (value: string) => parseInt(value, 10));

export const pool = new Pool({ connectionString });

pool.on('error', (err) => {
  // Errors on idle clients (e.g. connection dropped by the server) must be
  // handled here or they crash the process per node-postgres's docs.
  console.error('[db] Unexpected error on idle client', err);
});
