import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { getEncounterMap } from './encounters.js';
import type { EncounterMapRow } from './encounters.js';
import type { CreateMapElementInput, UpdateMapElementInput } from '../schemas/mapElements.js';

export type MapElementType = 'wall' | 'door' | 'light' | 'area' | 'note' | 'image';

export interface MapElementRow {
  id: string;
  map_id: string;
  type: MapElementType;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  points: { x: number; y: number }[] | null;
  props: Record<string, unknown>;
  label: string | null;
  visible_to_players: boolean;
  locked: boolean;
  z_index: number;
}

const ELEMENT_ROW_COLUMNS = `id, map_id, type, x1, y1, x2, y2, points, props, label, visible_to_players, locked, z_index`;

// A missing x1/y1 pair on the 'area' (polygon) type would violate the DB's
// NOT NULL constraint even though its real geometry lives in `points` — the
// first polygon vertex is stored there too as a convenience anchor (label
// placement, "does this element exist near here" queries), not as
// authoritative geometry.
function extractGeometry(input: CreateMapElementInput): {
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  points: { x: number; y: number }[] | null;
  props: Record<string, unknown>;
} {
  switch (input.type) {
    case 'wall':
      return { x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2, points: null, props: {} };
    case 'door':
      return { x1: input.x1, y1: input.y1, x2: input.x2, y2: input.y2, points: null, props: input.props };
    case 'light':
      return { x1: input.x1, y1: input.y1, x2: null, y2: null, points: null, props: input.props };
    case 'note':
      return { x1: input.x1, y1: input.y1, x2: null, y2: null, points: null, props: input.props };
    case 'image':
      return { x1: input.x1, y1: input.y1, x2: null, y2: null, points: null, props: input.props };
    case 'area': {
      const anchor = input.points[0]!;
      return { x1: anchor.x, y1: anchor.y, x2: null, y2: null, points: input.points, props: input.props };
    }
  }
}

export interface AffectedEncounter {
  id: string;
  campaign_id: string;
  sync_seq: number;
}

// Elements persist per maps.id (campaign-scoped, reused across encounters —
// see the map_elements migration's header comment), but editing happens from
// within one live encounter's battle map (routes/encounters.ts). A change
// bumps sync_seq for, and reports, every OTHER encounter currently linked to
// the same map too, so the route can broadcast MAP_ELEMENTS_CHANGED to every
// live session showing this room — not just the one the DM happens to be
// editing from — with a freshly-bumped seq in each one's own envelope.
async function bumpLinkedEncounters(client: PoolClient, mapId: string): Promise<AffectedEncounter[]> {
  const result = await client.query<AffectedEncounter>(
    `UPDATE encounters SET sync_seq = sync_seq + 1
     WHERE id IN (SELECT encounter_id FROM encounter_maps_link WHERE map_id = $1)
     RETURNING id, campaign_id, sync_seq`,
    [mapId],
  );
  return result.rows;
}

export async function listMapElements(pool: Pool | PoolClient, encounterId: string): Promise<MapElementRow[]> {
  const map = await getEncounterMap(pool, encounterId);
  if (!map) return [];
  const result = await pool.query<MapElementRow>(
    `SELECT ${ELEMENT_ROW_COLUMNS} FROM map_elements WHERE map_id = $1 ORDER BY z_index, created_at`,
    [map.id],
  );
  return result.rows;
}

// camelCase wire shape, same "format*ForWire" naming/purpose convention as
// services/encounters.ts's formatMapForWire.
export function formatMapElementForWire(el: MapElementRow) {
  return {
    id: el.id,
    mapId: el.map_id,
    type: el.type,
    x1: el.x1,
    y1: el.y1,
    x2: el.x2,
    y2: el.y2,
    points: el.points,
    props: el.props,
    label: el.label,
    visibleToPlayers: el.visible_to_players,
    locked: el.locked,
    zIndex: el.z_index,
  };
}

export interface MapElementMutationResult {
  element: MapElementRow;
  map: EncounterMapRow;
  affectedEncounters: AffectedEncounter[];
}

export async function createMapElement(
  pool: Pool,
  encounterId: string,
  input: CreateMapElementInput,
): Promise<MapElementMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) throw new AppError('CONFLICT', 'No map configured for this encounter yet');

    const geometry = extractGeometry(input);
    const result = await client.query<MapElementRow>(
      `INSERT INTO map_elements (map_id, type, x1, y1, x2, y2, points, props, label, visible_to_players, locked, z_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${ELEMENT_ROW_COLUMNS}`,
      [
        map.id,
        input.type,
        geometry.x1,
        geometry.y1,
        geometry.x2,
        geometry.y2,
        geometry.points ? JSON.stringify(geometry.points) : null,
        JSON.stringify(geometry.props),
        input.label ?? null,
        input.visibleToPlayers ?? true,
        input.locked ?? false,
        input.zIndex ?? 0,
      ],
    );

    const affectedEncounters = await bumpLinkedEncounters(client, map.id);
    await client.query('COMMIT');
    return { element: result.rows[0]!, map, affectedEncounters };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateMapElement(
  pool: Pool,
  encounterId: string,
  elementId: string,
  input: UpdateMapElementInput,
): Promise<MapElementMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) throw new AppError('CONFLICT', 'No map configured for this encounter yet');

    const existingRes = await client.query<MapElementRow>(
      `SELECT ${ELEMENT_ROW_COLUMNS} FROM map_elements WHERE id = $1 AND map_id = $2 FOR UPDATE`,
      [elementId, map.id],
    );
    const existing = existingRes.rows[0];
    if (!existing) throw notFound('Map element');

    // Shallow-merged, not replaced — a caller patching just `state` on a
    // door shouldn't have to resend the whole props object.
    const mergedProps = input.props ? { ...existing.props, ...input.props } : existing.props;

    const result = await client.query<MapElementRow>(
      `UPDATE map_elements SET
         x1 = COALESCE($1, x1),
         y1 = COALESCE($2, y1),
         x2 = CASE WHEN $3 THEN $4 ELSE x2 END,
         y2 = CASE WHEN $5 THEN $6 ELSE y2 END,
         points = CASE WHEN $7 THEN $8 ELSE points END,
         props = $9,
         label = CASE WHEN $10 THEN $11 ELSE label END,
         visible_to_players = COALESCE($12, visible_to_players),
         locked = COALESCE($13, locked),
         z_index = COALESCE($14, z_index),
         updated_at = now()
       WHERE id = $15
       RETURNING ${ELEMENT_ROW_COLUMNS}`,
      [
        input.x1 ?? null,
        input.y1 ?? null,
        input.x2 !== undefined,
        input.x2 ?? null,
        input.y2 !== undefined,
        input.y2 ?? null,
        input.points !== undefined,
        input.points ? JSON.stringify(input.points) : null,
        JSON.stringify(mergedProps),
        input.label !== undefined,
        input.label ?? null,
        input.visibleToPlayers ?? null,
        input.locked ?? null,
        input.zIndex ?? null,
        elementId,
      ],
    );

    const affectedEncounters = await bumpLinkedEncounters(client, map.id);
    await client.query('COMMIT');
    return { element: result.rows[0]!, map, affectedEncounters };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteMapElement(
  pool: Pool,
  encounterId: string,
  elementId: string,
): Promise<{ elementId: string; map: EncounterMapRow; affectedEncounters: AffectedEncounter[] } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) {
      await client.query('ROLLBACK');
      return null;
    }
    const result = await client.query(`DELETE FROM map_elements WHERE id = $1 AND map_id = $2`, [elementId, map.id]);
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const affectedEncounters = await bumpLinkedEncounters(client, map.id);
    await client.query('COMMIT');
    return { elementId, map, affectedEncounters };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
