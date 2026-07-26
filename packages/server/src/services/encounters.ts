// Encounter + combat-participant business logic. Kept as plain functions
// (not embedded in route handlers) per the task brief: advanceTurn in
// particular is the hook point the real-time-sync agent will import and call
// directly from a socket handler next, so it must not depend on Express
// req/res.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isUniqueViolation } from './dbErrors.js';
import { requireMembership, requireOwnerOrDm, type CampaignRole } from './authz.js';
import type {
  AddParticipantInput,
  ApplyActionEconomyInput,
  CreateEncounterInput,
  SetInitiativeInput,
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
  pos_x: number | null;
  pos_y: number | null;
  action_used: boolean;
  bonus_action_used: boolean;
  reaction_used: boolean;
  dash_used: boolean;
  movement_used_ft: number;
  [key: string]: unknown;
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
  encounter_id: number;
  background_asset_id: number | null;
  background_file_url: string | null;
  grid_columns: number;
  grid_rows: number;
  cell_size_px: number;
}

export async function getEncounterMap(pool: Pool | PoolClient, encounterId: number): Promise<EncounterMapRow | null> {
  const result = await pool.query<EncounterMapRow>(
    `SELECT em.encounter_id, em.background_asset_id, ca.file_url AS background_file_url,
            em.grid_columns, em.grid_rows, em.cell_size_px
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
  };
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
      `INSERT INTO encounter_maps (encounter_id, background_asset_id, grid_columns, grid_rows, cell_size_px, updated_at)
       VALUES ($1, $2, COALESCE($3, 20), COALESCE($4, 20), COALESCE($5, 50), now())
       ON CONFLICT (encounter_id) DO UPDATE SET
         background_asset_id = CASE WHEN $6 THEN $2 ELSE encounter_maps.background_asset_id END,
         grid_columns = COALESCE($3, encounter_maps.grid_columns),
         grid_rows = COALESCE($4, encounter_maps.grid_rows),
         cell_size_px = COALESCE($5, encounter_maps.cell_size_px),
         updated_at = now()`,
      [
        encounterId,
        input.backgroundAssetId ?? null,
        input.gridColumns ?? null,
        input.gridRows ?? null,
        input.cellSizePx ?? null,
        backgroundAssetIdSupplied,
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

export async function setParticipantPosition(
  pool: Pool,
  encounterId: number,
  participantId: number,
  input: SetParticipantPositionInput,
): Promise<ParticipantMutationResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET pos_x = $1, pos_y = $2 WHERE id = $3 AND encounter_id = $4 RETURNING *`,
      [input.x, input.y, participantId, encounterId],
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

    if (input.spend) {
      const column = `${input.spend}_used`;
      if (current[column] === true) {
        throw new AppError('CONFLICT', `That participant's ${input.spend.replace('_', ' ')} has already been used this turn`);
      }
      sets.push(`${column} = true`);
      if (input.spend === 'action' && input.dash) {
        sets.push(`dash_used = true`);
      }
    }
    if (input.addMovementFt !== undefined) {
      sets.push(`movement_used_ft = movement_used_ft + $${i}`);
      values.push(input.addMovementFt);
      i++;
    }

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
  // Null for character participants; a monster instance's alive/dead/fled/
  // captured status. REFACTOR-PLAN.md §1: the map view only spawns a token
  // for status='alive' instances — a dead monster stays in the initiative
  // roster (so its turn can still be skipped/removed deliberately) but
  // shouldn't visually reappear on the board.
  monster_instance_status: 'alive' | 'dead' | 'fled' | 'captured' | null;
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
            COALESCE(c.name, mi.custom_name, m.name) AS name,
            COALESCE(c.hp_current, mi.hp_current) AS hp_current,
            COALESCE(c.hp_max, mi.hp_max_override, m.hit_point_average) AS hp_max,
            COALESCE(c.hp_temp, mi.hp_temp) AS hp_temp,
            COALESCE(c.armor_class, mi.armor_class_override, m.armor_class) AS armor_class,
            c.is_pc,
            mi.status AS monster_instance_status,
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
    if (input.characterId != null) {
      const pcRes = await client.query<{ is_pc: boolean }>(`SELECT is_pc FROM characters WHERE id = $1`, [input.characterId]);
      if (pcRes.rows[0]?.is_pc) defaultVisibility = 'exact';
    }

    let participant: ParticipantRow;
    try {
      const result = await client.query<ParticipantRow>(
        `INSERT INTO combat_participants
           (encounter_id, character_id, monster_instance_id, initiative_roll, initiative_tiebreak, turn_order, joined_round, hp_visibility)
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
          input.hpVisibility ?? defaultVisibility,
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
           dash_used = false, movement_used_ft = 0
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
