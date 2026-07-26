// Reveal engine core (PLAN.md §11.4). Generalizes the redaction discipline
// hpVisibility.ts already established — compute state server-side, redact
// before it ever leaves the process — to arbitrary character/monster-
// instance stat-block fields. hp_visibility and active_effects.
// visible_to_players are NOT routed through here; both stay as their own
// mechanisms (§11's locked-in decision).

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm } from './authz.js';
import {
  isRevealableField,
  revealableFieldsFor,
  MONSTER_INSTANCE_STAT_BLOCK_SQL,
  type RevealEntityType,
} from '../domain/revealFields.js';
import type { UpdateRevealsInput } from '../schemas/reveals.js';

export interface RevealState {
  revealed: boolean;
  playerOverride: string | null;
}

export interface SerializedReveal {
  fieldKey: string;
  revealed: boolean;
  playerOverride: string | null;
}

type EntityTarget = { characterId: number } | { monsterInstanceId: number };

function targetColumn(target: EntityTarget): { column: 'character_id' | 'monster_instance_id'; id: number } {
  return 'characterId' in target
    ? { column: 'character_id', id: target.characterId }
    : { column: 'monster_instance_id', id: target.monsterInstanceId };
}

interface RevealRow {
  field_key: string;
  revealed: boolean;
  player_override: string | null;
}

async function loadCampaignDefaults(
  pool: Pool | PoolClient,
  campaignId: number,
  entityType: RevealEntityType,
): Promise<Set<string>> {
  const result = await pool.query<{ reveal_defaults: Record<string, string[]> }>(
    `SELECT reveal_defaults FROM campaigns WHERE id = $1`,
    [campaignId],
  );
  const defaults = result.rows[0]?.reveal_defaults?.[entityType] ?? [];
  return new Set(defaults);
}

/**
 * Full reveal state for every field in `entityType`'s registry. A field with
 * no explicit entity_field_reveals row falls back to whether it's in the
 * campaign's reveal_defaults allowlist for that entity type (default: not
 * present, i.e. hidden) — see the entity_field_reveals migration's comment.
 */
export async function resolveReveals(
  pool: Pool | PoolClient,
  campaignId: number,
  entityType: RevealEntityType,
  target: EntityTarget,
): Promise<Map<string, RevealState>> {
  const { column, id } = targetColumn(target);
  const [rowsRes, defaults] = await Promise.all([
    pool.query<RevealRow>(`SELECT field_key, revealed, player_override FROM entity_field_reveals WHERE ${column} = $1`, [id]),
    loadCampaignDefaults(pool, campaignId, entityType),
  ]);
  const explicit = new Map(rowsRes.rows.map((r) => [r.field_key, { revealed: r.revealed, playerOverride: r.player_override }]));

  const state = new Map<string, RevealState>();
  for (const field of revealableFieldsFor(entityType)) {
    state.set(field, explicit.get(field) ?? { revealed: defaults.has(field), playerOverride: null });
  }
  return state;
}

/**
 * Redacts every registered field on `row` per `revealState`: unrevealed ->
 * null, revealed with a playerOverride -> the override string instead of
 * the true value, revealed with no override -> the true value untouched.
 * Same shape as hpVisibility.ts's redactHpFields — call this on the raw row
 * right before it's sent to a player-role response, never on a DM-role one.
 */
export function redactEntityFields<T extends Record<string, unknown>>(
  row: T,
  entityType: RevealEntityType,
  revealState: Map<string, RevealState>,
): T {
  const result: Record<string, unknown> = { ...row };
  for (const field of revealableFieldsFor(entityType)) {
    const state = revealState.get(field);
    result[field] = state?.revealed ? (state.playerOverride ?? row[field]) : null;
  }
  return result as T;
}

function serialize(state: Map<string, RevealState>): SerializedReveal[] {
  return [...state.entries()].map(([fieldKey, s]) => ({ fieldKey, revealed: s.revealed, playerOverride: s.playerOverride }));
}

/**
 * Batch variant of resolveReveals for exactly one field, across many
 * characters and many monster instances at once — avoids N+1 queries when
 * redacting a whole encounter roster's worth of participants at once (used
 * by sockets/broadcast.ts's buildFullStateSyncPayload for armorClass).
 */
export async function resolveFieldRevealBatch(
  pool: Pool | PoolClient,
  campaignId: number,
  fieldKey: string,
  characterIds: number[],
  monsterInstanceIds: number[],
): Promise<{ characters: Map<number, RevealState>; monsterInstances: Map<number, RevealState> }> {
  const [rowsRes, charDefaults, monsterDefaults] = await Promise.all([
    pool.query<{ character_id: number | null; monster_instance_id: number | null; revealed: boolean; player_override: string | null }>(
      `SELECT character_id, monster_instance_id, revealed, player_override
       FROM entity_field_reveals
       WHERE field_key = $1 AND (character_id = ANY($2::bigint[]) OR monster_instance_id = ANY($3::bigint[]))`,
      [fieldKey, characterIds, monsterInstanceIds],
    ),
    loadCampaignDefaults(pool, campaignId, 'character'),
    loadCampaignDefaults(pool, campaignId, 'monster_instance'),
  ]);

  const characters = new Map<number, RevealState>();
  const monsterInstances = new Map<number, RevealState>();
  for (const row of rowsRes.rows) {
    const state: RevealState = { revealed: row.revealed, playerOverride: row.player_override };
    if (row.character_id != null) characters.set(row.character_id, state);
    else if (row.monster_instance_id != null) monsterInstances.set(row.monster_instance_id, state);
  }
  for (const id of characterIds) {
    if (!characters.has(id)) characters.set(id, { revealed: charDefaults.has(fieldKey), playerOverride: null });
  }
  for (const id of monsterInstanceIds) {
    if (!monsterInstances.has(id)) monsterInstances.set(id, { revealed: monsterDefaults.has(fieldKey), playerOverride: null });
  }
  return { characters, monsterInstances };
}

// True (unredacted) current values for a set of fieldKeys, used right after
// a reveal write to build the REVEAL_CHANGED broadcast payload — the write
// path itself only ever touches entity_field_reveals, never the character/
// monster_instance row, so the true value has to be looked up separately.
export async function getTrueFieldValues(
  pool: Pool,
  entityType: RevealEntityType,
  target: EntityTarget,
  fieldKeys: string[],
): Promise<Record<string, unknown>> {
  const { id } = targetColumn(target);
  const result =
    entityType === 'character'
      ? await pool.query(`SELECT armor_class, speed, senses, languages, notes FROM characters WHERE id = $1`, [id])
      : await pool.query(
          `SELECT ${MONSTER_INSTANCE_STAT_BLOCK_SQL} FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id WHERE mi.id = $1`,
          [id],
        );
  const row: Record<string, unknown> = result.rows[0] ?? {};
  return Object.fromEntries(fieldKeys.map((k) => [k, row[k]]));
}

// ---- DM-facing read/write of raw reveal state (for the eye-icon grid) ----

async function fetchCharacterCampaignId(pool: Pool, characterId: number): Promise<number> {
  const result = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM characters WHERE id = $1`, [characterId]);
  const row = result.rows[0];
  if (!row) throw notFound('Character');
  return row.campaign_id;
}

async function fetchMonsterInstanceCampaignId(pool: Pool, monsterInstanceId: number): Promise<number> {
  const result = await pool.query<{ campaign_id: number }>(
    `SELECT campaign_id FROM monster_instances WHERE id = $1`,
    [monsterInstanceId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row.campaign_id;
}

export async function getCharacterReveals(pool: Pool, actorId: number, characterId: number): Promise<SerializedReveal[]> {
  const campaignId = await fetchCharacterCampaignId(pool, characterId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);
  return serialize(await resolveReveals(pool, campaignId, 'character', { characterId }));
}

export async function getMonsterInstanceReveals(pool: Pool, actorId: number, monsterInstanceId: number): Promise<SerializedReveal[]> {
  const campaignId = await fetchMonsterInstanceCampaignId(pool, monsterInstanceId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);
  return serialize(await resolveReveals(pool, campaignId, 'monster_instance', { monsterInstanceId }));
}

// One row per live encounter the entity is currently a combat_participants
// row in — same "bump sync_seq in the same transaction, return sync
// targets" idiom as services/characters.ts's applyHpDelta, so the route can
// broadcast REVEAL_CHANGED per encounter after commit.
export interface EncounterRevealSyncTarget {
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
  participant_id: number;
}

export interface UpdateRevealsResult {
  fields: SerializedReveal[];
  encounterSyncs: EncounterRevealSyncTarget[];
}

async function upsertAndSync(
  pool: Pool,
  entityType: RevealEntityType,
  target: EntityTarget,
  actorId: number,
  input: UpdateRevealsInput,
): Promise<UpdateRevealsResult> {
  for (const field of input.fields) {
    if (!isRevealableField(entityType, field.fieldKey)) {
      throw new AppError('VALIDATION_ERROR', `"${field.fieldKey}" is not a revealable field for ${entityType}`);
    }
  }
  const { column, id } = targetColumn(target);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const field of input.fields) {
      await client.query(
        `INSERT INTO entity_field_reveals (${column}, field_key, revealed, player_override, revealed_at, revealed_by_user_id)
         VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN now() ELSE NULL END, $5)
         ON CONFLICT (${column}, field_key) WHERE ${column} IS NOT NULL
         DO UPDATE SET
           revealed = EXCLUDED.revealed,
           player_override = EXCLUDED.player_override,
           revealed_at = CASE WHEN EXCLUDED.revealed THEN now() ELSE entity_field_reveals.revealed_at END,
           revealed_by_user_id = EXCLUDED.revealed_by_user_id`,
        [id, field.fieldKey, field.revealed, field.playerOverride ?? null, actorId],
      );
    }

    const encounterSyncs = await client.query<EncounterRevealSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.${column} = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [id],
    );

    await client.query('COMMIT');

    const state = new Map<string, RevealState>(
      input.fields.map((f) => [f.fieldKey, { revealed: f.revealed, playerOverride: f.playerOverride ?? null }]),
    );
    return { fields: serialize(state), encounterSyncs: encounterSyncs.rows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCharacterReveals(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: UpdateRevealsInput,
): Promise<UpdateRevealsResult> {
  const campaignId = await fetchCharacterCampaignId(pool, characterId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);
  return upsertAndSync(pool, 'character', { characterId }, actorId, input);
}

export async function updateMonsterInstanceReveals(
  pool: Pool,
  actorId: number,
  monsterInstanceId: number,
  input: UpdateRevealsInput,
): Promise<UpdateRevealsResult> {
  const campaignId = await fetchMonsterInstanceCampaignId(pool, monsterInstanceId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);
  return upsertAndSync(pool, 'monster_instance', { monsterInstanceId }, actorId, input);
}

// ---- Panic button / per-encounter reset ----

/**
 * "Hide everything" (PLAN.md §11.5). Cross-cutting by design: also hides
 * hp_visibility and active_effects.visible_to_players, not just this
 * table's rows — scoping it to only entity_field_reveals would make "hide
 * everything" false advertising.
 */
export async function hideAllForCampaign(pool: Pool, actorId: number, campaignId: number): Promise<void> {
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE entity_field_reveals SET revealed = false
       WHERE character_id IN (SELECT id FROM characters WHERE campaign_id = $1)
          OR monster_instance_id IN (SELECT id FROM monster_instances WHERE campaign_id = $1)`,
      [campaignId],
    );
    await client.query(
      `UPDATE combat_participants cp SET hp_visibility = 'hidden'
       FROM encounters e WHERE cp.encounter_id = e.id AND e.campaign_id = $1`,
      [campaignId],
    );
    await client.query(
      `UPDATE active_effects ae SET visible_to_players = false
       WHERE ae.removed_at IS NULL
         AND (ae.character_id IN (SELECT id FROM characters WHERE campaign_id = $1)
           OR ae.monster_instance_id IN (SELECT id FROM monster_instances WHERE campaign_id = $1))`,
      [campaignId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * "Reset reveals for this encounter" — scoped to entities currently seated
 * in it, hp_visibility back to 'banded' (the combat default), not 'hidden'
 * (that's hide-all's job, not reset's).
 */
export async function resetRevealsForEncounter(pool: Pool, actorId: number, encounterId: number): Promise<{ campaignId: number }> {
  const encRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const encounter = encRes.rows[0];
  if (!encounter) throw notFound('Encounter');
  const role = await requireMembership(pool, encounter.campaign_id, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE entity_field_reveals SET revealed = false
       WHERE character_id IN (SELECT character_id FROM combat_participants WHERE encounter_id = $1 AND character_id IS NOT NULL)
          OR monster_instance_id IN (
            SELECT monster_instance_id FROM combat_participants WHERE encounter_id = $1 AND monster_instance_id IS NOT NULL
          )`,
      [encounterId],
    );
    await client.query(`UPDATE combat_participants SET hp_visibility = 'banded' WHERE encounter_id = $1`, [encounterId]);
    await client.query(
      `UPDATE active_effects ae SET visible_to_players = false
       FROM combat_participants cp
       WHERE cp.encounter_id = $1 AND ae.removed_at IS NULL
         AND ((ae.character_id IS NOT NULL AND ae.character_id = cp.character_id)
           OR (ae.monster_instance_id IS NOT NULL AND ae.monster_instance_id = cp.monster_instance_id))`,
      [encounterId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { campaignId: encounter.campaign_id };
}
