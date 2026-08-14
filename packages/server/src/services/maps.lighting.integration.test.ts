// Per-map lighting state (nav point 4) — 'bright' (default, fully visible
// to players), 'dim' (visible, distinct low-light rendering), 'dark'
// (players see only what their tokens' vision reaches; enforced server-side
// by sockets/broadcast.ts's buildFullStateSyncPayload via domain/vision.ts —
// see encounters.vision.integration.test.ts / broadcastVisibility.integration.test.ts
// for that filter itself — with VisionOverlay.tsx only rendering the fog
// shape over the already-filtered set the client received). Covers: the
// maps library's own create/update default/round-trip, and
// setMapLighting's persistence through the encounter's active_map_id
// resolution (same path getEncounterMap/formatMapForWire use). Throwaway
// campaign/encounter/map fixtures, same isolation convention as
// mapElements.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createEncounter, formatMapForWire, getEncounterMap, setMapLighting } from './encounters.js';
import { createMap, linkMapToEncounter, setActiveMap, updateMap } from './maps.js';

describe('per-map lighting (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let mapId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Lighting Test DM', 'x') RETURNING id`,
      [`lighting-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Lighting Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const map = await createMap(pool, campaignId, { name: 'Lighting Test Map' });
    mapId = map.id;
    const encounter = await createEncounter(pool, campaignId, { name: 'Lighting Test Encounter' });
    encounterId = encounter.id;
    await linkMapToEncounter(pool, encounterId, mapId);
    await setActiveMap(pool, encounterId, mapId);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it("a newly-created map defaults to 'bright'", async () => {
    const map = await getEncounterMap(pool, encounterId);
    expect(map!.lighting_state).toBe('bright');
    expect(formatMapForWire(map)!.lightingState).toBe('bright');
  });

  it('createMap accepts an explicit lightingState', async () => {
    const dark = await createMap(pool, campaignId, { name: 'Pre-Dark Map', lightingState: 'dark' });
    expect(dark.lighting_state).toBe('dark');
  });

  it('updateMap can change lightingState without touching other fields', async () => {
    const updated = await updateMap(pool, campaignId, mapId, { lightingState: 'dim' });
    expect(updated.lighting_state).toBe('dim');
    expect(updated.name).toBe('Lighting Test Map');
  });

  it("setMapLighting persists and round-trips through getEncounterMap/formatMapForWire", async () => {
    const { map } = await setMapLighting(pool, encounterId, 'dark');
    expect(map.lighting_state).toBe('dark');

    const refetched = await getEncounterMap(pool, encounterId);
    expect(refetched!.lighting_state).toBe('dark');
    expect(formatMapForWire(refetched)!.lightingState).toBe('dark');
  });

  it('setMapLighting bumps the encounter sync_seq (so a live client resyncs)', async () => {
    const before = await pool.query<{ sync_seq: number }>(`SELECT sync_seq FROM encounters WHERE id = $1`, [encounterId]);
    const { encounter } = await setMapLighting(pool, encounterId, 'bright');
    expect(encounter.sync_seq).toBeGreaterThan(before.rows[0]!.sync_seq);
  });
});
