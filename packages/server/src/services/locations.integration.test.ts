// Integration test for Phase 3 "locations and factions" (services/locations.ts)
// — DM-only write, DM hide/reveal (role_split, services/visibility.ts):
// created hidden by default, filtered out of a non-DM listLocations call
// until the DM reveals it. Same throwaway campaign/user fixture convention as
// plotThreads.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { createLocation, deleteLocation, listLocations, updateLocation } from './locations.js';

describe('locations (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Location Test DM', 'x') RETURNING id`,
      [`location-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Location Test Campaign', $1, '2024') RETURNING id`,
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

  it('a non-DM cannot create, update, or delete a location', async () => {
    await expect(createLocation(pool, campaignId, 'player', { name: 'Should fail' })).rejects.toBeInstanceOf(AppError);

    const location = await createLocation(pool, campaignId, 'dm', { name: 'Waterdeep' });
    await expect(updateLocation(pool, campaignId, location.id, 'player', { name: 'Nope' })).rejects.toBeInstanceOf(AppError);
    await expect(deleteLocation(pool, campaignId, location.id, 'player')).rejects.toBeInstanceOf(AppError);
  });

  it('creates, lists (DM-only hide/reveal), updates, and deletes a location', async () => {
    const location = await createLocation(pool, campaignId, 'dm', {
      name: 'The Yawning Portal',
      description: 'A tavern built around a portal to Undermountain.',
      notes: 'Durnan runs the place.',
    });
    expect(location.name).toBe('The Yawning Portal');
    expect(location.visible_to_players).toBe(false);

    const listedForDm = await listLocations(pool, campaignId, 'dm');
    expect(listedForDm.map((l) => l.id)).toContain(location.id);

    const listedForPlayerHidden = await listLocations(pool, campaignId, 'player');
    expect(listedForPlayerHidden.map((l) => l.id)).not.toContain(location.id);

    const updated = await updateLocation(pool, campaignId, location.id, 'dm', {
      notes: 'Durnan runs the place. Trapdoor to level 1.',
      visibleToPlayers: true,
    });
    expect(updated.notes).toBe('Durnan runs the place. Trapdoor to level 1.');
    expect(updated.description).toBe('A tavern built around a portal to Undermountain.');
    expect(updated.visible_to_players).toBe(true);

    const listedForPlayerRevealed = await listLocations(pool, campaignId, 'player');
    expect(listedForPlayerRevealed.map((l) => l.id)).toContain(location.id);

    await deleteLocation(pool, campaignId, location.id, 'dm');
    const listedAfterDelete = await listLocations(pool, campaignId, 'dm');
    expect(listedAfterDelete.map((l) => l.id)).not.toContain(location.id);
  });
});
