// Encounter + combat-participant business logic. Kept as plain functions
// (not embedded in route handlers) per the task brief: advanceTurn in
// particular is the hook point the real-time-sync agent will import and call
// directly from a socket handler next, so it must not depend on Express
// req/res.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isUniqueViolation } from './dbErrors.js';
import { requireMembership, requireOwnerOrDm, type CampaignRole } from './authz.js';
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
  SetInitiativeInput,
  SetParticipantFactionInput,
  SetParticipantPositionInput,
  UpdateEncounterInput,
  UpsertEncounterMapInput,
} from '../schemas/encounters.js';

// combat_participants.initiative_roll is NOT NULL (PLAN.md schema), so
// "hasn't been rolled yet" needs a sentinel rather than NULL. A real d20+mod
// roll is realistically never this low, so collision risk is negligible.
const UNROLLED_INITIATIVE = -9999;

interface EncounterRow {
  id: number;
  campaign_id: number;
  status: 'preparing' | 'active' | 'paused' | 'completed';
  current_round: number;
  current_turn_index: number;
  sync_seq: number;
  [key: string]: unknown;
}

interface ParticipantRow {
  id: number;
  encounter_id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  hp_visibility: 'exact' | 'banded' | 'hidden';
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
  campaignId: number,
  encounterId: number,
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
async function fetchEncounterById(client: Pool | PoolClient, encounterId: number): Promise<EncounterRow> {
  const result = await client.query<EncounterRow>(`SELECT * FROM encounters WHERE id = $1`, [encounterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row;
}

async function fetchParticipants(client: Pool | PoolClient, encounterId: number): Promise<ParticipantRow[]> {
  const result = await client.query<ParticipantRow>(
    `SELECT * FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
    [encounterId],
  );
  return result.rows;
}

// ---- CRUD (nested under /campaigns/:id/encounters, DM-gated at the route) ----

export async function listEncounters(pool: Pool, campaignId: number) {
  const result = await pool.query(
    `SELECT * FROM encounters WHERE campaign_id = $1 ORDER BY created_at DESC`,
    [campaignId],
  );
  return result.rows;
}

export async function getEncounter(pool: Pool, campaignId: number, encounterId: number) {
  const encounter = await fetchEncounterScoped(pool, campaignId, encounterId);
  const participants = await fetchParticipants(pool, encounterId);
  const map = await getEncounterMap(pool, encounterId);
  return { ...encounter, participants, map: formatMapForWire(map) };
}

// Flat lookup by encounter id alone (REFACTOR-PLAN.md §1: /maps/:mapId — a
// standalone full-screen route with no campaignId in its URL, since
// encounter_maps is 1:1 with encounters and this app has no separate
// campaign-level map entity). Membership is derived from the encounter row
// itself, same pattern as requireEncounterDm in routes/encounters.ts, except
// read access here only needs membership, not the DM role.
export async function getEncounterFlat(pool: Pool, userId: number, encounterId: number) {
  const encounter = await fetchEncounterById(pool, encounterId);
  const role = await requireMembership(pool, encounter.campaign_id, userId);
  const full = await getEncounter(pool, encounter.campaign_id, encounterId);
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
  id: number;
  encounter_id: number;
  background_asset_id: number | null;
  background_file_url: string | null;
  grid_columns: number;
  grid_rows: number;
  cell_size_px: number;
  feet_per_cell: number;
}

export async function getEncounterMap(pool: Pool | PoolClient, encounterId: number): Promise<EncounterMapRow | null> {
  const result = await pool.query<EncounterMapRow>(
    `SELECT em.id, em.encounter_id, em.background_asset_id, ca.file_url AS background_file_url,
            em.grid_columns, em.grid_rows, em.cell_size_px, em.feet_per_cell
     FROM encounter_maps em
     LEFT JOIN campaign_assets ca ON ca.id = em.background_asset_id
     WHERE em.encounter_id = $1`,
    [encounterId],
  );
  return result.rows[0] ?? null;
}

export function formatMapForWire(map: EncounterMapRow | null) {
  if (!map) return null;
  return {
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

export async function listMapCellOverrides(pool: Pool, encounterId: number): Promise<MapCellOverrideRow[]> {
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
  encounterId: number,
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
  encounterId: number,
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
  campaignId: number,
  backgroundAssetId: number | null | undefined,
): Promise<void> {
  if (backgroundAssetId === null || backgroundAssetId === undefined) return;
  const result = await client.query<{ campaign_id: number }>(
    `SELECT campaign_id FROM campaign_assets WHERE id = $1`,
    [backgroundAssetId],
  );
  const row = result.rows[0];
  if (!row || Number(row.campaign_id) !== campaignId) {
    throw notFound('Asset');
  }
}

export interface EncounterMapMutationResult {
  encounter: EncounterRow;
  map: EncounterMapRow;
}

export async function upsertEncounterMap(
  pool: Pool,
  encounterId: number,
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

    // ON CONFLICT DO UPDATE only overwrites fields that were actually
    // supplied — COALESCE(new, existing) for the plain-number fields, and an
    // explicit boolean flag for background_asset_id since `null` is itself a
    // meaningful supplied value (clear it), not "leave it alone".
    await client.query(
      `INSERT INTO encounter_maps (encounter_id, background_asset_id, grid_columns, grid_rows, cell_size_px, feet_per_cell, updated_at)
       VALUES ($1, $2, COALESCE($3, 20), COALESCE($4, 20), COALESCE($5, 50), COALESCE($7, 5), now())
       ON CONFLICT (encounter_id) DO UPDATE SET
         background_asset_id = CASE WHEN $6 THEN $2 ELSE encounter_maps.background_asset_id END,
         grid_columns = COALESCE($3, encounter_maps.grid_columns),
         grid_rows = COALESCE($4, encounter_maps.grid_rows),
         cell_size_px = COALESCE($5, encounter_maps.cell_size_px),
         feet_per_cell = COALESCE($7, encounter_maps.feet_per_cell),
         updated_at = now()`,
      [
        encounterId,
        input.backgroundAssetId ?? null,
        input.gridColumns ?? null,
        input.gridRows ?? null,
        input.cellSizePx ?? null,
        backgroundAssetIdSupplied,
        input.feetPerCell ?? null,
      ],
    );

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
  const mapRes = await client.query<{ id: number; feet_per_cell: number; grid_columns: number; grid_rows: number }>(
    `SELECT id, feet_per_cell, grid_columns, grid_rows FROM encounter_maps WHERE encounter_id = $1`,
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
    occupants.set(`${row.pos_x},${row.pos_y}`, { participantId: -1, faction: row.faction, sizeRank: sizeRankFor(row.size) });
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
// blocking ordinary token-placement drag-and-drop outside a live turn).
// Returns null (no validation performed, move is free) when any of those
// apply, or when loadMovementContext can't build a usable context — this
// function never blocks a move it can't actually reason about.
async function computeValidatedMoveCost(
  client: PoolClient,
  encounter: EncounterRow,
  participant: ParticipantRow,
  to: { x: number | null; y: number | null },
): Promise<{ costFt: number } | null> {
  if (to.x === null || to.y === null) return null; // removal from the map
  if (participant.pos_x === null || participant.pos_y === null) return null; // initial placement
  if (encounter.status !== 'active') return null;

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
  encounterId: number,
  participantId: number,
): Promise<{ cells: string[]; remainingFt: number }> {
  const encounter = await fetchEncounterById(pool, encounterId);
  const participantRes = await pool.query<ParticipantRow>(
    `SELECT * FROM combat_participants WHERE id = $1 AND encounter_id = $2`,
    [participantId, encounterId],
  );
  const participant = participantRes.rows[0];
  if (!participant) throw notFound('Participant');
  if (participant.pos_x === null || participant.pos_y === null || encounter.status !== 'active') {
    return { cells: [], remainingFt: 0 };
  }

  const ctx = await loadMovementContext(pool, encounter, participant);
  if (!ctx) return { cells: [], remainingFt: 0 };

  const reachable = computeReachableSet(ctx.grid, ctx.mover, { x: participant.pos_x, y: participant.pos_y }, ctx.remainingFt);
  return { cells: [...reachable], remainingFt: ctx.remainingFt };
}

export async function setParticipantPosition(
  pool: Pool,
  encounterId: number,
  participantId: number,
  input: SetParticipantPositionInput,
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
    const validated = await computeValidatedMoveCost(client, encounter, locked, input);

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
  encounterId: number,
  participantId: number,
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

// Authorization for PATCH /encounters/:id/participants/:pid/action-economy
// (battle mode, REVISION-PLAN.md §10.2): unlike every other combat_participants
// mutation in this app (DM-only via requireEncounterDm in routes/encounters.ts),
// a player must be able to spend their OWN character's action-economy slots.
// Resolves campaign_id + the participant's owning character (if any) via a
// single join, then applies the same "DM, or owner" shape as
// services/characters.ts's authorizeCharacterMutation/requireOwnerOrDm —
// pulled out as its own service function (rather than inlined in the route
// middleware) so this authorization boundary is directly testable without
// spinning up Express, matching this file's existing pure-function
// precedent (e.g. computeNextTurn).
export async function authorizeParticipantAction(
  pool: Pool,
  actorId: number,
  encounterId: number,
  participantId: number,
): Promise<CampaignRole> {
  const result = await pool.query<{ campaign_id: number; owner_user_id: number | null }>(
    `SELECT e.campaign_id, c.owner_user_id
       FROM combat_participants cp
       JOIN encounters e ON e.id = cp.encounter_id
       LEFT JOIN characters c ON c.id = cp.character_id
      WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Participant');

  const role = await requireMembership(pool, row.campaign_id, actorId);
  // row.owner_user_id is NULL both for NPC characters (no owning player) and
  // for monster-instance participants (the LEFT JOIN finds no characters
  // row at all) — requireOwnerOrDm treats a null owner as "no non-DM may
  // touch this", which is exactly right for both cases.
  requireOwnerOrDm(role, row.owner_user_id, actorId);
  return role;
}

// Per-turn action economy (Phase 3.6). Locks the participant row so a
// double-click can't spend the same slot twice via a race — the CONFLICT
// check and the write happen against the same locked row within one
// transaction, same pattern as monsters.ts's createMonsterInstance.
export async function applyActionEconomy(
  pool: Pool,
  encounterId: number,
  participantId: number,
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
  encounterId: number,
  participantId: number,
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
// current HP figures (real-valued — the sockets/visibility.ts layer is
// responsible for banding/hiding those per hp_visibility before anything
// goes out over the wire; this function stays visibility-agnostic on
// purpose, same as any other plain read used by both DM and player call
// sites elsewhere in this file).

export interface CombatSnapshotParticipant {
  participant_id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  name: string;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  hp_visibility: 'exact' | 'banded' | 'hidden';
  hp_current: number;
  hp_max: number;
  hp_temp: number;
  armor_class: number;
  // NULL for monster-instance participants (no `characters` row to join) —
  // PLAN.md §11.6's armorClass redaction exempts PCs the same way
  // services/characters.ts already exempts them from HP redaction (`row.
  // is_pc`), so this needs to travel with the snapshot row too.
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
}

export interface CombatSnapshot {
  encounter: EncounterRow;
  participants: CombatSnapshotParticipant[];
}

export async function getEncounterCombatSnapshot(pool: Pool | PoolClient, encounterId: number): Promise<CombatSnapshot> {
  const encounter = await fetchEncounterById(pool, encounterId);
  const result = await pool.query<CombatSnapshotParticipant>(
    `SELECT cp.id AS participant_id, cp.character_id, cp.monster_instance_id,
            cp.initiative_roll, cp.initiative_tiebreak, cp.turn_order, cp.hp_visibility,
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
            COALESCE(c.speed, NULLIF(regexp_replace(COALESCE(m.speed->>'walk', ''), '[^0-9]', '', 'g'), '')::int) AS speed_ft
     FROM combat_participants cp
     LEFT JOIN characters c ON c.id = cp.character_id
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     WHERE cp.encounter_id = $1
     ORDER BY cp.turn_order ASC`,
    [encounterId],
  );
  return { encounter, participants: result.rows };
}

export async function createEncounter(pool: Pool, campaignId: number, input: CreateEncounterInput) {
  const result = await pool.query(
    `INSERT INTO encounters (campaign_id, name) VALUES ($1, $2) RETURNING *`,
    [campaignId, input.name],
  );
  return result.rows[0];
}

export async function updateEncounter(
  pool: Pool,
  campaignId: number,
  encounterId: number,
  input: UpdateEncounterInput,
) {
  await fetchEncounterScoped(pool, campaignId, encounterId);
  if (input.name === undefined) {
    return fetchEncounterScoped(pool, campaignId, encounterId);
  }
  const result = await pool.query(`UPDATE encounters SET name = $1 WHERE id = $2 RETURNING *`, [input.name, encounterId]);
  return result.rows[0];
}

export async function deleteEncounter(pool: Pool, campaignId: number, encounterId: number): Promise<void> {
  await fetchEncounterScoped(pool, campaignId, encounterId);
  await pool.query(`DELETE FROM encounters WHERE id = $1`, [encounterId]);
}

// ---- Lifecycle (flat /encounters/:id/start|end — campaign derived from the row) ----

export async function startEncounter(pool: Pool, encounterId: number) {
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

export async function endEncounter(pool: Pool, encounterId: number) {
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
  encounterId: number,
  input: AddParticipantInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounter = await fetchEncounterById(client, encounterId);
    const joinedRound = Math.max(1, encounter.current_round);

    const existingCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM combat_participants WHERE encounter_id = $1`,
      [encounterId],
    );
    const turnOrder = Number(existingCount.rows[0]!.count);

    // Default visibility (PLAN.md §5.3): exact for PCs, banded for NPCs and
    // monster instances — looked up rather than assumed from "is this a
    // character row at all", since the characters table holds NPCs too.
    let defaultVisibility: 'exact' | 'banded' = 'banded';
    let defaultFaction: 'player' | 'enemy' = 'enemy';
    if (input.characterId != null) {
      const pcRes = await client.query<{ is_pc: boolean }>(`SELECT is_pc FROM characters WHERE id = $1`, [input.characterId]);
      if (pcRes.rows[0]?.is_pc) {
        defaultVisibility = 'exact';
        defaultFaction = 'player';
      }
    }

    let participant: ParticipantRow;
    try {
      const result = await client.query<ParticipantRow>(
        `INSERT INTO combat_participants
           (encounter_id, character_id, monster_instance_id, initiative_roll, initiative_tiebreak, turn_order, joined_round, hp_visibility, faction)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          encounterId,
          input.characterId ?? null,
          input.monsterInstanceId ?? null,
          input.initiativeRoll ?? UNROLLED_INITIATIVE,
          null, // tiebreak is only meaningful once /roll-initiative computes a real dex-mod tiebreak
          turnOrder,
          joinedRound,
          input.hpVisibility ?? defaultVisibility,
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

export async function removeParticipant(
  pool: Pool,
  encounterId: number,
  participantId: number,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deleted = await client.query<ParticipantRow>(
      `DELETE FROM combat_participants WHERE id = $1 AND encounter_id = $2 RETURNING *`,
      [participantId, encounterId],
    );
    const participant = deleted.rows[0];
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

export async function setParticipantInitiative(
  pool: Pool,
  encounterId: number,
  participantId: number,
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

// Round-robin turn advancement: only wraps to the next round when the turn
// index would run past the last participant. Pulled out as a pure function
// so the round-wrap boundary condition (and only it, not the DB locking
// around it) can be unit tested directly.
export function computeNextTurn(
  currentIndex: number,
  currentRound: number,
  participantCount: number,
): { nextIndex: number; nextRound: number } {
  const nextIndex = currentIndex + 1;
  if (nextIndex >= participantCount) {
    return { nextIndex: 0, nextRound: currentRound + 1 };
  }
  return { nextIndex, nextRound: currentRound };
}

export async function rollInitiative(pool: Pool, encounterId: number, force: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Dex modifiers for every participant, sourced from characters.dex or
    // (via the monster catalog) monsters.dex for monster instances.
    const dexRes = await client.query<{ id: number; dex: number }>(
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

    // Re-sort turn_order by the (possibly just-updated) initiative ranking:
    // highest roll first, dex-mod tiebreak, then id for a stable final tiebreak.
    const reordered = await client.query<ParticipantRow>(
      `SELECT * FROM combat_participants WHERE encounter_id = $1
       ORDER BY initiative_roll DESC, initiative_tiebreak DESC NULLS LAST, id ASC`,
      [encounterId],
    );
    for (let i = 0; i < reordered.rows.length; i++) {
      await client.query(`UPDATE combat_participants SET turn_order = $1 WHERE id = $2`, [i, reordered.rows[i]!.id]);
    }

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
  id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  effect_definition_id: number;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: number | null;
  visible_to_players: boolean;
  effect_definition_name: string;
}

export interface AdvanceTurnResult {
  encounter: EncounterRow;
  participants: ParticipantRow[];
  expiredEffects: ExpiredEffectRow[];
}

export async function advanceTurn(pool: Pool, encounterId: number): Promise<AdvanceTurnResult> {
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

    const countRes = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM combat_participants WHERE encounter_id = $1`,
      [encounterId],
    );
    const participantCount = Number(countRes.rows[0]!.count);
    if (participantCount === 0) {
      throw new AppError('CONFLICT', 'This encounter has no participants to advance through');
    }

    const { nextIndex, nextRound } = computeNextTurn(
      encounter.current_turn_index,
      encounter.current_round,
      participantCount,
    );

    const updatedRes = await client.query<EncounterRow>(
      `UPDATE encounters
       SET current_turn_index = $1, current_round = $2, sync_seq = sync_seq + 1
       WHERE id = $3
       RETURNING *`,
      [nextIndex, nextRound, encounterId],
    );

    // Fresh action economy for whoever's turn is starting — turn_order is
    // assigned 0..participantCount-1 (rollInitiative), matching
    // current_turn_index 1:1, so nextIndex directly selects the right row.
    await client.query(
      `UPDATE combat_participants
       SET action_used = false, bonus_action_used = false, reaction_used = false,
           dash_used = false, movement_used_ft = 0, object_interaction_used = false,
           last_action_economy_snapshot = NULL
       WHERE encounter_id = $1 AND turn_order = $2`,
      [encounterId, nextIndex],
    );

    // Round-based effect expiry, in the SAME transaction as the turn advance
    // itself (a crash between the two must never leave turn state advanced
    // but a 'rounds' effect un-decremented, or vice versa). Two-step: first
    // decrement every still-active 'rounds' effect on this encounter, then
    // soft-delete (removed_at) whichever of those just hit zero.
    const decremented = await client.query<{ id: number; duration_value: number | null }>(
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
         WHERE ae.id = ANY($1::bigint[]) AND ed.id = ae.effect_definition_id
         RETURNING ae.id, ae.character_id, ae.monster_instance_id, ae.effect_definition_id,
                   ae.duration_type, ae.duration_value, ae.concentration, ae.source_character_id,
                   ae.visible_to_players, ed.name AS effect_definition_name`,
        [expiredIds],
      );
      expiredEffects = expiredRes.rows;
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
