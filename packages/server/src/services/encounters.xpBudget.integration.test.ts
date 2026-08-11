// Integration test for Phase 3 "encounter XP budgeting" (services/encounters.ts's
// getEncounterXpBudget) — proves the real wiring (character-level lookup via
// character_classes, monster xp_value via the catalog join, campaign
// srd_edition dispatch) against the pure domain/xpBudget.ts module already
// covered in isolation by xpBudget.test.ts. Throwaway campaign/character/
// monster-instance/encounter fixtures, same isolation convention as
// characters.applyDamage.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { assessEncounterXp } from '../domain/xpBudget.js';
import { getEncounterXpBudget } from './encounters.js';

describe('getEncounterXpBudget (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let classId: string;
  let monsterId: string;
  let monsterXpValue: number;
  let characterAId: string; // level 3
  let characterBId: string; // level 2
  let monsterInstanceId: string;
  let encounterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'XP Budget Test DM', 'x') RETURNING id`,
      [`xp-budget-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('XP Budget Test Campaign', $1, '2014') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const classRes = await pool.query<{ id: string }>(`SELECT id FROM classes LIMIT 1`);
    classId = classRes.rows[0]!.id;

    const monsterRes = await pool.query<{ id: string; xp_value: number }>(`SELECT id, xp_value FROM monsters LIMIT 1`);
    monsterId = monsterRes.rows[0]!.id;
    monsterXpValue = monsterRes.rows[0]!.xp_value;

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'XP Budget PC A', 10, 10, 10, 10, 10, 10, 12, 30, 20, 20)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterAId = charARes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 3)`, [characterAId, classId]);

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'XP Budget PC B', 10, 10, 10, 10, 10, 10, 12, 30, 15, 15)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterBId = charBRes.rows[0]!.id;
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 2)`, [characterBId, classId]);

    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 10) RETURNING id`,
      [campaignId, monsterId],
    );
    monsterInstanceId = instanceRes.rows[0]!.id;

    const encounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name) VALUES ($1, 'XP Budget Test Encounter') RETURNING id`,
      [campaignId],
    );
    encounterId = encounterRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 10, 0)`,
      [encounterId, characterAId],
    );
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, character_id, initiative_roll, turn_order) VALUES ($1, $2, 8, 1)`,
      [encounterId, characterBId],
    );
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, monster_instance_id, initiative_roll, turn_order) VALUES ($1, $2, 15, 2)`,
      [encounterId, monsterInstanceId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('resolves party levels from character_classes and monster XP from the catalog join', async () => {
    const result = await getEncounterXpBudget(pool, campaignId, encounterId);
    expect(result.edition).toBe('2014');

    // Cross-check against the pure function directly with the known inputs
    // (levels 3 and 2, one monster at the catalog's real xp_value) — proves
    // the service's DB wiring produced the exact same inputs, not just "some
    // plausible-looking result."
    const expected = assessEncounterXp('2014', [3, 2], [{ xpValue: monsterXpValue, quantity: 1 }]);
    expect(result).toEqual(expected);
  });

  it('throws a validation error when the encounter has no character participants', async () => {
    const emptyEncounterRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name) VALUES ($1, 'XP Budget Empty Encounter') RETURNING id`,
      [campaignId],
    );
    const emptyEncounterId = emptyEncounterRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO combat_participants (encounter_id, monster_instance_id, initiative_roll, turn_order) VALUES ($1, $2, 5, 0)`,
      [emptyEncounterId, monsterInstanceId],
    );

    await expect(getEncounterXpBudget(pool, campaignId, emptyEncounterId)).rejects.toBeInstanceOf(AppError);
  });
});
