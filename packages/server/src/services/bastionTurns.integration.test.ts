// Integration tests for Phase 4 "Bastion tracking" sub-phase 3
// (services/bastionTurns.ts) — order issuance, Maintain, Bastion Point
// awarding, the 25 GP reroll spend, and the Meditation Chamber bonus-order
// exception. Bastion Events / BP-spending endpoints are sub-phase 4, not
// covered here. Throwaway fixtures, same isolation convention as
// bastions.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { createBastion, addFacility } from './bastions.js';
import { resolveBastionTurn, listBastionTurns } from './bastionTurns.js';

describe('bastionTurns (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let wizardClassId: string;
  let characterId: string;
  let bastionId: string;
  let libraryFacilityId: string; // 1d4, research, no prereq
  let armoryFacilityId: string; // 1d4, trade, no prereq
  let meditationChamberFacilityId: string; // 1d8, empower, no prereq, level 13

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Turn Test DM', 'x') RETURNING id`,
      [`bastion-turn-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Bastion Turn Test Player', 'x') RETURNING id`,
      [`bastion-turn-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, bastions_enabled) VALUES ('Bastion Turn Test Campaign', $1, '2024', true) RETURNING id`,
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
       VALUES ($1, true, $2, $2, 'Bastion Turn Test Character', 10, 10, 10, 10, 10, 10, 10, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerUserId],
    );
    characterId = characterRes.rows[0]!.id;
    // Level 13 -- qualifies for Meditation Chamber (min_level 13) with plenty
    // of special-facility headroom (allowance 5) for Library + Armory too.
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 13)`, [characterId, wizardClassId]);

    const catalogRes = await pool.query<{ index_key: string; id: string }>(`SELECT index_key, id FROM bastion_facility_catalog`);
    const catalogByKey = Object.fromEntries(catalogRes.rows.map((r) => [r.index_key, r.id]));

    const bastion = await createBastion(pool, campaignId, 'player', playerUserId, { ownerCharacterId: characterId });
    bastionId = bastion.id;

    const library = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_library! });
    libraryFacilityId = library.id;
    const armory = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, { catalogId: catalogByKey.bastion_armory! });
    armoryFacilityId = armory.id;
    const meditationChamber = await addFacility(pool, campaignId, bastionId, 'player', playerUserId, {
      catalogId: catalogByKey.bastion_meditation_chamber!,
    });
    meditationChamberFacilityId = meditationChamber.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId || playerUserId) await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[dmUserId, playerUserId]]);
    await pool.end();
  });

  it('resolves a Maintain turn: rolls 1d4 per operational special facility and sums onto bastion_points', async () => {
    const turn = await resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
      inGameDay: 7, maintain: true, orders: [],
    });
    expect(turn.was_maintain).toBe(true);
    expect(turn.turn_number).toBe(1);
    const outcome = turn.event_outcome as {
      maintainBp: Array<{ facilityId: string; roll: number }>;
      event: { bpAwarded?: number };
    };
    // 3 special facilities (Library, Armory, Meditation Chamber) -- basic
    // facilities never appear in Maintain BP.
    expect(outcome.maintainBp).toHaveLength(3);
    for (const r of outcome.maintainBp) {
      expect(r.roll).toBeGreaterThanOrEqual(1);
      expect(r.roll).toBeLessThanOrEqual(4);
    }
    // Sub-phase 4: a Maintain turn also rolls the Bastion Events table
    // (services/bastionEvents.ts), which can award BONUS BP on top of the
    // flat per-facility Maintain roll (Extraordinary Opportunity) -- must be
    // included here or this assertion is flaky whenever that event lands.
    const eventBp = outcome.event.bpAwarded ?? 0;
    const expectedTotal = outcome.maintainBp.reduce((sum, r) => sum + r.roll, 0) + eventBp;

    const bastionRes = await pool.query(`SELECT bastion_points, last_turn_in_game_day FROM bastions WHERE id = $1`, [bastionId]);
    expect(bastionRes.rows[0]!.bastion_points).toBe(expectedTotal);
    expect(bastionRes.rows[0]!.last_turn_in_game_day).toBe(7);

    // The same Events roll can also shut down a facility (Attack/Lost
    // Hirelings) at random -- reset to a known-operational state so every
    // LATER test in this file (which assumes Library/Armory/Meditation
    // Chamber are all orderable) is deterministic regardless of what this
    // event roll happened to land on. Several events also credit/debit the
    // owning character's GP (Friendly Visitors, Refugees, Criminal
    // Hireling, ...) -- reset that too, so the later "25 GP reroll rejected
    // for insufficient funds" test isn't flaky depending on what this
    // event roll happened to award.
    await pool.query(`UPDATE bastion_facilities SET status = 'operational' WHERE bastion_id = $1`, [bastionId]);
    await pool.query(`DELETE FROM character_currency WHERE character_id = $1`, [characterId]);
  });

  it('rejects a turn that submits neither Maintain nor any orders', async () => {
    const { resolveBastionTurnSchema } = await import('../schemas/bastionTurns.js');
    expect(() => resolveBastionTurnSchema.parse({ inGameDay: 14, maintain: false, orders: [] })).toThrow();
  });

  it('rejects a turn that submits both Maintain and per-facility orders', async () => {
    const { resolveBastionTurnSchema } = await import('../schemas/bastionTurns.js');
    expect(() =>
      resolveBastionTurnSchema.parse({ inGameDay: 14, maintain: true, orders: [{ facilityId: libraryFacilityId }] }),
    ).toThrow();
  });

  it('resolves a per-facility orders turn: awards each facility\'s own BP die roll, resets consecutive_turns_without_orders', async () => {
    await pool.query(`UPDATE bastions SET consecutive_turns_without_orders = 3 WHERE id = $1`, [bastionId]);
    const before = await pool.query(`SELECT bastion_points FROM bastions WHERE id = $1`, [bastionId]);
    const bpBefore = before.rows[0]!.bastion_points as number;

    const turn = await resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
      inGameDay: 14,
      maintain: false,
      orders: [{ facilityId: libraryFacilityId, resultNote: 'Researched local rumors' }, { facilityId: armoryFacilityId }],
    });
    expect(turn.was_maintain).toBe(false);
    expect(turn.turn_number).toBe(2);
    expect(turn.orders).toHaveLength(2);
    for (const order of turn.orders) {
      expect(order.bp_die_roll).toBeGreaterThanOrEqual(1);
      expect(order.bp_die_roll).toBeLessThanOrEqual(4); // both Library and Armory are 1d4
      expect(order.bp_awarded).toBe(order.bp_die_roll);
      expect(order.paid_reroll_gp).toBeNull();
    }
    const libraryOrder = turn.orders.find((o) => o.bastion_facility_id === libraryFacilityId)!;
    expect((libraryOrder.result as { note: string }).note).toBe('Researched local rumors');

    const expectedGain = turn.orders.reduce((sum, o) => sum + o.bp_awarded, 0);
    const after = await pool.query(
      `SELECT bastion_points, consecutive_turns_without_orders FROM bastions WHERE id = $1`,
      [bastionId],
    );
    expect(after.rows[0]!.bastion_points).toBe(bpBefore + expectedGain);
    expect(after.rows[0]!.consecutive_turns_without_orders).toBe(0);
  });

  it('rejects a second order to the same facility in one turn without a Meditation Chamber bonus slot', async () => {
    await expect(
      resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
        inGameDay: 21, maintain: false,
        orders: [{ facilityId: libraryFacilityId }, { facilityId: libraryFacilityId }],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('allows a second order to an already-ordered facility when a Meditation Chamber bonus slot is available', async () => {
    const turn = await resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
      inGameDay: 21,
      maintain: false,
      orders: [
        { facilityId: meditationChamberFacilityId },
        { facilityId: libraryFacilityId },
        { facilityId: libraryFacilityId }, // the bonus order
      ],
    });
    expect(turn.orders).toHaveLength(3);
    expect(turn.orders.filter((o) => o.bastion_facility_id === libraryFacilityId)).toHaveLength(2);
  });

  it('rejects an order to a shut-down facility', async () => {
    await pool.query(`UPDATE bastion_facilities SET status = 'shut_down' WHERE id = $1`, [armoryFacilityId]);
    try {
      await expect(
        resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
          inGameDay: 28, maintain: false, orders: [{ facilityId: armoryFacilityId }],
        }),
      ).rejects.toBeInstanceOf(AppError);
    } finally {
      await pool.query(`UPDATE bastion_facilities SET status = 'operational' WHERE id = $1`, [armoryFacilityId]);
    }
  });

  it('the 25 GP reroll is rejected for insufficient funds, then succeeds and atomically deducts gold once funded', async () => {
    await expect(
      resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
        inGameDay: 35, maintain: false, orders: [{ facilityId: libraryFacilityId, payReroll: true }],
      }),
    ).rejects.toBeInstanceOf(AppError);

    await pool.query(
      `INSERT INTO character_currency (character_id, gp) VALUES ($1, 100)
       ON CONFLICT (character_id) DO UPDATE SET gp = 100`,
      [characterId],
    );
    const turn = await resolveBastionTurn(pool, campaignId, bastionId, 'player', playerUserId, {
      inGameDay: 35, maintain: false, orders: [{ facilityId: libraryFacilityId, payReroll: true }],
    });
    expect(turn.orders[0]!.paid_reroll_gp).toBe(25);

    const currency = await pool.query(`SELECT gp FROM character_currency WHERE character_id = $1`, [characterId]);
    expect(currency.rows[0]!.gp).toBe(75);
  });

  it('lists resolved turns in ascending turn_number order', async () => {
    const turns = await listBastionTurns(pool, campaignId, bastionId);
    const numbers = turns.map((t) => t.turn_number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
  });
});
