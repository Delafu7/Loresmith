// Campaign calendar (Phase 3) — a DM-entered, manual timeline of in-world
// events anchored to in_game_day (see the migration's own comment for why
// that's an int, not free text). DM-only write, all-member read, no
// redaction — same baseline as locations/plot_threads' own content.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireDm, type CampaignRole } from './authz.js';
import type { CreateCampaignEventInput, UpdateCampaignEventInput } from '../schemas/campaignEvents.js';

interface CampaignEventRow {
  id: string;
  campaign_id: string;
  in_game_day: number;
  title: string;
  description: string | null;
  created_at: string;
}

export async function listCampaignEvents(pool: Pool, campaignId: string) {
  const result = await pool.query<CampaignEventRow>(
    `SELECT * FROM campaign_events WHERE campaign_id = $1 ORDER BY in_game_day ASC, created_at ASC`,
    [campaignId],
  );
  return result.rows;
}

async function fetchEventScoped(pool: Pool, campaignId: string, eventId: string): Promise<CampaignEventRow> {
  const result = await pool.query<CampaignEventRow>(
    `SELECT * FROM campaign_events WHERE id = $1 AND campaign_id = $2`,
    [eventId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Campaign event');
  return row;
}

export async function createCampaignEvent(pool: Pool, campaignId: string, role: CampaignRole, input: CreateCampaignEventInput) {
  requireDm(role);
  const result = await pool.query<CampaignEventRow>(
    `INSERT INTO campaign_events (campaign_id, in_game_day, title, description) VALUES ($1,$2,$3,$4) RETURNING *`,
    [campaignId, input.inGameDay, input.title, input.description ?? null],
  );
  return result.rows[0];
}

export async function updateCampaignEvent(
  pool: Pool,
  campaignId: string,
  eventId: string,
  role: CampaignRole,
  input: UpdateCampaignEventInput,
) {
  requireDm(role);
  await fetchEventScoped(pool, campaignId, eventId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.inGameDay !== undefined) { sets.push(`in_game_day = $${i++}`); values.push(input.inGameDay); }
  if (input.title !== undefined) { sets.push(`title = $${i++}`); values.push(input.title); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); values.push(input.description); }
  if (sets.length === 0) return fetchEventScoped(pool, campaignId, eventId);

  values.push(eventId);
  const result = await pool.query<CampaignEventRow>(`UPDATE campaign_events SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteCampaignEvent(pool: Pool, campaignId: string, eventId: string, role: CampaignRole): Promise<void> {
  requireDm(role);
  await fetchEventScoped(pool, campaignId, eventId);
  await pool.query(`DELETE FROM campaign_events WHERE id = $1`, [eventId]);
}
