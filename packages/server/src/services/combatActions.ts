// Action recording + combat log (nav point 2). One row per resolved action
// (roll + damage/effect already known), written additively — the client
// calls POST /encounters/:id/actions once per action instead of every
// existing roll/damage/action-economy endpoint threading a write through
// itself. Read path respects encounter visibility (nav point 1): an action
// touching a currently-hidden participant is invisible to a non-DM viewer,
// full for the DM — same "compute per-role server-side" rule as
// sockets/broadcast.ts's FULL_STATE_SYNC split.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { authorizeParticipantAction } from './encounters.js';
import type { RecordActionInput } from '../schemas/combatActions.js';

interface ParticipantEntity {
  character_id: string | null;
  monster_instance_id: string | null;
}

export interface CombatActionRow {
  id: string;
  encounter_id: string;
  actor_character_id: string | null;
  actor_monster_instance_id: string | null;
  action_type: string;
  means_item_id: string | null;
  means_spell_id: string | null;
  means_character_attack_id: string | null;
  means_label: string | null;
  dice_roll_id: string | null;
  result_kind: string;
  damage_amount: number | null;
  damage_type_id: string | null;
  effect_description: string | null;
  created_at: string;
}

export interface CombatActionTarget {
  characterId: string | null;
  monsterInstanceId: string | null;
  name: string;
}

export interface CombatActionView {
  id: string;
  encounterId: string;
  actorCharacterId: string | null;
  actorMonsterInstanceId: string | null;
  actorName: string;
  actionType: string;
  meansName: string | null;
  diceRollId: string | null;
  diceRollTotal: number | null;
  resultKind: string;
  damageAmount: number | null;
  damageTypeName: string | null;
  effectDescription: string | null;
  createdAt: string;
  targets: CombatActionTarget[];
}

async function resolveParticipantEntity(pool: Pool, encounterId: string, participantId: string): Promise<ParticipantEntity> {
  const res = await pool.query<ParticipantEntity>(
    `SELECT character_id, monster_instance_id FROM combat_participants WHERE id = $1 AND encounter_id = $2`,
    [participantId, encounterId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Participant');
  return row;
}

export async function recordAction(
  pool: Pool,
  actorUserId: string,
  encounterId: string,
  input: RecordActionInput,
): Promise<CombatActionView> {
  // authorizeParticipantAction (services/encounters.ts) is the same
  // DM-or-owning-player gate the action-economy route already uses — the
  // actor must be a live participant in THIS encounter.
  await authorizeParticipantAction(pool, actorUserId, encounterId, input.actorParticipantId);
  const actor = await resolveParticipantEntity(pool, encounterId, input.actorParticipantId);

  let targets: ParticipantEntity[] = [];
  if (input.targetParticipantIds.length > 0) {
    const targetsRes = await pool.query<ParticipantEntity & { id: string }>(
      `SELECT id, character_id, monster_instance_id FROM combat_participants WHERE id = ANY($1::uuid[]) AND encounter_id = $2`,
      [input.targetParticipantIds, encounterId],
    );
    if (targetsRes.rows.length !== input.targetParticipantIds.length) {
      throw new AppError('VALIDATION_ERROR', 'One or more targets are not participants in this encounter');
    }
    targets = targetsRes.rows;
  }

  const client = await pool.connect();
  let actionId: string;
  try {
    await client.query('BEGIN');

    const actionRes = await client.query<CombatActionRow>(
      `INSERT INTO combat_actions
         (encounter_id, actor_character_id, actor_monster_instance_id, action_type,
          means_item_id, means_spell_id, means_character_attack_id, means_label,
          dice_roll_id, result_kind, damage_amount, damage_type_id, effect_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        encounterId,
        actor.character_id,
        actor.monster_instance_id,
        input.actionType,
        input.meansItemId ?? null,
        input.meansSpellId ?? null,
        input.meansCharacterAttackId ?? null,
        input.meansLabel ?? null,
        input.diceRollId ?? null,
        input.resultKind ?? 'n/a',
        input.damageAmount ?? null,
        input.damageTypeId ?? null,
        input.effectDescription ?? null,
      ],
    );
    actionId = actionRes.rows[0]!.id;

    for (const target of targets) {
      await client.query(
        `INSERT INTO combat_action_targets (action_id, target_character_id, target_monster_instance_id) VALUES ($1, $2, $3)`,
        [actionId, target.character_id, target.monster_instance_id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const view = await fetchActionView(pool, actionId);
  if (!view) throw new AppError('INTERNAL', 'Failed to load the action just recorded');
  return view;
}

const ACTION_SELECT = `
  SELECT ca.id, ca.encounter_id, ca.actor_character_id, ca.actor_monster_instance_id,
         COALESCE(actor_char.name, actor_mi.custom_name, actor_monster.name) AS actor_name,
         ca.action_type,
         COALESCE(means_item.name, means_spell.name, means_attack.name, ca.means_label) AS means_name,
         ca.dice_roll_id, dr.result_total AS dice_roll_total,
         ca.result_kind, ca.damage_amount, dt.name AS damage_type_name,
         ca.effect_description, ca.created_at
  FROM combat_actions ca
  LEFT JOIN characters actor_char ON actor_char.id = ca.actor_character_id
  LEFT JOIN monster_instances actor_mi ON actor_mi.id = ca.actor_monster_instance_id
  LEFT JOIN monsters actor_monster ON actor_monster.id = actor_mi.monster_id
  LEFT JOIN items means_item ON means_item.id = ca.means_item_id
  LEFT JOIN spells means_spell ON means_spell.id = ca.means_spell_id
  LEFT JOIN character_attacks means_attack ON means_attack.id = ca.means_character_attack_id
  LEFT JOIN damage_types dt ON dt.id = ca.damage_type_id
  LEFT JOIN dice_rolls dr ON dr.id = ca.dice_roll_id
`;

interface ActionSelectRow {
  id: string;
  encounter_id: string;
  actor_character_id: string | null;
  actor_monster_instance_id: string | null;
  actor_name: string;
  action_type: string;
  means_name: string | null;
  dice_roll_id: string | null;
  dice_roll_total: number | null;
  result_kind: string;
  damage_amount: number | null;
  damage_type_name: string | null;
  effect_description: string | null;
  created_at: string;
}

interface TargetSelectRow {
  action_id: string;
  target_character_id: string | null;
  target_monster_instance_id: string | null;
  target_name: string;
}

async function fetchTargetsByActionId(pool: Pool, actionIds: string[]): Promise<Map<string, CombatActionTarget[]>> {
  const map = new Map<string, CombatActionTarget[]>();
  if (actionIds.length === 0) return map;

  const res = await pool.query<TargetSelectRow>(
    `SELECT cat.action_id, cat.target_character_id, cat.target_monster_instance_id,
            COALESCE(tc.name, tmi.custom_name, tm.name) AS target_name
     FROM combat_action_targets cat
     LEFT JOIN characters tc ON tc.id = cat.target_character_id
     LEFT JOIN monster_instances tmi ON tmi.id = cat.target_monster_instance_id
     LEFT JOIN monsters tm ON tm.id = tmi.monster_id
     WHERE cat.action_id = ANY($1::uuid[])`,
    [actionIds],
  );
  for (const row of res.rows) {
    const list = map.get(row.action_id) ?? [];
    list.push({ characterId: row.target_character_id, monsterInstanceId: row.target_monster_instance_id, name: row.target_name });
    map.set(row.action_id, list);
  }
  return map;
}

function toView(row: ActionSelectRow, targets: CombatActionTarget[]): CombatActionView {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    actorCharacterId: row.actor_character_id,
    actorMonsterInstanceId: row.actor_monster_instance_id,
    actorName: row.actor_name,
    actionType: row.action_type,
    meansName: row.means_name,
    diceRollId: row.dice_roll_id,
    diceRollTotal: row.dice_roll_total,
    resultKind: row.result_kind,
    damageAmount: row.damage_amount,
    damageTypeName: row.damage_type_name,
    effectDescription: row.effect_description,
    createdAt: row.created_at,
    targets,
  };
}

async function fetchActionView(pool: Pool, actionId: string): Promise<CombatActionView | null> {
  const res = await pool.query<ActionSelectRow>(`${ACTION_SELECT} WHERE ca.id = $1`, [actionId]);
  const row = res.rows[0];
  if (!row) return null;
  const targetsByAction = await fetchTargetsByActionId(pool, [actionId]);
  return toView(row, targetsByAction.get(actionId) ?? []);
}

interface HiddenEntitySets {
  characterIds: Set<string>;
  monsterInstanceIds: Set<string>;
}

async function getHiddenEntitySets(pool: Pool, encounterId: string): Promise<HiddenEntitySets> {
  const res = await pool.query<ParticipantEntity>(
    `SELECT character_id, monster_instance_id FROM combat_participants WHERE encounter_id = $1 AND visible_to_players = false`,
    [encounterId],
  );
  return {
    characterIds: new Set(res.rows.map((r) => r.character_id).filter((id): id is string => id != null)),
    monsterInstanceIds: new Set(res.rows.map((r) => r.monster_instance_id).filter((id): id is string => id != null)),
  };
}

function involvesHidden(
  actorCharacterId: string | null,
  actorMonsterInstanceId: string | null,
  targets: CombatActionTarget[],
  hidden: HiddenEntitySets,
): boolean {
  const isHidden = (characterId: string | null, monsterInstanceId: string | null) =>
    (characterId != null && hidden.characterIds.has(characterId)) ||
    (monsterInstanceId != null && hidden.monsterInstanceIds.has(monsterInstanceId));

  if (isHidden(actorCharacterId, actorMonsterInstanceId)) return true;
  return targets.some((t) => isHidden(t.characterId, t.monsterInstanceId));
}

/**
 * Whether a just-recorded action should reach player sockets at all (nav
 * point 1) — used by the route/broadcast layer right after recordAction,
 * without a second round-trip through listActionsForEncounter's own
 * (separately fetched) hidden set.
 */
export async function isActionVisibleToPlayers(pool: Pool, encounterId: string, action: CombatActionView): Promise<boolean> {
  const hidden = await getHiddenEntitySets(pool, encounterId);
  return !involvesHidden(action.actorCharacterId, action.actorMonsterInstanceId, action.targets, hidden);
}

export async function listActionsForEncounter(
  pool: Pool,
  encounterId: string,
  viewerRole: 'dm' | 'player',
  pagination: { limit: number; offset: number },
): Promise<CombatActionView[]> {
  const res = await pool.query<ActionSelectRow>(
    `${ACTION_SELECT} WHERE ca.encounter_id = $1 ORDER BY ca.created_at DESC LIMIT $2 OFFSET $3`,
    [encounterId, pagination.limit, pagination.offset],
  );
  const targetsByAction = await fetchTargetsByActionId(pool, res.rows.map((r) => r.id));
  const views = res.rows.map((row) => toView(row, targetsByAction.get(row.id) ?? []));

  if (viewerRole === 'dm') return views;

  const hidden = await getHiddenEntitySets(pool, encounterId);
  return views.filter((v) => !involvesHidden(v.actorCharacterId, v.actorMonsterInstanceId, v.targets, hidden));
}
