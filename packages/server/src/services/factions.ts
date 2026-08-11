// Factions (Phase 3 "locations and factions") — same shape/visibility as
// services/locations.ts's siblings; see that file's header comment.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireDm, type CampaignRole } from './authz.js';
import type { CreateFactionInput, UpdateFactionInput } from '../schemas/factions.js';

interface FactionRow {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listFactions(pool: Pool, campaignId: string) {
  const result = await pool.query<FactionRow>(`SELECT * FROM factions WHERE campaign_id = $1 ORDER BY name ASC`, [campaignId]);
  return result.rows;
}

async function fetchFactionScoped(pool: Pool, campaignId: string, factionId: string): Promise<FactionRow> {
  const result = await pool.query<FactionRow>(`SELECT * FROM factions WHERE id = $1 AND campaign_id = $2`, [factionId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Faction');
  return row;
}

export async function createFaction(pool: Pool, campaignId: string, role: CampaignRole, input: CreateFactionInput) {
  requireDm(role);
  const result = await pool.query<FactionRow>(
    `INSERT INTO factions (campaign_id, name, description, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [campaignId, input.name, input.description ?? null, input.notes ?? null],
  );
  return result.rows[0];
}

export async function updateFaction(
  pool: Pool,
  campaignId: string,
  factionId: string,
  role: CampaignRole,
  input: UpdateFactionInput,
) {
  requireDm(role);
  await fetchFactionScoped(pool, campaignId, factionId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); values.push(input.name); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); values.push(input.description); }
  if (input.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(input.notes); }
  if (sets.length === 0) return fetchFactionScoped(pool, campaignId, factionId);

  sets.push('updated_at = now()');
  values.push(factionId);
  const result = await pool.query<FactionRow>(`UPDATE factions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteFaction(pool: Pool, campaignId: string, factionId: string, role: CampaignRole): Promise<void> {
  requireDm(role);
  await fetchFactionScoped(pool, campaignId, factionId);
  await pool.query(`DELETE FROM factions WHERE id = $1`, [factionId]);
}
