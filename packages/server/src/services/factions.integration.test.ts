// Integration test for Phase 3 "locations and factions" (services/factions.ts)
// — identical shape/authorization to services/locations.ts, see that file's
// own test for the fuller comment. Same throwaway fixture convention.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { createFaction, deleteFaction, listFactions, updateFaction } from './factions.js';

describe('factions (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Faction Test DM', 'x') RETURNING id`,
      [`faction-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Faction Test Campaign', $1, '2024') RETURNING id`,
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

  it('a non-DM cannot create, update, or delete a faction', async () => {
    await expect(createFaction(pool, campaignId, 'player', { name: 'Should fail' })).rejects.toBeInstanceOf(AppError);

    const faction = await createFaction(pool, campaignId, 'dm', { name: 'Harpers' });
    await expect(updateFaction(pool, campaignId, faction.id, 'player', { name: 'Nope' })).rejects.toBeInstanceOf(AppError);
    await expect(deleteFaction(pool, campaignId, faction.id, 'player')).rejects.toBeInstanceOf(AppError);
  });

  it('creates, lists (all-member read), updates, and deletes a faction', async () => {
    const faction = await createFaction(pool, campaignId, 'dm', {
      name: 'Zhentarim',
      description: 'A mercenary and trade coalition with a shady reputation.',
      notes: 'Secretly backed by the party\'s current patron.',
    });
    expect(faction.name).toBe('Zhentarim');

    const listedForPlayer = await listFactions(pool, campaignId);
    expect(listedForPlayer.map((f) => f.id)).toContain(faction.id);

    const updated = await updateFaction(pool, campaignId, faction.id, 'dm', { description: 'Openly hostile to the Harpers now.' });
    expect(updated.description).toBe('Openly hostile to the Harpers now.');
    expect(updated.notes).toBe('Secretly backed by the party\'s current patron.');

    await deleteFaction(pool, campaignId, faction.id, 'dm');
    const listedAfterDelete = await listFactions(pool, campaignId);
    expect(listedAfterDelete.map((f) => f.id)).not.toContain(faction.id);
  });
});
