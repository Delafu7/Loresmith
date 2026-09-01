// docs/roadmap/dnd-2024-gap-analysis.md P1-13 (Hide) — rollDice's own
// "an attack roll ends Invisible" side effect (services/diceRolls.ts's
// rollDice, see its header comment). Uses the real seeded "Invisible"
// effect_definition rather than a throwaway homebrew one, same "double as an
// integration check the seed is wired correctly" precedent as
// damage.rageResistance.integration.test.ts. Throwaway campaign/character/
// monster-instance fixtures, same isolation convention as that file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { rollDice } from './diceRolls.js';
import { applyCharacterEffect, applyMonsterInstanceEffect } from './effects.js';

describe('rollDice clears an active Invisible effect on an attack roll (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;
  let monsterInstanceId: string;
  let invisibleEffectDefinitionId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'ClearInvisible Test DM', 'x') RETURNING id`,
      [`clear-invisible-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('ClearInvisible Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'ClearInvisible Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = charRes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'ClearInvisible Test Beast', '2024', 'Medium', 'beast', 12, 10, '2d8', '{"walk":30}',
               10, 10, 10, 4, 10, 6, 1, 200, '[]'::jsonb)
       RETURNING id`,
      [`clear-invisible-monster-${suffix}`],
    );
    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterCatalogRes.rows[0]!.id],
    );
    monsterInstanceId = instanceRes.rows[0]!.id;

    const invisibleRes = await pool.query<{ id: string }>(`SELECT id FROM effect_definitions WHERE name = 'Invisible' AND is_homebrew = false`);
    if (!invisibleRes.rows[0]) throw new Error("Expected a seeded 'Invisible' effect_definitions row for this test");
    invisibleEffectDefinitionId = invisibleRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('an attack roll for a character with an active Invisible effect clears it', async () => {
    await applyCharacterEffect(pool, dmUserId, characterId, { effectDefinitionId: invisibleEffectDefinitionId, sourceType: 'manual' });

    const roll = await rollDice(pool, campaignId, dmUserId, 'dm', {
      rollType: 'attack', rollContext: 'Test Attack', keep: 'normal', modifier: 0, diceSides: 20, diceCount: 1,
      characterId, visibility: 'public',
    });

    expect(roll.clearedInvisibleEffect).not.toBeNull();
    expect(roll.clearedInvisibleEffect!.effect_definition_name).toBe('Invisible');

    const activeRes = await pool.query(
      `SELECT id FROM active_effects WHERE character_id = $1 AND effect_definition_id = $2 AND removed_at IS NULL`,
      [characterId, invisibleEffectDefinitionId],
    );
    expect(activeRes.rows).toHaveLength(0);
  });

  it('a non-attack roll (e.g. a skill check) leaves an active Invisible effect untouched', async () => {
    await applyCharacterEffect(pool, dmUserId, characterId, { effectDefinitionId: invisibleEffectDefinitionId, sourceType: 'manual' });

    const roll = await rollDice(pool, campaignId, dmUserId, 'dm', {
      rollType: 'skill_check', rollContext: 'Test Check', keep: 'normal', modifier: 0, diceSides: 20, diceCount: 1,
      characterId, visibility: 'public',
    });

    expect(roll.clearedInvisibleEffect).toBeUndefined();

    const activeRes = await pool.query(
      `SELECT id FROM active_effects WHERE character_id = $1 AND effect_definition_id = $2 AND removed_at IS NULL`,
      [characterId, invisibleEffectDefinitionId],
    );
    expect(activeRes.rows).toHaveLength(1);

    await pool.query(`UPDATE active_effects SET removed_at = now() WHERE character_id = $1 AND removed_at IS NULL`, [characterId]);
  });

  it('an attack roll with no active Invisible effect is a no-op (clearedInvisibleEffect stays undefined)', async () => {
    const roll = await rollDice(pool, campaignId, dmUserId, 'dm', {
      rollType: 'attack', rollContext: 'Test Attack', keep: 'normal', modifier: 0, diceSides: 20, diceCount: 1,
      characterId, visibility: 'public',
    });
    expect(roll.clearedInvisibleEffect).toBeUndefined();
  });

  it('an attack roll for a monster instance with an active Invisible effect clears it too', async () => {
    await applyMonsterInstanceEffect(pool, dmUserId, monsterInstanceId, { effectDefinitionId: invisibleEffectDefinitionId, sourceType: 'manual' });

    const roll = await rollDice(pool, campaignId, dmUserId, 'dm', {
      rollType: 'attack', rollContext: 'Test Attack', keep: 'normal', modifier: 0, diceSides: 20, diceCount: 1,
      monsterInstanceId, visibility: 'public',
    });

    expect(roll.clearedInvisibleEffect).not.toBeNull();

    const activeRes = await pool.query(
      `SELECT id FROM active_effects WHERE monster_instance_id = $1 AND effect_definition_id = $2 AND removed_at IS NULL`,
      [monsterInstanceId, invisibleEffectDefinitionId],
    );
    expect(activeRes.rows).toHaveLength(0);
  });
});
