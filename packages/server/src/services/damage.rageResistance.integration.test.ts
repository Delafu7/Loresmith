// docs/roadmap/dnd-2024-gap-analysis.md P1-11 (CB-02) — Rage-style
// TEMPORARY damage resistance: a currently-active effect_definitions
// template's `grants_resistance` is unioned with a target's PERMANENT
// damage_resistances column, read fresh on every applyDamage/
// applyMonsterInstanceDamage call, never written into the permanent column
// itself. Uses the real seeded "Raging" template (bludgeoning/piercing/
// slashing) rather than a throwaway homebrew one, doubling as an
// integration check that the seed is wired correctly. Throwaway campaign/
// character/monster-instance fixtures, same isolation convention as
// characters.applyDamage.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyDamage } from './characters.js';
import { applyMonsterInstanceDamage } from './monsters.js';
import { applyCharacterEffect, applyMonsterInstanceEffect, removeEffect } from './effects.js';

describe('Rage-style temporary resistance (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let plainCharacterId: string; // no permanent resistances
  let piercingResistantCharacterId: string; // permanently resistant to piercing (separate from Raging)
  let monsterInstanceId: string;
  let ragingEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'RageResistance Test DM', 'x') RETURNING id`,
      [`rage-resistance-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('RageResistance Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const plainRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'RageResistance Test Barbarian', 10, 10, 10, 10, 10, 10, 12, 30, 50, 50)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    plainCharacterId = plainRes.rows[0]!.id;

    const piercingRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, damage_resistances)
       VALUES ($1, true, $2, $2, 'RageResistance Test Piercing-Resistant Barbarian', 10, 10, 10, 10, 10, 10, 12, 30, 50, 50, ARRAY['piercing'])
       RETURNING id`,
      [campaignId, dmUserId],
    );
    piercingResistantCharacterId = piercingRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'RageResistance Test Beast', '2024', 'Medium', 'beast', 12, 50, '8d8+16', '{"walk":30}',
               16, 12, 14, 4, 10, 6, 1, 200, '[]'::jsonb)
       RETURNING id`,
      [`rage-resistance-monster-${suffix}`],
    );
    const monsterCatalogId = monsterCatalogRes.rows[0]!.id;

    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 50) RETURNING id`,
      [campaignId, monsterCatalogId],
    );
    monsterInstanceId = instanceRes.rows[0]!.id;

    const ragingRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Raging' AND is_homebrew = false`);
    if (!ragingRes.rows[0]) throw new Error("Expected a seeded 'Raging' effect_definitions row for this test");
    ragingEffectDefinitionId = ragingRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a character with an active Raging effect resists bludgeoning damage, without any permanent resistances column set', async () => {
    const before = await pool.query<{ damage_resistances: string[] }>(`SELECT damage_resistances FROM characters WHERE id = $1`, [plainCharacterId]);
    expect(before.rows[0]!.damage_resistances).toEqual([]);

    await applyCharacterEffect(pool, dmUserId, plainCharacterId, { effectDefinitionId: ragingEffectDefinitionId, sourceType: 'manual' });

    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4, diceCount: 1, modifier: 19, damageType: 'bludgeoning', isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(true);
    expect(result.appliedDamage).toBe(Math.floor(result.rawTotal / 2));

    // The permanent column is untouched — this is TEMPORARY, read-time-only
    // resistance, never written into damage_resistances.
    const after = await pool.query<{ damage_resistances: string[] }>(`SELECT damage_resistances FROM characters WHERE id = $1`, [plainCharacterId]);
    expect(after.rows[0]!.damage_resistances).toEqual([]);
  });

  it('a damage type NOT granted by Raging (fire) is unaffected while Raging is active', async () => {
    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4, diceCount: 1, modifier: 19, damageType: 'fire', isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(false);
    expect(result.appliedDamage).toBe(result.rawTotal);
  });

  it('removing the Raging effect stops the resistance on the very next damage application', async () => {
    const activeRes = await pool.query<{ id: string }>(
      `SELECT id FROM active_effects WHERE character_id = $1 AND effect_definition_id = $2 AND removed_at IS NULL`,
      [plainCharacterId, ragingEffectDefinitionId],
    );
    expect(activeRes.rows).toHaveLength(1);
    await removeEffect(pool, dmUserId, activeRes.rows[0]!.id);

    const result = await applyDamage(pool, dmUserId, plainCharacterId, {
      diceSides: 4, diceCount: 1, modifier: 19, damageType: 'bludgeoning', isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(false);
    expect(result.appliedDamage).toBe(result.rawTotal);
  });

  it('a permanent resistance and a temporary one to the SAME type union without double-applying', async () => {
    await applyCharacterEffect(pool, dmUserId, piercingResistantCharacterId, { effectDefinitionId: ragingEffectDefinitionId, sourceType: 'manual' });

    const result = await applyDamage(pool, dmUserId, piercingResistantCharacterId, {
      diceSides: 4, diceCount: 1, modifier: 19, damageType: 'piercing', isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(true);
    // Halved exactly once, not twice, despite two independent sources both
    // granting resistance to the same type.
    expect(result.appliedDamage).toBe(Math.floor(result.rawTotal / 2));
  });

  it('a monster instance with an active Raging-granting effect resists bludgeoning damage the same way', async () => {
    const before = await pool.query<{ damage_resistances: string[] | null }>(
      `SELECT damage_resistances FROM monsters m JOIN monster_instances mi ON mi.monster_id = m.id WHERE mi.id = $1`,
      [monsterInstanceId],
    );
    expect(before.rows[0]!.damage_resistances ?? []).toEqual([]);

    await applyMonsterInstanceEffect(pool, dmUserId, monsterInstanceId, { effectDefinitionId: ragingEffectDefinitionId, sourceType: 'manual' });

    const result = await applyMonsterInstanceDamage(pool, dmUserId, monsterInstanceId, {
      diceSides: 4, diceCount: 1, modifier: 19, damageType: 'slashing', isCritical: false,
    });
    expect(result.breakdown.resistanceApplied).toBe(true);
    expect(result.appliedDamage).toBe(Math.floor(result.rawTotal / 2));
  });
});
