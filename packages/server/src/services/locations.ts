// Locations (Phase 3 "locations and factions") — DM-authored world reference
// data, DM-only to write. Hide/reveal (services/visibility.ts's 'role_split'
// mode, same shape as campaign_assets.visible_to_players): a player's list
// response omits a hidden location entirely — filtered in SQL, never a
// post-fetch JS pass, matching this codebase's existing "list-endpoint
// filtering belongs in the query" convention (see assets.ts's listAssets,
// notes.ts's listNotes).

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireDm, type CampaignRole } from './authz.js';
import type { CreateLocationInput, UpdateLocationInput } from '../schemas/locations.js';

interface LocationRow {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  visible_to_players: boolean;
  created_at: string;
  updated_at: string;
}

export async function listLocations(pool: Pool, campaignId: string, role: CampaignRole) {
  const values: unknown[] = [campaignId];
  let where = 'campaign_id = $1';
  if (role !== 'dm') where += ' AND visible_to_players = true';

  const result = await pool.query<LocationRow>(`SELECT * FROM locations WHERE ${where} ORDER BY name ASC`, values);
  return result.rows;
}

async function fetchLocationScoped(pool: Pool, campaignId: string, locationId: string): Promise<LocationRow> {
  const result = await pool.query<LocationRow>(`SELECT * FROM locations WHERE id = $1 AND campaign_id = $2`, [locationId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Location');
  return row;
}

export async function createLocation(pool: Pool, campaignId: string, role: CampaignRole, input: CreateLocationInput) {
  requireDm(role);
  const result = await pool.query<LocationRow>(
    `INSERT INTO locations (campaign_id, name, description, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [campaignId, input.name, input.description ?? null, input.notes ?? null],
  );
  return result.rows[0];
}

export async function updateLocation(
  pool: Pool,
  campaignId: string,
  locationId: string,
  role: CampaignRole,
  input: UpdateLocationInput,
) {
  requireDm(role);
  await fetchLocationScoped(pool, campaignId, locationId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); values.push(input.name); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); values.push(input.description); }
  if (input.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(input.notes); }
  if (input.visibleToPlayers !== undefined) { sets.push(`visible_to_players = $${i++}`); values.push(input.visibleToPlayers); }
  if (sets.length === 0) return fetchLocationScoped(pool, campaignId, locationId);

  sets.push('updated_at = now()');
  values.push(locationId);
  const result = await pool.query<LocationRow>(`UPDATE locations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteLocation(pool: Pool, campaignId: string, locationId: string, role: CampaignRole): Promise<void> {
  requireDm(role);
  await fetchLocationScoped(pool, campaignId, locationId);
  await pool.query(`DELETE FROM locations WHERE id = $1`, [locationId]);
}
