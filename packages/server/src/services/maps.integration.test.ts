// Integration test for the campaign-scoped map library
// (1784269788666_create-campaign-maps-library.ts): CRUD over `maps`, the
// N:M link/unlink/activate actions, and that reusing one map across two
// encounters actually works (the whole point of promoting maps out of the
// old 1:1 encounter_maps embedding). Throwaway campaign/user/encounter
// fixtures, same isolation convention as encounters.visibility.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import {
  createMap,
  deleteMap,
  getMap,
  linkMapToEncounter,
  listMaps,
  listMapsForEncounter,
  setActiveMap,
  unlinkMapFromEncounter,
  updateMap,
} from './maps.js';

describe('campaign map library (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let otherCampaignId: string;
  let encounterAId: string;
  let encounterBId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Maps Test DM', 'x') RETURNING id`,
      [`maps-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Maps Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Maps Test Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    otherCampaignId = otherCampaignRes.rows[0]!.id;

    const encounterARes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Room A', 'preparing') RETURNING id`,
      [campaignId],
    );
    encounterAId = encounterARes.rows[0]!.id;
    const encounterBRes = await pool.query<{ id: string }>(
      `INSERT INTO encounters (campaign_id, name, status) VALUES ($1, 'Room B', 'preparing') RETURNING id`,
      [campaignId],
    );
    encounterBId = encounterBRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      await pool.end();
    }
  });

  it('creates, lists, gets, updates, and deletes a map', async () => {
    const map = await createMap(pool, campaignId, { name: 'The Sunless Vale — Entrance', gridColumns: 15, gridRows: 12 });
    expect(map.campaign_id).toBe(campaignId);
    expect(map.grid_columns).toBe(15);

    const list = await listMaps(pool, campaignId);
    expect(list.map((m) => m.id)).toContain(map.id);

    const fetched = await getMap(pool, campaignId, map.id);
    expect(fetched.name).toBe('The Sunless Vale — Entrance');

    const updated = await updateMap(pool, campaignId, map.id, { name: 'The Sunless Vale — Entrance Hall', notes: 'Trapdoor under the rug' });
    expect(updated.name).toBe('The Sunless Vale — Entrance Hall');
    expect(updated.notes).toBe('Trapdoor under the rug');
    // Untouched fields survive a partial update.
    expect(updated.grid_columns).toBe(15);

    await deleteMap(pool, campaignId, map.id);
    await expect(getMap(pool, campaignId, map.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects fetching a map that belongs to a different campaign', async () => {
    const map = await createMap(pool, campaignId, { name: 'Cross-campaign test map' });
    await expect(getMap(pool, otherCampaignId, map.id)).rejects.toBeInstanceOf(AppError);
  });

  it('reuses one map across two encounters (the point of the N:M library)', async () => {
    const map = await createMap(pool, campaignId, { name: 'Shared Dungeon Map', gridColumns: 20, gridRows: 20 });

    const resultA = await setActiveMap(pool, encounterAId, map.id);
    expect(resultA.map?.id).toBe(map.id);
    const resultB = await setActiveMap(pool, encounterBId, map.id);
    expect(resultB.map?.id).toBe(map.id);

    const linkedToA = await listMapsForEncounter(pool, encounterAId);
    const linkedToB = await listMapsForEncounter(pool, encounterBId);
    expect(linkedToA.map((m) => m.id)).toContain(map.id);
    expect(linkedToB.map((m) => m.id)).toContain(map.id);

    const encounterARow = await pool.query<{ active_map_id: string }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterAId]);
    const encounterBRow = await pool.query<{ active_map_id: string }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterBId]);
    expect(encounterARow.rows[0]!.active_map_id).toBe(map.id);
    expect(encounterBRow.rows[0]!.active_map_id).toBe(map.id);
  });

  it('linkMapToEncounter attaches without activating; setActiveMap auto-links', async () => {
    const map = await createMap(pool, campaignId, { name: 'Pre-linked room' });
    await linkMapToEncounter(pool, encounterAId, map.id);

    const linked = await listMapsForEncounter(pool, encounterAId);
    expect(linked.map((m) => m.id)).toContain(map.id);

    const encounterRow = await pool.query<{ active_map_id: string | null }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterAId]);
    expect(encounterRow.rows[0]!.active_map_id).not.toBe(map.id); // linked, not activated

    const anotherMap = await createMap(pool, campaignId, { name: 'Auto-link test map' });
    await setActiveMap(pool, encounterAId, anotherMap.id);
    const linkedAfterActivate = await listMapsForEncounter(pool, encounterAId);
    expect(linkedAfterActivate.map((m) => m.id)).toContain(anotherMap.id); // auto-linked by setActiveMap
  });

  it('setActiveMap rejects a map from a different campaign', async () => {
    const otherMap = await createMap(pool, otherCampaignId, { name: 'Wrong campaign map' });
    await expect(setActiveMap(pool, encounterAId, otherMap.id)).rejects.toBeInstanceOf(AppError);
  });

  it('unlinking the active map clears active_map_id and returns a result to broadcast', async () => {
    const map = await createMap(pool, campaignId, { name: 'Unlink-active test map' });
    await setActiveMap(pool, encounterAId, map.id);

    const result = await unlinkMapFromEncounter(pool, encounterAId, map.id);
    expect(result).not.toBeNull();
    expect(result!.map).toBeNull();

    const encounterRow = await pool.query<{ active_map_id: string | null }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterAId]);
    expect(encounterRow.rows[0]!.active_map_id).toBeNull();

    const linked = await listMapsForEncounter(pool, encounterAId);
    expect(linked.map((m) => m.id)).not.toContain(map.id);
  });

  it('unlinking a non-active map returns null (nothing live-visible changed)', async () => {
    const activeMap = await createMap(pool, campaignId, { name: 'Stays active' });
    const otherMap = await createMap(pool, campaignId, { name: 'Just linked, not active' });
    await setActiveMap(pool, encounterAId, activeMap.id);
    await linkMapToEncounter(pool, encounterAId, otherMap.id);

    const result = await unlinkMapFromEncounter(pool, encounterAId, otherMap.id);
    expect(result).toBeNull();

    const encounterRow = await pool.query<{ active_map_id: string | null }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterAId]);
    expect(encounterRow.rows[0]!.active_map_id).toBe(activeMap.id); // untouched
  });

  it('deleting a linked/active map clears the pointer via ON DELETE SET NULL (no blocking guard)', async () => {
    const map = await createMap(pool, campaignId, { name: 'Delete-while-active test map' });
    await setActiveMap(pool, encounterAId, map.id);

    await deleteMap(pool, campaignId, map.id);

    const encounterRow = await pool.query<{ active_map_id: string | null }>(`SELECT active_map_id FROM encounters WHERE id = $1`, [encounterAId]);
    expect(encounterRow.rows[0]!.active_map_id).toBeNull();
  });
});
