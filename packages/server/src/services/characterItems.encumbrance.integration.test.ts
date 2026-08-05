// Integration test for the encumbrance derivation
// (docs/rules/inventory-and-attunement.md, dnd-rules agent):
// getCharacterEncumbrance sums ALL owned items (equipped or not) by
// quantity x weight_lb, and computeEncumbrance's thresholds/flags come
// through correctly end to end. Throwaway campaign/user/character
// fixtures; reads (never mutates) known-weight seeded catalog `items` rows.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addCharacterItem, getCharacterEncumbrance } from './characterItems.js';

describe('character encumbrance (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;
  let daggerId: string; // 1 lb
  let scaleMailId: string; // 45 lb

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Encumbrance Test DM', 'x') RETURNING id`,
      [`encumbrance-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Encumbrance Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    // STR 10 -> capacity 150 lb, encumbered >50 lb, heavily encumbered >100 lb.
    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Encumbrance Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;

    const daggerRes = await pool.query<{ id: string }>(`SELECT id FROM items WHERE name = 'Dagger' LIMIT 1`);
    if (!daggerRes.rows[0]) throw new Error('Expected seeded catalog item "Dagger" (1 lb)');
    daggerId = daggerRes.rows[0].id;

    const scaleMailRes = await pool.query<{ id: string }>(`SELECT id FROM items WHERE name = 'Scale Mail' LIMIT 1`);
    if (!scaleMailRes.rows[0]) throw new Error('Expected seeded catalog item "Scale Mail" (45 lb)');
    scaleMailId = scaleMailRes.rows[0].id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('zero items -> zero carried weight, neither flag set', async () => {
    const result = await getCharacterEncumbrance(pool, dmUserId, characterId);
    expect(result.carryCapacityLb).toBe(150);
    expect(result.totalCarriedLb).toBe(0);
    expect(result.encumbered).toBe(false);
    expect(result.heavilyEncumbered).toBe(false);
  });

  it('sums quantity x weight_lb across all owned items, equipped or not', async () => {
    await addCharacterItem(pool, dmUserId, characterId, { itemId: daggerId, quantity: 3, isEquipped: false, isAttuned: false });
    await addCharacterItem(pool, dmUserId, characterId, { itemId: scaleMailId, quantity: 1, isEquipped: true, isAttuned: false });

    // 3 * 1 + 1 * 45 = 48 lb -> under the 50 lb encumbered threshold.
    const result = await getCharacterEncumbrance(pool, dmUserId, characterId);
    expect(result.totalCarriedLb).toBe(48);
    expect(result.encumbered).toBe(false);
  });

  it('crossing the encumbered threshold flips the flag', async () => {
    await addCharacterItem(pool, dmUserId, characterId, { itemId: daggerId, quantity: 3, isEquipped: false, isAttuned: false });

    // 48 + 3 = 51 lb -> over the 50 lb threshold.
    const result = await getCharacterEncumbrance(pool, dmUserId, characterId);
    expect(result.totalCarriedLb).toBe(51);
    expect(result.encumbered).toBe(true);
    expect(result.heavilyEncumbered).toBe(false);
  });

  it('crossing the heavily-encumbered threshold flips both flags', async () => {
    await addCharacterItem(pool, dmUserId, characterId, { itemId: scaleMailId, quantity: 2, isEquipped: false, isAttuned: false });

    // 51 + 90 = 141 lb -> over the 100 lb heavily-encumbered threshold.
    const result = await getCharacterEncumbrance(pool, dmUserId, characterId);
    expect(result.totalCarriedLb).toBe(141);
    expect(result.encumbered).toBe(true);
    expect(result.heavilyEncumbered).toBe(true);
  });
});
