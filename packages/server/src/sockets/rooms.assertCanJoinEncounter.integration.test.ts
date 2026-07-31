// Integration test for assertCanJoinEncounter (the gate behind the
// join:encounter socket handler) — nav point 1's other half: even a player
// who owns a seated character must not be able to join an encounter's
// Socket.io room while it's still 'preparing'. No socket-level test harness
// exists in this codebase (see damageAuthz.integration.test.ts's own note),
// but this function has no socket/Express dependency, so it's exercised
// directly. Throwaway campaign/users/character/encounter fixtures, same
// isolation convention as encounters.actionEconomyAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { assertCanJoinEncounter } from './rooms.js';

describe('assertCanJoinEncounter (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerWithCharacterUserId: string;
  let playerWithoutCharacterUserId: string;
  let campaignId: string;
  let preparingEncounterId: string;
  let activeEncounterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'JoinGate Test DM', 'x') RETURNING id`,
      [`join-gate-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'JoinGate Test Player A', 'x') RETURNING id`,
      [`join-gate-player-a-${suffix}@example.test`],
    );
    playerWithCharacterUserId = playerARes.rows[0]!.id;

    const playerBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'JoinGate Test Player B', 'x') RETURNING id`,
      [`join-gate-player-b-${suffix}@example.test`],
    );
    playerWithoutCharacterUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('JoinGate Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerWithCharacterUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerWithoutCharacterUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'JoinGate Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerWithCharacterUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    const preparingRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Preparing Encounter', 'preparing') RETURNING id`,
      [campaignId],
    );
    preparingEncounterId = preparingRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 10, 0)`,
      [preparingEncounterId, characterId],
    );

    const activeRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Active Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    activeEncounterId = activeRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 10, 0)`,
      [activeEncounterId, characterId],
    );
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerWithCharacterUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerWithCharacterUserId]);
      if (playerWithoutCharacterUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerWithoutCharacterUserId]);
      await pool.end();
    }
  });

  it('the DM can join a preparing encounter', async () => {
    await expect(
      assertCanJoinEncounter(preparingEncounterId, campaignId, 'preparing', dmUserId),
    ).resolves.toBe('dm');
  });

  it("a player CANNOT join a preparing encounter even with a seated character", async () => {
    await expect(
      assertCanJoinEncounter(preparingEncounterId, campaignId, 'preparing', playerWithCharacterUserId),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('a player with a seated character CAN join an active encounter', async () => {
    await expect(
      assertCanJoinEncounter(activeEncounterId, campaignId, 'active', playerWithCharacterUserId),
    ).resolves.toBe('player');
  });

  it('a player with no character in the encounter cannot join it once active', async () => {
    await expect(
      assertCanJoinEncounter(activeEncounterId, campaignId, 'active', playerWithoutCharacterUserId),
    ).rejects.toBeInstanceOf(AppError);
  });
});
