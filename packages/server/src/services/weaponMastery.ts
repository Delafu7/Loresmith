// docs/roadmap/dnd-2024-gap-analysis.md P1-6 (EQ-02) — Weapon Mastery
// mechanical effects. Two concerns:
//
//  1. "Known masteries" — which weapon kinds a character can use the
//     mastery property of (character_weapon_mastery_choices), capped by
//     class_levels.weapon_mastery_count summed across the character's
//     classes (docs/roadmap/progress.md flags this sum-across-classes
//     choice as an inferred, unverified multiclass interaction — the PHB's
//     multiclassing table doesn't list Weapon Mastery at all).
//
//  2. Resolving what a mastery property DOES when a weapon that carries it
//     hits (or, for Graze, misses). Scoped with the user to "track state,
//     don't auto-consult it" for every property, matching this app's
//     existing conditions/rests automation philosophy: Sap/Vex/Slow write a
//     real, visible active_effects row; Cleave/Graze/Nick/Push/Topple just
//     confirm the mastery is known and describe the mechanical text,
//     resolved by the caller through endpoints that already fully exist
//     (a second POST .../attacks/.../damage call, a token move, the normal
//     effects endpoints for Topple's Prone). Nothing here rolls dice, moves
//     a token, or feeds back into rollDice's advantage/disadvantage — that
//     gap is the same one this project already tracks as CB-07/P2-2 for
//     conditions generally, not something this phase closes.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { authorizeCharacterAction, authorizeCharacterMutation, fetchCharacterOrThrow, requireCharacterReadAccess } from './characters.js';
import { requireMembership } from './authz.js';
import { insertActiveEffect, type EffectMutationResult } from './effects.js';
import type { SetCharacterWeaponMasteriesInput, WeaponMasteryTriggerInput } from '../schemas/weaponMastery.js';

interface ChosenMasteryRow {
  item_id: string;
  slug: string;
  name: string;
  mastery_index_key: string | null;
}

async function fetchAllowedMasteryCount(pool: Pool, characterId: string): Promise<number> {
  const result = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(cl.weapon_mastery_count), 0)::int AS total
     FROM character_classes cc
     JOIN class_levels cl ON cl.class_id = cc.class_id AND cl.level = cc.level
     WHERE cc.character_id = $1`,
    [characterId],
  );
  return result.rows[0]?.total ?? 0;
}

export async function listCharacterWeaponMasteries(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);

  const [chosen, allowedCount] = await Promise.all([
    pool.query<ChosenMasteryRow>(
      `SELECT cwm.item_id, i.slug, i.name, i.properties->>'mastery' AS mastery_index_key
       FROM character_weapon_mastery_choices cwm
       JOIN items i ON i.id = cwm.item_id
       WHERE cwm.character_id = $1
       ORDER BY i.name ASC`,
      [characterId],
    ),
    fetchAllowedMasteryCount(pool, characterId),
  ]);

  return { chosen: chosen.rows, allowedCount };
}

export async function setCharacterWeaponMasteries(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: SetCharacterWeaponMasteriesInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const uniqueIds = Array.from(new Set(input.itemIds));

  if (uniqueIds.length > 0) {
    const itemsRes = await pool.query<{ id: string; item_type: string; mastery: string | null }>(
      `SELECT id, item_type, properties->>'mastery' AS mastery FROM items WHERE id = ANY($1::uuid[])`,
      [uniqueIds],
    );
    if (itemsRes.rows.length !== uniqueIds.length) {
      throw new AppError('VALIDATION_ERROR', 'One or more itemIds do not reference an existing item');
    }
    for (const row of itemsRes.rows) {
      if (row.item_type !== 'weapon') throw new AppError('VALIDATION_ERROR', `Item ${row.id} is not a weapon`);
      if (!row.mastery) throw new AppError('VALIDATION_ERROR', `Item ${row.id} has no weapon mastery property`);
    }
  }

  const allowedCount = await fetchAllowedMasteryCount(pool, characterId);
  if (uniqueIds.length > allowedCount) {
    throw new AppError(
      'VALIDATION_ERROR',
      `This character knows at most ${allowedCount} weapon mastery ${allowedCount === 1 ? 'property' : 'properties'} (chose ${uniqueIds.length})`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM character_weapon_mastery_choices WHERE character_id = $1`, [characterId]);
    for (const itemId of uniqueIds) {
      await client.query(`INSERT INTO character_weapon_mastery_choices (character_id, item_id) VALUES ($1, $2)`, [characterId, itemId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return listCharacterWeaponMasteries(pool, actorId, characterId);
}

// ---- Mastery-property mechanical text (docs/players-handbook-2024/
// Chapter 6- Equipment/chapter6-equipment.md, lines 358-386) — used for the
// 5 properties that resolve through an existing endpoint rather than
// writing new state. Kept as plain narrated text, not a further-structured
// payload, matching this app's existing "saveDc/half_on_save are
// suggest-to-the-UI, not server-enforced" convention (services/
// diceEngine.ts's computeSaveDc comment) — Topple's DC in particular is
// left for the client to compute via that same existing helper, not
// recomputed here.
const NARRATIVE_ONLY_TEXT: Record<string, string> = {
  cleave:
    'Cleave: make a melee attack roll with this weapon against a second creature within 1.5 m (5 ft) of the first, also within your reach. ' +
    'On a hit, that creature takes the weapon’s damage, but only add your ability modifier if it’s negative. Resolve as a normal second attack/damage call. Once per turn (not enforced by this endpoint).',
  graze:
    'Graze: this attack missed, but you still deal damage equal to the ability modifier you used for the attack roll (same damage type as the weapon). ' +
    'Resolve via the normal damage-application call with diceCount: 0.',
  nick:
    'Nick: the Light property’s extra attack can be made as part of the Attack action instead of as a Bonus Action. Once per turn (not enforced by this endpoint).',
  push:
    'Push: you may push the target up to 3 m (10 ft) straight away from you, if it is Large or smaller. Resolve via the normal token-move/position endpoint.',
  topple:
    'Topple: the target must make a Constitution saving throw (DC 8 + the ability modifier used for the attack roll + your proficiency bonus). ' +
    'On a failed save, apply the Prone condition via the normal character/monster-instance effects endpoint.',
};

// The 3 properties that create real lingering active_effects state.
// 'target' = who the effect lands on ('attacker' for Vex, which benefits
// the wielder, not the creature that was hit).
const STATEFUL_MASTERY: Record<string, { effectName: string; target: 'attacker' | 'target'; requiresDamage: boolean }> = {
  sap: { effectName: 'Sap (Weapon Mastery)', target: 'target', requiresDamage: false },
  vex: { effectName: 'Vex (Weapon Mastery)', target: 'attacker', requiresDamage: true },
  slow: { effectName: 'Slowed (Weapon Mastery)', target: 'target', requiresDamage: true },
};

export interface WeaponMasteryTriggerResult {
  masteryIndexKey: string;
  masteryName: string;
  weaponItemId: string;
  applied: boolean;
  alreadyApplied?: boolean;
  effect?: EffectMutationResult;
  message: string;
}

interface ResolvedWeapon {
  itemId: string;
  masteryIndexKey: string;
}

async function resolveWeapon(pool: Pool, characterId: string, input: WeaponMasteryTriggerInput): Promise<ResolvedWeapon> {
  if (input.weaponItemId) {
    const result = await pool.query<{ mastery: string | null }>(
      `SELECT properties->>'mastery' AS mastery FROM items WHERE id = $1`,
      [input.weaponItemId],
    );
    const row = result.rows[0];
    if (!row) throw notFound('Item');
    if (!row.mastery) throw new AppError('VALIDATION_ERROR', 'This item has no weapon mastery property');
    return { itemId: input.weaponItemId, masteryIndexKey: row.mastery };
  }

  const result = await pool.query<{ item_id: string | null; mastery: string | null }>(
    `SELECT ca.item_id, i.properties->>'mastery' AS mastery
     FROM character_attacks ca LEFT JOIN items i ON i.id = ca.item_id
     WHERE ca.id = $1 AND ca.character_id = $2`,
    [input.characterAttackId, characterId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Character attack');
  if (!row.item_id) throw new AppError('VALIDATION_ERROR', 'This attack has no linked weapon (itemId)');
  if (!row.mastery) throw new AppError('VALIDATION_ERROR', 'This attack’s weapon has no mastery property');
  return { itemId: row.item_id, masteryIndexKey: row.mastery };
}

async function assertKnowsMastery(pool: Pool, characterId: string, itemId: string): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM character_weapon_mastery_choices WHERE character_id = $1 AND item_id = $2`,
    [characterId, itemId],
  );
  if (result.rows.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'This character has not chosen the mastery property of this weapon (see PUT .../weapon-masteries)');
  }
}

async function assertTargetInCampaign(pool: Pool, campaignId: string, targetCharacterId?: string, targetMonsterInstanceId?: string): Promise<void> {
  if (targetCharacterId) {
    const r = await pool.query(`SELECT 1 FROM characters WHERE id = $1 AND campaign_id = $2`, [targetCharacterId, campaignId]);
    if (r.rows.length === 0) throw notFound('Target character in this campaign');
  } else if (targetMonsterInstanceId) {
    const r = await pool.query(`SELECT 1 FROM monster_instances WHERE id = $1 AND campaign_id = $2`, [targetMonsterInstanceId, campaignId]);
    if (r.rows.length === 0) throw notFound('Target monster instance in this campaign');
  }
}

async function fetchMasteryName(pool: Pool, indexKey: string): Promise<string> {
  const result = await pool.query<{ name: string }>(`SELECT name FROM weapon_mastery_properties WHERE index_key = $1`, [indexKey]);
  const row = result.rows[0];
  if (!row) throw new AppError('VALIDATION_ERROR', `Unknown weapon mastery property '${indexKey}'`);
  return row.name;
}

async function fetchEffectDefinitionId(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = $1 AND is_homebrew = false`, [name]);
  const row = result.rows[0];
  if (!row) throw new AppError('VALIDATION_ERROR', `Effect definition '${name}' not seeded`);
  return row.id;
}

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — POST /characters/:id/weapon-mastery-trigger.
// :id is the ATTACKING character; authorized the same way applyDamage
// authorizes its actorParticipantId-less path (control of the attacker),
// not DM-only — this narrates the ATTACKER's own already-resolved action,
// not a fresh DM edit. Target campaign membership is checked, but no
// participant/turn gating is added on top — the real gate already happened
// at the attack-roll/applyDamage step this call follows.
export async function resolveWeaponMasteryTrigger(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: WeaponMasteryTriggerInput,
): Promise<WeaponMasteryTriggerResult> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterAction(pool, actorId, character);
  await requireMembership(pool, character.campaign_id, actorId);
  await assertTargetInCampaign(pool, character.campaign_id, input.targetCharacterId, input.targetMonsterInstanceId);

  const { itemId, masteryIndexKey } = await resolveWeapon(pool, characterId, input);
  await assertKnowsMastery(pool, characterId, itemId);
  const masteryName = await fetchMasteryName(pool, masteryIndexKey);

  const stateful = STATEFUL_MASTERY[masteryIndexKey];
  if (!stateful) {
    // cleave / graze / nick / push / topple — narrate only.
    const outcomeOk = masteryIndexKey === 'graze' ? input.outcome === 'miss' : input.outcome === 'hit';
    const message = outcomeOk
      ? (NARRATIVE_ONLY_TEXT[masteryIndexKey] ?? masteryName)
      : `${masteryName} doesn't apply: this property requires a ${masteryIndexKey === 'graze' ? 'miss' : 'hit'}.`;
    return { masteryIndexKey, masteryName, weaponItemId: itemId, applied: false, message };
  }

  if (input.outcome !== 'hit' || (stateful.requiresDamage && !(input.damageDealt && input.damageDealt > 0))) {
    return {
      masteryIndexKey, masteryName, weaponItemId: itemId, applied: false,
      message: `${masteryName} doesn't apply: requires a hit${stateful.requiresDamage ? ' that deals damage' : ''}.`,
    };
  }

  const targetCharacterId = stateful.target === 'attacker' ? characterId : input.targetCharacterId;
  const targetMonsterInstanceId = stateful.target === 'attacker' ? undefined : input.targetMonsterInstanceId;

  const effectDefinitionId = await fetchEffectDefinitionId(pool, stateful.effectName);

  // Slow's RAW text: "the Speed reduction doesn't exceed 10 feet" even
  // across multiple Slow hits before the window ends — don't stack a
  // second row on top of an already-active one.
  if (masteryIndexKey === 'slow') {
    const existing = await pool.query<{ id: string }>(
      `SELECT ae.id FROM active_effects ae
       WHERE ae.effect_definition_id = $1 AND ae.removed_at IS NULL
         AND ${targetCharacterId ? 'ae.character_id = $2' : 'ae.monster_instance_id = $2'}`,
      [effectDefinitionId, targetCharacterId ?? targetMonsterInstanceId],
    );
    if (existing.rows[0]) {
      return {
        masteryIndexKey, masteryName, weaponItemId: itemId, applied: false, alreadyApplied: true,
        message: 'Slowed already active on this target — the reduction does not stack further.',
      };
    }
  }

  const effect = await insertActiveEffect(pool, {
    effectDefinitionId,
    characterId: targetCharacterId ?? null,
    monsterInstanceId: targetMonsterInstanceId ?? null,
    encounterId: input.encounterId ?? null,
    sourceCharacterId: characterId,
    sourceType: 'class_feature',
    notes:
      stateful.target === 'attacker'
        ? `Vex vs target ${input.targetCharacterId ?? input.targetMonsterInstanceId}`
        : `From ${masteryName} (attacker ${characterId})`,
  });

  return { masteryIndexKey, masteryName, weaponItemId: itemId, applied: true, effect, message: `${masteryName} applied.` };
}
