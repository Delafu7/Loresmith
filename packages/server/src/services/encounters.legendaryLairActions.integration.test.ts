// Integration test for Phase 2 "legendary actions per-round counters" +
// "lair actions (round-start trigger)" — both live in services/encounters.ts
// (addParticipant/spawn initialization, spendLegendaryAction,
// advanceTurn's round-boundary reset + roundAdvanced flag) and
// schemas/encounters.ts (updateEncounterSchema's lairActions field).
// Throwaway campaign/monster/encounter fixtures, same isolation convention
// as encounters.dodgeExpiry.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { addParticipant, advanceTurn, createEncounter, spendLegendaryAction, updateEncounter } from './encounters.js';

describe('legendary + lair actions (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let legendaryMonsterId: string;
  let plainMonsterId: string;
  let legendaryInstanceId: string;
  let plainInstanceId: string;
  let encounterId: string;
  let legendaryParticipantId: string;
  let plainParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Legendary Test DM', 'x') RETURNING id`,
      [`legendary-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Legendary Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    async function makeMonster(name: string, legendaryActionCount: number | null): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO monsters
           (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
            str, dex, con, int, wis, cha, challenge_rating, xp_value, actions, legendary_action_count)
         VALUES ($1, $2, '2024', 'Large', 'dragon', 18, 200, '16d12+96', '{"walk":40,"fly":80}',
                 23, 14, 23, 16, 15, 20, 17, 18000, '[{"name":"Bite","description":"Melee attack"}]'::jsonb, $3)
         RETURNING id`,
        [`legendary-test-${name}-${suffix}`, name, legendaryActionCount],
      );
      return res.rows[0]!.id;
    }
    legendaryMonsterId = await makeMonster('Legendary Test Wyrm', 3);
    plainMonsterId = await makeMonster('Plain Test Wolf', null);

    const legendaryInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 200) RETURNING id`,
      [campaignId, legendaryMonsterId],
    );
    legendaryInstanceId = legendaryInstanceRes.rows[0]!.id;

    const plainInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 11) RETURNING id`,
      [campaignId, plainMonsterId],
    );
    plainInstanceId = plainInstanceRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'Legendary Test Encounter' });
    encounterId = encounter.id;

    const legendaryParticipant = await addParticipant(pool, encounterId, { monsterInstanceId: legendaryInstanceId });
    legendaryParticipantId = legendaryParticipant.participant.id;
    const plainParticipant = await addParticipant(pool, encounterId, { monsterInstanceId: plainInstanceId });
    plainParticipantId = plainParticipant.participant.id;

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (legendaryMonsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [legendaryMonsterId]);
      if (plainMonsterId) await pool.query(`DELETE FROM monsters WHERE id = $1`, [plainMonsterId]);
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('addParticipant initializes legendary_actions_remaining from the monster catalog row, null for a non-legendary monster', async () => {
    const legendaryRow = await pool.query<{ legendary_actions_remaining: number | null }>(
      `SELECT legendary_actions_remaining FROM combat_participants WHERE id = $1`,
      [legendaryParticipantId],
    );
    expect(legendaryRow.rows[0]!.legendary_actions_remaining).toBe(3);

    const plainRow = await pool.query<{ legendary_actions_remaining: number | null }>(
      `SELECT legendary_actions_remaining FROM combat_participants WHERE id = $1`,
      [plainParticipantId],
    );
    expect(plainRow.rows[0]!.legendary_actions_remaining).toBeNull();
  });

  it('spendLegendaryAction decrements by cost (default 1), rejects overspend, and rejects a non-legendary participant', async () => {
    const afterOne = await spendLegendaryAction(pool, encounterId, legendaryParticipantId, {});
    expect(afterOne.participant.legendary_actions_remaining).toBe(2);

    const afterTwoCost = await spendLegendaryAction(pool, encounterId, legendaryParticipantId, { cost: 2 });
    expect(afterTwoCost.participant.legendary_actions_remaining).toBe(0);

    await expect(spendLegendaryAction(pool, encounterId, legendaryParticipantId, {})).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(spendLegendaryAction(pool, encounterId, plainParticipantId, {})).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('advanceTurn resets every legendary participant back to full budget once the round boundary crosses, and reports roundAdvanced accurately', async () => {
    // legendaryParticipantId is at 0 from the previous test — turn_order 0
    // (legendary) -> 1 (plain) is still round 1, no reset yet.
    const withinRound = await advanceTurn(pool, encounterId);
    expect(withinRound.roundAdvanced).toBe(false);
    const stillZero = await pool.query<{ legendary_actions_remaining: number | null }>(
      `SELECT legendary_actions_remaining FROM combat_participants WHERE id = $1`,
      [legendaryParticipantId],
    );
    expect(stillZero.rows[0]!.legendary_actions_remaining).toBe(0);

    // 1 (plain) -> 0 (legendary) wraps back to round 2 — legendary resets.
    const roundBoundary = await advanceTurn(pool, encounterId);
    expect(roundBoundary.roundAdvanced).toBe(true);
    const reset = await pool.query<{ legendary_actions_remaining: number | null }>(
      `SELECT legendary_actions_remaining FROM combat_participants WHERE id = $1`,
      [legendaryParticipantId],
    );
    expect(reset.rows[0]!.legendary_actions_remaining).toBe(3);

    // The non-legendary participant's NULL stays NULL — nothing to reset.
    const plainStillNull = await pool.query<{ legendary_actions_remaining: number | null }>(
      `SELECT legendary_actions_remaining FROM combat_participants WHERE id = $1`,
      [plainParticipantId],
    );
    expect(plainStillNull.rows[0]!.legendary_actions_remaining).toBeNull();
  });

  it('updateEncounter sets and clears lairActions', async () => {
    const withLair = await updateEncounter(pool, campaignId, encounterId, {
      lairActions: [{ name: 'Tremor', description: 'The ground shakes, forcing a Dexterity save.' }],
    });
    expect(withLair.lair_actions).toEqual([{ name: 'Tremor', description: 'The ground shakes, forcing a Dexterity save.' }]);

    const cleared = await updateEncounter(pool, campaignId, encounterId, { lairActions: null });
    expect(cleared.lair_actions).toBeNull();
  });

  it('a non-DM/non-existent participant id rejects spendLegendaryAction with a clean error', async () => {
    await expect(
      spendLegendaryAction(pool, encounterId, '00000000-0000-0000-0000-000000000000', {}),
    ).rejects.toBeInstanceOf(AppError);
  });
});
