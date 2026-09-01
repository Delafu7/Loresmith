// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P2-3 (CB-08) —
// proves the actual wiring (loadMovementContext's new threats/is_disengaging
// queries feeding services/movement.ts's computeOpportunityAttackTriggers,
// via setParticipantPosition), not just the pure movement.ts function
// (movement.test.ts already covers the trigger math in isolation). A 2-row
// map: the mover travels along row 0, the enemy threat sits at (0,1) —
// adjacent to the mover's start (Chebyshev distance 1, within 5ft reach) but
// never itself on the mover's path, so occupancy passability never enters
// into it. Throwaway campaign/encounter fixtures, same isolation convention
// as encounters.incapacitatedOccupancy.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  applyActionEconomy,
  createEncounter,
  setEncounterMode,
  setParticipantPosition,
  startEncounter,
  upsertEncounterMap,
} from './encounters.js';
import { applyCharacterEffect, removeEffect } from './effects.js';
import { createHomebrewMonster } from './monsterCatalog.js';

describe('Opportunity Attack trigger detection (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let enemyParticipantId: string;
  let disengagingEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'OppAttack Test DM', 'x') RETURNING id`,
      [`opp-attack-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('OppAttack Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const enemyMonster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'OppAttack Test Enemy', size: 'medium', creatureType: 'humanoid', armorClass: 12, hitPointAverage: 10,
      hitDice: '2d8', speed: { walk: 30 }, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Slam', description: '1d4 bludgeoning.' }],
    });
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [campaignId, enemyMonster.id]);
    const enemyInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, enemyMonster.id],
    );

    const encounter = await createEncounter(pool, campaignId, { name: 'OppAttack Test Encounter' });
    encounterId = encounter.id;
    await upsertEncounterMap(pool, encounterId, { gridColumns: 6, gridRows: 2, feetPerCell: 5 });

    const { participant: enemyParticipant } = await addParticipant(pool, encounterId, {
      monsterInstanceId: enemyInstanceRes.rows[0]!.id, faction: 'enemy',
    });
    enemyParticipantId = enemyParticipant.id;
    await setParticipantPosition(pool, encounterId, enemyParticipantId, { x: 0, y: 1 }, 'dm');

    await setEncounterMode(pool, encounterId, { mode: 'combat' });
    await startEncounter(pool, encounterId);

    const disengagingRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Disengaging' AND is_homebrew = false`);
    if (!disengagingRes.rows[0]) throw new Error("Expected a seeded 'Disengaging' effect_definitions row for this test");
    disengagingEffectDefinitionId = disengagingRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function seatFreshMover(name: string, initiativeRoll: number): Promise<string> {
    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId, name],
    );
    const { participant } = await addParticipant(pool, encounterId, { characterId: charRes.rows[0]!.id, initiativeRoll });
    await setParticipantPosition(pool, encounterId, participant.id, { x: 0, y: 0 }, 'dm');
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [participant.turn_order, encounterId]);
    return participant.id;
  }

  it('moving from adjacent-to-an-enemy to far away triggers an opportunity attack from that enemy', async () => {
    const moverId = await seatFreshMover('OppAttack Test PC 1', 10);
    const result = await setParticipantPosition(pool, encounterId, moverId, { x: 5, y: 0 }, 'dm');
    expect(result.opportunityAttackTriggers).toEqual([enemyParticipantId]);
  });

  it('a move that stays within the enemy\'s reach the whole time never triggers', async () => {
    const moverId = await seatFreshMover('OppAttack Test PC 2', 9);
    const result = await setParticipantPosition(pool, encounterId, moverId, { x: 1, y: 0 }, 'dm');
    expect(result.opportunityAttackTriggers).toEqual([]);
  });

  it('a Disengaging mover never triggers, even on the exact same far move', async () => {
    const moverId = await seatFreshMover('OppAttack Test PC 3', 8);
    const { effect } = await applyCharacterEffect(pool, dmUserId, (await pool.query<{ character_id: string }>(
      `SELECT character_id FROM combat_participants WHERE id = $1`, [moverId],
    )).rows[0]!.character_id, { effectDefinitionId: disengagingEffectDefinitionId, sourceType: 'manual' });

    const result = await setParticipantPosition(pool, encounterId, moverId, { x: 5, y: 0 }, 'dm');
    expect(result.opportunityAttackTriggers).toEqual([]);

    await removeEffect(pool, dmUserId, (effect as { id: string }).id);
  });

  it('an enemy that already spent its reaction this turn never triggers', async () => {
    await applyActionEconomy(pool, encounterId, enemyParticipantId, { spend: 'reaction' });

    const moverId = await seatFreshMover('OppAttack Test PC 4', 7);
    const result = await setParticipantPosition(pool, encounterId, moverId, { x: 5, y: 0 }, 'dm');
    expect(result.opportunityAttackTriggers).toEqual([]);

    // Restore for any later test in this file that might run after this one.
    await pool.query(`UPDATE combat_participants SET reaction_used = false WHERE id = $1`, [enemyParticipantId]);
  });
});
