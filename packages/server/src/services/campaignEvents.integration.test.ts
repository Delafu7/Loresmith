// Integration test for Phase 3 "campaign calendar" (services/campaignEvents.ts)
// — DM-only write, all-member read, no redaction. Same throwaway
// campaign/user fixture convention as locations.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { createCampaignEvent, deleteCampaignEvent, listCampaignEvents, updateCampaignEvent } from './campaignEvents.js';

describe('campaignEvents (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Calendar Test DM', 'x') RETURNING id`,
      [`calendar-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Calendar Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a non-DM cannot create, update, or delete a campaign event', async () => {
    await expect(
      createCampaignEvent(pool, campaignId, 'player', { inGameDay: 1, title: 'Should fail' }),
    ).rejects.toBeInstanceOf(AppError);

    const event = await createCampaignEvent(pool, campaignId, 'dm', { inGameDay: 1, title: 'The party arrives in Phandalin' });
    await expect(updateCampaignEvent(pool, campaignId, event.id, 'player', { title: 'Nope' })).rejects.toBeInstanceOf(AppError);
    await expect(deleteCampaignEvent(pool, campaignId, event.id, 'player')).rejects.toBeInstanceOf(AppError);
  });

  it('creates, lists (all-member read, sorted by in_game_day), updates, and deletes an event', async () => {
    const later = await createCampaignEvent(pool, campaignId, 'dm', {
      inGameDay: 10,
      title: 'The bridge collapses',
      description: 'Cut off from town.',
    });
    const earlier = await createCampaignEvent(pool, campaignId, 'dm', { inGameDay: 2, title: 'First encounter with goblins' });

    const listed = await listCampaignEvents(pool, campaignId);
    const ids = listed.map((e) => e.id);
    expect(ids).toContain(later.id);
    expect(ids).toContain(earlier.id);
    expect(ids.indexOf(earlier.id)).toBeLessThan(ids.indexOf(later.id));

    const updated = await updateCampaignEvent(pool, campaignId, earlier.id, 'dm', { description: 'Ambushed on the road.' });
    expect(updated.description).toBe('Ambushed on the road.');
    expect(updated.title).toBe('First encounter with goblins');

    await deleteCampaignEvent(pool, campaignId, earlier.id, 'dm');
    const afterDelete = await listCampaignEvents(pool, campaignId);
    expect(afterDelete.map((e) => e.id)).not.toContain(earlier.id);
  });
});
