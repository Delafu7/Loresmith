// Encounter + combat-participant business logic. Kept as plain functions
// (not embedded in route handlers) per the task brief: advanceTurn in
// particular is the hook point the real-time-sync agent will import and call
// directly from a socket handler next, so it must not depend on Express
// req/res.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isUniqueViolation } from './dbErrors.js';
import { requireMembership, requireControllerOrDm, type CampaignRole } from './authz.js';
import {
  computePathCost,
  computeReachableSet,
  sizeRankFor,
  type CellOverride,
  type CostType,
  type DiagonalRule,
  type Faction,
  type Medium,
  type MovementGrid,
  type MoverProfile,
  type Occupant,
} from './movement.js';
import type {
  AddParticipantInput,
  ApplyActionEconomyInput,
  CreateEncounterInput,
  SetEncounterModeInput,
  SetInitiativeInput,
  SetParticipantFactionInput,
  SetParticipantPositionInput,
  SetParticipantVisibilityInput,
  TransitionDispositionInput,
  UpdateEncounterInput,
  UpsertEncounterMapInput,
} from '../schemas/encounters.js';

// combat_participants.initiative_roll is NOT NULL (PLAN.md schema), so
// "hasn't been rolled yet" needs a sentinel rather than NULL. A real d20+mod
// roll is realistically never this low, so collision risk is negligible.
const UNROLLED_INITIATIVE = -9999;

interface EncounterRow {
  id: string;
  campaign_id: string;
  name: string;
  status: 'preparing' | 'active' | 'paused' | 'completed';
  mode: 'exploration' | 'combat';
  current_round: number;
  current_turn_index: number;
  // Map-first encounter system: the authoritative pointer to who's active,
  // immune to turn_order churn from a mid-combat re-roll or splice (see
  // 1784269784666_add-active-participant-tracking.ts's header comment).
  // current_turn_index is kept in lockstep as a derived/display value — it
  // always equals this participant's own turn_order — purely so every
  // existing turn_order-vs-current_turn_index equality check (requireCurrentTurn,
  // canMoveToken.ts, advanceTurn's action-economy-reset WHERE clause) keeps
  // working unchanged.
  active_participant_id: string | null;
  active_map_id: string | null;
  sync_seq: number;
  disposition: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  [key: string]: unknown;
}

export interface EncounterDispositionEventRow {
  id: string;
  encounter_id: string;
  from_disposition: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  to_disposition: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  changed_by_user_id: string;
  note: string | null;
  created_at: string;
}

interface ParticipantRow {
  id: string;
  encounter_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
  pos_x: number | null;
  pos_y: number | null;
  action_used: boolean;
  bonus_action_used: boolean;
  reaction_used: boolean;
  dash_used: boolean;
  movement_used_ft: number;
  object_interaction_used: boolean;
  last_action_economy_snapshot: ActionEconomySnapshot | null;
  visible_to_players: boolean;
  [key: string]: unknown;
}

// docs/rules/actions.md §2.4 — the smallest mechanism satisfying
// REFACTOR-PLAN.md §5's "allow the DM to undo": one slot, overwritten on
// every applyActionEconomy call with the PRE-mutation values of whatever it
// touched, consumed (nulled) by a single undo call. Not a stack/log — a
// second consecutive spend without an intervening undo simply overwrites
// the previous snapshot, matching the "last mutation, not this turn's
// mutations" scoping that doc calls out as the sharpest edge case (a
// readied reaction can fire turns after the action that readied it).
interface ActionEconomySnapshot {
  action_used?: boolean;
  bonus_action_used?: boolean;
  reaction_used?: boolean;
  dash_used?: boolean;
  movement_used_ft?: number;
  object_interaction_used?: boolean;
}

async function fetchEncounterScoped(
  client: Pool | PoolClient,
  campaignId: string,
  encounterId: string,
): Promise<EncounterRow> {
  const result = await client.query<EncounterRow>(
    `SELECT * FROM encounters WHERE id = $1 AND campaign_id = $2`,
    [encounterId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row;
}

// Used by the flat /encounters/:id/... action routes, which have no
// campaignId in the URL — derives it from the row instead.
async function fetchEncounterById(client: Pool | PoolClient, encounterId: string): Promise<EncounterRow> {
  const result = await client.query<EncounterRow>(`SELECT * FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row;
}

async function fetchParticipants(client: Pool | PoolClient, encounterId: string): Promise<ParticipantRow[]> {
  const result = await client.query<ParticipantRow>(
    `SELECT * FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
    [encounterId],
  );
  return result.rows;
}

// ---- CRUD (nested under /campaigns/:id/encounters, DM-gated at the route) ----

// Encounter visibility by state (nav point 1): while an encounter is
// 'preparing' (the DM still configuring it), it must not appear in a
// non-DM's list at all — not just be inert/greyed-out. The DM always sees
// everything, matching the "DM sees the full list regardless of state"
// column-filtering pattern used below in getEncounter/fetchParticipants.
// participant_count (nav point: Map section) — lets a client pick "which
// encounter actually has anything on its map" without an N-request detail
// fetch per encounter; a plain COUNT subquery, not a join, so an encounter
// with zero participants still returns exactly one row.
export async function listEncounters(pool: Pool, campaignId: string, viewerRole: CampaignRole) {
  const result = await pool.query(
    viewerRole === 'dm'
      ? `SELECT e.*, (SELECT COUNT(*) FROM combat_participants cp WHERE cp.encounter_id = e.id)::int AS participant_count
         FROM encounters e WHERE e.campaign_id = $1 ORDER BY e.created_at DESC`
      : `SELECT e.*, (SELECT COUNT(*) FROM combat_participants cp WHERE cp.encounter_id = e.id)::int AS participant_count
         FROM encounters e WHERE e.campaign_id = $1 AND e.status != 'preparing' ORDER BY e.created_at DESC`,
    [campaignId],
  );
  return result.rows;
}

// Map-first encounter system: "on reload/reconnect, land directly in the
// current fullscreen map" needs a way to ask, before anything has pushed
// anything, "is there an active encounter I should be in fullscreen for
// right now" — mirrors relevantSocketIds' (sockets/broadcast.ts) DM-or-owns-
// a-seated-participant relevance rule, just as a pull instead of a push.
// Most-recently-started wins if more than one is active (a split-party edge
// case) — the client only auto-navigates once per mount, so this is only
// ever the FIRST encounter a returning user lands in; any other relevant one
// surfaces the same way it would for a brand new push (see the client-side
// listener, not a server concern).
export async function getMyLiveEncounter(
  pool: Pool,
  campaignId: string,
  userId: string,
  role: CampaignRole,
): Promise<{ id: string; name: string } | null> {
  const result =
    role === 'dm'
      ? await pool.query<{ id: string; name: string }>(
          `SELECT id, name FROM encounters WHERE campaign_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
          [campaignId],
        )
      : await pool.query<{ id: string; name: string }>(
          `SELECT DISTINCT e.id, e.name, e.started_at
           FROM encounters e
           JOIN combat_participants cp ON cp.encounter_id = e.id
           JOIN characters c ON c.id = cp.character_id
           WHERE e.campaign_id = $1 AND e.status = 'active' AND c.owner_user_id = $2
           ORDER BY e.started_at DESC
           LIMIT 1`,
          [campaignId, userId],
        );
  return result.rows[0] ?? null;
}

// Drops participant rows a non-DM viewer shouldn't see at all (visible_to_players
// = false — e.g. an ambush the DM hasn't revealed yet). DM always gets every row.
function filterParticipantsForViewer(participants: ParticipantRow[], viewerRole: CampaignRole): ParticipantRow[] {
  if (viewerRole === 'dm') return participants;
  return participants.filter((p) => p.visible_to_players !== false);
}

export async function getEncounter(pool: Pool, campaignId: string, encounterId: string, viewerRole: CampaignRole) {
  const encounter = await fetchEncounterScoped(pool, campaignId, encounterId);
  // 404, not 403, so a non-DM probing a known encounter id can't distinguish
  // "still preparing" from "doesn't exist" — same reasoning as every other
  // existence-hiding check in this codebase (see notFound()'s call sites).
  if (viewerRole !== 'dm' && encounter.status === 'preparing') throw notFound('Encounter');
  const participants = filterParticipantsForViewer(await fetchParticipants(pool, encounterId), viewerRole);
  const map = await getEncounterMap(pool, encounterId);
  return { ...encounter, participants, map: formatMapForWire(map) };
}

// Flat lookup by encounter id alone (REFACTOR-PLAN.md §1: /maps/:mapId — a
// standalone full-screen route with no campaignId in its URL, since
// encounter_maps is 1:1 with encounters and this app has no separate
// campaign-level map entity). Membership is derived from the encounter row
// itself, same pattern as requireEncounterDm in routes/encounters.ts, except
// read access here only needs membership, not the DM role.
export async function getEncounterFlat(pool: Pool, userId: string, encounterId: string) {
  const encounter = await fetchEncounterById(pool, encounterId);
  const role = await requireMembership(pool, encounter.campaign_id, userId);
  const full = await getEncounter(pool, encounter.campaign_id, encounterId, role);
  return { ...full, myRole: role };
}

// ---- Battle map (Phase 3.3) ----
//
// One optional encounter_maps row per encounter — same "separate optional
// 1:1 table rather than nullable columns on the parent" precedent as other
// optional-extension tables in this schema. `background_file_url` is
// resolved here via a join to campaign_assets so callers (the REST
// getEncounter above and sockets/broadcast.ts's buildFullStateSyncPayload)
// never need a second assets fetch just to render the map background.

export interface EncounterMapRow {
  id: string;
  encounter_id: string;
  background_asset_id: string | null;
  background_file_url: string | null;
  grid_columns: number;
  grid_rows: number;
  cell_size_px: number;
  feet_per_cell: number;
}

// Resolves through encounters.active_map_id into the campaign-scoped `maps`
// library (see 1784269788666_create-campaign-maps-library.ts) rather than a
// 1:1 encounter_maps row — but returns the EXACT SAME EncounterMapRow shape
// as before on purpose, so every downstream consumer (formatMapForWire,
// MAP_UPDATED, the cell-override routes, BattleMap.tsx) keeps working
// unchanged: they only ever cared about "the encounter's current map,"
// which is now just resolved differently, not reshaped.
export async function getEncounterMap(pool: Pool | PoolClient, encounterId: string): Promise<EncounterMapRow | null> {
  const result = await pool.query<EncounterMapRow>(
    `SELECT m.id, e.id AS encounter_id, m.background_asset_id, ca.file_url AS background_file_url,
            m.grid_columns, m.grid_rows, m.cell_size_px, m.feet_per_cell
     FROM encounters e
     JOIN maps m ON m.id = e.active_map_id
     LEFT JOIN campaign_assets ca ON ca.id = m.background_asset_id
     WHERE e.id = $1`,
    [encounterId],
  );
  return result.rows[0] ?? null;
}

export function formatMapForWire(map: EncounterMapRow | null) {
  if (!map) return null;
  return {
    // The library map's own id (maps.id) — lets a client-side map-library
    // picker (routes/maps.ts) tell which of a campaign's maps is this
    // encounter's currently active one without a second round-trip.
    id: map.id,
    backgroundAssetId: map.background_asset_id,
    backgroundFileUrl: map.background_file_url,
    gridColumns: map.grid_columns,
    gridRows: map.grid_rows,
    cellSizePx: map.cell_size_px,
    feetPerCell: map.feet_per_cell,
  };
}

// ---- Terrain cell overrides (REFACTOR-PLAN.md §4) ----
//
// Fetched via its own lightweight REST endpoint rather than threaded through
// FULL_STATE_SYNC/MAP_UPDATED's payload — terrain changes far less often
// than combat state, so a client refetches this once on map load and again
// whenever MAP_UPDATED fires (already broadcast on any map-related change),
// instead of every socket consumer growing a new payload field for
// something most of them never render.

export interface MapCellOverrideRow {
  x: number;
  y: number;
  cost_type: CostType;
  medium: Medium;
  special_cost_ft: number | null;
  note: string | null;
}

export async function listMapCellOverrides(pool: Pool, encounterId: string): Promise<MapCellOverrideRow[]> {
  const map = await getEncounterMap(pool, encounterId);
  if (!map) return [];
  const result = await pool.query<MapCellOverrideRow>(
    `SELECT x, y, cost_type, medium, special_cost_ft, note FROM map_cell_overrides WHERE encounter_map_id = $1 ORDER BY y, x`,
    [map.id],
  );
  return result.rows;
}

export interface UpsertCellOverrideInput {
  costType: CostType;
  medium?: Medium;
  specialCostFt?: number | null;
  note?: string | null;
}

// Both mutations bump encounters.sync_seq in the same transaction and
// return the updated row — same "every mutation that broadcasts also bumps
// seq" discipline as every other combat_participants/encounter_maps writer
// in this file (PLAN.md §5.2) — so the MAP_UPDATED broadcast the route
// triggers carries a real, freshly-bumped seq instead of a stale one.

export async function upsertMapCellOverride(
  pool: Pool,
  encounterId: string,
  x: number,
  y: number,
  input: UpsertCellOverrideInput,
): Promise<{ encounter: EncounterRow; map: EncounterMapRow }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) throw new AppError('CONFLICT', 'No map configured for this encounter yet');

    await client.query(
      `INSERT INTO map_cell_overrides (encounter_map_id, x, y, cost_type, medium, special_cost_ft, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (encounter_map_id, x, y) DO UPDATE SET
         cost_type = EXCLUDED.cost_type, medium = EXCLUDED.medium,
         special_cost_ft = EXCLUDED.special_cost_ft, note = EXCLUDED.note, updated_at = now()`,
      [map.id, x, y, input.costType, input.medium ?? 'ground', input.specialCostFt ?? null, input.note ?? null],
    );

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );
    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, map };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteMapCellOverride(
  pool: Pool,
  encounterId: string,
  x: number,
  y: number,
): Promise<{ encounter: EncounterRow; map: EncounterMapRow } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await getEncounterMap(client, encounterId);
    if (!map) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(`DELETE FROM map_cell_overrides WHERE encounter_map_id = $1 AND x = $2 AND y = $3`, [map.id, x, y]);

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );
    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, map };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Cross-campaign consistency check (backgroundAssetId's row must belong to
// the SAME campaign as the encounter) is a service-layer check, not a DB
// constraint — same "app-layer, not declarative" precedent as
// services/monsterCatalog.ts's validateArtAssetBelongsToCampaign and
// services/assets.ts's authorizeAssetUpload.
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

export interface EncounterMapMutationResult {
  encounter: EncounterRow;
  map: EncounterMapRow;
}

// "The encounter's map" is now "the encounter's active library map" (see
// 1784269788666_create-campaign-maps-library.ts) — this function preserves
// its EXISTING contract (PUT /encounters/:id/map, called by BattleMap.tsx's
// inline "Reconfigure map" form) exactly, so that flow needs zero frontend
// changes: if the encounter already has an active map, this updates that
// `maps` row in place (same partial-update semantics as before); if it
// doesn't yet, this creates a new campaign-scoped library entry, links it,
// and activates it — "configure this encounter's map inline" implicitly
// creates a reusable library entry, while routes/maps.ts's library CRUD is
// the additive surface for browsing/reusing/renaming maps across encounters.
export async function upsertEncounterMap(
  pool: Pool,
  encounterId: string,
  input: UpsertEncounterMapInput,
): Promise<EncounterMapMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounter = await fetchEncounterById(client, encounterId);

    // backgroundAssetId may be explicitly `null` (clear the background) or
    // simply omitted (leave it alone) — those are NOT the same thing, so the
    // "was it supplied at all" flag below is passed separately from the
    // value itself.
    await validateBackgroundAssetBelongsToCampaign(client, encounter.campaign_id, input.backgroundAssetId);
    const backgroundAssetIdSupplied = input.backgroundAssetId !== undefined;

    if (encounter.active_map_id) {
      // COALESCE(new, existing) only overwrites fields actually supplied,
      // and an explicit boolean flag for background_asset_id since `null`
      // is itself a meaningful supplied value (clear it), not "leave it
      // alone" — same partial-update semantics as the pre-library version.
      await client.query(
        `UPDATE maps SET
           background_asset_id = CASE WHEN $2 THEN $3 ELSE background_asset_id END,
           grid_columns = COALESCE($4, grid_columns),
           grid_rows = COALESCE($5, grid_rows),
           cell_size_px = COALESCE($6, cell_size_px),
           feet_per_cell = COALESCE($7, feet_per_cell),
           updated_at = now()
         WHERE id = $1`,
        [
          encounter.active_map_id,
          backgroundAssetIdSupplied,
          input.backgroundAssetId ?? null,
          input.gridColumns ?? null,
          input.gridRows ?? null,
          input.cellSizePx ?? null,
          input.feetPerCell ?? null,
        ],
      );
    } else {
      const mapRes = await client.query<{ id: string }>(
        `INSERT INTO maps (campaign_id, name, background_asset_id, grid_columns, grid_rows, cell_size_px, feet_per_cell)
         VALUES ($1, $2, $3, COALESCE($4, 20), COALESCE($5, 20), COALESCE($6, 50), COALESCE($7, 5))
         RETURNING id`,
        [
          encounter.campaign_id,
          `${encounter.name} Map`,
          input.backgroundAssetId ?? null,
          input.gridColumns ?? null,
          input.gridRows ?? null,
          input.cellSizePx ?? null,
          input.feetPerCell ?? null,
        ],
      );
      const newMapId = mapRes.rows[0]!.id;
      await client.query(`INSERT INTO encounter_maps_link (encounter_id, map_id) VALUES ($1, $2)`, [encounterId, newMapId]);
      await client.query(`UPDATE encounters SET active_map_id = $1 WHERE id = $2`, [newMapId, encounterId]);
    }

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    // Re-read the map row via `client` BEFORE commit, not `pool` after —
    // otherwise a concurrent writer's commit could interleave between our
    // COMMIT and a post-commit read, pairing our sync_seq with someone
    // else's map data (or, if the encounter was deleted in that gap, with
    // no map row at all).
    const map = await getEncounterMap(client, encounterId);
    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, map: map! };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// REFACTOR-PLAN.md §4 / docs/rules/movement.md §2.3: shared grid+mover
// loader for both the move-validation path (setParticipantPosition) and the
// reachable-cells read endpoint (getParticipantReachableCells) — both need
// the exact same context, and drifting the two loaders apart would risk a
// reachable-cell highlight that doesn't match what the server would actually
// accept. Returns null when there's no map or no usable speed data to
// validate/compute against.
async function loadMovementContext(
  client: Pool | PoolClient,
  encounter: EncounterRow,
  participant: ParticipantRow,
): Promise<{ grid: MovementGrid; mover: MoverProfile; speedFt: number; remainingFt: number } | null> {
  const mapRes = await client.query<{ id: string; feet_per_cell: number; grid_columns: number; grid_rows: number }>(
    `SELECT id, feet_per_cell, grid_columns, grid_rows FROM maps WHERE id = (SELECT active_map_id FROM encounters WHERE id = $1)`,
    [encounter.id],
  );
  const map = mapRes.rows[0];
  if (!map) return null; // nothing configured to validate against yet

  const moverRes = await client.query<{
    speed_ft: number | null;
    size: string;
    alt_speeds: Record<string, number>;
    is_prone: boolean;
  }>(
    `SELECT
       COALESCE(c.speed, NULLIF(regexp_replace(COALESCE(m.speed->>'walk', ''), '[^0-9]', '', 'g'), '')::int) AS speed_ft,
       COALESCE(m.size, 'Medium') AS size,
       COALESCE(c.alt_speeds, (m.speed - 'walk'), '{}'::jsonb) AS alt_speeds,
       EXISTS (
         SELECT 1 FROM active_effects ae
         JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
         WHERE ae.removed_at IS NULL AND LOWER(ed.name) = 'prone'
           AND ((ae.character_id = $1 AND $1 IS NOT NULL) OR (ae.monster_instance_id = $2 AND $2 IS NOT NULL))
       ) AS is_prone
     FROM combat_participants cp
     LEFT JOIN characters c ON c.id = cp.character_id
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     WHERE cp.id = $3`,
    [participant.character_id, participant.monster_instance_id, participant.id],
  );
  const mv = moverRes.rows[0];
  if (!mv || mv.speed_ft == null) return null; // no usable speed data to validate against

  const campaignRes = await client.query<{ diagonal_movement_rule: DiagonalRule; srd_edition: '2014' | '2024' }>(
    `SELECT diagonal_movement_rule, srd_edition FROM campaigns WHERE id = $1`,
    [encounter.campaign_id],
  );
  const campaign = campaignRes.rows[0]!;

  const overridesRes = await client.query<{ x: number; y: number; cost_type: CostType; medium: Medium; special_cost_ft: number | null }>(
    `SELECT x, y, cost_type, medium, special_cost_ft FROM map_cell_overrides WHERE encounter_map_id = $1`,
    [map.id],
  );
  const overrides = new Map<string, CellOverride>();
  for (const row of overridesRes.rows) {
    overrides.set(`${row.x},${row.y}`, { costType: row.cost_type, medium: row.medium, specialCostFt: row.special_cost_ft });
  }

  const occupantsRes = await client.query<{ pos_x: number; pos_y: number; faction: Faction; size: string }>(
    `SELECT cp.pos_x, cp.pos_y, cp.faction, COALESCE(m.size, 'Medium') AS size
     FROM combat_participants cp
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     WHERE cp.encounter_id = $1 AND cp.id != $2 AND cp.pos_x IS NOT NULL AND cp.pos_y IS NOT NULL`,
    [encounter.id, participant.id],
  );
  const occupants = new Map<string, Occupant>();
  for (const row of occupantsRes.rows) {
    occupants.set(`${row.pos_x},${row.pos_y}`, { participantId: '', faction: row.faction, sizeRank: sizeRankFor(row.size) });
  }

  const grid: MovementGrid = {
    columns: map.grid_columns,
    rows: map.grid_rows,
    feetPerCell: map.feet_per_cell,
    diagonalRule: campaign.diagonal_movement_rule,
    edition: campaign.srd_edition,
    overrides,
    occupants,
  };
  const mover: MoverProfile = {
    faction: participant.faction,
    sizeRank: sizeRankFor(mv.size),
    altSpeedsFt: mv.alt_speeds ?? {},
    isProne: mv.is_prone,
  };
  const remainingFt = mv.speed_ft + (participant.dash_used ? mv.speed_ft : 0) - participant.movement_used_ft;

  return { grid, mover, speedFt: mv.speed_ft, remainingFt };
}

// docs/rules/movement.md §2.4: validation only applies to an ACTUAL move of
// an already-placed token during ACTIVE combat — not initial placement
// (from null,null), not removal (to null,null), and not while the encounter
// is 'preparing'/'paused'/'completed' (DM setup/rearrangement stays
// unconditional, matching that doc's explicit recommendation to avoid
// blocking ordinary token-placement drag-and-drop outside a live turn), and
// not while the encounter is in 'exploration' mode (free player-driven
// roaming, no turn order, no movement limit — the whole point of that mode).
// A non-DM actor is additionally required to be moving on their own current
// turn once combat validation does apply (requireCurrentTurn) — the DM
// keeps its original unconditional access in every mode/status. Returns
// null (no validation performed, move is free) when any of those apply, or
// when loadMovementContext can't build a usable context — this function
// never blocks a move it can't actually reason about.
async function computeValidatedMoveCost(
  client: PoolClient,
  encounter: EncounterRow,
  participant: ParticipantRow,
  to: { x: number | null; y: number | null },
  actorRole: CampaignRole,
): Promise<{ costFt: number } | null> {
  if (to.x === null || to.y === null) return null; // removal from the map
  if (participant.pos_x === null || participant.pos_y === null) return null; // initial placement
  if (encounter.mode === 'exploration') return null; // free roam, DM or player
  if (encounter.status !== 'active') return null;
  if (actorRole !== 'dm') requireCurrentTurn(encounter, participant);

  const ctx = await loadMovementContext(client, encounter, participant);
  if (!ctx) return null;

  const path = computePathCost(ctx.grid, ctx.mover, { x: participant.pos_x, y: participant.pos_y }, { x: to.x, y: to.y });
  if (!path) {
    throw new AppError('CONFLICT', 'No legal path to that cell', { reason: 'BLOCKED_PATH' });
  }
  if (path.costFt > ctx.remainingFt) {
    throw new AppError('CONFLICT', 'Move exceeds remaining movement', {
      reason: 'INSUFFICIENT_MOVEMENT',
      requiredFt: path.costFt,
      remainingFt: ctx.remainingFt,
    });
  }

  return { costFt: path.costFt };
}

// REFACTOR-PLAN.md §4: "selecting a character highlights reachable cells...
// computed with pathfinding over actual terrain cost — server computes and
// returns it." Read-only counterpart to computeValidatedMoveCost, sharing
// the same loader so the highlight can never show a cell the write path
// would then reject. Returns an empty set (not an error) when the
// participant isn't placed, the encounter isn't active, or there's nothing
// to validate against — an empty highlight is a reasonable "nothing to show
// yet" rendering, not a failure.
export async function getParticipantReachableCells(
  pool: Pool,
  encounterId: string,
  participantId: string,
): Promise<{ cells: string[]; remainingFt: number }> {
  const encounter = await fetchEncounterById(pool, encounterId);
  const participantRes = await pool.query<ParticipantRow>(
    `SELECT * FROM combat_participants WHERE id = $1 AND encounter_id = $2`,
    [participantId, encounterId],
  );
  const participant = participantRes.rows[0];
  if (!participant) throw notFound('Participant');
  // Exploration mode has no budget concept — nothing to highlight (mirrors
  // computeValidatedMoveCost's own mode gate just below in this file).
  if (
    participant.pos_x === null ||
    participant.pos_y === null ||
    encounter.mode !== 'combat' ||
    encounter.status !== 'active'
  ) {
    return { cells: [], remainingFt: 0 };
  }

  const ctx = await loadMovementContext(pool, encounter, participant);
  if (!ctx) return { cells: [], remainingFt: 0 };

  const reachable = computeReachableSet(ctx.grid, ctx.mover, { x: participant.pos_x, y: participant.pos_y }, ctx.remainingFt);
  return { cells: [...reachable], remainingFt: ctx.remainingFt };
}

export async function setParticipantPosition(
  pool: Pool,
  encounterId: string,
  participantId: string,
  input: SetParticipantPositionInput,
  actorRole: CampaignRole,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Locked for the duration of the validate+write so two rapid moves for
    // the same participant can't both pass the budget check against the
    // same stale movement_used_ft (docs/rules/movement.md §2.4's "today's
    // endpoint never locks the row" gap).
    const lockedRes = await client.query<ParticipantRow>(
      `SELECT * FROM combat_participants WHERE id = $1 AND encounter_id = $2 FOR UPDATE`,
      [participantId, encounterId],
    );
    const locked = lockedRes.rows[0];
    if (!locked) throw notFound('Participant');

    const encounter = await fetchEncounterById(client, encounterId);
    const validated = await computeValidatedMoveCost(client, encounter, locked, input, actorRole);

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants
       SET pos_x = $1, pos_y = $2, movement_used_ft = movement_used_ft + $3
       WHERE id = $4 AND encounter_id = $5 RETURNING *`,
      [input.x, input.y, validated?.costFt ?? 0, participantId, encounterId],
    );
    const participant = updated.rows[0]!;

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// REFACTOR-PLAN.md §3: DM overrides a participant's board-readability faction
// (player/ally/enemy/neutral) — same shape as setParticipantPosition just
// above (bump sync_seq in the same transaction, broadcast room-wide, no
// DM/player visibility split needed since faction isn't HP-sensitive info).
export async function setParticipantFaction(
  pool: Pool,
  encounterId: string,
  participantId: string,
  input: SetParticipantFactionInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET faction = $1 WHERE id = $2 AND encounter_id = $3 RETURNING *`,
      [input.faction, participantId, encounterId],
    );
    const participant = updated.rows[0];
    if (!participant) throw notFound('Participant');

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Encounter visibility by state (nav point 1) — DM-only toggle for an
// individual participant (e.g. revealing an ambush mid-fight). Same
// bump-sync_seq-and-broadcast-a-resync shape as setParticipantFaction, except
// the route broadcasts via broadcastFullStateResync (role-split) rather than
// a dedicated event, since this genuinely changes what a player sees, not
// just a display detail like faction.
export async function setParticipantVisibility(
  pool: Pool,
  encounterId: string,
  participantId: string,
  input: SetParticipantVisibilityInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET visible_to_players = $1 WHERE id = $2 AND encounter_id = $3 RETURNING *`,
      [input.visible, participantId, encounterId],
    );
    const participant = updated.rows[0];
    if (!participant) throw notFound('Participant');

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Authorization for PATCH /encounters/:id/participants/:pid/action-economy
// (battle mode, REVISION-PLAN.md §10.2): unlike every other combat_participants
// mutation in this app (DM-only via requireEncounterDm in routes/encounters.ts),
// a player must be able to spend their OWN character's action-economy slots.
// Resolves campaign_id + the participant's owning/controlling character (if
// any) via a single join, then applies the same "DM, or controller" shape as
// services/characters.ts's authorizeCharacterAction/requireControllerOrDm —
// pulled out as its own service function (rather than inlined in the route
// middleware) so this authorization boundary is directly testable without
// spinning up Express, matching this file's existing pure-function
// precedent (e.g. computeNextTurn).
export async function authorizeParticipantAction(
  pool: Pool,
  actorId: string,
  encounterId: string,
  participantId: string,
): Promise<CampaignRole> {
  const result = await pool.query<{ campaign_id: string; owner_user_id: string | null; controller_user_id: string | null }>(
    `SELECT e.campaign_id, c.owner_user_id, c.controller_user_id
       FROM combat_participants cp
       JOIN encounters e ON e.id = cp.encounter_id
       LEFT JOIN characters c ON c.id = cp.character_id
      WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Participant');

  const role = await requireMembership(pool, row.campaign_id, actorId);
  // row.owner_user_id/controller_user_id are both NULL for NPC characters
  // (no owning/controlling player) and for monster-instance participants
  // (the LEFT JOIN finds no characters row at all) — requireControllerOrDm
  // treats null-both as "no non-DM may touch this", exactly right for both
  // cases. Iteration 2 "Character ownership vs. control": this is an "act
  // right now" check (spend this participant's action economy/move its
  // token), so it's control-gated, not ownership-gated — a player the DM
  // has delegated this PC to for the scene can act for it even though they
  // don't own it.
  requireControllerOrDm(role, row.controller_user_id, row.owner_user_id, actorId);
  return role;
}

// Per-turn action economy (Phase 3.6). Locks the participant row so a
// double-click can't spend the same slot twice via a race — the CONFLICT
// check and the write happen against the same locked row within one
// transaction, same pattern as monsters.ts's createMonsterInstance.
export async function applyActionEconomy(
  pool: Pool,
  encounterId: string,
  participantId: string,
  input: ApplyActionEconomyInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<ParticipantRow>(
      `SELECT * FROM combat_participants WHERE id = $1 AND encounter_id = $2 FOR UPDATE`,
      [participantId, encounterId],
    );
    const current = locked.rows[0];
    if (!current) throw notFound('Participant');

    // Reactions are the one legitimate off-turn spend (an opportunity attack,
    // a readied response) — every other spend (action, bonus action, object
    // interaction, or bare movement) must happen on the spender's own turn.
    if (input.spend !== 'reaction') {
      const encounter = await fetchEncounterById(client, encounterId);
      requireCurrentTurn(encounter, current);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    // docs/rules/actions.md §2.4: snapshot the PRE-mutation value of every
    // column this call is about to touch, so a single undo call can restore
    // exactly this spend (and only this spend) — see ActionEconomySnapshot.
    const snapshot: Record<string, boolean | number> = {};

    if (input.spend) {
      const column = `${input.spend}_used`;
      if (current[column] === true) {
        throw new AppError('CONFLICT', `That participant's ${input.spend.replace('_', ' ')} has already been used this turn`);
      }
      sets.push(`${column} = true`);
      snapshot[column] = false;
      if (input.spend === 'action' && input.dash) {
        sets.push(`dash_used = true`);
        snapshot.dash_used = current.dash_used;
      }
    }
    if (input.addMovementFt !== undefined) {
      sets.push(`movement_used_ft = movement_used_ft + $${i}`);
      values.push(input.addMovementFt);
      i++;
      snapshot.movement_used_ft = current.movement_used_ft;
    }

    values.push(JSON.stringify(snapshot));
    const snapshotParam = i++;
    sets.push(`last_action_economy_snapshot = $${snapshotParam}::jsonb`);

    values.push(participantId, encounterId);
    const idParam = i++;
    const encounterParam = i;
    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET ${sets.join(', ')} WHERE id = $${idParam} AND encounter_id = $${encounterParam} RETURNING *`,
      values,
    );
    const participant = updated.rows[0]!;

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// REFACTOR-PLAN.md §5 / docs/rules/actions.md §2.4: DM-only "undo last
// consumption." Restores exactly the columns the last applyActionEconomy
// call touched (per its stored snapshot) — not a guessed decrement, and not
// scoped to "this turn," since a readied action's reaction can fire (and
// need undoing) turns after the action slot that readied it was spent
// (docs/rules/actions.md §3's sharpest flagged edge case).
export async function undoActionEconomy(
  pool: Pool,
  encounterId: string,
  participantId: string,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<ParticipantRow>(
      `SELECT * FROM combat_participants WHERE id = $1 AND encounter_id = $2 FOR UPDATE`,
      [participantId, encounterId],
    );
    const current = locked.rows[0];
    if (!current) throw notFound('Participant');
    if (!current.last_action_economy_snapshot) {
      throw new AppError('CONFLICT', 'Nothing to undo for that participant');
    }

    const snapshot = current.last_action_economy_snapshot;
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [column, value] of Object.entries(snapshot)) {
      sets.push(`${column} = $${i}`);
      values.push(value);
      i++;
    }
    sets.push('last_action_economy_snapshot = NULL');

    values.push(participantId, encounterId);
    const idParam = i++;
    const encounterParam = i;
    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET ${sets.join(', ')} WHERE id = $${idParam} AND encounter_id = $${encounterParam} RETURNING *`,
      values,
    );
    const participant = updated.rows[0]!;

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: encounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- Combat snapshot for the sockets layer (FULL_STATE_SYNC) ----
//
// Enriches the bare combat_participants rows with the display name and
// current HP figures — HP/AC/effects are all always-visible now (hide/
// reveal was removed), so this stays a plain read used identically by every
// caller.

export interface CombatSnapshotParticipant {
  participant_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  name: string;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  armor_class: number;
  is_pc: boolean | null;
  pos_x: number | null;
  pos_y: number | null;
  // Phase 3.6: per-turn 5e action economy — reset by advanceTurn for
  // whichever participant's turn is starting (see that function's comment).
  action_used: boolean;
  bonus_action_used: boolean;
  reaction_used: boolean;
  dash_used: boolean;
  movement_used_ft: number;
  // REFACTOR-PLAN.md §5 / docs/rules/actions.md §1.6: a fourth per-turn
  // tracked resource, distinct from the three economy slots above.
  object_interaction_used: boolean;
  // Null for character participants; a monster instance's alive/dead/fled/
  // captured status. REFACTOR-PLAN.md §1: the map view only spawns a token
  // for status='alive' instances — a dead monster stays in the initiative
  // roster (so its turn can still be skipped/removed deliberately) but
  // shouldn't visually reappear on the board.
  monster_instance_status: 'alive' | 'dead' | 'fled' | 'captured' | null;
  // REFACTOR-PLAN.md §3 (docs/rules/creature-sizes.md): monster catalog size
  // string (free text, Title Case by seeded convention — 'Tiny'..'Gargantuan'
  // — see that doc's normalization-gap note). Characters have no size column
  // at all today, so PC/NPC-character participants always resolve to the
  // 'Medium' fallback here rather than leaving the footprint undefined.
  size: string;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
  // Base walking speed in feet, used purely to DISPLAY a movement budget
  // (speed, doubled if dash_used) client-side — never enforced server-side
  // as a hard cap (matches this app's existing "display-only, DM
  // adjudicates" precedent for stealth-disadvantage/str-requirement flags).
  // Characters store speed as a plain int column; monsters store it in a
  // speed JSONB whose 'walk' value has historically been either a bare
  // number (homebrew, per schemas/monsterCatalog.ts) or a display string
  // like "30 ft." (the original seeded bestiary, never force-migrated) — the
  // regexp strips non-digits so either shape resolves to a usable int.
  speed_ft: number | null;
  // Battle map token art (nav point 4 bug fix): a character's uploaded
  // portrait, or a monster's homebrew art upload / catalog image_url,
  // resolved to a displayable URL here (not just the bare FK) since this is
  // the one query FULL_STATE_SYNC's token rendering actually reads from —
  // see Token.tsx's former "no image in the payload at all" note.
  image_url: string | null;
  // Encounter visibility by state (nav point 1) — filtering by this happens
  // one layer up, in buildFullStateSyncPayload, not here: this snapshot stays
  // the full/authoritative internal read (turn order, movement validation,
  // and action-economy logic all need every participant, hidden or not).
  visible_to_players: boolean;
}

export interface CombatSnapshot {
  encounter: EncounterRow;
  participants: CombatSnapshotParticipant[];
}

export async function getEncounterCombatSnapshot(pool: Pool | PoolClient, encounterId: string): Promise<CombatSnapshot> {
  const encounter = await fetchEncounterById(pool, encounterId);
  const result = await pool.query<CombatSnapshotParticipant>(
    `SELECT cp.id AS participant_id, cp.character_id, cp.monster_instance_id,
            cp.initiative_roll, cp.initiative_tiebreak, cp.turn_order,
            cp.pos_x, cp.pos_y,
            cp.action_used, cp.bonus_action_used, cp.reaction_used, cp.dash_used, cp.movement_used_ft,
            cp.object_interaction_used,
            COALESCE(c.name, mi.custom_name, m.name) AS name,
            COALESCE(c.hp_current, mi.hp_current) AS hp_current,
            COALESCE(c.hp_max, mi.hp_max_override, m.hit_point_average) AS hp_max,
            COALESCE(c.hp_temp, mi.hp_temp) AS hp_temp,
            COALESCE(c.armor_class, mi.armor_class_override, m.armor_class) AS armor_class,
            c.is_pc,
            mi.status AS monster_instance_status,
            COALESCE(m.size, 'Medium') AS size,
            cp.faction,
            COALESCE(c.speed, NULLIF(regexp_replace(COALESCE(m.speed->>'walk', ''), '[^0-9]', '', 'g'), '')::int) AS speed_ft,
            COALESCE(ca_char.file_url, ca_monster.file_url, m.image_url) AS image_url,
            cp.visible_to_players
     FROM combat_participants cp
     LEFT JOIN characters c ON c.id = cp.character_id
     LEFT JOIN campaign_assets ca_char ON ca_char.id = c.portrait_asset_id
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     LEFT JOIN campaign_assets ca_monster ON ca_monster.id = m.art_asset_id
     WHERE cp.encounter_id = $1
     ORDER BY cp.turn_order ASC`,
    [encounterId],
  );
  return { encounter, participants: result.rows };
}

export async function createEncounter(pool: Pool, campaignId: string, input: CreateEncounterInput) {
  const result = await pool.query(
    `INSERT INTO encounters (campaign_id, name) VALUES ($1, $2) RETURNING *`,
    [campaignId, input.name],
  );
  return result.rows[0];
}

export async function updateEncounter(
  pool: Pool,
  campaignId: string,
  encounterId: string,
  input: UpdateEncounterInput,
) {
  await fetchEncounterScoped(pool, campaignId, encounterId);
  if (input.name === undefined) {
    return fetchEncounterScoped(pool, campaignId, encounterId);
  }
  const result = await pool.query(`UPDATE encounters SET name = $1 WHERE id = $2 RETURNING *`, [input.name, encounterId]);
  return result.rows[0];
}

export async function deleteEncounter(pool: Pool, campaignId: string, encounterId: string): Promise<void> {
  await fetchEncounterScoped(pool, campaignId, encounterId);
  await pool.query(`DELETE FROM encounters WHERE id = $1`, [encounterId]);
}

// ---- Lifecycle (flat /encounters/:id/start|end — campaign derived from the row) ----

export async function startEncounter(pool: Pool, encounterId: string) {
  const encounter = await fetchEncounterById(pool, encounterId);
  if (encounter.status !== 'preparing') {
    throw new AppError('CONFLICT', `Cannot start an encounter in status '${encounter.status}' (must be 'preparing')`);
  }
  const result = await pool.query(
    `UPDATE encounters SET status = 'active', current_round = 1, started_at = now(), sync_seq = sync_seq + 1
     WHERE id = $1 RETURNING *`,
    [encounterId],
  );
  return result.rows[0];
}

export async function endEncounter(pool: Pool, encounterId: string) {
  const encounter = await fetchEncounterById(pool, encounterId);
  if (encounter.status !== 'active' && encounter.status !== 'paused') {
    throw new AppError('CONFLICT', `Cannot end an encounter in status '${encounter.status}'`);
  }
  const result = await pool.query(
    `UPDATE encounters SET status = 'completed', ended_at = now(), sync_seq = sync_seq + 1
     WHERE id = $1 RETURNING *`,
    [encounterId],
  );
  return result.rows[0];
}

// Exploration/combat mode is a DM toggle fully independent of status/start/
// end — no transition restrictions, callable in any status, so a DM can
// e.g. allow free-roam movement mid-"active" encounter for out-of-initiative
// narrative movement without ending combat first.
// Exploration/combat mode is a DM toggle fully independent of status/start/
// end — no transition restrictions, callable in any status (unchanged from
// before the map-first encounter system). The new "Start combat" UI action
// calls startCombat instead of this directly, since entering combat that way
// also rolls initiative and sets the active-participant pointer atomically —
// but this raw toggle stays available for combat -> exploration ("End
// combat"), which is deliberately a plain single-column update: it preserves
// active_participant_id/turn_order/positions/HP/conditions/participants
// untouched, so the map returns to free-roam exploration with everything
// exactly as combat left it.
export async function setEncounterMode(pool: Pool, encounterId: string, input: SetEncounterModeInput): Promise<EncounterRow> {
  const result = await pool.query<EncounterRow>(
    `UPDATE encounters SET mode = $1, sync_seq = sync_seq + 1 WHERE id = $2 RETURNING *`,
    [input.mode, encounterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row;
}

// Encounter-level disposition (see 1784269787666's header comment for why
// this is a logged transition rather than a raw field, and how it differs
// from combat_participants.faction). `fromDisposition` is read from the row
// inside the same transaction, not trusted from the caller, so the history
// is always accurate even under a race between two DMs. A no-op transition
// (toDisposition === current) is rejected rather than silently logged, since
// "why did the disposition change to the same thing" would be a confusing
// history entry with no real event behind it.
export interface DispositionMutationResult {
  encounter: EncounterRow;
  event: EncounterDispositionEventRow;
}

export async function transitionDisposition(
  pool: Pool,
  encounterId: string,
  input: TransitionDispositionInput,
  changedByUserId: string,
): Promise<DispositionMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query<EncounterRow>(
      `SELECT * FROM encounters WHERE id = $1 FOR UPDATE`,
      [encounterId],
    );
    const before = current.rows[0];
    if (!before) throw notFound('Encounter');

    if (before.disposition === input.toDisposition) {
      throw new AppError('VALIDATION_ERROR', `Encounter is already ${input.toDisposition}`);
    }

    const updated = await client.query<EncounterRow>(
      `UPDATE encounters SET disposition = $1, sync_seq = sync_seq + 1 WHERE id = $2 RETURNING *`,
      [input.toDisposition, encounterId],
    );
    const encounter = updated.rows[0]!;

    const eventRes = await client.query<EncounterDispositionEventRow>(
      `INSERT INTO encounter_disposition_events
         (encounter_id, from_disposition, to_disposition, changed_by_user_id, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [encounterId, before.disposition, input.toDisposition, changedByUserId, input.note ?? null],
    );

    await client.query('COMMIT');
    return { encounter, event: eventRes.rows[0]! };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listDispositionEvents(pool: Pool, encounterId: string): Promise<EncounterDispositionEventRow[]> {
  const result = await pool.query<EncounterDispositionEventRow>(
    `SELECT * FROM encounter_disposition_events WHERE encounter_id = $1 ORDER BY created_at DESC`,
    [encounterId],
  );
  return result.rows;
}

// ---- Participants (flat /encounters/:id/participants — campaign derived from the row) ----

// Both addParticipant and removeParticipant now return the bumped encounter
// row alongside the participant, because PARTICIPANT_JOINED/PARTICIPANT_LEFT
// broadcasts need {encounterId, campaignId, seq} in the same envelope as
// every other event (PLAN.md §5.2) — sync_seq is bumped in the SAME
// transaction as the insert/delete, not as a separate follow-up query.

export interface ParticipantMutationResult {
  encounter: EncounterRow;
  participant: ParticipantRow;
}

export async function addParticipant(
  pool: Pool,
  encounterId: string,
  input: AddParticipantInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounterRes = await client.query<EncounterRow>(`SELECT * FROM encounters WHERE id = $1 FOR UPDATE`, [encounterId]);
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    const joinedRound = Math.max(1, encounter.current_round);

    const existingCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM combat_participants WHERE encounter_id = $1`,
      [encounterId],
    );
    const turnOrder = Number(existingCount.rows[0]!.count);

    // Default faction: player for PCs, enemy otherwise — looked up rather
    // than assumed from "is this a character row at all", since the
    // characters table holds NPCs too.
    let defaultFaction: 'player' | 'enemy' = 'enemy';
    if (input.characterId != null) {
      const pcRes = await client.query<{ is_pc: boolean }>(`SELECT is_pc FROM characters WHERE id = $1`, [input.characterId]);
      if (pcRes.rows[0]?.is_pc) {
        defaultFaction = 'player';
      }
    }

    let participant: ParticipantRow;
    try {
      const result = await client.query<ParticipantRow>(
        `INSERT INTO combat_participants
           (encounter_id, character_id, monster_instance_id, initiative_roll, initiative_tiebreak, turn_order, joined_round, faction)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          encounterId,
          input.characterId ?? null,
          input.monsterInstanceId ?? null,
          input.initiativeRoll ?? UNROLLED_INITIATIVE,
          null, // tiebreak is only meaningful once /roll-initiative computes a real dex-mod tiebreak
          turnOrder,
          joinedRound,
          input.faction ?? defaultFaction,
        ],
      );
      participant = result.rows[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'That character or monster instance is already a participant in this encounter');
      }
      throw err;
    }

    // Joining mid-combat: a token every other participant already has a
    // real initiative roll and a turn_order slotted by it (per this
    // encounter's own mode/status, not a global assumption) gets one too,
    // right now, rather than sitting at the tail end unrolled until the DM
    // remembers to re-roll. rollAndReorderInitiative(force=false) only rolls
    // participants still at the UNROLLED_INITIATIVE sentinel — since every
    // existing participant already got rolled by startCombat, this only
    // touches the one just inserted — then resequences turn_order for
    // everyone by the resulting ranking; syncActiveParticipantTurnIndex
    // re-derives current_turn_index afterward in case that resequencing
    // shifted the currently-active participant's own turn_order value.
    // Skipped when the caller supplied an explicit initiativeRoll (DM
    // override) — that participant isn't "unrolled" so there's nothing to do.
    if (input.initiativeRoll === undefined && encounter.mode === 'combat' && encounter.status === 'active') {
      await rollAndReorderInitiative(client, encounterId, false);
      await syncActiveParticipantTurnIndex(client, encounterId);
      const refreshed = await client.query<ParticipantRow>(`SELECT * FROM combat_participants WHERE id = $1`, [participant.id]);
      participant = refreshed.rows[0]!;
    }

    const updatedEncounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    return { encounter: updatedEncounterRes.rows[0]!, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeParticipant(
  pool: Pool,
  encounterId: string,
  participantId: string,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounterRes = await client.query<EncounterRow>(`SELECT * FROM encounters WHERE id = $1 FOR UPDATE`, [encounterId]);
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');

    const deleted = await client.query<ParticipantRow>(
      `DELETE FROM combat_participants WHERE id = $1 AND encounter_id = $2 RETURNING *`,
      [participantId, encounterId],
    );
    const participant = deleted.rows[0];
    if (!participant) throw notFound('Participant');

    // "A token deleted while it is the active combatant" (map-first
    // encounter system): removeParticipant is the one mutation that can
    // orphan active_participant_id (ON DELETE SET NULL just fired), so
    // resolve who picks up next here rather than leaving the encounter
    // stuck with a null pointer until the next unrelated advance-turn call.
    // Only meaningful while a round is actually live — outside 'active'
    // status, turn order is inert (matches requireCurrentTurn's own
    // "no-op outside active" rule).
    let finalEncounter = encounter;
    if (encounter.status === 'active' && encounter.active_participant_id === participant.id) {
      const remainingRes = await client.query<{ id: string; turn_order: number }>(
        `SELECT id, turn_order FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
        [encounterId],
      );
      if (remainingRes.rows.length === 0) {
        const clearedRes = await client.query<EncounterRow>(
          `UPDATE encounters SET active_participant_id = NULL, sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
          [encounterId],
        );
        finalEncounter = clearedRes.rows[0]!;
      } else {
        const { nextTurnOrder, nextRound } = computeNextTurn(
          remainingRes.rows.map((r) => r.turn_order),
          participant.turn_order,
          encounter.current_round,
        );
        const next = remainingRes.rows.find((r) => r.turn_order === nextTurnOrder)!;
        const advancedRes = await client.query<EncounterRow>(
          `UPDATE encounters
           SET active_participant_id = $1, current_turn_index = $2, current_round = $3, sync_seq = sync_seq + 1
           WHERE id = $4 RETURNING *`,
          [next.id, nextTurnOrder, nextRound, encounterId],
        );
        finalEncounter = advancedRes.rows[0]!;
      }
    } else {
      const bumpedRes = await client.query<EncounterRow>(
        `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
        [encounterId],
      );
      finalEncounter = bumpedRes.rows[0]!;
    }

    await client.query('COMMIT');
    return { encounter: finalEncounter, participant };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setParticipantInitiative(
  pool: Pool,
  encounterId: string,
  participantId: string,
  input: SetInitiativeInput,
) {
  const result = await pool.query(
    `UPDATE combat_participants
     SET initiative_roll = $1, initiative_tiebreak = $2
     WHERE id = $3 AND encounter_id = $4
     RETURNING *`,
    [input.initiativeRoll, input.initiativeTiebreak ?? null, participantId, encounterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Participant');
  return row;
}

export function dexModifier(dexScore: number): number {
  return Math.floor((dexScore - 10) / 2);
}

// Round-robin turn advancement: given every remaining participant's
// turn_order (ascending, need not be dense/contiguous) and whichever
// turn_order value is currently active, finds the next one strictly greater
// than it, wrapping to the lowest and incrementing the round when there
// isn't one. Operating on turn_order VALUES rather than a positional index
// is what makes this immune to gaps (a participant removed mid-combat) and
// insertions (a latecomer's turn_order slotted in by initiative, not
// appended) — see 1784269784666_add-active-participant-tracking.ts.
// Reused by advanceTurn (currentTurnOrder = whoever's turn just ended) and
// removeParticipant (currentTurnOrder = whoever was JUST DELETED, to find
// who picks up next) — deleting the last-in-order active combatant wraps
// and increments the round exactly like a normal turn ending would, which
// is the intended behavior, not a special case. Pulled out as a pure
// function so the round-wrap boundary condition can be unit tested directly.
export function computeNextTurn(
  sortedTurnOrders: number[],
  currentTurnOrder: number,
  currentRound: number,
): { nextTurnOrder: number; nextRound: number } {
  const next = sortedTurnOrders.find((t) => t > currentTurnOrder);
  if (next !== undefined) {
    return { nextTurnOrder: next, nextRound: currentRound };
  }
  return { nextTurnOrder: sortedTurnOrders[0]!, nextRound: currentRound + 1 };
}

// docs/rules/actions.md:113 flagged this as a known gap: no endpoint that
// spends a per-turn resource (action economy, shove) ever checked whose turn
// it actually was — authorization only verified "own character or DM," not
// turn order. Pure and directly testable, same precedent as computeNextTurn.
// No-ops outside live combat (preparing/paused/completed) — turn order is
// meaningless until a round is actually active.
export function requireCurrentTurn(
  encounter: Pick<EncounterRow, 'status' | 'current_turn_index'>,
  participant: Pick<ParticipantRow, 'turn_order'>,
): void {
  if (encounter.status !== 'active') return;
  if (participant.turn_order !== encounter.current_turn_index) {
    throw new AppError('CONFLICT', "It isn't that participant's turn", { reason: 'NOT_YOUR_TURN' });
  }
}

// Shared roll-and-resequence core, used by both the standalone /roll-initiative
// route (rollInitiative below) and startCombat: rolls a d20+dex-mod for every
// participant that needs one (force=true re-rolls everyone; force=false only
// the still-unrolled sentinel), then re-sequences EVERY participant's
// turn_order to match the resulting initiative ranking. Throws CONFLICT if
// there's nobody to roll for. Runs on an already-open transaction — callers
// own BEGIN/COMMIT/ROLLBACK.
async function rollAndReorderInitiative(client: PoolClient, encounterId: string, force: boolean): Promise<void> {
  // Dex modifiers for every participant, sourced from characters.dex or
  // (via the monster catalog) monsters.dex for monster instances.
  const dexRes = await client.query<{ id: string; dex: number }>(
    `SELECT cp.id, COALESCE(c.dex, m.dex) AS dex
     FROM combat_participants cp
     LEFT JOIN characters c ON c.id = cp.character_id
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     WHERE cp.encounter_id = $1`,
    [encounterId],
  );

  const participants = await fetchParticipants(client, encounterId);
  if (participants.length === 0) {
    throw new AppError('CONFLICT', 'This encounter has no participants to roll initiative for');
  }
  const dexById = new Map(dexRes.rows.map((r) => [r.id, r.dex]));

  for (const participant of participants) {
    const needsRoll = force || participant.initiative_roll === UNROLLED_INITIATIVE;
    if (!needsRoll) continue;
    const mod = dexModifier(dexById.get(participant.id) ?? 10);
    const d20 = 1 + Math.floor(Math.random() * 20);
    await client.query(
      `UPDATE combat_participants SET initiative_roll = $1, initiative_tiebreak = $2 WHERE id = $3`,
      [d20 + mod, mod, participant.id],
    );
  }

  await reorderTurnOrderByInitiative(client, encounterId);
}

// Re-sort turn_order by the current initiative ranking: highest roll first,
// dex-mod tiebreak, then id for a stable final tiebreak. Reassigns
// turn_order to EVERY participant, including ones already mid-combat — safe
// (unlike the old dense-index scheme) only because whoever's actually active
// is tracked by active_participant_id, an id, not a position;
// syncActiveParticipantTurnIndex (called by every caller of this function)
// re-derives current_turn_index from that id's freshly-assigned turn_order
// right after, so a mid-combat re-roll, a latecomer's insertion, or a batch
// spawn can never leave current_turn_index pointing at the wrong
// participant. Exported for services/spawn.ts, which rolls real initiative
// values for newly-spawned participants directly (no UNROLLED_INITIATIVE
// sentinel involved) and then needs this same resequencing step without
// going through rollAndReorderInitiative's own dice-rolling pass.
export async function reorderTurnOrderByInitiative(client: PoolClient, encounterId: string): Promise<void> {
  const reordered = await client.query<ParticipantRow>(
    `SELECT * FROM combat_participants WHERE encounter_id = $1
     ORDER BY initiative_roll DESC, initiative_tiebreak DESC NULLS LAST, id ASC`,
    [encounterId],
  );
  for (let i = 0; i < reordered.rows.length; i++) {
    await client.query(`UPDATE combat_participants SET turn_order = $1 WHERE id = $2`, [i, reordered.rows[i]!.id]);
  }
}

// Re-derives encounters.current_turn_index from active_participant_id's
// live turn_order — call after anything that might have reassigned
// turn_order values (rollAndReorderInitiative) or moved the active pointer
// itself. No-op when the encounter isn't active or has no active participant
// yet (e.g. before startCombat has ever run).
export async function syncActiveParticipantTurnIndex(client: PoolClient, encounterId: string): Promise<void> {
  await client.query(
    `UPDATE encounters e
     SET current_turn_index = cp.turn_order
     FROM combat_participants cp
     WHERE e.id = $1 AND e.active_participant_id = cp.id AND e.status = 'active'`,
    [encounterId],
  );
}

export async function rollInitiative(pool: Pool, encounterId: string, force: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await rollAndReorderInitiative(client, encounterId, force);
    await syncActiveParticipantTurnIndex(client, encounterId);

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );

    await client.query('COMMIT');
    const finalParticipants = await fetchParticipants(pool, encounterId);
    return { encounter: encounterRes.rows[0], participants: finalParticipants };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Map-first encounter system — the atomic "Start combat" action: rolls
// initiative for everyone who doesn't have one yet, sets mode='combat',
// starts round 1 of THIS fight (a fresh round count each time combat
// (re)starts, even within the same still-open encounter/map session — round
// number is a combat-specific concept with no meaning during exploration),
// and points active_participant_id/current_turn_index at whoever rolled
// highest. One button, one transaction, one broadcast — replaces the old
// two-click "toggle mode, then separately roll initiative" flow. Rejects
// with the same zero-participants CONFLICT rollAndReorderInitiative already
// throws (nothing DM-added means nothing to fight with).
export async function startCombat(pool: Pool, encounterId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounterRes = await client.query<EncounterRow>(`SELECT * FROM encounters WHERE id = $1 FOR UPDATE`, [encounterId]);
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    if (encounter.status !== 'active') {
      throw new AppError('CONFLICT', `Cannot start combat on an encounter in status '${encounter.status}' (must be 'active')`);
    }

    await rollAndReorderInitiative(client, encounterId, false);

    const firstRes = await client.query<{ id: string }>(
      `SELECT id FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC LIMIT 1`,
      [encounterId],
    );
    const first = firstRes.rows[0]!;

    const updatedRes = await client.query<EncounterRow>(
      `UPDATE encounters
       SET mode = 'combat', current_round = 1, current_turn_index = 0, active_participant_id = $1, sync_seq = sync_seq + 1
       WHERE id = $2 RETURNING *`,
      [first.id, encounterId],
    );

    await client.query('COMMIT');
    const participants = await fetchParticipants(pool, encounterId);
    return { encounter: updatedRes.rows[0]!, participants };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- Turn advancement ----
//
// The one function the real-time-sync layer will import directly (per the
// task brief) rather than going through HTTP — kept dependency-free of
// req/res so it's a clean import for a socket handler.

// A `duration_type = 'rounds'` active_effects row decremented to <= 0 by
// this turn advance, joined with its effect_definitions.name so the sockets
// layer can broadcast EFFECT_EXPIRED without a second fetch. Only 'rounds'
// effects are touched here — 'minutes'/'hours'/'until_save'/'until_removed'/
// 'permanent'/'special' are explicitly out of scope for automatic expiry
// (DM removes those manually via DELETE /effects/:id), per this task's brief.
export interface ExpiredEffectRow {
  id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  effect_definition_id: string;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: string | null;
  effect_definition_name: string;
}

export interface AdvanceTurnResult {
  encounter: EncounterRow;
  participants: ParticipantRow[];
  expiredEffects: ExpiredEffectRow[];
}

export async function advanceTurn(pool: Pool, encounterId: string): Promise<AdvanceTurnResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounterRes = await client.query<EncounterRow>(
      `SELECT * FROM encounters WHERE id = $1 FOR UPDATE`,
      [encounterId],
    );
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    if (encounter.status !== 'active') {
      throw new AppError('CONFLICT', `Cannot advance turn on an encounter in status '${encounter.status}' (must be 'active')`);
    }

    const turnOrdersRes = await client.query<{ turn_order: number }>(
      `SELECT turn_order FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
      [encounterId],
    );
    if (turnOrdersRes.rows.length === 0) {
      throw new AppError('CONFLICT', 'This encounter has no participants to advance through');
    }

    const { nextTurnOrder, nextRound } = computeNextTurn(
      turnOrdersRes.rows.map((r) => r.turn_order),
      encounter.current_turn_index,
      encounter.current_round,
    );

    // Fresh action economy for whoever's turn is starting. turn_order need
    // not be dense anymore (see computeNextTurn's header comment), so
    // nextTurnOrder is looked up by value, not treated as a positional index.
    const startingRes = await client.query<{ id: string; character_id: string | null; monster_instance_id: string | null }>(
      `UPDATE combat_participants
       SET action_used = false, bonus_action_used = false, reaction_used = false,
           dash_used = false, movement_used_ft = 0, object_interaction_used = false,
           last_action_economy_snapshot = NULL
       WHERE encounter_id = $1 AND turn_order = $2
       RETURNING id, character_id, monster_instance_id`,
      [encounterId, nextTurnOrder],
    );
    const nextParticipantId = startingRes.rows[0]!.id;

    const updatedRes = await client.query<EncounterRow>(
      `UPDATE encounters
       SET current_turn_index = $1, current_round = $2, active_participant_id = $3, sync_seq = sync_seq + 1
       WHERE id = $4
       RETURNING *`,
      [nextTurnOrder, nextRound, nextParticipantId, encounterId],
    );

    // Round-based effect expiry, in the SAME transaction as the turn advance
    // itself (a crash between the two must never leave turn state advanced
    // but a 'rounds' effect un-decremented, or vice versa). Two-step: first
    // decrement every still-active 'rounds' effect on this encounter, then
    // soft-delete (removed_at) whichever of those just hit zero.
    const decremented = await client.query<{ id: string; duration_value: number | null }>(
      `UPDATE active_effects
       SET duration_value = duration_value - 1
       WHERE encounter_id = $1 AND duration_type = 'rounds' AND removed_at IS NULL AND duration_value IS NOT NULL
       RETURNING id, duration_value`,
      [encounterId],
    );
    const expiredIds = decremented.rows.filter((r) => (r.duration_value ?? 0) <= 0).map((r) => r.id);

    let expiredEffects: ExpiredEffectRow[] = [];
    if (expiredIds.length > 0) {
      const expiredRes = await client.query<ExpiredEffectRow>(
        `UPDATE active_effects ae
         SET removed_at = now()
         FROM effect_definitions ed
         WHERE ae.id = ANY($1::uuid[]) AND ed.id = ae.effect_definition_id
         RETURNING ae.id, ae.character_id, ae.monster_instance_id, ae.effect_definition_id,
                   ae.duration_type, ae.duration_value, ae.concentration, ae.source_character_id,
                   ed.name AS effect_definition_name`,
        [expiredIds],
      );
      expiredEffects = expiredRes.rows;
    }

    // Dodge (docs/rules/actions.md's Dodge section): "until the start of
    // YOUR next turn" is a per-participant trigger, not a global round
    // countdown, so it can't use the 'rounds' decrement path above — instead
    // directly soft-remove any still-live Dodge effect belonging to
    // whichever participant's turn is starting right now.
    const startingParticipant = startingRes.rows[0];
    const dodgeTargetColumn = startingParticipant?.character_id != null ? 'character_id' : 'monster_instance_id';
    const dodgeTargetId = startingParticipant?.character_id ?? startingParticipant?.monster_instance_id ?? null;
    if (dodgeTargetId != null) {
      const dodgeExpiredRes = await client.query<ExpiredEffectRow>(
        `UPDATE active_effects ae
         SET removed_at = now()
         FROM effect_definitions ed
         WHERE ae.effect_definition_id = ed.id AND ed.name = 'Dodge'
           AND ae.removed_at IS NULL AND ae.${dodgeTargetColumn} = $1
         RETURNING ae.id, ae.character_id, ae.monster_instance_id, ae.effect_definition_id,
                   ae.duration_type, ae.duration_value, ae.concentration, ae.source_character_id,
                   ed.name AS effect_definition_name`,
        [dodgeTargetId],
      );
      expiredEffects = [...expiredEffects, ...dodgeExpiredRes.rows];
    }

    await client.query('COMMIT');
    const participants = await fetchParticipants(pool, encounterId);
    return { encounter: updatedRes.rows[0]!, participants, expiredEffects };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
