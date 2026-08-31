// docs/roadmap/dnd-2024-gap-analysis.md P1-8 — the player-facing "spend a
// hit die during a short rest" action: roll die + CON mod (min 1 HP each),
// decrement hit_dice_remaining, clamp at hp_max, gate on is_alive. Throwaway
// fixture style, live DB — same isolation convention as
// characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { spendHitDice } from './characters.js';

describe('spendHitDice (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let fighterCharacterId: string; // hp_max 20, hp_current 5, CON 16 (mod +3), 3 d10 hit dice remaining
  let deadCharacterId: string; // is_alive = false

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'SpendHitDice Test DM', 'x') RETURNING id`,
      [`spend-hit-dice-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('SpendHitDice Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const fighterClass = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'fighter' AND edition_scope = '2024'`);
    const fighterClassId = fighterClass.rows[0]!.id;

    const fighterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, hit_dice_remaining)
       VALUES ($1, true, $2, $2, 'SpendHitDice Test Fighter', 10, 10, 16, 10, 10, 10, 12, 30, 20, 5, $3)
       RETURNING id`,
      [campaignId, dmUserId, JSON.stringify({ d10: 3 })],
    );
    fighterCharacterId = fighterRes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [fighterCharacterId, fighterClassId]);

    const deadRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, hit_dice_remaining, is_alive)
       VALUES ($1, true, $2, $2, 'SpendHitDice Test Dead PC', 10, 10, 16, 10, 10, 10, 12, 30, 20, 0, $3, false)
       RETURNING id`,
      [campaignId, dmUserId, JSON.stringify({ d10: 3 })],
    );
    deadCharacterId = deadRes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [deadCharacterId, fighterClassId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('spending 1 die rolls d10+3 (min 1), heals, decrements remaining, and clamps at hp_max', async () => {
    const result = await spendHitDice(pool, dmUserId, fighterCharacterId, { dieType: 'd10', count: 1 });
    expect(result.rolls).toHaveLength(1);
    expect(result.rolls[0]).toBeGreaterThanOrEqual(1);
    expect(result.rolls[0]).toBeLessThanOrEqual(10);
    expect(result.conModifier).toBe(3);
    expect(result.healedPerDie[0]).toBe(Math.max(1, result.rolls[0]! + 3));
    expect(result.totalHealed).toBe(result.healedPerDie[0]);
    expect(result.hitDiceRemaining.d10).toBe(2);
    expect((result.character.hp_current as number)).toBeLessThanOrEqual(20);
    expect((result.character.hp_current as number)).toBe(Math.min(20, 5 + result.totalHealed));
  });

  it('spending 2 dice in one call rolls each independently (min 1 each, not once for the pool)', async () => {
    const before = await pool.query<{ hp_current: number }>(`SELECT hp_current FROM characters WHERE id = $1`, [fighterCharacterId]);
    const result = await spendHitDice(pool, dmUserId, fighterCharacterId, { dieType: 'd10', count: 2 });
    expect(result.rolls).toHaveLength(2);
    expect(result.healedPerDie).toHaveLength(2);
    const expectedTotal = result.healedPerDie.reduce((a, b) => a + b, 0);
    expect(result.totalHealed).toBe(expectedTotal);
    expect(result.hitDiceRemaining.d10).toBe(0);
    const after = Math.min(20, before.rows[0]!.hp_current + expectedTotal);
    expect(result.character.hp_current).toBe(after);
  });

  it('rejects spending more dice than remain', async () => {
    await expect(spendHitDice(pool, dmUserId, fighterCharacterId, { dieType: 'd10', count: 1 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects a die type this character does not have', async () => {
    await expect(spendHitDice(pool, dmUserId, fighterCharacterId, { dieType: 'd6', count: 1 })).rejects.toBeInstanceOf(AppError);
  });

  it('rejects spending hit dice on a dead character', async () => {
    await expect(spendHitDice(pool, dmUserId, deadCharacterId, { dieType: 'd10', count: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
