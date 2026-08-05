// Integration test for cast-from-encounter (services/casting.ts): spending
// the slot and applying the effect to targets happen together, insufficient
// slots reject the whole cast (nothing partially applied), a non-owning
// non-DM actor is rejected, and casting a second concentration effect
// through this path still triggers the existing SRD auto-replace (proves
// castFromEncounter reuses applyEncounterEffect's real logic, not a
// reimplementation). Throwaway campaign/users/character/encounter fixtures.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { castFromEncounter } from './casting.js';

describe('cast-from-encounter (integration, live DB, throwaway fixtures)', () => {
  let casterUserId: string;
  let otherPlayerUserId: string;
  let campaignId: string;
  let casterCharacterId: string;
  let allyCharacterId: string;
  let encounterId: string;
  let casterParticipantId: string;
  let allyParticipantId: string;
  let concentrationDefA: string;
  let concentrationDefB: string;

  async function makeEffectDefinition(name: string, concentration: boolean): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO effect_definitions
         (name, default_duration_type, default_duration_value, concentration, is_homebrew, owning_campaign_id)
       VALUES ($1, 'minutes', 10, $2, true, $3)
       RETURNING id`,
      [name, concentration, campaignId],
    );
    return res.rows[0]!.id;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const casterRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Casting Test Caster', 'x') RETURNING id`,
      [`casting-caster-${suffix}@example.test`],
    );
    casterUserId = casterRes.rows[0]!.id;
    const otherRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Casting Test Other Player', 'x') RETURNING id`,
      [`casting-other-${suffix}@example.test`],
    );
    otherPlayerUserId = otherRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Casting Test Campaign', $1, '2024') RETURNING id`,
      [casterUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, casterUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, otherPlayerUserId]);

    const casterCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Casting Test Caster PC', 10, 10, 10, 10, 10, 10, 10, 20, 20)
       RETURNING id`,
      [campaignId, casterUserId],
    );
    casterCharacterId = casterCharRes.rows[0]!.id;

    const allyCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Casting Test Ally PC', 10, 10, 10, 10, 10, 10, 10, 20, 20)
       RETURNING id`,
      [campaignId, casterUserId],
    );
    allyCharacterId = allyCharRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1, 'spell_slot_1', 1, 2, 'long_rest')`,
      [casterCharacterId],
    );

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Casting Test Encounter', 'active') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    const casterParticipantRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 10, 0) RETURNING id`,
      [encounterId, casterCharacterId],
    );
    casterParticipantId = casterParticipantRes.rows[0]!.id;
    const allyParticipantRes = await pool.query<{ id: string }>(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 5, 1) RETURNING id`,
      [encounterId, allyCharacterId],
    );
    allyParticipantId = allyParticipantRes.rows[0]!.id;

    concentrationDefA = await makeEffectDefinition('Casting Test Concentration Effect A', true);
    concentrationDefB = await makeEffectDefinition('Casting Test Concentration Effect B', true);
  });

  afterAll(async () => {
    try {
      // active_effects.source_character_id has no ON DELETE cascade/set-null
      // rule (a pre-existing schema gap, unrelated to this feature) — this
      // test is the first in the suite to set sourceCharacterId to a
      // DIFFERENT character than the effect's target, which the campaign
      // cascade can't resolve on its own (RESTRICT blocks deleting the
      // source character while an effect still references it). Deleted
      // explicitly first to sidestep it, rather than widening the schema
      // for one test file's cleanup.
      if (campaignId) await pool.query(`DELETE FROM active_effects WHERE character_id IN (SELECT id FROM characters WHERE campaign_id = $1)`, [campaignId]);
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (casterUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [casterUserId]);
      if (otherPlayerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [otherPlayerUserId]);
      await pool.end();
    }
  });

  it('rejects a non-owning, non-DM actor', async () => {
    // otherPlayerUserId is a member but neither the DM nor casterCharacterId's owner.
    await expect(
      castFromEncounter(pool, otherPlayerUserId, encounterId, {
        characterId: casterCharacterId,
        resourceKey: 'spell_slot_1',
        targetParticipantIds: [],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('spends the slot and applies the effect to the target, atomically', async () => {
    const before = await pool.query<{ current_value: number }>(
      `SELECT current_value FROM character_resource_pools WHERE character_id = $1 AND resource_key = 'spell_slot_1'`,
      [casterCharacterId],
    );
    expect(before.rows[0]!.current_value).toBe(1);

    const result = await castFromEncounter(pool, casterUserId, encounterId, {
      characterId: casterCharacterId,
      resourceKey: 'spell_slot_1',
      effectDefinitionId: concentrationDefA,
      targetParticipantIds: [allyParticipantId],
      concentration: true,
    });

    expect(result.resourcePool.current_value).toBe(0);
    expect(result.appliedEffects).toHaveLength(1);
    expect(result.appliedEffects[0]!.effect.character_id).toBe(allyCharacterId);
    expect(result.appliedEffects[0]!.effect.effect_definition_id).toBe(concentrationDefA);

    const active = await pool.query(
      `SELECT id FROM active_effects WHERE character_id = $1 AND effect_definition_id = $2 AND removed_at IS NULL`,
      [allyCharacterId, concentrationDefA],
    );
    expect(active.rows.length).toBe(1);
  });

  it('rejects the whole cast when the slot is insufficient (nothing partially applied)', async () => {
    // Only 0 remain after the previous test spent the last one.
    await expect(
      castFromEncounter(pool, casterUserId, encounterId, {
        characterId: casterCharacterId,
        resourceKey: 'spell_slot_1',
        effectDefinitionId: concentrationDefB,
        targetParticipantIds: [allyParticipantId],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // The target's existing concentration effect (from the prior test) is
    // untouched — the rejected cast never reached the effect-apply step.
    const active = await pool.query(
      `SELECT effect_definition_id FROM active_effects WHERE character_id = $1 AND removed_at IS NULL`,
      [allyCharacterId],
    );
    expect(active.rows.map((r) => r.effect_definition_id)).toEqual([concentrationDefA]);
  });

  it('a second concentration cast through this path still auto-replaces the first (reuses real effect logic)', async () => {
    // Refill the slot to isolate this test from the previous rejection.
    await pool.query(
      `UPDATE character_resource_pools SET current_value = 1 WHERE character_id = $1 AND resource_key = 'spell_slot_1'`,
      [casterCharacterId],
    );

    const result = await castFromEncounter(pool, casterUserId, encounterId, {
      characterId: casterCharacterId,
      resourceKey: 'spell_slot_1',
      effectDefinitionId: concentrationDefB,
      targetParticipantIds: [allyParticipantId],
      concentration: true,
    });

    expect(result.appliedEffects[0]!.replacedEffect).not.toBeNull();
    expect(result.appliedEffects[0]!.replacedEffect!.effectDefinitionName).toBe('Casting Test Concentration Effect A');

    const active = await pool.query(
      `SELECT effect_definition_id FROM active_effects WHERE character_id = $1 AND removed_at IS NULL`,
      [allyCharacterId],
    );
    expect(active.rows.map((r) => r.effect_definition_id)).toEqual([concentrationDefB]);
  });

  it('spending with no effectDefinitionId just spends the slot (e.g. a pure-damage cantrip/spell)', async () => {
    await pool.query(
      `UPDATE character_resource_pools SET current_value = 1 WHERE character_id = $1 AND resource_key = 'spell_slot_1'`,
      [casterCharacterId],
    );

    const result = await castFromEncounter(pool, casterUserId, encounterId, {
      characterId: casterCharacterId,
      resourceKey: 'spell_slot_1',
      targetParticipantIds: [casterParticipantId],
    });

    expect(result.resourcePool.current_value).toBe(0);
    expect(result.appliedEffects).toEqual([]);
  });
});
