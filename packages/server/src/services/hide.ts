// Hide Action (docs/roadmap/dnd-2024-gap-analysis.md P1-13, rulesGlossary.md
// "Hide [Action]" line 954-960: "you must succeed on a DC 15 Dexterity
// (Stealth) check... On a successful check, you have the Invisible
// condition while hidden.") — mirrors services/shove.ts/grapple.ts's
// PC-attacker-only, DM-approval-gated shape and contested-roll transaction
// discipline, but simplified: there's no opposed/defender side (the DC is a
// fixed 15, never overridden — see schemas/hide.ts's header comment), and on
// success the effect targets the ACTOR themself (self-targeting), not an
// opponent. Preconditions (Heavily Obscured / Cover / out of every enemy's
// line of sight) are the DM's own call per the rule text's own "The Dungeon
// Master decides when circumstances are appropriate for hiding" — not
// enforced here, matching Cover's (P1-10) own "track state, don't gate the
// core roll pipeline on it" precedent.
//
// The "you make an attack roll" break condition is enforced elsewhere
// (services/diceRolls.ts's rollDice — see its own P1-13 comment) rather than
// here, since it has to fire on ANY subsequent attack roll, not just at the
// moment Hide is taken. The other 3 break conditions (loud noise, being
// found, casting a spell with a Verbal component) are DM-judgment calls this
// app doesn't model — same "specific break conditions... not enforced"
// treatment as every other partially-automated condition this cycle
// (Dodge's clear-on-turn-advance is the one other auto-cleared condition;
// everything else goes through the existing DELETE /effects/:id flow).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { rollDice, type DiceRollRow } from './diceRolls.js';
import { requireCurrentTurn } from './encounters.js';
import { requireMembership } from './authz.js';
import { applyEncounterEffect, type EffectMutationResult } from './effects.js';
import { createPendingAction, type PendingActionCreated } from './pendingActions.js';
import { proficiencyBonusForLevel } from './diceEngine.js';
import type { PerformHideInput } from '../schemas/hide.js';

const HIDE_DC = 15;

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

interface EncounterRow {
  id: string;
  campaign_id: string;
  sync_seq: number;
  [key: string]: unknown;
}

interface ParticipantRow {
  id: string;
  action_used: boolean;
  bonus_action_used: boolean;
  reaction_used: boolean;
  dash_used: boolean;
  movement_used_ft: number;
  object_interaction_used: boolean;
  [key: string]: unknown;
}

export interface HideResult {
  encounter: EncounterRow;
  participant: ParticipantRow;
  checkRoll: DiceRollRow;
  success: boolean;
  appliedEffect: EffectMutationResult | null;
  message: string;
}

async function fetchInvisibleEffectDefinitionId(pool: Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM effect_definitions WHERE name = 'Invisible' AND condition_id IS NOT NULL LIMIT 1`,
  );
  const row = result.rows[0];
  if (!row) throw new AppError('CONFLICT', 'No "Invisible" effect definition found in the catalog — seed effect_definitions first');
  return row.id;
}

export async function performHide(
  pool: Pool,
  encounterId: string,
  actorParticipantId: string,
  actorUserId: string,
  _input: PerformHideInput,
): Promise<HideResult | PendingActionCreated> {
  // Phase 4 "DM approval before a player-submitted action resolves" — see
  // shove.ts's performShove for the full rationale (mirrors it exactly).
  const campaignForRoleRes = await pool.query<{ campaign_id: string }>(
    `SELECT e.campaign_id FROM combat_participants cp JOIN encounters e ON e.id = cp.encounter_id WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [actorParticipantId, encounterId],
  );
  const campaignForRole = campaignForRoleRes.rows[0];
  if (!campaignForRole) throw notFound('Actor participant (must be a character)');
  const role = await requireMembership(pool, campaignForRole.campaign_id, actorUserId);
  if (role !== 'dm') {
    const request = await createPendingAction(pool, {
      encounterId,
      campaignId: campaignForRole.campaign_id,
      requestedByUserId: actorUserId,
      actorParticipantId,
      targetParticipantIds: [actorParticipantId],
      kind: 'hide',
      label: 'Hide',
      payload: {},
    });
    return { pending: true, request };
  }

  const client = await pool.connect();
  let campaignId: string;
  let actorCharacterId: string;
  let actorDex: number;
  let actorTotalLevel: number;
  let stealthProficiencyLevel: 'proficient' | 'expertise' | null;
  let encounter: EncounterRow;
  let participant: ParticipantRow;

  try {
    await client.query('BEGIN');

    const actorRes = await client.query<{
      id: string;
      character_id: string | null;
      action_used: boolean;
      dex: number;
      campaign_id: string;
      turn_order: number;
      status: 'preparing' | 'active' | 'paused' | 'completed';
      current_turn_index: number;
    }>(
      `SELECT cp.id, cp.character_id, cp.action_used, cp.turn_order, c.dex, e.campaign_id, e.status, e.current_turn_index
       FROM combat_participants cp
       JOIN characters c ON c.id = cp.character_id
       JOIN encounters e ON e.id = cp.encounter_id
       WHERE cp.id = $1 AND cp.encounter_id = $2
       FOR UPDATE OF cp`,
      [actorParticipantId, encounterId],
    );
    const actorRow = actorRes.rows[0];
    if (!actorRow) throw notFound('Actor participant (must be a character)');
    if (actorRow.action_used) {
      throw new AppError('CONFLICT', "That participant's action has already been used this turn");
    }
    requireCurrentTurn(
      { status: actorRow.status, current_turn_index: actorRow.current_turn_index },
      { turn_order: actorRow.turn_order },
    );
    campaignId = actorRow.campaign_id;
    actorDex = actorRow.dex;
    actorCharacterId = actorRow.character_id!;

    const levelRes = await client.query<{ total: number }>(
      `SELECT COALESCE(SUM(level), 0)::int AS total FROM character_classes WHERE character_id = $1`,
      [actorCharacterId],
    );
    actorTotalLevel = levelRes.rows[0]!.total;

    const stealthRes = await client.query<{ level: 'proficient' | 'expertise' }>(
      `SELECT csp.level FROM character_skill_proficiencies csp
       JOIN skills s ON s.id = csp.skill_id
       WHERE csp.character_id = $1 AND s.index_key = 'stealth'`,
      [actorCharacterId],
    );
    stealthProficiencyLevel = stealthRes.rows[0]?.level ?? null;

    const updated = await client.query<ParticipantRow>(
      `UPDATE combat_participants SET action_used = true WHERE id = $1 AND encounter_id = $2 RETURNING *`,
      [actorParticipantId, encounterId],
    );
    participant = updated.rows[0]!;

    const encounterRes = await client.query<EncounterRow>(
      `UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`,
      [encounterId],
    );
    encounter = encounterRes.rows[0]!;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // ---- Roll (and, on success, the effect application) happens after the
  // action-economy transaction commits — same reasoning as shove.ts/grapple.ts.
  const profBonus = proficiencyBonusForLevel(actorTotalLevel);
  const profTerm = stealthProficiencyLevel === 'expertise' ? profBonus * 2 : stealthProficiencyLevel === 'proficient' ? profBonus : 0;
  const checkModifier = abilityModifier(actorDex) + profTerm;

  const checkRoll = await rollDice(pool, campaignId, actorUserId, 'dm', {
    rollType: 'skill_check',
    rollContext: 'Hide (Stealth)',
    keep: 'normal',
    modifier: checkModifier,
    diceSides: 20,
    diceCount: 1,
    characterId: actorCharacterId,
    encounterId,
    visibility: 'public' as const,
  });

  const success = checkRoll.result_total >= HIDE_DC;

  let appliedEffect: EffectMutationResult | null = null;
  if (success) {
    const invisibleEffectDefinitionId = await fetchInvisibleEffectDefinitionId(pool);
    appliedEffect = await applyEncounterEffect(pool, encounterId, campaignId, {
      effectDefinitionId: invisibleEffectDefinitionId,
      characterId: actorCharacterId,
      sourceCharacterId: actorCharacterId,
      sourceType: 'manual',
      // rulesGlossary.md line 958 — "Make note of your check's total, which
      // is the DC for a creature to find you with a Wisdom (Perception)
      // check." Recorded here rather than only in dice_rolls history so the
      // effect itself documents the DC to beat, same "self-documenting
      // active effect" convenience the app already gets for free on
      // spell-sourced effects via their saveDc column.
      notes: `Hidden — DC ${checkRoll.result_total} for a creature to find you (Wisdom (Perception) check).`,
    });
  }

  const message = success
    ? `Hide succeeds (${checkRoll.result_total} vs DC ${HIDE_DC}) — you have the Invisible condition while hidden.`
    : `Hide fails (${checkRoll.result_total} vs DC ${HIDE_DC}) — you remain visible.`;

  return { encounter, participant, checkRoll, success, appliedEffect, message };
}
