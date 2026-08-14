// Server-side darkness vision filter (domain/vision.ts), exercised through
// buildFullStateSyncPayload itself — the actual security boundary for "a
// player client must not receive positions of creatures it cannot see."
// Complements encounters.vision.integration.test.ts (per-participant vision
// field plumbing) and maps.lighting.integration.test.ts (the lighting_state
// column itself) by covering what those don't: that the FULL_STATE_SYNC
// participant list a specific player VIEWER receives is actually filtered
// by range/line-of-sight/party membership under 'dark' lighting, stays
// unfiltered under 'bright', and that the DM always gets everyone.
// Throwaway campaign/encounter/map fixtures, same isolation convention as
// mapElements.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter, setMapLighting, setParticipantPosition, setParticipantVision } from '../services/encounters.js';
import { createMap, linkMapToEncounter, setActiveMap } from '../services/maps.js';
import { createMapElement } from '../services/mapElements.js';
import { buildFullStateSyncPayload } from './broadcast.js';

describe('buildFullStateSyncPayload darkness vision filter (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let encounterId: string;
  let mapId: string;

  let pcParticipantId: string;
  let allyParticipantId: string;
  let visibleEnemyParticipantId: string;
  let farEnemyParticipantId: string;
  let blockedEnemyParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Vision Filter Test DM', 'x') RETURNING id`,
      [`vision-filter-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Vision Filter Test Player', 'x') RETURNING id`,
      [`vision-filter-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Vision Filter Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    async function makeCharacter(name: string, isPc: boolean, ownerUserId: string | null): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, $2, $3, $4, $5, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
         RETURNING id`,
        [campaignId, isPc, ownerUserId, dmUserId, name],
      );
      return res.rows[0]!.id;
    }

    const pcCharacterId = await makeCharacter('Viewer PC', true, playerUserId);
    const allyCharacterId = await makeCharacter('Distant Party Ally', true, null);
    const visibleEnemyCharacterId = await makeCharacter('Nearby Goblin', false, null);
    const farEnemyCharacterId = await makeCharacter('Far-off Goblin', false, null);
    const blockedEnemyCharacterId = await makeCharacter('Goblin Behind The Wall', false, null);

    const map = await createMap(pool, campaignId, { name: 'Vision Filter Test Map', feetPerCell: 5, lightingState: 'bright' });
    mapId = map.id;
    const encounter = await createEncounter(pool, campaignId, { name: 'Vision Filter Test Encounter' });
    encounterId = encounter.id;
    await linkMapToEncounter(pool, encounterId, mapId);
    await setActiveMap(pool, encounterId, mapId);

    pcParticipantId = (await addParticipant(pool, encounterId, { characterId: pcCharacterId })).participant.id;
    allyParticipantId = (await addParticipant(pool, encounterId, { characterId: allyCharacterId })).participant.id;
    visibleEnemyParticipantId = (await addParticipant(pool, encounterId, { characterId: visibleEnemyCharacterId })).participant.id;
    farEnemyParticipantId = (await addParticipant(pool, encounterId, { characterId: farEnemyCharacterId })).participant.id;
    blockedEnemyParticipantId = (await addParticipant(pool, encounterId, { characterId: blockedEnemyCharacterId })).participant.id;

    // Encounter stays 'preparing' throughout (never started), so
    // setParticipantPosition's movement validation is a no-op and every
    // placement below is free, unbudgeted token placement.
    await setParticipantPosition(pool, encounterId, pcParticipantId, { x: 0, y: 0 }, 'dm');
    await setParticipantPosition(pool, encounterId, allyParticipantId, { x: 1000, y: 1000 }, 'dm'); // far outside any vision range
    await setParticipantPosition(pool, encounterId, visibleEnemyParticipantId, { x: 4, y: 0 }, 'dm'); // 20ft away, unobstructed
    await setParticipantPosition(pool, encounterId, farEnemyParticipantId, { x: 100, y: 0 }, 'dm'); // 500ft away, beyond range
    await setParticipantPosition(pool, encounterId, blockedEnemyParticipantId, { x: 0, y: 4 }, 'dm'); // 20ft away, but behind a wall

    await setParticipantVision(pool, encounterId, pcParticipantId, { visionEnabled: true, visionRadiusFt: 30, darkvisionRadiusFt: 0 });

    // A wall crossing the straight line from the PC (0,0) to the "blocked"
    // enemy (0,4) at (0,2), but nowhere near the PC -> visible enemy line.
    await createMapElement(pool, encounterId, { type: 'wall', x1: -5, y1: 2, x2: 5, y2: 2 });
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
    await pool.end();
  });

  function participantIds(payload: Awaited<ReturnType<typeof buildFullStateSyncPayload>>): string[] {
    return (payload.participants as { participantId: string }[]).map((p) => p.participantId);
  }

  it('under bright lighting, a player sees every participant regardless of range or walls', async () => {
    const payload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', playerUserId);
    expect(participantIds(payload).sort()).toEqual(
      [pcParticipantId, allyParticipantId, visibleEnemyParticipantId, farEnemyParticipantId, blockedEnemyParticipantId].sort(),
    );
  });

  it('under dark lighting, a player only sees their own PC, the always-visible party, and in-range/unobstructed enemies', async () => {
    await setMapLighting(pool, encounterId, 'dark');
    const payload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', playerUserId);
    const ids = participantIds(payload);

    expect(ids).toContain(pcParticipantId);
    expect(ids).toContain(allyParticipantId); // own party always visible, regardless of range
    expect(ids).toContain(visibleEnemyParticipantId); // in range, unobstructed
    expect(ids).not.toContain(farEnemyParticipantId); // beyond vision range
    expect(ids).not.toContain(blockedEnemyParticipantId); // in range, but a wall blocks line of sight
  });

  it('under dark lighting, the DM still receives every participant, unfiltered', async () => {
    const payload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'dm', dmUserId);
    expect(participantIds(payload).sort()).toEqual(
      [pcParticipantId, allyParticipantId, visibleEnemyParticipantId, farEnemyParticipantId, blockedEnemyParticipantId].sort(),
    );
  });

  it('a player with no seated character of their own sees only the always-visible party, under dark lighting', async () => {
    const spectatorRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Vision Filter Test Spectator', 'x') RETURNING id`,
      [`vision-filter-spectator-${Date.now()}@example.test`],
    );
    const spectatorUserId = spectatorRes.rows[0]!.id;
    try {
      const payload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', spectatorUserId);
      // Both party-faction participants (the PC and the distant ally) are
      // always visible, even to a viewer who doesn't own either of them —
      // only the enemies require an owned, in-range, unobstructed viewer.
      expect(participantIds(payload).sort()).toEqual([pcParticipantId, allyParticipantId].sort());
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [spectatorUserId]);
    }
  });
});
