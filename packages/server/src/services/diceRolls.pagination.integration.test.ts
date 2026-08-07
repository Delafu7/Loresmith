// Regression test for Iteration 3 blocker B2 — decodeCursor's type guard
// checked `typeof parsed.id !== 'number'`, but dice_rolls.id is always a
// UUID string, so every server-issued cursor from encodeCursor failed that
// check unconditionally and "load more" 400ed on every real page beyond the
// first. Proves a full cursor round-trip actually walks the whole table
// instead of erroring on page 2. Throwaway campaign/user fixtures, same
// isolation convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { listDiceRolls, type DiceRollRow } from './diceRolls.js';

describe('listDiceRolls cursor pagination (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  const rollIds: string[] = [];

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Pagination Test DM', 'x') RETURNING id`,
      [`dice-pagination-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Pagination Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    // Insert enough rows to force a second page (PAGE_SIZE is 30).
    for (let i = 0; i < 35; i++) {
      const res = await pool.query<DiceRollRow>(
        `INSERT INTO dice_rolls
           (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
         VALUES ($1, $2, 'custom', ARRAY[10], 'normal', 20, 1, 0, 10)
         RETURNING id`,
        [campaignId, dmUserId],
      );
      rollIds.push(res.rows[0]!.id);
    }
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('walks every page via the server-issued cursor without the id-type guard rejecting it', async () => {
    const seen = new Set<string>();

    const first = await listDiceRolls(pool, campaignId, 'dm', {});
    expect(first.rolls.length).toBe(30);
    expect(first.nextCursor).not.toBeNull();
    for (const roll of first.rolls) seen.add(roll.id);

    // Before the fix, this call always threw AppError('VALIDATION_ERROR',
    // 'Invalid cursor') because decodeCursor's guard could never accept a
    // UUID string id.
    const second = await listDiceRolls(pool, campaignId, 'dm', { cursor: first.nextCursor! });
    expect(second.rolls.length).toBe(5);
    expect(second.nextCursor).toBeNull();
    for (const roll of second.rolls) seen.add(roll.id);

    expect(seen.size).toBe(35);
    for (const id of rollIds) expect(seen.has(id)).toBe(true);
  });
});
