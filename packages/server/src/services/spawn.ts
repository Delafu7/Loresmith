// Batched monster-instance spawn (Iteration 2, "Fast add/spawn UX" — see
// docs/rules/monster-spawning.md for the HP-strategy/group-initiative rules
// basis). Replaces what used to be `quantity` sequential POST
// /monster-instances + POST /participants round-trips with one transactional
// request: N monster_instances + N combat_participants inserted, turn_order
// resequenced once, encounters.sync_seq bumped once. Mirrors
// createMonsterInstance's (services/monsters.ts) row-locking/auto-naming
// pattern and addParticipant's (services/encounters.ts) participant-insert
// shape — see each function's own comments for the precedents being reused.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { rollDie, rollHitDice } from './diceRolls.js';
import { dexModifier, reorderTurnOrderByInitiative, syncActiveParticipantTurnIndex } from './encounters.js';
import { assertMonsterCuratedInBestiary } from './campaignBestiary.js';
import type { SpawnParticipantsInput } from '../schemas/encounters.js';

const ALPHA_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface SpawnedParticipant {
  id: string;
  encounter_id: string;
  monster_instance_id: string;
  initiative_roll: number;
  initiative_tiebreak: number | null;
  turn_order: number;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
  [key: string]: unknown;
}

export interface SpawnParticipantsResult {
  encounter: Record<string, unknown>;
  participants: SpawnedParticipant[];
}

// Auto-naming for a batch mirrors createMonsterInstance's "{name} {n}"
// scheme, but computes the starting number ONCE (existingInCampaign, below)
// and increments in-loop rather than re-querying COUNT(*) per insert — the
// per-insert version createMonsterInstance uses is safe there because each
// call is its own transaction, but N inserts in a single transaction would
// all read the same pre-loop count and collide on the same name if it were
// reused unchanged here.
function computeInstanceName(
  monster: { name: string; is_unique: boolean },
  input: SpawnParticipantsInput,
  startCount: number,
  index: number,
): string | null {
  if (monster.is_unique) return null;
  if (input.customBaseName) return `${input.customBaseName} ${index + 1}`;
  if (input.namingScheme === 'alpha') {
    return `${monster.name} ${ALPHA_NAMES[(startCount + index) % ALPHA_NAMES.length]}`;
  }
  return `${monster.name} ${startCount + index + 1}`;
}

export async function spawnParticipants(
  pool: Pool,
  encounterId: string,
  input: SpawnParticipantsInput,
): Promise<SpawnParticipantsResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const encounterRes = await client.query<{
      id: string;
      campaign_id: string;
      current_round: number;
      mode: 'exploration' | 'combat';
      status: 'preparing' | 'active' | 'paused' | 'completed';
      [key: string]: unknown;
    }>(`SELECT * FROM encounters WHERE id = $1 FOR UPDATE`, [encounterId]);
    const encounter = encounterRes.rows[0];
    if (!encounter) throw notFound('Encounter');
    const joinedRound = Math.max(1, encounter.current_round);
    const campaignId = encounter.campaign_id;

    // Same row-lock discipline as createMonsterInstance — serializes a
    // concurrent spawn of the same is_unique monster behind this one.
    const monsterRes = await client.query<{
      id: string;
      name: string;
      is_unique: boolean;
      hit_point_average: number;
      hit_dice: string;
      dex: number;
      legendary_action_count: number | null;
    }>(
      `SELECT id, name, is_unique, hit_point_average, hit_dice, dex, legendary_action_count FROM monsters WHERE id = $1 FOR UPDATE`,
      [input.monsterId],
    );
    const monster = monsterRes.rows[0];
    if (!monster) throw notFound('Monster');

    await assertMonsterCuratedInBestiary(client, campaignId, input.monsterId);

    if (monster.is_unique && input.quantity > 1) {
      throw new AppError('VALIDATION_ERROR', `${monster.name} is unique and cannot be spawned more than once in a single batch`);
    }

    if (monster.is_unique) {
      const uniqueLiving = await client.query<{ campaign_id: string; campaign_name: string }>(
        `SELECT mi.campaign_id, c.name AS campaign_name
         FROM monster_instances mi
         JOIN campaigns c ON c.id = mi.campaign_id
         WHERE mi.monster_id = $1 AND mi.status = 'alive'
         LIMIT 1`,
        [input.monsterId],
      );
      const existing = uniqueLiving.rows[0];
      if (existing) {
        throw new AppError(
          'CONFLICT',
          `${monster.name} is unique and already has a living instance in campaign "${existing.campaign_name}" (id ${existing.campaign_id})`,
          { existingCampaignId: existing.campaign_id },
        );
      }
    }

    const existingInCampaign = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monster_instances WHERE campaign_id = $1 AND monster_id = $2`,
      [campaignId, input.monsterId],
    );
    const startCount = Number(existingInCampaign.rows[0]!.count);

    const existingParticipantCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM combat_participants WHERE encounter_id = $1`,
      [encounterId],
    );
    let turnOrder = Number(existingParticipantCount.rows[0]!.count);

    const mod = dexModifier(monster.dex);
    // groupInitiative: roll once up front and reuse for every instance in
    // this batch — see docs/rules/monster-spawning.md §2 for the SRD basis
    // (both editions treat a shared roll for identical creatures as core
    // procedure, not an optional variant).
    const sharedInitiative = input.groupInitiative ? rollDie(20) + mod : null;

    // hpStrategy 'same': rolled once, lazily, on first use, then reused for
    // every remaining instance — see docs/rules/monster-spawning.md §1.
    let sameRolledHp: number | null = null;

    const spawned: SpawnedParticipant[] = [];

    for (let i = 0; i < input.quantity; i++) {
      let hpCurrent: number;
      if (input.hpStrategy === 'average') {
        hpCurrent = monster.hit_point_average;
      } else if (input.hpStrategy === 'rolled') {
        hpCurrent = rollHitDice(monster.hit_dice);
      } else {
        if (sameRolledHp === null) sameRolledHp = rollHitDice(monster.hit_dice);
        hpCurrent = sameRolledHp;
      }

      const customName = computeInstanceName(monster, input, startCount, i);

      const instanceRes = await client.query<{ id: string }>(
        `INSERT INTO monster_instances (campaign_id, monster_id, custom_name, hp_current, hp_temp, status, is_recurring)
         VALUES ($1,$2,$3,$4,0,'alive',false)
         RETURNING id`,
        [campaignId, input.monsterId, customName, hpCurrent],
      );
      const instanceId = instanceRes.rows[0]!.id;

      const initiativeRoll = input.groupInitiative ? sharedInitiative! : rollDie(20) + mod;
      const initiativeTiebreak = mod;

      // Phase 2 "legendary actions per-round counters" — a freshly-spawned
      // legendary monster starts this encounter with its full budget; NULL
      // for a non-legendary monster (legendary_action_count NULL), same as
      // every other creature.
      const participantRes = await client.query<SpawnedParticipant>(
        `INSERT INTO combat_participants
           (encounter_id, monster_instance_id, initiative_roll, initiative_tiebreak, turn_order, joined_round, faction, legendary_actions_remaining)
         VALUES ($1,$2,$3,$4,$5,$6,'enemy',$7)
         RETURNING *`,
        [encounterId, instanceId, initiativeRoll, initiativeTiebreak, turnOrder, joinedRound, monster.legendary_action_count],
      );
      turnOrder += 1;
      spawned.push(participantRes.rows[0]!);
    }

    // Only resequence/re-derive the active turn pointer while combat is
    // actually running — mirrors addParticipant's identical guard in
    // services/encounters.ts. During 'preparing', turn_order staying as
    // plain append order (already true from the loop above) is correct;
    // /roll-initiative or startCombat establishes the real ordering later.
    if (encounter.mode === 'combat' && encounter.status === 'active') {
      await reorderTurnOrderByInitiative(client, encounterId);
      await syncActiveParticipantTurnIndex(client, encounterId);
      const refreshed = await client.query<SpawnedParticipant>(
        `SELECT * FROM combat_participants WHERE id = ANY($1::uuid[])`,
        [spawned.map((p) => p.id)],
      );
      spawned.length = 0;
      spawned.push(...refreshed.rows);
    }

    const updatedEncounterRes = await client.query(`UPDATE encounters SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING *`, [
      encounterId,
    ]);

    await client.query('COMMIT');
    return { encounter: updatedEncounterRes.rows[0], participants: spawned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
