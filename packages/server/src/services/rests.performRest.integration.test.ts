// Integration test for performRest()'s DB-level behavior. rests.test.ts
// covers computeHitDiceRestore as a pure function (dice-distribution math);
// this exercises the actual UPDATE statements performRest runs against a
// real Postgres instance: long rest resetting HP + hit dice + the right
// resource-pool recharge buckets, and short rest deliberately NOT touching
// HP/hit dice while only resetting 'short_rest' pools.
//
// Isolation choice: performRest() opens its OWN connection (pool.connect())
// and runs its own internal BEGIN/COMMIT, so wrapping the *call* in an
// outer BEGIN/ROLLBACK wouldn't work -- a second session can never see
// another session's uncommitted writes in Postgres, so the outer
// transaction's rows wouldn't exist yet as far as performRest's own
// connection is concerned. Instead this creates throwaway campaign/user/
// character/resource-pool rows (never touching the seeded demo campaign
// that encounters.initiative.integration.test.ts guards so carefully), and
// tears them down in afterAll via cascading deletes (campaigns ->
// campaign_members/characters/rest_events/rest_event_characters, all
// ON DELETE CASCADE). The teardown is wrapped in try/finally: even though
// these are throwaway rows (not shared demo data, so a leak here can't
// corrupt anything other tests depend on), the whole point of this repo's
// past live-DB-test bug was two tests racing/failing without restoring
// state, so cleanup always runs regardless of which line above it threw.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { performRest } from './rests.js';

describe('performRest (integration, live DB, throwaway fixtures)', () => {
  let userId: string;
  let campaignId: string;
  let longRestCharacterId: string;
  let shortRestCharacterId: string;

  async function makeCharacter(fighterClassId: string, hpMax: number, hpCurrent: number, hitDiceRemaining: Record<string, number>) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, hp_max, hp_current, hit_dice_remaining)
       VALUES ($1, true, $2, $2, 'Rest Test Fighter', 10, 10, 10, 10, 10, 10, 10, $3, $4, $5)
       RETURNING id`,
      [campaignId, userId, hpMax, hpCurrent, JSON.stringify(hitDiceRemaining)],
    );
    const characterId = res.rows[0]!.id;
    // Fighter, level 4 -> 4 total (d10) hit dice. This campaign is
    // srd_edition='2024', so a long rest restores all 4 (Rules Glossary
    // "Long Rest" § Benefits of the Rest, line 1135: "all spent Hit Point
    // Dice").
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 4)`, [characterId, fighterClassId]);
    for (const [resourceKey, rechargeOn] of [
      ['short_pool', 'short_rest'],
      ['long_pool', 'long_rest'],
      ['dawn_pool', 'dawn'],
      ['never_pool', 'none'],
    ] as const) {
      await pool.query(
        `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
         VALUES ($1, $2, 0, 3, $3)`,
        [characterId, resourceKey, rechargeOn],
      );
    }
    return characterId;
  }

  beforeAll(async () => {
    const classRes = await pool.query<{ id: string }>(
      `SELECT id FROM classes WHERE index_key = 'fighter' AND edition_scope = '2024'`,
    );
    const fighterClassId = classRes.rows[0]!.id;

    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Rest Test User', 'x') RETURNING id`,
      [`rest-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
    );
    userId = userRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Rest Test Campaign', $1, '2024') RETURNING id`,
      [userId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, userId]);

    longRestCharacterId = await makeCharacter(fighterClassId, 30, 10, { d10: 0 });
    shortRestCharacterId = await makeCharacter(fighterClassId, 30, 10, { d10: 1 });
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await pool.end();
    }
  });

  it('long rest resets HP to max, restores hit dice, and resets short_rest/long_rest/dawn pools (never "none")', async () => {
    const { characters } = await performRest(pool, userId, campaignId, {
      restType: 'long',
      characterIds: [longRestCharacterId],
    });
    expect(characters[0]!.hpBefore).toBe(10);
    expect(characters[0]!.hpAfter).toBe(30);

    const charRow = await pool.query<{ hp_current: number; hit_dice_remaining: Record<string, number> }>(
      `SELECT hp_current, hit_dice_remaining FROM characters WHERE id = $1`,
      [longRestCharacterId],
    );
    expect(charRow.rows[0]!.hp_current).toBe(30);
    // 4 total hit dice, srd_edition='2024' -> all 4 restored
    // (computeHitDiceRestore's edition branching is unit-tested on its own
    // in rests.test.ts; this just confirms performRest actually persists
    // that result for a real 2024 campaign row).
    expect(charRow.rows[0]!.hit_dice_remaining).toEqual({ d10: 4 });

    const pools = await pool.query<{ resource_key: string; current_value: number }>(
      `SELECT resource_key, current_value FROM character_resource_pools WHERE character_id = $1 ORDER BY resource_key`,
      [longRestCharacterId],
    );
    const byKey = Object.fromEntries(pools.rows.map((r) => [r.resource_key, r.current_value]));
    expect(byKey.short_pool).toBe(3);
    expect(byKey.long_pool).toBe(3);
    expect(byKey.dawn_pool).toBe(3);
    expect(byKey.never_pool).toBe(0); // recharge_on='none' must never be touched, even on a long rest
  });

  it('short rest does NOT touch HP or hit dice, and only resets recharge_on=\'short_rest\' pools', async () => {
    const { characters } = await performRest(pool, userId, campaignId, {
      restType: 'short',
      characterIds: [shortRestCharacterId],
    });
    expect(characters[0]!.hpBefore).toBe(10);
    expect(characters[0]!.hpAfter).toBe(10); // unchanged -- short rest never touches HP here

    const charRow = await pool.query<{ hp_current: number; hit_dice_remaining: Record<string, number> }>(
      `SELECT hp_current, hit_dice_remaining FROM characters WHERE id = $1`,
      [shortRestCharacterId],
    );
    expect(charRow.rows[0]!.hp_current).toBe(10);
    expect(charRow.rows[0]!.hit_dice_remaining).toEqual({ d10: 1 }); // untouched

    const pools = await pool.query<{ resource_key: string; current_value: number }>(
      `SELECT resource_key, current_value FROM character_resource_pools WHERE character_id = $1 ORDER BY resource_key`,
      [shortRestCharacterId],
    );
    const byKey = Object.fromEntries(pools.rows.map((r) => [r.resource_key, r.current_value]));
    expect(byKey.short_pool).toBe(3); // reset
    expect(byKey.long_pool).toBe(0); // untouched
    expect(byKey.dawn_pool).toBe(0); // untouched
    expect(byKey.never_pool).toBe(0); // untouched
  });
});
