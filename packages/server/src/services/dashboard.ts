// Aggregates the logged-in user's "home" view (Phase 3.6) — one call
// instead of the frontend fanning out per-campaign requests. Every query
// here is scoped by campaign_members membership (or direct ownership), so
// there's no separate authorization layer needed beyond requireAuth: a user
// can only ever see their own rows and rows from campaigns they belong to.

import type { Pool } from 'pg';
import { listCampaignsForUser } from './campaigns.js';

const RECENT_NOTES_LIMIT = 20;

export async function getUserDashboard(pool: Pool, userId: number) {
  const campaigns = await listCampaignsForUser(pool, userId);

  const charactersRes = await pool.query(
    `SELECT ch.*, camp.name AS campaign_name
     FROM characters ch
     JOIN campaigns camp ON camp.id = ch.campaign_id
     WHERE ch.owner_user_id = $1
     ORDER BY ch.name ASC`,
    [userId],
  );

  // Notes this user wrote themselves, across every campaign they belong to.
  const myNotesRes = await pool.query(
    `SELECT n.*, camp.name AS campaign_name
     FROM notes n
     JOIN campaigns camp ON camp.id = n.campaign_id
     WHERE n.author_user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, RECENT_NOTES_LIMIT],
  );

  // Recent notes from ANY author across this user's campaigns — every note
  // is visible to the whole campaign now (hide/reveal was removed).
  const campaignNotesRes = await pool.query(
    `SELECT n.*, camp.name AS campaign_name
     FROM notes n
     JOIN campaign_members cm ON cm.campaign_id = n.campaign_id AND cm.user_id = $1
     JOIN campaigns camp ON camp.id = n.campaign_id
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, RECENT_NOTES_LIMIT],
  );

  return {
    campaigns,
    characters: charactersRes.rows,
    myNotes: myNotesRes.rows,
    campaignNotes: campaignNotesRes.rows,
  };
}
