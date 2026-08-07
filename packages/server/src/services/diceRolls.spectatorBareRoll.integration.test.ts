// Regression test for Iteration 3 security major M1 — rollDice's only
// branch with no role check at all was a "bare" roll (neither characterId
// nor monsterInstanceId): the characterId branch rejects a spectator via
// requireControllerOrDm and the monsterInstanceId branch is DM-only, but a
// spectator supplying neither could insert a dice_rolls row and have it
// broadcast, violating the "spectator is strictly read-only" contract.
// Throwaway campaign/user fixtures, same isolation convention as
// characters.spectator.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { rollDice } from './diceRolls.js';
import type { CreateDiceRollInput } from '../schemas/diceRolls.js';

describe('rollDice rejects a spectator bare roll (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let spectatorUserId: string;
  let playerUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bare Roll Test DM', 'x') RETURNING id`,
      [`bare-roll-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const spectatorRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bare Roll Test Spectator', 'x') RETURNING id`,
      [`bare-roll-spec-${suffix}@example.test`],
    );
    spectatorUserId = spectatorRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bare Roll Test Player', 'x') RETURNING id`,
      [`bare-roll-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Bare Roll Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm'), ($1, $3, 'spectator'), ($1, $4, 'player')`,
      [campaignId, dmUserId, spectatorUserId, playerUserId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dmUserId, spectatorUserId, playerUserId]]);
    await pool.end();
  });

  const bareRoll: CreateDiceRollInput = {
    rollType: 'custom',
    keep: 'normal',
    modifier: 0,
    diceSides: 20,
    diceCount: 1,
  };

  it('rejects a spectator rolling a bare (no character/monster) die', async () => {
    await expect(rollDice(pool, campaignId, spectatorUserId, 'spectator', bareRoll)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });

    const rows = await pool.query(`SELECT id FROM dice_rolls WHERE campaign_id = $1 AND user_id = $2`, [campaignId, spectatorUserId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('a player and the DM are unaffected by the fix and can still roll bare dice', async () => {
    const playerRoll = await rollDice(pool, campaignId, playerUserId, 'player', bareRoll);
    expect(playerRoll.user_id).toBe(playerUserId);

    const dmRoll = await rollDice(pool, campaignId, dmUserId, 'dm', bareRoll);
    expect(dmRoll.user_id).toBe(dmUserId);
  });
});
