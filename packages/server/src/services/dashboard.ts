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

  // Notes this user wrote themselves, across every campaign they belong to
  // — a player's own notes are always visible_to_players=true regardless of
  // role (services/notes.ts's createNote), so no visibility filter needed.
  const myNotesRes = await pool.query(
    `SELECT n.*, camp.name AS campaign_name
     FROM notes n
     JOIN campaigns camp ON camp.id = n.campaign_id
     WHERE n.author_user_id = $1
     ORDER BY n.created_at DESC
     LIMIT $2`,
    [userId, RECENT_NOTES_LIMIT],
  );

  // Recent notes from ANY author across this user's campaigns — same
  // per-campaign visibility rule as services/notes.ts's listNotes
  // (DM sees everything in campaigns they DM, players only see
  // visible_to_players=true), but evaluated per-row via the campaign_members
  // join since a user can be DM in one campaign and a player in another.
  const campaignNotesRes = await pool.query(
    `SELECT n.*, camp.name AS campaign_name
     FROM notes n
     JOIN campaign_members cm ON cm.campaign_id = n.campaign_id AND cm.user_id = $1
     JOIN campaigns camp ON camp.id = n.campaign_id
     WHERE cm.role = 'dm' OR n.visible_to_players = true
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
