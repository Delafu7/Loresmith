// Integration test for the generic per-campaign category/tag system (Task
// 1's forward-looking schema for Task 2/3/5). Exercises find-or-create
// idempotency, attach/detach, and the entity_type mismatch guard — written
// against the 'creature' entity type only, but nothing here is creature-
// specific (see services/campaignCategories.ts's own header comment).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { findOrCreateCategory, attachCategory, detachCategory, listCategoriesForEntities, listCampaignCategories } from './campaignCategories.js';

describe('campaign categories (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  const entityId = '00000000-0000-0000-0000-000000000001'; // fake creature-entry id, no FK to satisfy

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Categories Test DM', 'x') RETURNING id`,
      [`categories-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Categories Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('find-or-create is idempotent by (campaign, entity_type, name)', async () => {
    const first = await findOrCreateCategory(pool, campaignId, 'creature', 'Undead', '#333', 'skull');
    const second = await findOrCreateCategory(pool, campaignId, 'creature', 'Undead', '#000', 'ignored');

    expect(second.id).toBe(first.id);
    expect(second.color).toBe('#333'); // color/icon only set on first creation, never overwritten

    const list = await listCampaignCategories(pool, campaignId, 'creature');
    expect(list.filter((c) => c.name === 'Undead')).toHaveLength(1);
  });

  it('the same name is a distinct row for a different entity_type', async () => {
    const creatureCat = await findOrCreateCategory(pool, campaignId, 'creature', 'Boss');
    const shopCat = await findOrCreateCategory(pool, campaignId, 'shop', 'Boss');
    expect(creatureCat.id).not.toBe(shopCat.id);
  });

  it('attach/detach round-trips through listCategoriesForEntities', async () => {
    const category = await findOrCreateCategory(pool, campaignId, 'creature', 'Recurring Villain');
    await attachCategory(pool, campaignId, 'creature', entityId, category.id);

    const byEntity = await listCategoriesForEntities(pool, 'creature', [entityId]);
    expect(byEntity.get(entityId)?.map((c) => c.name)).toContain('Recurring Villain');

    await detachCategory(pool, category.id, entityId);
    const afterDetach = await listCategoriesForEntities(pool, 'creature', [entityId]);
    expect(afterDetach.get(entityId)?.map((c) => c.name) ?? []).not.toContain('Recurring Villain');
  });

  it('rejects attaching a category whose entity_type does not match', async () => {
    const shopCategory = await findOrCreateCategory(pool, campaignId, 'shop', 'General Store');
    await expect(attachCategory(pool, campaignId, 'creature', entityId, shopCategory.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
