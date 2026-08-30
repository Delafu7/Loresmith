// Integration tests for docs/roadmap/dnd-2024-gap-analysis.md P1-1 (death
// saving throw state machine), grounded in docs/rules/death-saving-throws.md.
// Same throwaway-fixture isolation convention as
// characters.applyDamage.integration.test.ts, whose big-modifier /
// retry-on-the-actual-die-value techniques this file reuses to get
// deterministic outcomes out of the server's real RNG (rollDie), rather than
// mocking it — no test in this codebase mocks the dice engine.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyDamage, applyHpDelta, rollDeathSave, stabilizeCharacter } from './characters.js';
import { AppError } from '../middleware/errors.js';

describe('death saving throws (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DeathSaves Test DM', 'x') RETURNING id`,
      [`death-saves-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('DeathSaves Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function makeCharacter(
    name: string,
    overrides: Partial<{
      hpMax: number;
      hpCurrent: number;
      isAlive: boolean;
      isStable: boolean;
      deathSaveSuccesses: number;
      deathSaveFailures: number;
    }> = {},
  ): Promise<string> {
    const { hpMax = 50, hpCurrent = 50, isAlive = true, isStable = false, deathSaveSuccesses = 0, deathSaveFailures = 0 } = overrides;
    const res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, is_alive, is_stable, death_save_successes, death_save_failures)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [campaignId, dmUserId, name, hpMax, hpCurrent, isAlive, isStable, deathSaveSuccesses, deathSaveFailures],
    );
    return res.rows[0]!.id;
  }

  async function hasUnconsciousEffect(characterId: string): Promise<boolean> {
    const res = await pool.query(
      `SELECT 1 FROM active_effects ae JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = $1 AND ed.name = 'Unconscious' AND ae.removed_at IS NULL`,
      [characterId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Full fixture reset between retry attempts — every field a prior
  // attempt could have mutated (hp_current, is_alive, is_stable, the
  // counters, AND any Unconscious active_effects row it may have inserted)
  // must be restored, or a roll from an earlier failed attempt (e.g. a
  // stray nat 20 healing to 1 HP, or an ordinary drop applying Unconscious
  // before the target roll finally lands) leaks into the next attempt.
  async function resetCharacter(
    characterId: string,
    fields: Partial<{ hpCurrent: number; isAlive: boolean; isStable: boolean; deathSaveSuccesses: number; deathSaveFailures: number }>,
  ): Promise<void> {
    const {
      hpCurrent = 0,
      isAlive = true,
      isStable = false,
      deathSaveSuccesses = 0,
      deathSaveFailures = 0,
    } = fields;
    await pool.query(
      `UPDATE characters SET hp_current = $1, is_alive = $2, is_stable = $3, death_save_successes = $4, death_save_failures = $5 WHERE id = $6`,
      [hpCurrent, isAlive, isStable, deathSaveSuccesses, deathSaveFailures, characterId],
    );
    await pool.query(
      `UPDATE active_effects SET removed_at = now()
       WHERE character_id = $1 AND removed_at IS NULL
         AND effect_definition_id = (SELECT id FROM effect_definitions WHERE name = 'Unconscious' LIMIT 1)`,
      [characterId],
    );
  }

  // Repeats `attempt` (which resets fixture state via `reset` first) until
  // its result satisfies `predicate`, or gives up. The dice ranges used here
  // (a 1d4 damage die, a 1d20 death save) are small enough that this
  // converges in a handful of real DB round trips.
  async function retryUntil<T>(reset: () => Promise<void>, attempt: () => Promise<T>, predicate: (result: T) => boolean): Promise<T> {
    for (let i = 0; i < 200; i++) {
      await reset();
      const result = await attempt();
      if (predicate(result)) return result;
    }
    throw new Error('retryUntil: predicate never satisfied within 200 attempts');
  }

  describe('applyDamage: falling unconscious / massive damage / damage-at-0-HP', () => {
    it('dropping to exactly 0 HP (no overkill) applies Unconscious and leaves counters zeroed', async () => {
      // hp_max huge relative to the 1d4 damage roll — overkill can never
      // reach hp_max, so this can only ever be the "ordinary drop" branch.
      const characterId = await makeCharacter('Drop To Zero PC', { hpMax: 100, hpCurrent: 1 });
      const result = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4, diceCount: 1, modifier: 0, damageType: null, isCritical: false,
      });
      expect(result.character.hp_current).toBe(0);
      expect(result.character.is_alive).toBe(true);
      expect(result.character.is_stable).toBe(false);
      expect(result.character.death_save_successes).toBe(0);
      expect(result.character.death_save_failures).toBe(0);
      expect(await hasUnconsciousEffect(characterId)).toBe(true);
    });

    it('massive damage exactly at the threshold (overkill === hp_max) kills instantly, no Unconscious row created', async () => {
      // hp_max=20, hp_current=1 (initial-drop scenario). modifier=17 + 1d4
      // gives appliedDamage in [18,21]; retry until the die lands on 4 so
      // appliedDamage=21, overkill = 21 - 1 = 20 = hp_max exactly.
      const characterId = await makeCharacter('Massive Damage Exact PC', { hpMax: 20, hpCurrent: 1 });
      const result = await retryUntil(
        () => resetCharacter(characterId, { hpCurrent: 1 }),
        () => applyDamage(pool, dmUserId, characterId, { diceSides: 4, diceCount: 1, modifier: 17, damageType: null, isCritical: false }),
        (r) => r.diceRoll.rolls[0] === 4,
      );
      expect(result.appliedDamage).toBe(21);
      expect(result.character.is_alive).toBe(false);
      expect(result.character.hp_current).toBe(0);
      expect(await hasUnconsciousEffect(characterId)).toBe(false);
    });

    it('one point under the massive-damage threshold survives — 0 HP, Unconscious, not dead', async () => {
      // Same fixture shape; retry until the die lands on 3 so
      // appliedDamage=20, overkill = 20 - 1 = 19 < hp_max (20).
      const characterId = await makeCharacter('Massive Damage Under PC', { hpMax: 20, hpCurrent: 1 });
      const result = await retryUntil(
        () => resetCharacter(characterId, { hpCurrent: 1 }),
        () => applyDamage(pool, dmUserId, characterId, { diceSides: 4, diceCount: 1, modifier: 17, damageType: null, isCritical: false }),
        (r) => r.diceRoll.rolls[0] === 3,
      );
      expect(result.appliedDamage).toBe(20);
      expect(result.character.is_alive).toBe(true);
      expect(result.character.hp_current).toBe(0);
      expect(await hasUnconsciousEffect(characterId)).toBe(true);
    });

    it('damage at 0 HP adds exactly 1 failure on a non-critical hit', async () => {
      const characterId = await makeCharacter('Damage At Zero PC', { hpMax: 50, hpCurrent: 0, deathSaveFailures: 0 });
      const result = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4, diceCount: 1, modifier: 0, damageType: null, isCritical: false,
      });
      expect(result.character.hp_current).toBe(0);
      expect(result.character.death_save_failures).toBe(1);
      expect(result.character.is_alive).toBe(true);
    });

    it('a critical hit at 0 HP adds 2 failures — from 1 existing failure, one crit kills', async () => {
      const characterId = await makeCharacter('Crit At Zero PC', { hpMax: 50, hpCurrent: 0, deathSaveFailures: 1 });
      const critRoll = await pool.query<{ id: string }>(
        `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
         VALUES ($1, $2, 'attack', ARRAY[20], 'normal', 20, 1, 0, 20) RETURNING id`,
        [campaignId, dmUserId],
      );
      const result = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4, diceCount: 1, modifier: 0, damageType: null, attackRollId: critRoll.rows[0]!.id,
      } as Parameters<typeof applyDamage>[3]);
      expect(result.character.death_save_failures).toBe(3);
      expect(result.character.is_alive).toBe(false);
      expect(await hasUnconsciousEffect(characterId)).toBe(false);
    });

    it('massive damage while already at 0 HP overrides the failure-counter path entirely', async () => {
      // hp_max=4, modifier=10 + 1d4 guarantees appliedDamage in [11,14] —
      // always >= hp_max regardless of the roll, so no retry needed.
      const characterId = await makeCharacter('Massive At Zero PC', { hpMax: 4, hpCurrent: 0, deathSaveFailures: 0 });
      const result = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4, diceCount: 1, modifier: 10, damageType: null, isCritical: false,
      });
      expect(result.character.is_alive).toBe(false);
      expect(result.character.death_save_failures).toBe(0); // killed by massive damage, not the counter
    });

    it('breaking Stable via any damage does not itself count as the new sequence\'s first failure', async () => {
      const characterId = await makeCharacter('Break Stable PC', { hpMax: 50, hpCurrent: 0, isStable: true });
      const result = await applyDamage(pool, dmUserId, characterId, {
        diceSides: 4, diceCount: 1, modifier: 0, damageType: null, isCritical: false,
      });
      expect(result.character.is_stable).toBe(false);
      expect(result.character.death_save_failures).toBe(0);
      expect(result.character.hp_current).toBe(0);
      expect(result.character.is_alive).toBe(true);
    });
  });

  describe('rollDeathSave', () => {
    it('rejects when hp_current is not 0', async () => {
      const characterId = await makeCharacter('Not Down PC', { hpCurrent: 10 });
      await expect(rollDeathSave(pool, dmUserId, characterId)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects when the character is already dead', async () => {
      const characterId = await makeCharacter('Already Dead PC', { hpCurrent: 0, isAlive: false });
      await expect(rollDeathSave(pool, dmUserId, characterId)).rejects.toBeInstanceOf(AppError);
    });

    it('rejects when the character is already Stable', async () => {
      const characterId = await makeCharacter('Already Stable PC', { hpCurrent: 0, isStable: true });
      await expect(rollDeathSave(pool, dmUserId, characterId)).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('a natural 20 regains 1 HP and fully clears the death-save state', async () => {
      const characterId = await makeCharacter('Nat20 PC', {
        hpCurrent: 0, deathSaveSuccesses: 1, deathSaveFailures: 1,
      });
      const result = await retryUntil(
        async () => {
          await resetCharacter(characterId, { deathSaveSuccesses: 1, deathSaveFailures: 1 });
          await pool.query(
            `INSERT INTO active_effects (effect_definition_id, character_id, source_type, duration_type)
             SELECT id, $1, 'manual', 'until_removed' FROM effect_definitions WHERE name = 'Unconscious'`,
            [characterId],
          );
        },
        () => rollDeathSave(pool, dmUserId, characterId),
        (r) => r.roll === 20,
      );
      expect(result.character.hp_current).toBe(1);
      expect(result.character.death_save_successes).toBe(0);
      expect(result.character.death_save_failures).toBe(0);
      expect(result.character.is_stable).toBe(false);
      expect(await hasUnconsciousEffect(characterId)).toBe(false);
    });

    it('a natural 1 counts as two failures — from 2 existing failures, it kills in one roll', async () => {
      const characterId = await makeCharacter('Nat1 Kills PC', { hpCurrent: 0, deathSaveFailures: 2 });
      const result = await retryUntil(
        () => resetCharacter(characterId, { deathSaveFailures: 2 }),
        () => rollDeathSave(pool, dmUserId, characterId),
        (r) => r.roll === 1,
      );
      expect(result.character.death_save_failures).toBe(3);
      expect(result.character.is_alive).toBe(false);
    });

    it('an ordinary failure (not nat 1) only adds ONE failure', async () => {
      const characterId = await makeCharacter('Ordinary Failure PC', { hpCurrent: 0, deathSaveFailures: 1 });
      const result = await retryUntil(
        () => resetCharacter(characterId, { deathSaveFailures: 1 }),
        () => rollDeathSave(pool, dmUserId, characterId),
        (r) => r.roll >= 2 && r.roll <= 9,
      );
      expect(result.character.death_save_failures).toBe(2);
      expect(result.character.is_alive).toBe(true);
    });

    it('the 3rd success (an ordinary 10+ roll, not nat 20) stabilizes and wipes BOTH counters', async () => {
      const characterId = await makeCharacter('Stabilize Via Success PC', {
        hpCurrent: 0, deathSaveSuccesses: 2, deathSaveFailures: 2,
      });
      const result = await retryUntil(
        () => resetCharacter(characterId, { deathSaveSuccesses: 2, deathSaveFailures: 2 }),
        () => rollDeathSave(pool, dmUserId, characterId),
        (r) => r.roll >= 10 && r.roll <= 19,
      );
      expect(result.character.is_stable).toBe(true);
      expect(result.character.death_save_successes).toBe(0);
      expect(result.character.death_save_failures).toBe(0);
      expect(result.character.is_alive).toBe(true);
    });
  });

  describe('stabilizeCharacter (Help action, DC 10 Wisdom (Medicine))', () => {
    it('a successful check stabilizes the target and resets both counters', async () => {
      const targetId = await makeCharacter('Stabilize Target PC', { hpCurrent: 0, deathSaveSuccesses: 1, deathSaveFailures: 2 });
      const helperId = await makeCharacter('Stabilize Helper PC', { hpCurrent: 50 });
      // modifier=15 guarantees total >= 10 regardless of the d20 roll.
      const result = await stabilizeCharacter(pool, dmUserId, targetId, { helperCharacterId: helperId, modifier: 15 });
      expect(result.success).toBe(true);
      expect(result.target.is_stable).toBe(true);
      expect(result.target.death_save_successes).toBe(0);
      expect(result.target.death_save_failures).toBe(0);
    });

    it('a failed check leaves the target unchanged', async () => {
      const targetId = await makeCharacter('Stabilize Fail Target PC', { hpCurrent: 0, deathSaveSuccesses: 1, deathSaveFailures: 1 });
      const helperId = await makeCharacter('Stabilize Fail Helper PC', { hpCurrent: 50 });
      // modifier=-15 guarantees total < 10 regardless of the d20 roll.
      const result = await stabilizeCharacter(pool, dmUserId, targetId, { helperCharacterId: helperId, modifier: -15 });
      expect(result.success).toBe(false);
      expect(result.target.is_stable).toBe(false);
      expect(result.target.death_save_successes).toBe(1);
      expect(result.target.death_save_failures).toBe(1);
    });

    it('rejects when the target is not at 0 HP', async () => {
      const targetId = await makeCharacter('Not Down Stabilize PC', { hpCurrent: 10 });
      const helperId = await makeCharacter('Stabilize Helper PC 2', { hpCurrent: 50 });
      await expect(stabilizeCharacter(pool, dmUserId, targetId, { helperCharacterId: helperId, modifier: 15 })).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('applyHpDelta (plain heal/manual-correction path)', () => {
    it('regaining any real HP at 0 clears the death-save counters and Stable', async () => {
      const characterId = await makeCharacter('Heal Reset PC', { hpCurrent: 0, deathSaveSuccesses: 1, deathSaveFailures: 1 });
      await pool.query(
        `INSERT INTO active_effects (effect_definition_id, character_id, source_type, duration_type)
         SELECT id, $1, 'manual', 'until_removed' FROM effect_definitions WHERE name = 'Unconscious'`,
        [characterId],
      );
      const result = await applyHpDelta(pool, dmUserId, characterId, { delta: 5, tempDelta: 0 });
      expect(result.character.hp_current).toBe(5);
      expect(result.character.death_save_successes).toBe(0);
      expect(result.character.death_save_failures).toBe(0);
      expect(result.character.is_stable).toBe(false);
      expect(await hasUnconsciousEffect(characterId)).toBe(false);
    });

    it('a temp-HP-only grant at 0 HP does not wake or stabilize the character', async () => {
      const characterId = await makeCharacter('Temp HP At Zero PC', { hpCurrent: 0, deathSaveFailures: 1 });
      const result = await applyHpDelta(pool, dmUserId, characterId, { delta: 0, tempDelta: 5 });
      expect(result.character.hp_current).toBe(0);
      expect(result.character.hp_temp).toBe(5);
      expect(result.character.death_save_failures).toBe(1);
      expect(result.character.is_stable).toBe(false);
    });

    it('rejects healing a character who has already died', async () => {
      const characterId = await makeCharacter('Dead No Heal PC', { hpCurrent: 0, isAlive: false });
      await expect(applyHpDelta(pool, dmUserId, characterId, { delta: 10, tempDelta: 0 })).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });
});
