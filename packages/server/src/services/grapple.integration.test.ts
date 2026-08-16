// Integration test for performGrapple (services/grapple.ts) — mirrors
// shove.turnOrderAuthz.integration.test.ts's fixture shape, extended to
// cover the size restriction and the Grappled effect application on
// success (shove has no equivalent effect-application step to test).
// Throwaway campaign/user/monster fixtures, same isolation convention as
// campaignExportImport.integration.test.ts (which already uses
// createHomebrewMonster for a size-controlled fixture monster).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { performGrapple } from './grapple.js';
import { createHomebrewMonster } from './monsterCatalog.js';

describe('performGrapple (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let attackerParticipantId: string; // PC, turn_order 0
  let mediumTargetParticipantId: string; // grappleable
  let gargantuanTargetParticipantId: string; // too large

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Grapple Test DM', 'x') RETURNING id`,
      [`grapple-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Grapple Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    // Phase 4 "DM approval": performGrapple now resolves role internally
    // (to decide DM-unconditional vs. queue-for-approval), which requires
    // actual campaign_members membership — this row was previously never
    // needed since authorization lived entirely at the route layer.
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Grapple Test PC', 16, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterId = charRes.rows[0]!.id;

    const mediumMonster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'Grapple Test Medium Monster', size: 'medium', creatureType: 'beast', armorClass: 12, hitPointAverage: 10,
      hitDice: '2d8', speed: { walk: 30 }, str: 8, dex: 8, con: 10, int: 4, wis: 10, cha: 4,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Bite', description: '1d4 piercing.' }],
    });
    const gargantuanMonster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'Grapple Test Gargantuan Monster', size: 'gargantuan', creatureType: 'beast', armorClass: 12, hitPointAverage: 100,
      hitDice: '10d20', speed: { walk: 30 }, str: 20, dex: 8, con: 20, int: 4, wis: 10, cha: 4,
      challengeRating: 10, xpValue: 5900, actions: [{ name: 'Bite', description: '4d6 piercing.' }],
    });

    const mediumInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, mediumMonster.id],
    );
    const gargantuanInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 100) RETURNING id`,
      [campaignId, gargantuanMonster.id],
    );

    // addParticipant now requires campaign-bestiary curation — see
    // assertMonsterCuratedInBestiary (services/campaignBestiary.ts).
    await pool.query(
      `INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2), ($1, $3)`,
      [campaignId, mediumMonster.id, gargantuanMonster.id],
    );

    const encounter = await createEncounter(pool, campaignId, { name: 'Grapple Test Encounter' });
    encounterId = encounter.id;

    const { participant: attacker } = await addParticipant(pool, encounterId, { characterId });
    attackerParticipantId = attacker.id; // turn_order 0
    const { participant: mediumTarget } = await addParticipant(pool, encounterId, { monsterInstanceId: mediumInstanceRes.rows[0]!.id });
    mediumTargetParticipantId = mediumTarget.id;
    const { participant: gargantuanTarget } = await addParticipant(pool, encounterId, { monsterInstanceId: gargantuanInstanceRes.rows[0]!.id });
    gargantuanTargetParticipantId = gargantuanTarget.id;

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) {
      // active_effects.source_character_id has no ON DELETE CASCADE from
      // characters (unlike campaign_id's cascade from campaigns) — clear
      // the Grappled effect this test applied before the campaign cascade
      // deletes its source character out from under it.
      await pool.query(`DELETE FROM active_effects WHERE source_character_id IN (SELECT id FROM characters WHERE campaign_id = $1)`, [campaignId]);
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    }
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('rejects a target more than one size category larger than the attacker', async () => {
    await expect(
      performGrapple(pool, encounterId, attackerParticipantId, dmUserId, {
        targetParticipantId: gargantuanTargetParticipantId,
        defenderSkill: 'athletics',
        defenderRollOverride: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('a successful grapple (attacker beats defender) applies the Grappled effect and spends the action', async () => {
    const result = await performGrapple(pool, encounterId, attackerParticipantId, dmUserId, {
      targetParticipantId: mediumTargetParticipantId,
      defenderSkill: 'athletics',
      defenderRollOverride: 1, // guarantees the attacker (STR 16, +3) beats a total of 1
    });
    expect(result.success).toBe(true);
    expect(result.participant.action_used).toBe(true);
    expect(result.appliedEffect).not.toBeNull();
    expect(result.appliedEffect!.effectDefinitionName).toBe('Grappled');

    const activeEffectRes = await pool.query(
      `SELECT ae.* FROM active_effects ae
       JOIN monster_instances mi ON mi.id = ae.monster_instance_id
       JOIN combat_participants cp ON cp.monster_instance_id = mi.id
       WHERE cp.id = $1 AND ae.removed_at IS NULL`,
      [mediumTargetParticipantId],
    );
    expect(activeEffectRes.rows).toHaveLength(1);
  });

  it('a failed grapple (defender beats attacker) spends the action but applies no effect', async () => {
    // Fresh attacker seat so action_used starts false again.
    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Grapple Test PC Two', 8, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const { participant: weakAttacker } = await addParticipant(pool, encounterId, { characterId: charRes.rows[0]!.id, initiativeRoll: 1 });
    // Seat this participant as the currently-active turn.
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [weakAttacker.turn_order, encounterId]);

    const result = await performGrapple(pool, encounterId, weakAttacker.id, dmUserId, {
      targetParticipantId: mediumTargetParticipantId,
      defenderSkill: 'athletics',
      defenderRollOverride: 30, // guarantees the defender wins
    });
    expect(result.success).toBe(false);
    expect(result.participant.action_used).toBe(true);
    expect(result.appliedEffect).toBeNull();
  });

  it('rejects a grapple attempt when the action has already been used', async () => {
    await expect(
      performGrapple(pool, encounterId, attackerParticipantId, dmUserId, {
        targetParticipantId: mediumTargetParticipantId,
        defenderSkill: 'athletics',
        defenderRollOverride: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
