// Regression test for the Iteration 3 minor sweep — updateCharacterAttack
// used to have no protection at all against ending up with both
// attackBonus and saveDc set (the DB CHECK constraint would reject it with
// a raw, unhandled Postgres error). Covers both layers: the schema's own
// .refine() (catches a single PATCH payload setting both fields at once)
// and the service's isCheckViolation catch (catches the payload only
// setting ONE field when the row already has the other set from a
// previous write — the case the schema-level refine can't see). Throwaway
// campaign/character fixtures, same isolation convention as
// characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addCharacterAttack, updateCharacterAttack } from './characterAttacks.js';
import { updateCharacterAttackSchema } from '../schemas/characterAttacks.js';
import { AppError } from '../middleware/errors.js';

describe('character attack mutual-exclusivity (attackBonus vs saveDc) (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CharAttacks Test DM', 'x') RETURNING id`,
      [`char-attacks-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CharAttacks Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'CharAttacks Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('updateCharacterAttackSchema rejects a single PATCH payload setting both fields', () => {
    const result = updateCharacterAttackSchema.safeParse({ name: 'Test', attackBonus: 5, saveDc: 12 });
    expect(result.success).toBe(false);
  });

  it('the service catches the DB check-violation when a PATCH sets only ONE field but the row already has the other', async () => {
    const attack = await addCharacterAttack(pool, dmUserId, characterId, {
      name: 'Longsword',
      attackBonus: 5,
      halfOnSave: true,
      sortOrder: 0,
    } as Parameters<typeof addCharacterAttack>[3]);

    // The payload alone (just saveDc) passes the schema's own .refine() —
    // attackBonus isn't present in THIS payload — but the row already has
    // attackBonus=5, so the resulting row would violate the DB constraint.
    await expect(
      updateCharacterAttack(pool, dmUserId, characterId, attack.id, { saveDc: 12 } as Parameters<typeof updateCharacterAttack>[4]),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Confirms it's a clean AppError, not a raw driver error leaking through.
    await expect(
      updateCharacterAttack(pool, dmUserId, characterId, attack.id, { saveDc: 12 } as Parameters<typeof updateCharacterAttack>[4]),
    ).rejects.toBeInstanceOf(AppError);

    const unchanged = await pool.query(`SELECT attack_bonus, save_dc FROM character_attacks WHERE id = $1`, [attack.id]);
    expect(unchanged.rows[0]!.attack_bonus).toBe(5);
    expect(unchanged.rows[0]!.save_dc).toBeNull();
  });

  it('clearing attackBonus first, then setting saveDc, succeeds', async () => {
    const attack = await addCharacterAttack(pool, dmUserId, characterId, {
      name: 'Fireball',
      attackBonus: 3,
      halfOnSave: true,
      sortOrder: 0,
    } as Parameters<typeof addCharacterAttack>[3]);

    await updateCharacterAttack(pool, dmUserId, characterId, attack.id, {
      attackBonus: null,
    } as Parameters<typeof updateCharacterAttack>[4]);
    const updated = await updateCharacterAttack(pool, dmUserId, characterId, attack.id, {
      saveDc: 15,
    } as Parameters<typeof updateCharacterAttack>[4]);
    expect(updated.attack_bonus).toBeNull();
    expect(updated.save_dc).toBe(15);
  });
});
