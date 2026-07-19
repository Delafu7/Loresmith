// Integration tests for multiclass spell-slot computation
// (recomputeSpellSlots) and prerequisite validation
// (validateMulticlassPrerequisites), services/spellSlots.ts.
//
// Isolation choice: unlike performRest()/applyCharacterEffect() (which each
// open their own connection and run their own internal BEGIN/COMMIT), both
// functions under test here accept a plain `Pool | PoolClient` and do no
// transaction management of their own. That means they CAN be driven
// through a single client with a transaction *this test* opens and rolls
// back at the end -- nothing ever commits, so there is nothing to clean up
// and zero risk to the seeded demo campaign (Kessia Duskbane, the real
// Paladin 3 / Warlock 2 demo PC this logic was built against, is never
// touched). Temp characters below reference the first existing
// campaign/user rows purely as FK targets (a read-only reference, never a
// mutation, since the whole transaction is rolled back) rather than
// creating yet more throwaway rows that would need explicit cleanup.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { recomputeSpellSlots, validateMulticlassPrerequisites } from './spellSlots.js';

describe('multiclass spell slots + prerequisites (integration, rolled-back transaction)', () => {
  let client: PoolClient;
  let campaignId: number;
  let userId: number;
  let paladinClassId: number;
  let warlockClassId: number;
  let rangerClassId: number;
  let fighterClassId: number;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    const campaignRes = await client.query<{ id: number }>(`SELECT id FROM campaigns ORDER BY id LIMIT 1`);
    if (campaignRes.rows.length === 0) throw new Error('Expected at least one seeded campaign to exist');
    campaignId = campaignRes.rows[0]!.id;

    const userRes = await client.query<{ id: number }>(`SELECT id FROM users ORDER BY id LIMIT 1`);
    if (userRes.rows.length === 0) throw new Error('Expected at least one seeded user to exist');
    userId = userRes.rows[0]!.id;

    async function classIdFor(indexKey: string): Promise<number> {
      const res = await client.query<{ id: number }>(
        `SELECT id FROM classes WHERE index_key = $1 AND edition_scope = '2024'`,
        [indexKey],
      );
      if (res.rows.length === 0) throw new Error(`Expected seeded class '${indexKey}' (edition 2024) to exist`);
      return res.rows[0]!.id;
    }
    paladinClassId = await classIdFor('paladin');
    warlockClassId = await classIdFor('warlock');
    rangerClassId = await classIdFor('ranger');
    fighterClassId = await classIdFor('fighter');
  });

  afterAll(async () => {
    // Nothing was ever committed -- rolling back is the entire cleanup.
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  async function makeCharacter(name: string): Promise<number> {
    const res = await client.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 10, 10, 10)
       RETURNING id`,
      [campaignId, userId, name],
    );
    return res.rows[0]!.id;
  }

  it('Paladin 3 / Warlock 2: multiclass spell_slot_1 and Warlock\'s own warlock_pact_slot_1 stay separate, never summed', async () => {
    const characterId = await makeCharacter('Test Paladin3-Warlock2');
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [characterId, paladinClassId]);
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 2)`, [characterId, warlockClassId]);

    await recomputeSpellSlots(client, characterId);

    // Expected values pulled from the same tables recomputeSpellSlots reads
    // from, rather than hardcoded, so this stays correct if the seeded SRD
    // data ever changes -- only the "kept separate" shape is asserted as a
    // fixed expectation.
    const multiclassRow = await client.query<{ spell_slots: Record<string, number> }>(
      `SELECT spell_slots FROM multiclass_spell_slot_table WHERE combined_caster_level = 1`, // floor(3 * 0.5) = 1
    );
    const expectedSpellSlot1 = Number(multiclassRow.rows[0]!.spell_slots['1']);
    expect(expectedSpellSlot1).toBeGreaterThan(0);

    const pactRow = await client.query<{ spell_slots: Record<string, number> }>(
      `SELECT spell_slots FROM class_levels WHERE class_id = $1 AND level = 2`,
      [warlockClassId],
    );
    const expectedWarlockSlot1 = Number(pactRow.rows[0]!.spell_slots.spell_slots_level_1);
    expect(expectedWarlockSlot1).toBeGreaterThan(0);

    const pools = await client.query<{ resource_key: string; max_value: number; recharge_on: string }>(
      `SELECT resource_key, max_value, recharge_on FROM character_resource_pools WHERE character_id = $1 ORDER BY resource_key`,
      [characterId],
    );
    const byKey = Object.fromEntries(pools.rows.map((r) => [r.resource_key, r]));

    expect(byKey.spell_slot_1?.max_value).toBe(expectedSpellSlot1);
    expect(byKey.spell_slot_1?.recharge_on).toBe('long_rest');
    expect(byKey.warlock_pact_slot_1?.max_value).toBe(expectedWarlockSlot1);
    expect(byKey.warlock_pact_slot_1?.recharge_on).toBe('short_rest');

    // The most important assertion in this test: exactly these two distinct
    // pools exist -- the two pools are never summed/merged into one.
    expect(Object.keys(byKey).sort()).toEqual(['spell_slot_1', 'warlock_pact_slot_1']);
    const naiveSum = expectedSpellSlot1 + expectedWarlockSlot1;
    expect(byKey.spell_slot_1?.max_value).not.toBe(naiveSum);
    expect(byKey.warlock_pact_slot_1?.max_value).not.toBe(naiveSum);
  });

  it('Paladin 1 / Ranger 1 (two half-casters) yields ZERO spell slots -- per-class flooring happens before summing, not after', async () => {
    const characterId = await makeCharacter('Test Paladin1-Ranger1');
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [characterId, paladinClassId]);
    await client.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [characterId, rangerClassId]);

    await recomputeSpellSlots(client, characterId);

    const pools = await client.query(`SELECT resource_key FROM character_resource_pools WHERE character_id = $1`, [characterId]);
    // floor(1 * 0.5) + floor(1 * 0.5) = 0 + 0 = 0, NOT floor((1 + 1) / 2) = 1
    // -- the classic multiclass-slot bug this function must avoid. A
    // combined caster level of 0 means no spell_slot_* rows at all.
    expect(pools.rows).toEqual([]);
  });

  describe('validateMulticlassPrerequisites', () => {
    it('exempts a single-class character from prerequisite checks entirely, regardless of ability scores', async () => {
      await expect(
        validateMulticlassPrerequisites(client, { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }, [fighterClassId]),
      ).resolves.toBeUndefined();
    });

    it("satisfies Fighter's STR-13-OR-DEX-13 prerequisite via DEX alone (requirement_group OR logic)", async () => {
      // Paired with Warlock (CHA 13, kept satisfied via CHA 16 in both this
      // and the failing case below) purely to force >1 distinct class id --
      // otherwise a single-class list is exempt before any row is even
      // checked, per the test above.
      await expect(
        validateMulticlassPrerequisites(
          client,
          { str: 8, dex: 14, con: 10, int: 10, wis: 10, cha: 16 },
          [fighterClassId, warlockClassId],
        ),
      ).resolves.toBeUndefined();
    });

    it('fails Fighter prerequisite when neither STR 13 nor DEX 13 is met', async () => {
      let caught: unknown;
      try {
        await validateMulticlassPrerequisites(
          client,
          { str: 8, dex: 8, con: 10, int: 10, wis: 10, cha: 16 },
          [fighterClassId, warlockClassId],
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe('VALIDATION_ERROR');
      expect((caught as AppError).message).toContain('Fighter');
    });
  });
});
