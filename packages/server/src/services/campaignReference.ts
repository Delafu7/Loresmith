// Per-campaign DM reference notes (Iteration 4) — see the migration's
// header comment for why this is its own dedicated, always-GM-only table
// rather than a reuse of notes.ts or the removed hide/reveal engine.
// Campaign membership/role checks are the caller's responsibility
// (route-level requireCampaignMember/requireRole('dm')), same convention
// as services/campaignBestiary.ts.

import type { Pool } from 'pg';

export interface ReferenceNotes {
  body: string;
  updated_at: string | null;
}

export async function getReferenceNotes(pool: Pool, campaignId: string): Promise<ReferenceNotes> {
  const result = await pool.query<{ body: string; updated_at: string }>(
    `SELECT body, updated_at FROM campaign_reference_notes WHERE campaign_id = $1`,
    [campaignId],
  );
  // No row yet (nobody has saved anything for this campaign) is a normal,
  // empty starting state — not a 404.
  return result.rows[0] ?? { body: '', updated_at: null };
}

// Upsert-and-return in one round trip — same ON CONFLICT DO UPDATE ...
// RETURNING trick used elsewhere in this app for idempotent single-row
// writes (e.g. campaignCategories.ts's findOrCreateCategory).
export async function updateReferenceNotes(pool: Pool, campaignId: string, body: string): Promise<ReferenceNotes> {
  const result = await pool.query<{ body: string; updated_at: string }>(
    `INSERT INTO campaign_reference_notes (campaign_id, body)
     VALUES ($1, $2)
     ON CONFLICT (campaign_id) DO UPDATE SET body = $2, updated_at = now()
     RETURNING body, updated_at`,
    [campaignId, body],
  );
  return result.rows[0]!;
}
