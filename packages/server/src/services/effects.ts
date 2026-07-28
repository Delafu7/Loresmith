// active_effects: the applied INSTANCE of an effect_definitions template
// (PLAN.md §3.1/§3.2) — real duration countdown, save DC, source, and
// target. All apply/remove endpoints are DM-only per PLAN.md's
// authorization matrix (conditions/effects are a DM tool, same bucket as HP
// tracking for NPCs/monster instances); GET is readable by any campaign
// member — every effect is visible to the whole party now (hide/reveal was
// removed).

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireMembership, type CampaignRole } from './authz.js';
import { isUniqueViolation } from './dbErrors.js';
import type { ApplyEncounterEffectInput, ApplyTargetEffectInput } from '../schemas/effects.js';

interface EffectDefinitionRow {
  id: number;
  name: string;
  default_duration_type: string;
  default_duration_value: number | null;
  concentration: boolean;
}

async function fetchEffectDefinitionOrThrow(pool: Pool, effectDefinitionId: number): Promise<EffectDefinitionRow> {
  const result = await pool.query<EffectDefinitionRow>(`SELECT * FROM effect_definitions WHERE id = $1`, [effectDefinitionId]);
  const row = result.rows[0];
  if (!row) throw notFound('Effect definition');
  return row;
}

// ---- Broadcast-target plumbing shared by apply/remove/expire ----
//
// Mirrors services/characters.ts's applyHpDelta / services/monsters.ts's
// applyMonsterInstanceHpDelta "encounterSyncs" pattern exactly: sync_seq is
// bumped in the SAME transaction as the effect mutation, and the sockets
// layer (routes/*.ts) fans a broadcast out per returned target — no separate
// follow-up query that could observe a different snapshot.
//
// Two cases:
//  1. The mutation already knows its encounter (POST /encounters/:id/effects,
//     or a DELETE of a row whose encounter_id was set that way) — bump that
//     one row directly.
//  2. The mutation has no encounter of its own (POST /characters/:id/effects,
//     POST /monster-instances/:id/effects — encounter_id is null by design,
//     see applyCharacterEffect/applyMonsterInstanceEffect below) — bump
//     every encounter the target is CURRENTLY a live combat_participants row
//     in, exactly like HP_CHANGED does. A DM applying poison to a character
//     mid-fight through the character's own effects endpoint still needs
//     that combat's room to hear about it.

export interface EncounterEffectSyncTarget {
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
}

async function bumpEncounterSyncSeq(client: PoolClient, encounterId: number): Promise<EncounterEffectSyncTarget> {
  const result = await client.query<EncounterEffectSyncTarget>(
    `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1
     RETURNING id AS encounter_id, campaign_id, sync_seq`,
    [encounterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Encounter');
  return row;
}

async function bumpAffectedEncounters(
  client: PoolClient,
  characterId: number | null,
  monsterInstanceId: number | null,
): Promise<EncounterEffectSyncTarget[]> {
  const column = characterId != null ? 'character_id' : 'monster_instance_id';
  const id = characterId ?? monsterInstanceId;
  const result = await client.query<EncounterEffectSyncTarget>(
    `UPDATE encounters e
     SET sync_seq = sync_seq + 1
     FROM combat_participants cp
     WHERE cp.${column} = $1 AND cp.encounter_id = e.id
     RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq`,
    [id],
  );
  return result.rows;
}

async function resolveEncounterSyncs(
  client: PoolClient,
  encounterId: number | null,
  characterId: number | null,
  monsterInstanceId: number | null,
): Promise<EncounterEffectSyncTarget[]> {
  return encounterId != null
    ? [await bumpEncounterSyncSeq(client, encounterId)]
    : bumpAffectedEncounters(client, characterId, monsterInstanceId);
}

type ActiveEffectRow = Record<string, unknown> & {
  id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  effect_definition_id: number;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: number | null;
};

export interface EffectMutationResult {
  effect: ActiveEffectRow;
  effectDefinitionName: string;
  encounterSyncs: EncounterEffectSyncTarget[];
  // Set when applying this (concentration) effect auto-ended a prior
  // concentration effect on the same target — see insertActiveEffect's
  // "SRD auto-replace" comment. The route layer broadcasts EFFECT_EXPIRED
  // for this alongside EFFECT_APPLIED for the new effect.
  replacedEffect: { effect: ActiveEffectRow; effectDefinitionName: string } | null;
}

interface InsertActiveEffectParams {
  effectDefinitionId: number;
  characterId: number | null;
  monsterInstanceId: number | null;
  encounterId: number | null;
  sourceCharacterId?: number | null;
  sourceSpellId?: number | null;
  sourceType: string;
  durationType?: string;
  durationValue?: number | null;
  stackCount?: number | null;
  appliedAtRound?: number | null;
  saveDc?: number | null;
  saveAbilityId?: number | null;
  concentration?: boolean;
  notes?: string | null;
}

/**
 * The one place that both (a) falls back to the effect_definitions
 * template's own duration/concentration defaults when the caller doesn't
 * override them, and (b) implements the real SRD concentration rule:
 * "casting a spell that requires concentration breaks your concentration
 * on a spell you're already concentrating on" — i.e. applying a NEW
 * concentration effect transparently ENDS the target's prior one, it is
 * never a rejected action. (Confirmed as a fix, not a design choice, by the
 * Phase 2 SRD-validation review: the previous behavior caught the DB's
 * concentration invariant's 23505 unique-violation and turned it into a
 * 409 CONFLICT, forcing the DM to manually remove the old effect first —
 * that modeled "you can't have two active concentration effects" correctly
 * as an invariant, but wrongly modeled the MECHANIC of acquiring a second
 * one as a hard block instead of an automatic replace.)
 *
 * The invariant itself (active_effects_one_concentration_per_character/
 * _monster_instance, a partial unique index — PLAN.md §3.4 item 3) is still
 * enforced at the DB level; this function just satisfies it by ending the
 * old effect in the SAME transaction as inserting the new one, rather than
 * ever letting the write reach the index as a conflict. The 23505 catch
 * remains as a defensive fallback for the concurrent-request race (two
 * requests both reading "no existing concentration" before either commits).
 *
 * Runs the whole thing (replace + insert + sync_seq bump(s)) in one
 * transaction so EFFECT_APPLIED/EFFECT_EXPIRED's `seq` always matches a
 * committed DB state (same discipline as addParticipant/removeParticipant
 * in services/encounters.ts).
 */
async function insertActiveEffect(pool: Pool, params: InsertActiveEffectParams): Promise<EffectMutationResult> {
  const definition = await fetchEffectDefinitionOrThrow(pool, params.effectDefinitionId);
  const durationType = params.durationType ?? definition.default_duration_type;
  const durationValue = params.durationValue !== undefined ? params.durationValue : definition.default_duration_value;
  const concentration = params.concentration !== undefined ? params.concentration : definition.concentration;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let replacedEffect: EffectMutationResult['replacedEffect'] = null;
    if (concentration) {
      const column = params.characterId != null ? 'character_id' : 'monster_instance_id';
      const targetId = params.characterId ?? params.monsterInstanceId;
      const priorRes = await client.query<ActiveEffectRow & { effect_definition_name: string }>(
        `SELECT ae.*, ed.name AS effect_definition_name
         FROM active_effects ae JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
         WHERE ae.${column} = $1 AND ae.concentration = true AND ae.removed_at IS NULL
         FOR UPDATE OF ae`,
        [targetId],
      );
      const prior = priorRes.rows[0];
      if (prior) {
        const endedRes = await client.query<ActiveEffectRow>(
          `UPDATE active_effects SET removed_at = now() WHERE id = $1 RETURNING *`,
          [prior.id],
        );
        replacedEffect = { effect: endedRes.rows[0]!, effectDefinitionName: prior.effect_definition_name };
      }
    }

    let effect: EffectMutationResult['effect'];
    try {
      const result = await client.query(
        `INSERT INTO active_effects
           (effect_definition_id, character_id, monster_instance_id, encounter_id, source_character_id, source_spell_id,
            source_type, duration_type, duration_value, stack_count, applied_at_round, save_dc, save_ability_id,
            concentration, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          params.effectDefinitionId, params.characterId, params.monsterInstanceId, params.encounterId,
          params.sourceCharacterId ?? null, params.sourceSpellId ?? null, params.sourceType,
          durationType, durationValue, params.stackCount ?? null, params.appliedAtRound ?? null,
          params.saveDc ?? null, params.saveAbilityId ?? null, concentration, params.notes ?? null,
        ],
      );
      effect = result.rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError('CONFLICT', 'Target is already concentrating on another effect');
      }
      throw err;
    }

    const encounterSyncs = await resolveEncounterSyncs(client, params.encounterId, params.characterId, params.monsterInstanceId);

    await client.query('COMMIT');
    return { effect, effectDefinitionName: definition.name, encounterSyncs, replacedEffect };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function assertTargetInCampaign(
  pool: Pool,
  campaignId: number,
  characterId: number | null,
  monsterInstanceId: number | null,
): Promise<void> {
  if (characterId != null) {
    const r = await pool.query(`SELECT 1 FROM characters WHERE id = $1 AND campaign_id = $2`, [characterId, campaignId]);
    if (r.rows.length === 0) throw notFound('Character in this campaign');
  } else if (monsterInstanceId != null) {
    const r = await pool.query(`SELECT 1 FROM monster_instances WHERE id = $1 AND campaign_id = $2`, [monsterInstanceId, campaignId]);
    if (r.rows.length === 0) throw notFound('Monster instance in this campaign');
  }
}

// ---- Encounter-scoped effects (POST/GET /encounters/:id/effects) ----

export async function listEncounterEffects(pool: Pool, encounterId: number, _role: CampaignRole) {
  const result = await pool.query(
    `SELECT * FROM active_effects WHERE encounter_id = $1 AND removed_at IS NULL ORDER BY created_at ASC`,
    [encounterId],
  );
  return result.rows;
}

// ---- Target-scoped effects (GET /characters/:id/effects,
// GET /monster-instances/:id/effects) — added alongside the Phase 2 UI's
// "apply an effect outside combat" flow: the POST endpoints already existed,
// but there was no way to read back what's currently active on a target
// outside of an encounter's own GET (which only surfaces encounter_id-scoped
// rows). Mirrors listEncounterEffects: any campaign member may read, every
// effect is visible to the whole party.

export async function listCharacterEffects(pool: Pool, actorId: number, characterId: number) {
  const charRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM characters WHERE id = $1`, [characterId]);
  const character = charRes.rows[0];
  if (!character) throw notFound('Character');
  await requireMembership(pool, character.campaign_id, actorId);

  const result = await pool.query(
    `SELECT ae.*, ed.name AS effect_definition_name FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.character_id = $1 AND ae.removed_at IS NULL ORDER BY ae.created_at ASC`,
    [characterId],
  );
  return result.rows;
}

export async function listMonsterInstanceEffects(pool: Pool, actorId: number, monsterInstanceId: number) {
  const instRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM monster_instances WHERE id = $1`, [monsterInstanceId]);
  const instance = instRes.rows[0];
  if (!instance) throw notFound('Monster instance');
  await requireMembership(pool, instance.campaign_id, actorId);

  const result = await pool.query(
    `SELECT ae.*, ed.name AS effect_definition_name FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.monster_instance_id = $1 AND ae.removed_at IS NULL ORDER BY ae.created_at ASC`,
    [monsterInstanceId],
  );
  return result.rows;
}

export async function applyEncounterEffect(
  pool: Pool,
  encounterId: number,
  campaignId: number,
  input: ApplyEncounterEffectInput,
): Promise<EffectMutationResult> {
  const characterId = input.characterId ?? null;
  const monsterInstanceId = input.monsterInstanceId ?? null;
  await assertTargetInCampaign(pool, campaignId, characterId, monsterInstanceId);

  return insertActiveEffect(pool, {
    effectDefinitionId: input.effectDefinitionId,
    characterId,
    monsterInstanceId,
    encounterId,
    sourceCharacterId: input.sourceCharacterId,
    sourceSpellId: input.sourceSpellId,
    sourceType: input.sourceType,
    durationType: input.durationType,
    durationValue: input.durationValue,
    stackCount: input.stackCount,
    appliedAtRound: input.appliedAtRound,
    saveDc: input.saveDc,
    saveAbilityId: input.saveAbilityId,
    concentration: input.concentration,
    notes: input.notes,
  });
}

// ---- Outside-combat effects (POST /characters/:id/effects,
// POST /monster-instances/:id/effects — encounter_id = null) ----

export async function applyCharacterEffect(
  pool: Pool,
  actorId: number,
  characterId: number,
  input: ApplyTargetEffectInput,
): Promise<EffectMutationResult> {
  const charRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM characters WHERE id = $1`, [characterId]);
  const character = charRes.rows[0];
  if (!character) throw notFound('Character');
  const role = await requireMembership(pool, character.campaign_id, actorId);
  requireDm(role);

  return insertActiveEffect(pool, {
    effectDefinitionId: input.effectDefinitionId,
    characterId,
    monsterInstanceId: null,
    encounterId: null,
    sourceCharacterId: input.sourceCharacterId,
    sourceSpellId: input.sourceSpellId,
    sourceType: input.sourceType,
    durationType: input.durationType,
    durationValue: input.durationValue,
    stackCount: input.stackCount,
    appliedAtRound: input.appliedAtRound,
    saveDc: input.saveDc,
    saveAbilityId: input.saveAbilityId,
    concentration: input.concentration,
    notes: input.notes,
  });
}

export async function applyMonsterInstanceEffect(
  pool: Pool,
  actorId: number,
  monsterInstanceId: number,
  input: ApplyTargetEffectInput,
): Promise<EffectMutationResult> {
  const instRes = await pool.query<{ campaign_id: number }>(`SELECT campaign_id FROM monster_instances WHERE id = $1`, [monsterInstanceId]);
  const instance = instRes.rows[0];
  if (!instance) throw notFound('Monster instance');
  const role = await requireMembership(pool, instance.campaign_id, actorId);
  requireDm(role);

  return insertActiveEffect(pool, {
    effectDefinitionId: input.effectDefinitionId,
    characterId: null,
    monsterInstanceId,
    encounterId: null,
    sourceCharacterId: input.sourceCharacterId,
    sourceSpellId: input.sourceSpellId,
    sourceType: input.sourceType,
    durationType: input.durationType,
    durationValue: input.durationValue,
    stackCount: input.stackCount,
    appliedAtRound: input.appliedAtRound,
    saveDc: input.saveDc,
    saveAbilityId: input.saveAbilityId,
    concentration: input.concentration,
    notes: input.notes,
  });
}

// ---- DELETE /effects/:id (flat — campaign derived from the target row) ----

interface EffectOwnerRow {
  id: number;
  encounter_id: number | null;
  character_id: number | null;
  monster_instance_id: number | null;
  campaign_id: number;
  effect_definition_name: string;
}

export async function removeEffect(pool: Pool, actorId: number, effectId: number): Promise<EffectMutationResult> {
  const result = await pool.query<EffectOwnerRow>(
    `SELECT ae.id, ae.encounter_id, ae.character_id, ae.monster_instance_id, ed.name AS effect_definition_name,
            COALESCE(c.campaign_id, mi.campaign_id) AS campaign_id
     FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     LEFT JOIN characters c ON c.id = ae.character_id
     LEFT JOIN monster_instances mi ON mi.id = ae.monster_instance_id
     WHERE ae.id = $1`,
    [effectId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Effect');
  const role = await requireMembership(pool, row.campaign_id, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE active_effects SET removed_at = now() WHERE id = $1 AND removed_at IS NULL RETURNING *`,
      [effectId],
    );
    const effect = updateRes.rows[0];
    if (!effect) throw new AppError('CONFLICT', 'Effect was already removed');

    const encounterSyncs = await resolveEncounterSyncs(client, row.encounter_id, row.character_id, row.monster_instance_id);

    await client.query('COMMIT');
    return { effect, effectDefinitionName: row.effect_definition_name, encounterSyncs, replacedEffect: null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
