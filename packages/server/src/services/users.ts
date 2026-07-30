// Small shared user lookups — extracted out of services/campaigns.ts's
// addMember (which used to run this exact query inline) so
// services/campaignInvitations.ts's acceptInvitation doesn't have to
// duplicate it. No dedicated /users route exists (and none is added here) —
// this stays a server-internal helper, not a general user-search API.

import type { Pool, PoolClient } from 'pg';

export async function findUserByEmail(pool: Pool | PoolClient, email: string): Promise<{ id: string } | null> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  return result.rows[0] ?? null;
}
