// Integration test for the concentration auto-replace behavior inside
// insertActiveEffect() (services/effects.ts). insertActiveEffect isn't
// exported itself -- it's always exercised through applyCharacterEffect/
// applyMonsterInstanceEffect/applyEncounterEffect, so this drives it via
// applyCharacterEffect, the simplest of the three.
//
// This behavior was JUST CHANGED (same session, immediately before this
// test was written) from "reject the second concentration effect with a 409
// CONFLICT" to "auto-end the prior concentration effect, then apply the new
// one" -- the real SRD rule that casting a new concentration spell breaks
// whatever you were already concentrating on, rather than blocking the cast.
//
// Isolation choice: applyCharacterEffect() opens its OWN connection
// (pool.connect()) and runs its own internal BEGIN/COMMIT, exactly like
// performRest() in rests.performRest.integration.test.ts -- so an outer
// BEGIN/ROLLBACK around the call wouldn't see anything (a second Postgres
// session never sees another session's uncommitted rows). This uses
// throwaway campaign/character/effect_definitions rows instead of touching
// the seeded demo data, torn down via cascading deletes in afterAll
// (campaigns -> campaign_members/characters/active_effects, and
// effect_definitions.owning_campaign_id, are all ON DELETE CASCADE).
// Cleanup is wrapped in try/finally so a failure mid-test still attempts to
// remove the throwaway rows rather than leaking them into the dev DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyCharacterEffect } from './effects.js';

describe('concentration auto-replace (integration, live DB, throwaway fixtures)', () => {
  let userId: number;
  let campaignId: number;
  let characterId: number;
  let concentrationDefA: number;
  let concentrationDefB: number;
  let nonConcentrationDef: number;

  async function makeEffectDefinition(name: string, concentration: boolean): Promise<number> {
    const res = await pool.query<{ id: number }>(
      `INSERT INTO effect_definitions
         (name, default_duration_type, default_duration_value, concentration, is_homebrew, owning_campaign_id)
       VALUES ($1, 'minutes', 10, $2, true, $3)
       RETURNING id`,
      [name, concentration, campaignId],
    );
    return res.rows[0]!.id;
  }

  beforeAll(async () => {
    const userRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Effects Test User', 'x') RETURNING id`,
      [`effects-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`],
    );
    userId = userRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Effects Test Campaign', $1, '2024') RETURNING id`,
      [userId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, userId]);

    const charRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Effects Test Character', 10, 10, 10, 10, 10, 10, 10, 20, 20)
       RETURNING id`,
      [campaignId, userId],
    );
    characterId = charRes.rows[0]!.id;

    concentrationDefA = await makeEffectDefinition('Test Concentration Effect A', true);
    concentrationDefB = await makeEffectDefinition('Test Concentration Effect B', true);
    nonConcentrationDef = await makeEffectDefinition('Test Non-Concentration Effect', false);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (userId) await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await pool.end();
    }
  });

  it('auto-ends a prior concentration effect on second application, while a non-concentration effect coexists', async () => {
    const first = await applyCharacterEffect(pool, userId, characterId, {
      effectDefinitionId: concentrationDefA,
      sourceType: 'manual',
    });
    expect(first.replacedEffect).toBeNull();
    expect(first.effect.concentration).toBe(true);
    expect(first.effect.removed_at).toBeNull();

    // Applying a SECOND concentration effect to the same character must not
    // throw/conflict (a); it must auto-end the first (b/d) and leave the
    // second active (c).
    const second = await applyCharacterEffect(pool, userId, characterId, {
      effectDefinitionId: concentrationDefB,
      sourceType: 'manual',
    });

    expect(second.replacedEffect).not.toBeNull();
    expect(second.replacedEffect!.effect.id).toBe(first.effect.id); // (d) points at the first effect's id
    expect(second.replacedEffect!.effect.removed_at).not.toBeNull(); // (b) first effect soft-deleted
    expect(second.effect.removed_at).toBeNull(); // (c) second effect is active
    expect(second.effect.concentration).toBe(true);

    // Confirm directly against the DB too, not just the function's return value.
    const dbFirst = await pool.query<{ removed_at: string | null }>(
      `SELECT removed_at FROM active_effects WHERE id = $1`,
      [first.effect.id],
    );
    expect(dbFirst.rows[0]!.removed_at).not.toBeNull();
    const dbSecond = await pool.query<{ removed_at: string | null }>(
      `SELECT removed_at FROM active_effects WHERE id = $1`,
      [second.effect.id],
    );
    expect(dbSecond.rows[0]!.removed_at).toBeNull();

    // (e) A non-concentration effect application must NOT trigger the
    // auto-replace logic, and must coexist with the still-active
    // concentration effect from `second`.
    const third = await applyCharacterEffect(pool, userId, characterId, {
      effectDefinitionId: nonConcentrationDef,
      sourceType: 'manual',
    });
    expect(third.replacedEffect).toBeNull();
    expect(third.effect.concentration).toBe(false);
    expect(third.effect.removed_at).toBeNull();

    const dbSecondAfterThird = await pool.query<{ removed_at: string | null }>(
      `SELECT removed_at FROM active_effects WHERE id = $1`,
      [second.effect.id],
    );
    expect(dbSecondAfterThird.rows[0]!.removed_at).toBeNull(); // still active alongside the new non-concentration effect

    const dbThird = await pool.query<{ removed_at: string | null }>(
      `SELECT removed_at FROM active_effects WHERE id = $1`,
      [third.effect.id],
    );
    expect(dbThird.rows[0]!.removed_at).toBeNull();
  });
});
