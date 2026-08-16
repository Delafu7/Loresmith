// Integration test for Phase 3 "players cast from their own UI" — the turn
// check castFromEncounter (services/casting.ts) now runs for a non-DM
// caster on top of its existing owner-or-DM control check. Casting was
// already fully player-self-service (no DM gate at all — see
// casting.integration.test.ts) and already permits targeting ANY
// participant, including another player's character (buffs/heals are
// expected to cross characters) — that targeting breadth is unchanged here,
// only turn order is newly enforced. Same throwaway-fixtures isolation
// convention as shove.turnOrderAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { castFromEncounter } from './casting.js';

describe('castFromEncounter turn-order enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let encounterId: string;
  let activeCharacterId: string; // turn_order 0, ON turn
  let waitingCharacterId: string; // turn_order 1, NOT on turn

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CastTurnOrder Test DM', 'x') RETURNING id`,
      [`cast-turn-order-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;
    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CastTurnOrder Test Player', 'x') RETURNING id`,
      [`cast-turn-order-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CastTurnOrder Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    // The same player owns both characters — irrelevant to the turn check
    // itself, which only cares about turn_order vs current_turn_index.
    const activeCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'CastTurnOrder PC Active', 10, 10, 10, 10, 10, 10, 10, 20, 20)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    activeCharacterId = activeCharRes.rows[0]!.id;

    const waitingCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'CastTurnOrder PC Waiting', 10, 10, 10, 10, 10, 10, 10, 20, 20)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    waitingCharacterId = waitingCharRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1, 'spell_slot_1', 2, 2, 'long_rest'), ($2, 'spell_slot_1', 2, 2, 'long_rest')`,
      [activeCharacterId, waitingCharacterId],
    );

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status, current_turn_index) VALUES ($1, 'CastTurnOrder Test Encounter', 'active', 0) RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 10, 0)`,
      [encounterId, activeCharacterId],
    );
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 5, 1)`,
      [encounterId, waitingCharacterId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
    await pool.end();
  });

  it('rejects a cast from a character whose participant is not currently up', async () => {
    await expect(
      castFromEncounter(pool, playerUserId, encounterId, {
        characterId: waitingCharacterId,
        resourceKey: 'spell_slot_1',
        targetParticipantIds: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });

    // Off-turn rejection must happen BEFORE the slot is spent — nothing
    // partially applied, same invariant casting.integration.test.ts already
    // proves for the insufficient-slot case.
    const pool_ = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'spell_slot_1'`,
      [waitingCharacterId],
    );
    expect(pool_.rows[0]!.current_value).toBe(2);
  });

  it('a cast from the character whose turn it currently is queues a pending request, not an immediate resolution (Phase 4)', async () => {
    const result = await castFromEncounter(pool, playerUserId, encounterId, {
      characterId: activeCharacterId,
      resourceKey: 'spell_slot_1',
      targetParticipantIds: [],
    });
    expect(result).toMatchObject({ pending: true, request: { status: 'pending', kind: 'cast', requested_by_user_id: playerUserId } });

    // Queuing must NOT have spent the slot yet — only DM approval (which
    // replays castFromEncounter, exercised in casting.integration.test.ts)
    // actually spends it.
    const pool_ = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'spell_slot_1'`,
      [activeCharacterId],
    );
    expect(pool_.rows[0]!.current_value).toBe(2);
  });
});
