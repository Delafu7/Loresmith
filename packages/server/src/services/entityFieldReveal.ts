// Reveal engine — narrowed to the one thing that survived the hide/reveal
// removal: a DM can hide or reveal a monster instance's damage
// vulnerabilities/resistances/immunities to players, one field at a time.
// Compute state server-side, redact before it ever leaves the process — same
// discipline HP redaction used to follow.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm } from './authz.js';
import { isRevealableField, MONSTER_INSTANCE_REVEALABLE_FIELDS } from '../domain/revealFields.js';
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

interface RevealRow {
  field_key: string;
  revealed: boolean;
  player_override: string | null;
}

/**
 * Full reveal state for a monster instance's three weakness fields. A field
 * with no explicit entity_field_reveals row falls back to "not present in
 * campaigns.reveal_defaults," i.e. hidden — a weakness starts secret until
 * the DM reveals it.
 */
export async function resolveReveals(
  pool: Pool | PoolClient,
  campaignId: number,
  monsterInstanceId: number,
): Promise<Map<string, RevealState>> {
  const [rowsRes, campaignRes] = await Promise.all([
    pool.query<RevealRow>(
      `SELECT field_key, revealed, player_override FROM entity_field_reveals WHERE monster_instance_id = $1`,
      [monsterInstanceId],
    ),
    pool.query<{ reveal_defaults: string[] }>(`SELECT reveal_defaults FROM campaigns WHERE id = $1`, [campaignId]),
  ]);
  const explicit = new Map(rowsRes.rows.map((r) => [r.field_key, { revealed: r.revealed, playerOverride: r.player_override }]));
  const defaults = new Set(campaignRes.rows[0]?.reveal_defaults ?? []);

  const state = new Map<string, RevealState>();
  for (const field of MONSTER_INSTANCE_REVEALABLE_FIELDS) {
    state.set(field, explicit.get(field) ?? { revealed: defaults.has(field), playerOverride: null });
  }
  return state;
}

/**
 * Redacts the three weakness fields on `row` per `revealState`: unrevealed
 * -> null, revealed with a playerOverride -> the override string instead of
 * the true value, revealed with no override -> the true value untouched.
 * Call this on the raw row right before it's sent to a player-role response,
 * never on a DM-role one.
 */
export function redactEntityFields<T extends Record<string, unknown>>(row: T, revealState: Map<string, RevealState>): T {
  const result: Record<string, unknown> = { ...row };
  for (const field of MONSTER_INSTANCE_REVEALABLE_FIELDS) {
    const state = revealState.get(field);
    result[field] = state?.revealed ? (state.playerOverride ?? row[field]) : null;
  }
  return result as T;
}

function serialize(state: Map<string, RevealState>): SerializedReveal[] {
  return [...state.entries()].map(([fieldKey, s]) => ({ fieldKey, revealed: s.revealed, playerOverride: s.playerOverride }));
}

// True (unredacted) current values for a set of fieldKeys, used right after
// a reveal write to build the REVEAL_CHANGED broadcast payload — the write
// path itself only ever touches entity_field_reveals, never monster_
// instances/monsters, so the true value has to be looked up separately.
export async function getTrueFieldValues(
  pool: Pool,
  monsterInstanceId: number,
  fieldKeys: string[],
): Promise<Record<string, unknown>> {
  const result = await pool.query(
    `SELECT m.damage_vulnerabilities, m.damage_resistances, m.damage_immunities
     FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id WHERE mi.id = $1`,
    [monsterInstanceId],
  );
  const row: Record<string, unknown> = result.rows[0] ?? {};
  return Object.fromEntries(fieldKeys.map((k) => [k, row[k]]));
}

// ---- DM-facing read/write of raw reveal state (for the eye-icon grid) ----

async function fetchMonsterInstanceCampaignId(pool: Pool, monsterInstanceId: number): Promise<number> {
  const result = await pool.query<{ campaign_id: number }>(
    `SELECT campaign_id FROM monster_instances WHERE id = $1`,
    [monsterInstanceId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row.campaign_id;
}

export async function getMonsterInstanceReveals(pool: Pool, actorId: number, monsterInstanceId: number): Promise<SerializedReveal[]> {
  const campaignId = await fetchMonsterInstanceCampaignId(pool, monsterInstanceId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);
  return serialize(await resolveReveals(pool, campaignId, monsterInstanceId));
}

// One row per live encounter the monster instance is currently a
// combat_participants row in — same "bump sync_seq in the same
// transaction, return sync targets" idiom as services/characters.ts's
// applyHpDelta, so the route can broadcast REVEAL_CHANGED per encounter
// after commit.
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

export async function updateMonsterInstanceReveals(
  pool: Pool,
  actorId: number,
  monsterInstanceId: number,
  input: UpdateRevealsInput,
): Promise<UpdateRevealsResult> {
  const campaignId = await fetchMonsterInstanceCampaignId(pool, monsterInstanceId);
  const role = await requireMembership(pool, campaignId, actorId);
  requireDm(role);

  for (const field of input.fields) {
    if (!isRevealableField(field.fieldKey)) {
      throw new AppError('VALIDATION_ERROR', `"${field.fieldKey}" is not a revealable field`);
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const field of input.fields) {
      await client.query(
        `INSERT INTO entity_field_reveals (monster_instance_id, field_key, revealed, player_override, revealed_at, revealed_by_user_id)
         VALUES ($1, $2, $3, $4, CASE WHEN $3 THEN now() ELSE NULL END, $5)
         ON CONFLICT (monster_instance_id, field_key)
         DO UPDATE SET
           revealed = EXCLUDED.revealed,
           player_override = EXCLUDED.player_override,
           revealed_at = CASE WHEN EXCLUDED.revealed THEN now() ELSE entity_field_reveals.revealed_at END,
           revealed_by_user_id = EXCLUDED.revealed_by_user_id`,
        [monsterInstanceId, field.fieldKey, field.revealed, field.playerOverride ?? null, actorId],
      );
    }

    const encounterSyncs = await client.query<EncounterRevealSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.monster_instance_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [monsterInstanceId],
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

// ---- Reset reveals for an encounter (weakness fields only now) ----

/**
 * "Reset weakness reveals for this encounter" — every monster instance
 * currently seated in it goes back to hidden. The old cross-cutting "hide
 * everything" campaign-wide panic button (which also touched hp_visibility
 * and active_effects.visible_to_players) was removed along with those two
 * mechanisms; this is the one piece of it still meaningful.
 */
export async function resetRevealsForEncounter(pool: Pool, actorId: number, encounterId: number): Promise<{ campaignId: number }> {
  const encRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const encounter = encRes.rows[0];
  if (!encounter) throw notFound('Encounter');
  const role = await requireMembership(pool, encounter.campaign_id, actorId);
  requireDm(role);

  await pool.query(
    `UPDATE entity_field_reveals SET revealed = false
     WHERE monster_instance_id IN (
       SELECT monster_instance_id FROM combat_participants WHERE encounter_id = $1 AND monster_instance_id IS NOT NULL
     )`,
    [encounterId],
  );

  return { campaignId: encounter.campaign_id };
}
