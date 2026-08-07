// Campaign-scoped map library (1784269788666_create-campaign-maps-library.ts)
// — CRUD over `maps`, plus the N:M link/activate actions used by an
// encounter's live view. See services/encounters.ts's getEncounterMap /
// upsertEncounterMap for the "encounter's currently active map" read/write
// path this library sits alongside (that inline path stays unchanged).

import type { Pool, PoolClient } from 'pg';
import { notFound } from '../middleware/errors.js';
import { getEncounterMap, type EncounterMapRow } from './encounters.js';
import type { CreateMapInput, UpdateMapInput } from '../schemas/maps.js';

export interface MapRow {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  background_asset_id: string | null;
  grid_columns: number;
  grid_rows: number;
  cell_size_px: number;
  feet_per_cell: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Cross-campaign consistency check, service-layer not a DB constraint — same
// "app-layer, not declarative" precedent as
// services/encounters.ts's validateBackgroundAssetBelongsToCampaign (which
// this duplicates rather than imports, matching that function's own
// comment about services/monsterCatalog.ts/services/assets.ts doing the same).
async function validateBackgroundAssetBelongsToCampaign(
  client: Pool | PoolClient,
  campaignId: string,
  backgroundAssetId: string | null | undefined,
): Promise<void> {
  if (backgroundAssetId === null || backgroundAssetId === undefined) return;
  const result = await client.query<{ campaign_id: string }>(
    `SELECT campaign_id FROM campaign_assets WHERE id = $1`,
    [backgroundAssetId],
  );
  const row = result.rows[0];
  if (!row || row.campaign_id !== campaignId) {
    throw notFound('Asset');
  }
}

export async function listMaps(pool: Pool, campaignId: string): Promise<MapRow[]> {
  const result = await pool.query<MapRow>(`SELECT * FROM maps WHERE campaign_id = $1 ORDER BY name`, [campaignId]);
  return result.rows;
}

export async function getMap(pool: Pool, campaignId: string, mapId: string): Promise<MapRow> {
  const result = await pool.query<MapRow>(`SELECT * FROM maps WHERE id = $1 AND campaign_id = $2`, [mapId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Map');
  return row;
}

export async function createMap(pool: Pool, campaignId: string, input: CreateMapInput): Promise<MapRow> {
  await validateBackgroundAssetBelongsToCampaign(pool, campaignId, input.backgroundAssetId);
  const result = await pool.query<MapRow>(
    `INSERT INTO maps (campaign_id, name, description, background_asset_id, grid_columns, grid_rows, cell_size_px, feet_per_cell, notes)
     VALUES ($1, $2, $3, $4, COALESCE($5, 20), COALESCE($6, 20), COALESCE($7, 50), COALESCE($8, 5), $9)
     RETURNING *`,
    [
      campaignId,
      input.name,
      input.description ?? null,
      input.backgroundAssetId ?? null,
      input.gridColumns ?? null,
      input.gridRows ?? null,
      input.cellSizePx ?? null,
      input.feetPerCell ?? null,
      input.notes ?? null,
    ],
  );
  return result.rows[0]!;
}

// Only fields actually supplied are overwritten — COALESCE(new, existing)
// for plain values, an explicit "was this key present in the body" flag for
// nullable ones (description/backgroundAssetId/notes), same partial-update
// discipline as services/encounters.ts's upsertEncounterMap.
export async function updateMap(pool: Pool, campaignId: string, mapId: string, input: UpdateMapInput): Promise<MapRow> {
  await getMap(pool, campaignId, mapId);
  if (input.backgroundAssetId !== undefined) {
    await validateBackgroundAssetBelongsToCampaign(pool, campaignId, input.backgroundAssetId);
  }
  const result = await pool.query<MapRow>(
    `UPDATE maps SET
       name = COALESCE($3, name),
       description = CASE WHEN $4 THEN $5 ELSE description END,
       background_asset_id = CASE WHEN $6 THEN $7 ELSE background_asset_id END,
       grid_columns = COALESCE($8, grid_columns),
       grid_rows = COALESCE($9, grid_rows),
       cell_size_px = COALESCE($10, cell_size_px),
       feet_per_cell = COALESCE($11, feet_per_cell),
       notes = CASE WHEN $12 THEN $13 ELSE notes END,
       updated_at = now()
     WHERE id = $1 AND campaign_id = $2
     RETURNING *`,
    [
      mapId,
      campaignId,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.backgroundAssetId !== undefined,
      input.backgroundAssetId ?? null,
      input.gridColumns ?? null,
      input.gridRows ?? null,
      input.cellSizePx ?? null,
      input.feetPerCell ?? null,
      input.notes !== undefined,
      input.notes ?? null,
    ],
  );
  return result.rows[0]!;
}

export interface DeleteMapAffectedEncounter {
  encounter_id: string;
  campaign_id: string;
}

// M5 fix: ON DELETE CASCADE (encounter_maps_link) / ON DELETE SET NULL
// (encounters.active_map_id) still handle the cleanup itself — no blocking
// guard against deleting a currently-linked/active map, matching this
// schema's general cascade-don't-block precedent (e.g. campaign_assets
// deletion) — but unlike every sibling map-mutating action
// (unlinkMapFromEncounter/setActiveMap/upsertMapCellOverride/
// deleteMapCellOverride), this used to leave any LIVE encounter's sync_seq
// untouched and broadcast nothing, so connected players silently kept
// rendering a map that no longer exists server-side until some unrelated
// event happened to force a resync. Finds every encounter this map was
// active for BEFORE the delete (the FK SET NULL only tells the caller "it's
// gone now", not "which encounters it used to belong to"), then bumps each
// one's sync_seq inside the same transaction as the delete itself.
export async function deleteMap(pool: Pool, campaignId: string, mapId: string): Promise<DeleteMapAffectedEncounter[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const activeFor = await client.query<{ id: string }>(
      `SELECT id FROM encounters WHERE campaign_id = $1 AND active_map_id = $2`,
      [campaignId, mapId],
    );

    const result = await client.query(`DELETE FROM maps WHERE id = $1 AND campaign_id = $2`, [mapId, campaignId]);
    if (result.rowCount === 0) throw notFound('Map');

    const affected: DeleteMapAffectedEncounter[] = [];
    for (const row of activeFor.rows) {
      const bumped = await client.query<{ id: string; campaign_id: string }>(
        `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING id, campaign_id`,
        [row.id],
      );
      const encounter = bumped.rows[0];
      if (encounter) affected.push({ encounter_id: encounter.id, campaign_id: encounter.campaign_id });
    }

    await client.query('COMMIT');
    return affected;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMapsForEncounter(pool: Pool, encounterId: string): Promise<MapRow[]> {
  const result = await pool.query<MapRow>(
    `SELECT m.* FROM maps m JOIN encounter_maps_link l ON l.map_id = m.id WHERE l.encounter_id = $1 ORDER BY m.name`,
    [encounterId],
  );
  return result.rows;
}

export interface EncounterLike {
  id: string;
  campaign_id: string;
  sync_seq: number;
  [key: string]: unknown;
}

export interface ActiveMapMutationResult {
  encounter: EncounterLike;
  map: EncounterMapRow | null;
}

async function assertSameCampaign(client: Pool | PoolClient, encounterId: string, mapId: string): Promise<void> {
  const result = await client.query<{ encounter_campaign_id: string; map_campaign_id: string }>(
    `SELECT e.campaign_id AS encounter_campaign_id, m.campaign_id AS map_campaign_id
     FROM encounters e, maps m WHERE e.id = $1 AND m.id = $2`,
    [encounterId, mapId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Encounter or map');
  if (row.encounter_campaign_id !== row.map_campaign_id) throw notFound('Map');
}

export async function linkMapToEncounter(pool: Pool, encounterId: string, mapId: string): Promise<void> {
  await assertSameCampaign(pool, encounterId, mapId);
  await pool.query(
    `INSERT INTO encounter_maps_link (encounter_id, map_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [encounterId, mapId],
  );
}

// Clears active_map_id too if the unlinked map was the active one — an
// unlinked map shouldn't stay "the map currently shown." Returns null (no
// sync_seq bump, nothing to broadcast) when the unlinked map wasn't the
// active one, since nothing about the live view actually changed; bumping
// sync_seq with no corresponding broadcast would desync connected clients'
// seq tracking for no visible reason. When it WAS active, the result's
// `map` is null (MAP_UPDATED's payload isn't nullable — see
// routes/encounters.ts's unlink route, which falls back to a full state
// resync instead, same precedent as setParticipantVisibility's "genuinely
// changes what's visible" resync).
export async function unlinkMapFromEncounter(
  pool: Pool,
  encounterId: string,
  mapId: string,
): Promise<ActiveMapMutationResult | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM encounter_maps_link WHERE encounter_id = $1 AND map_id = $2`, [encounterId, mapId]);
    const clearRes = await client.query(
      `UPDATE encounters SET active_map_id = NULL WHERE id = $1 AND active_map_id = $2`,
      [encounterId, mapId],
    );
    if ((clearRes.rowCount ?? 0) === 0) {
      await client.query('COMMIT');
      return null;
    }
    const encounterRes = await client.query<EncounterLike>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    const map = await getEncounterMap(client, encounterId);
    await client.query('COMMIT');
    return { encounter, map };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Activating a map auto-links it too (ON CONFLICT DO NOTHING) — fewer
// clicks for the common "pick a map for this encounter" case.
// linkMapToEncounter/unlinkMapFromEncounter above stay separately available
// for pre-linking several maps (e.g. a dungeon's rooms) ahead of any of
// them going active.
export async function setActiveMap(pool: Pool, encounterId: string, mapId: string): Promise<ActiveMapMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertSameCampaign(client, encounterId, mapId);
    await client.query(
      `INSERT INTO encounter_maps_link (encounter_id, map_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [encounterId, mapId],
    );
    const encounterRes = await client.query<EncounterLike>(
      `UPDATE encounters SET active_map_id = $1, sync_seq = sync_seq + 1 WHERE id = $2 RETURNING *`,
      [mapId, encounterId],
    );
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    const map = await getEncounterMap(client, encounterId);
    await client.query('COMMIT');
    return { encounter, map };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
