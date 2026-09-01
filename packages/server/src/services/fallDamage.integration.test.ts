// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — Falling. Fixture
// shape mirrors hide.integration.test.ts (encounter + seated participants,
// deterministic via extreme stats rather than mocked RNG) crossed with
// damage.rageResistance.integration.test.ts's damage_resistances/monster-
// instance setup (this test needs both a character AND a monster instance
// participant, to prove the character/monster-instance dispatch inside
// performFallDamage).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { performFallDamage } from './fallDamage.js';
import { createHomebrewMonster } from './monsterCatalog.js';

describe('performFallDamage (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let monsterCatalogId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Fall Test DM', 'x') RETURNING id`,
      [`fall-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Fall Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const monster = await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'Fall Test Beast', size: 'medium', creatureType: 'beast', armorClass: 12, hitPointAverage: 200,
      hitDice: '8d8+16', speed: { walk: 30 }, str: 16, dex: 12, con: 14, int: 4, wis: 10, cha: 6,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Slam', description: '1d4 bludgeoning.' }],
    });
    await pool.query(`INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2)`, [campaignId, monster.id]);
    monsterCatalogId = monster.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'Fall Test Encounter' });
    encounterId = encounter.id;
    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  async function seatFreshCharacter(name: string, hpMax: number, damageResistances: string[] = []): Promise<string> {
    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, damage_resistances)
       VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, $4, $4, $5)
       RETURNING id`,
      [campaignId, dmUserId, name, hpMax, damageResistances],
    );
    const { participant } = await addParticipant(pool, encounterId, { characterId: charRes.rows[0]!.id, initiativeRoll: 10 });
    return participant.id;
  }

  async function seatFreshMonsterInstance(): Promise<string> {
    const instanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, hp_current) VALUES ($1, $2, 200) RETURNING id`,
      [campaignId, monsterCatalogId],
    );
    const { participant } = await addParticipant(pool, encounterId, { monsterInstanceId: instanceRes.rows[0]!.id, initiativeRoll: 5 });
    return participant.id;
  }

  it('a 35 ft fall rolls 3d6 bludgeoning, reduces HP, and lands the target Prone', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (35 ft)', 200);
    const before = await pool.query<{ hp_current: number }>(
      `SELECT hp_current FROM characters WHERE id = (SELECT character_id FROM combat_participants WHERE id = $1)`,
      [participantId],
    );

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 35 });
    if ('pending' in result) throw new Error('unexpected pending result');

    expect(result.diceCount).toBe(3);
    expect(result.appliedDamage).toBeGreaterThanOrEqual(3);
    expect(result.appliedDamage).toBeLessThanOrEqual(18);
    expect(result.landedProne).toBe(true);
    expect(result.elevationFt).toBe(0); // clamped: started at 0

    const after = await pool.query<{ hp_current: number }>(
      `SELECT hp_current FROM characters WHERE id = (SELECT character_id FROM combat_participants WHERE id = $1)`,
      [participantId],
    );
    expect(after.rows[0]!.hp_current).toBe(before.rows[0]!.hp_current - result.appliedDamage);

    const proneRes = await pool.query(
      `SELECT ae.* FROM active_effects ae
       JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = (SELECT character_id FROM combat_participants WHERE id = $1)
         AND ed.name = 'Prone' AND ae.removed_at IS NULL`,
      [participantId],
    );
    expect(proneRes.rows).toHaveLength(1);
    expect(proneRes.rows[0]!.notes).toContain('Fell 35 ft');
  });

  it('a fall under 10 ft deals 0 dice, 0 damage, and no Prone', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (short fall)', 200);

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 5 });
    if ('pending' in result) throw new Error('unexpected pending result');

    expect(result.diceCount).toBe(0);
    expect(result.appliedDamage).toBe(0);
    expect(result.landedProne).toBe(false);

    const proneRes = await pool.query(
      `SELECT ae.* FROM active_effects ae
       JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.character_id = (SELECT character_id FROM combat_participants WHERE id = $1)
         AND ed.name = 'Prone' AND ae.removed_at IS NULL`,
      [participantId],
    );
    expect(proneRes.rows).toHaveLength(0);
  });

  it('elevation_ft tracks the landing height, clamped at 0', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (elevated)', 200);
    await pool.query(`UPDATE combat_participants SET elevation_ft = 50 WHERE id = $1`, [participantId]);

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 20 });
    if ('pending' in result) throw new Error('unexpected pending result');
    expect(result.elevationFt).toBe(30);

    const row = await pool.query<{ elevation_ft: number }>(`SELECT elevation_ft FROM combat_participants WHERE id = $1`, [participantId]);
    expect(row.rows[0]!.elevation_ft).toBe(30);
  });

  it('bludgeoning resistance halves the applied fall damage', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (resistant)', 200, ['bludgeoning']);

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 100 }); // 10d6
    if ('pending' in result) throw new Error('unexpected pending result');
    expect(result.diceCount).toBe(10);
    expect(result.appliedDamage).toBe(Math.floor(result.damage.rawTotal / 2));
  });

  it('a successful reaction save (halfOnSave) halves the fall damage', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (saved)', 200);

    const saveRes = await pool.query<{ id: string }>(
      `INSERT INTO dice_rolls (campaign_id, user_id, roll_type, d20_rolls, result_total)
       VALUES ($1, $2, 'saving_throw', ARRAY[20], 25) RETURNING id`,
      [campaignId, dmUserId],
    );

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, {
      distanceFt: 50, // 5d6
      saveDc: 15,
      savingThrowRollId: saveRes.rows[0]!.id,
    });
    if ('pending' in result) throw new Error('unexpected pending result');
    expect(result.damage.breakdown.savedHalved).toBe(true);
    expect(result.appliedDamage).toBe(Math.floor(result.damage.rawTotal / 2));
  });

  it('applies fall damage to a monster instance the same way as a character', async () => {
    const participantId = await seatFreshMonsterInstance();
    const before = await pool.query<{ hp_current: number }>(
      `SELECT hp_current FROM monster_instances WHERE id = (SELECT monster_instance_id FROM combat_participants WHERE id = $1)`,
      [participantId],
    );

    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 30 });
    if ('pending' in result) throw new Error('unexpected pending result');
    expect(result.diceCount).toBe(3);
    expect(result.characterId).toBeNull();
    expect(result.monsterInstanceId).not.toBeNull();
    expect(result.landedProne).toBe(true);

    const after = await pool.query<{ hp_current: number }>(
      `SELECT hp_current FROM monster_instances WHERE id = (SELECT monster_instance_id FROM combat_participants WHERE id = $1)`,
      [participantId],
    );
    expect(after.rows[0]!.hp_current).toBe(before.rows[0]!.hp_current - result.appliedDamage);

    const proneRes = await pool.query(
      `SELECT ae.* FROM active_effects ae
       JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
       WHERE ae.monster_instance_id = (SELECT monster_instance_id FROM combat_participants WHERE id = $1)
         AND ed.name = 'Prone' AND ae.removed_at IS NULL`,
      [participantId],
    );
    expect(proneRes.rows).toHaveLength(1);
  });

  it('a 200+ ft fall caps at 20d6', async () => {
    const participantId = await seatFreshCharacter('Fall Test PC (max fall)', 200);
    const result = await performFallDamage(pool, encounterId, participantId, dmUserId, { distanceFt: 500 });
    if ('pending' in result) throw new Error('unexpected pending result');
    expect(result.diceCount).toBe(20);
  });
});
