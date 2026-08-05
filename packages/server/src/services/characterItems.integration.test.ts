// Integration test for character_items, focused on the attunement 3-item
// limit (docs/rules/inventory-and-attunement.md, dnd-rules agent): the hard
// cap must hold both on create (an item added already-attuned) and on
// update (attuning an existing row), a redundant true->true patch on an
// already-attuned row must never self-block, and un-attuning frees a slot
// immediately. Throwaway campaign/user/character fixtures; reads (never
// mutates) a handful of existing seeded catalog `items` rows as read-only
// FK targets, same "reference the seed data, don't duplicate it" precedent
// as spellSlots.multiclass.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { addCharacterItem, updateCharacterItem } from './characterItems.js';

describe('character item attunement limit (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string;
  let itemIds: string[];

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Attunement Test DM', 'x') RETURNING id`,
      [`attunement-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Attunement Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Attunement Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;

    const itemsRes = await pool.query<{ id: string }>(`SELECT id FROM items ORDER BY id LIMIT 4`);
    if (itemsRes.rows.length < 4) throw new Error('Expected at least 4 seeded catalog items');
    itemIds = itemsRes.rows.map((r) => r.id);
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('allows attuning up to 3 items, then rejects a 4th on create', async () => {
    const { item: item1 } = await addCharacterItem(pool, dmUserId, characterId, {
      itemId: itemIds[0]!, quantity: 1, isEquipped: false, isAttuned: true,
    });
    const { item: item2 } = await addCharacterItem(pool, dmUserId, characterId, {
      itemId: itemIds[1]!, quantity: 1, isEquipped: false, isAttuned: true,
    });
    const { item: item3 } = await addCharacterItem(pool, dmUserId, characterId, {
      itemId: itemIds[2]!, quantity: 1, isEquipped: false, isAttuned: true,
    });
    expect([item1.is_attuned, item2.is_attuned, item3.is_attuned]).toEqual([true, true, true]);

    await expect(
      addCharacterItem(pool, dmUserId, characterId, { itemId: itemIds[3]!, quantity: 1, isEquipped: false, isAttuned: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      addCharacterItem(pool, dmUserId, characterId, { itemId: itemIds[3]!, quantity: 1, isEquipped: false, isAttuned: true }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects attuning a 4th item via update once at the cap', async () => {
    const { item: unattuned } = await addCharacterItem(pool, dmUserId, characterId, {
      itemId: itemIds[3]!, quantity: 1, isEquipped: false, isAttuned: false,
    });

    await expect(
      updateCharacterItem(pool, dmUserId, characterId, unattuned.id, { isAttuned: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a redundant true->true patch on an already-attuned row never self-blocks', async () => {
    const listRes = await pool.query<{ id: string }>(
      `SELECT id FROM character_items WHERE character_id = $1 AND is_attuned = true LIMIT 1`,
      [characterId],
    );
    const attunedId = listRes.rows[0]!.id;

    const { item } = await updateCharacterItem(pool, dmUserId, characterId, attunedId, { isAttuned: true, notes: 'still attuned' });
    expect(item.is_attuned).toBe(true);
    expect(item.notes).toBe('still attuned');
  });

  it('un-attuning frees a slot immediately, allowing a previously-blocked attune to succeed', async () => {
    const attunedRes = await pool.query<{ id: string }>(
      `SELECT id FROM character_items WHERE character_id = $1 AND is_attuned = true ORDER BY acquired_at LIMIT 1`,
      [characterId],
    );
    const toUnattune = attunedRes.rows[0]!.id;

    await updateCharacterItem(pool, dmUserId, characterId, toUnattune, { isAttuned: false });

    const stillUnattunedRes = await pool.query<{ id: string }>(
      `SELECT id FROM character_items WHERE character_id = $1 AND is_attuned = false LIMIT 1`,
      [characterId],
    );
    const toAttune = stillUnattunedRes.rows[0]!.id;

    const { item } = await updateCharacterItem(pool, dmUserId, characterId, toAttune, { isAttuned: true });
    expect(item.is_attuned).toBe(true);
  });
});
