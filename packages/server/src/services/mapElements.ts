import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { getEncounterMap } from './encounters.js';
import type { EncounterMapRow } from './encounters.js';
import type { CreateMapElementInput, UpdateMapElementInput } from '../schemas/mapElements.js';
import type { CampaignRole } from './authz.js';
import { resolveVisibilitySync } from './visibility.js';
import { computeBlocksVision } from '../domain/mapElementVisibility.js';

export type MapElementType = 'wall' | 'door' | 'light' | 'area' | 'note' | 'image';
export type MapElementVisibility = 'gm_only' | 'revealed_to_players' | 'owner_only';

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
  visibility: MapElementVisibility;
  owner_user_id: string | null;
  locked: boolean;
  z_index: number;
}

// Exported for services/doorActions.ts's own locked SELECT/UPDATE queries —
// same reasoning as bumpLinkedEncounters above.
export const ELEMENT_ROW_COLUMNS = `id, map_id, type, x1, y1, x2, y2, points, props, label, visibility, owner_user_id, locked, z_index`;

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
// Exported for services/doorActions.ts — a door open/close/force action
// mutates a map_elements row from a route OUTSIDE this file (participant-
// scoped, not element-scoped, since it needs requireOwnParticipantOrDm's
// :pid authorization), but still needs to bump every encounter sharing this
// map exactly like create/update/delete above, so every live session
// broadcasts the change — not a second, independently-maintained copy.
export async function bumpLinkedEncounters(client: PoolClient, mapId: string): Promise<AffectedEncounter[]> {
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
// services/encounters.ts's formatMapForWire. Full, unredacted shape — only
// safe to send to a viewer already authorized to see this row (a DM, or a
// call site that already checked formatMapElementForViewer's result below).
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
    visibility: el.visibility,
    ownerUserId: el.owner_user_id,
    locked: el.locked,
    zIndex: el.z_index,
  };
}

export type WireMapElement = ReturnType<typeof formatMapElementForWire>;

// A hidden wall/door/light still needs to contribute to a player's
// fog-of-war raycast (wall/door geometry) or light-radius rendering
// (light), so it isn't omitted outright — only redacted down to the
// minimum geometric/derived fact needed for that, per the approved
// "redact content, keep geometry" rule. note/area/image never block vision
// and are omitted entirely instead (see formatMapElementForViewer).
export interface RedactedMapElement {
  id: string;
  mapId: string;
  type: 'wall' | 'door' | 'light';
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  redacted: true;
  blocksVision?: boolean; // wall/door only
  lightRadii?: { brightRadiusFt: number; dimRadiusFt: number }; // light only
}

// The server-side enforcement point for the GM-only visibility layer on map
// elements — every call site that sends element data to a specific viewer
// (the REST GET route, buildFullStateSyncPayload, broadcastMapElementsChanged)
// must route through this rather than formatMapElementForWire directly.
// `viewerId: null` is used for the shared player-bucket socket broadcasts,
// where no single viewer is known — this correctly makes 'owner_only'
// elements never appear in that shared payload (see broadcast.ts's own
// comment on this limitation for live updates).
export function formatMapElementForViewer(
  el: MapElementRow,
  viewerId: string | null,
  viewerRole: CampaignRole,
): WireMapElement | RedactedMapElement | null {
  const visible =
    resolveVisibilitySync(
      { mode: 'gm_only', ownerUserId: el.visibility === 'owner_only' ? el.owner_user_id : null },
      viewerId,
      viewerRole,
    ) || (viewerRole !== 'dm' && el.visibility === 'revealed_to_players');
  if (visible) return formatMapElementForWire(el);

  switch (el.type) {
    case 'wall':
      return { id: el.id, mapId: el.map_id, type: 'wall', x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, redacted: true, blocksVision: true };
    case 'door':
      return { id: el.id, mapId: el.map_id, type: 'door', x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, redacted: true, blocksVision: computeBlocksVision(el) };
    case 'light': {
      const props = el.props as { brightRadiusFt?: number; dimRadiusFt?: number };
      return {
        id: el.id, mapId: el.map_id, type: 'light', x1: el.x1, y1: el.y1, x2: null, y2: null, redacted: true,
        lightRadii: { brightRadiusFt: props.brightRadiusFt ?? 0, dimRadiusFt: props.dimRadiusFt ?? 0 },
      };
    }
    default:
      return null; // note/area/image: fully omitted, never block vision
  }
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
    const visibility = input.visibility ?? 'revealed_to_players';
    const result = await client.query<MapElementRow>(
      `INSERT INTO map_elements (map_id, type, x1, y1, x2, y2, points, props, label, visibility, owner_user_id, locked, z_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        visibility,
        visibility === 'owner_only' ? (input.ownerUserId ?? null) : null,
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

    // A visibility change away from 'owner_only' clears any stale owner id
    // (rather than leaving a dangling owner_user_id on a now-gm_only/
    // revealed_to_players row); an explicit ownerUserId in the input always
    // wins when visibility is (or is becoming) 'owner_only'.
    const nextVisibility = input.visibility ?? existing.visibility;
    const nextOwnerUserId =
      nextVisibility === 'owner_only' ? (input.ownerUserId ?? existing.owner_user_id) : null;

    const result = await client.query<MapElementRow>(
      `UPDATE map_elements SET
         x1 = COALESCE($1, x1),
         y1 = COALESCE($2, y1),
         x2 = CASE WHEN $3 THEN $4 ELSE x2 END,
         y2 = CASE WHEN $5 THEN $6 ELSE y2 END,
         points = CASE WHEN $7 THEN $8 ELSE points END,
         props = $9,
         label = CASE WHEN $10 THEN $11 ELSE label END,
         visibility = $12,
         owner_user_id = $13,
         locked = COALESCE($14, locked),
         z_index = COALESCE($15, z_index),
         updated_at = now()
       WHERE id = $16
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
        nextVisibility,
        nextOwnerUserId,
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

export interface BatchVisibilityResult {
  elements: MapElementRow[];
  affectedEncounters: AffectedEncounter[];
}

// Bulk reveal/hide for BattleMap.tsx's multi-select toolbar. Same
// transactional/bump-linked-encounters shape as create/update/delete above.
export async function setMapElementsVisibilityBatch(
  pool: Pool,
  encounterId: string,
  elementIds: string[],
  visibility: MapElementVisibility,
  ownerUserId: string | null,
): Promise<BatchVisibilityResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) throw new AppError('CONFLICT', 'No map configured for this encounter yet');
    const result = await client.query<MapElementRow>(
      `UPDATE map_elements SET visibility = $1, owner_user_id = $2, updated_at = now()
       WHERE id = ANY($3::uuid[]) AND map_id = $4
       RETURNING ${ELEMENT_ROW_COLUMNS}`,
      [visibility, visibility === 'owner_only' ? ownerUserId : null, elementIds, map.id],
    );
    const affectedEncounters = await bumpLinkedEncounters(client, map.id);
    await client.query('COMMIT');
    return { elements: result.rows, affectedEncounters };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
