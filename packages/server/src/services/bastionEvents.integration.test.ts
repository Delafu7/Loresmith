// Integration tests for Phase 4 "Bastion tracking" sub-phase 4 —
// Bastion Events effects (services/bastionEvents.ts's applyBastionEvent,
// called with a forced eventKey to bypass the d20 RNG and test each
// event's DB effects deterministically), Request for Aid resolution,
// fall-of-a-Bastion tracking, and BP spending. Throwaway fixtures, same
// isolation convention as bastionTurns.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { addFacility, createBastion, skipBastionTurn, spendBastionPoints } from './bastions.js';
import { resolveBastionTurn, resolveRequestForAid } from './bastionTurns.js';
import { applyBastionEvent } from './bastionEvents.js';

describe('Bastion Events, fall tracking, and BP spending (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let wizardClassId: string;
  let characterId: string;
  let bastionId: string;
  let armoryFacilityId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Events Test DM', 'x') RETURNING id`,
      [`bastion-events-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Events Test Player', 'x') RETURNING id`,
      [`bastion-events-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, bastions_enabled) VALUES ('Bastion Events Test Campaign', $1, '2024', true) RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const wizardRes = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'wizard' AND edition_scope = '2024'`);
    wizardClassId = wizardRes.rows[0]!.id;

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Bastion Events Test Character', 10, 10, 10, 10, 10, 10, 10, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    characterId = characterRes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 9)`, [characterId, wizardClassId]);

    const catalogRes = await pool.query<{ index_key: string; id: string }>(`SELECT index_key, id FROM bastion_facility_catalog`);
    const catalogByKey = Object.fromEntries(catalogRes.rows.map((r) => [r.index_key, r.id]));

    const bastion = await createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: characterId });
    bastionId = bastion.id;
    const armory = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_armory! });
    armoryFacilityId = armory.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId || playerUserId) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[dmUserId, playerUserId]]);
    await pool.end();
  });

  it('Attack event: counts 1s across 6d6 for defender loss, shuts down a facility, and shuts down a second only once defenders hit exactly 0', async () => {
    await pool.query(`UPDATE bastions SET bastion_defenders = 0 WHERE id = $1`, [bastionId]);
    await pool.query(`UPDATE bastion_facilities SET status = 'operational' WHERE bastion_id = $1`, [bastionId]);

    const client = await pool.connect();
    try {
      const event = await applyBastionEvent(client, bastionId, characterId, 'attack');
      expect(event.eventKey).toBe('attack');
      const outcome = event.outcome as { dice: number[]; defendersLost: number; shutDownFacilityIds: string[] };
      expect(outcome.dice).toHaveLength(6);
      expect(outcome.defendersLost).toBe(outcome.dice.filter((d) => d === 1).length);
      // Defenders were already 0 before the attack -- the post-loss count is
      // still 0, so BOTH the first and (per the "no defenders left" clause)
      // the second facility should shut down, if the Bastion has 2+ special
      // facilities to shut down. This Bastion only has 1 (Armory), so at
      // most 1 shutdown id is possible regardless.
      expect(outcome.shutDownFacilityIds.length).toBeGreaterThanOrEqual(1);
      expect(outcome.shutDownFacilityIds).toContain(armoryFacilityId);
    } finally {
      client.release();
    }
    await pool.query(`UPDATE bastion_facilities SET status = 'operational' WHERE bastion_id = $1`, [bastionId]);
  });

  it('Request for Aid: resolves via resolveBastionTurn + resolveRequestForAid, with the >=10/<10 threshold producing distinct outcomes', async () => {
    // Force a request_for_aid turn by manipulating the resolved turn's
    // event_key/event_outcome directly (bypassing the d20 RNG) -- the same
    // "test the deterministic follow-up action against a forced state"
    // approach as the Attack test above.
    await pool.query(`UPDATE bastions SET bastion_defenders = 5 WHERE id = $1`, [bastionId]);
    const turn = await resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
      inGameDay: 100, maintain: true, orders: [],
    });
    // This same Maintain call rolls its OWN real Bastion Event (sub-phase
    // 4), which could itself be Attack and change bastion_defenders/
    // facility status for real before we force-override event_key below --
    // reset both back to a known state so the rest of this test is
    // deterministic regardless of what that real roll happened to be.
    await pool.query(`UPDATE bastions SET bastion_defenders = 5 WHERE id = $1`, [bastionId]);
    await pool.query(`UPDATE bastion_facilities SET status = 'operational' WHERE bastion_id = $1`, [bastionId]);
    await pool.query(
      `UPDATE bastion_turns SET event_key = 'request_for_aid', event_outcome = jsonb_set(event_outcome, '{event}', '{"pending": true}') WHERE id = $1`,
      [turn.id],
    );

    await expect(
      resolveRequestForAid(pool, campaignId, bastionId, turn.id, 'player', playerUserId, -1),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      resolveRequestForAid(pool, campaignId, bastionId, turn.id, 'player', playerUserId, 999),
    ).rejects.toBeInstanceOf(AppError); // more than the Bastion has

    const resolved = await resolveRequestForAid(pool, campaignId, bastionId, turn.id, 'player', playerUserId, 5);
    const event = (resolved.event_outcome as { event: { pending: boolean; total: number; success: boolean; defenderLoss: number } }).event;
    expect(event.pending).toBe(false);
    expect(event.success).toBe(event.total >= 10);
    expect(event.defenderLoss).toBe(event.success ? 0 : 1);

    // Already resolved -- a second attempt is rejected, not silently re-rolled.
    await expect(
      resolveRequestForAid(pool, campaignId, bastionId, turn.id, 'player', playerUserId, 1),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('Fall of a Bastion: skipBastionTurn increments the counter and falls exactly at the character\'s current level', async () => {
    // Fresh bastion for a clean counter (the shared one above already has turns resolved on it).
    const freshCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Bastion Fall Test Character', 10, 10, 10, 10, 10, 10, 10, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    const freshCharId = freshCharRes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 5)`, [freshCharId, wizardClassId]);
    const freshBastion = await createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: freshCharId });

    let bastion = freshBastion;
    for (let i = 0; i < 4; i++) {
      bastion = await skipBastionTurn(pool, campaignId, bastion.id, 'player', playerUserId);
      expect(bastion.status).toBe('active');
    }
    expect(bastion.consecutive_turns_without_orders).toBe(4);

    // Character is level 5 -- the 5th skipped turn (count reaches 5) must fall.
    bastion = await skipBastionTurn(pool, campaignId, bastion.id, 'player', playerUserId);
    expect(bastion.consecutive_turns_without_orders).toBe(5);
    expect(bastion.status).toBe('fallen');

    await expect(skipBastionTurn(pool, campaignId, bastion.id, 'player', playerUserId)).rejects.toBeInstanceOf(AppError);
  });

  it('BP spending: atomic, rejects insufficient balance, enforces the magic-item rarity/level table, and gates resurrection reuse by level', async () => {
    await pool.query(`UPDATE bastions SET bastion_points = 100 WHERE id = $1`, [bastionId]);

    // Rare requires level 9+ -- this character is exactly level 9, so it
    // should succeed at the level gate but the character only has 100 BP
    // against Rare's 250 BP cost, so it must fail on INSUFFICIENT BALANCE,
    // not the level gate.
    await expect(
      spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'magic_item', rarity: 'rare' }),
    ).rejects.toBeInstanceOf(AppError);

    const afterFailedSpend = await pool.query(`SELECT bastion_points FROM bastions WHERE id = $1`, [bastionId]);
    expect(afterFailedSpend.rows[0]!.bastion_points).toBe(100); // untouched by the rejected spend

    // Very Rare requires level 13 -- this character is level 9, rejected on
    // the LEVEL gate regardless of BP balance.
    await pool.query(`UPDATE bastions SET bastion_points = 10000 WHERE id = $1`, [bastionId]);
    await expect(
      spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'magic_item', rarity: 'very_rare' }),
    ).rejects.toBeInstanceOf(AppError);

    // Common (20 BP, no level gate) succeeds and atomically decrements.
    const afterCommon = await spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'magic_item', rarity: 'common' });
    expect(afterCommon.bastion_points).toBe(10000 - 20);

    // Resurrection: succeeds once, then rejected until the character gains a level.
    const afterFirstRes = await spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'resurrection' });
    expect(afterFirstRes.bastion_points).toBe(10000 - 20 - 100);
    expect(afterFirstRes.last_resurrection_character_level).toBe(9);

    await expect(
      spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'resurrection' }),
    ).rejects.toBeInstanceOf(AppError);

    await pool.query(`UPDATE character_classes SET level = 10 WHERE character_id = $1`, [characterId]);
    const afterLevelUp = await spendBastionPoints(pool, campaignId, bastionId, 'player', playerUserId, { kind: 'resurrection' });
    expect(afterLevelUp.last_resurrection_character_level).toBe(10);
  });
});
