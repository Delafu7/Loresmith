// Integration test for wall movement blocking — proves the actual DB-backed
// wiring (loadMovementContext reading map_elements and feeding a Segment[]
// into MovementGrid.walls, consulted by movement.ts's computePathCost),
// not just the pure movement.ts unit tests (movement.test.ts already covers
// the wall-blocking algorithm itself in isolation with synthetic grids).
// Throwaway campaign/encounter/map fixtures, same isolation convention as
// encounters.movement.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter, setEncounterMode, setParticipantPosition, startEncounter } from './encounters.js';
import { createMap, linkMapToEncounter, setActiveMap } from './maps.js';
import { createMapElement } from './mapElements.js';

describe('wall movement blocking (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let moverParticipantId: string;
  let controlParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Movement Wall Test DM', 'x') RETURNING id`,
      [`movement-wall-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Movement Wall Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    async function makeCharacter(name: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
            armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
         RETURNING id`,
        [campaignId, dmUserId, name],
      );
      return res.rows[0]!.id;
    }
    const moverCharacterId = await makeCharacter('Wall Test Mover');
    const controlCharacterId = await makeCharacter('Wall Test Control');

    // Single-row corridor (rows: 1) — same "no diagonal detour possible"
    // trick movement.test.ts's own terrain tests use, so a full-height wall
    // segment provably blocks rather than just being routed around.
    const map = await createMap(pool, campaignId, { name: 'Wall Test Map', gridColumns: 10, gridRows: 1, feetPerCell: 5 });
    const encounter = await createEncounter(pool, campaignId, { name: 'Wall Test Encounter' });
    encounterId = encounter.id;
    await linkMapToEncounter(pool, encounterId, map.id);
    await setActiveMap(pool, encounterId, map.id);

    moverParticipantId = (await addParticipant(pool, encounterId, { characterId: moverCharacterId })).participant.id;
    controlParticipantId = (await addParticipant(pool, encounterId, { characterId: controlCharacterId })).participant.id;

    // Initial placement (from null,null) is always free, regardless of status/mode.
    await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 0, y: 0 }, 'dm');
    await setParticipantPosition(pool, encounterId, controlParticipantId, { x: 0, y: 0 }, 'dm');

    // A wall between column 4 and column 5 (x=4.5), spanning well past the
    // single row (y=-1..2) so there is no row for a diagonal detour to use.
    await createMapElement(pool, encounterId, { type: 'wall', x1: 4.5, y1: -1, x2: 4.5, y2: 2 });

    await setEncounterMode(pool, encounterId, { mode: 'combat' });
    await startEncounter(pool, encounterId);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a move that stays on the near side of the wall succeeds normally', async () => {
    // (0,0) -> (3,0): 3 cells * 5ft = 15ft, well within the 30ft budget, and never crosses x=4.5.
    const { participant } = await setParticipantPosition(pool, encounterId, controlParticipantId, { x: 3, y: 0 }, 'dm');
    expect(participant.pos_x).toBe(3);
    expect(participant.pos_y).toBe(0);
  });

  it('a move whose only path crosses the wall is rejected as BLOCKED_PATH, even though the ft budget alone would allow it', async () => {
    // (0,0) -> (6,0): 6 cells * 5ft = 30ft, exactly at budget — this would
    // succeed on ft-budget grounds alone; the wall at x=4.5 is what must
    // reject it, in a corridor with no detour available.
    await expect(
      setParticipantPosition(pool, encounterId, moverParticipantId, { x: 6, y: 0 }, 'dm'),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'BLOCKED_PATH' } });

    const row = await pool.query<{ pos_x: number; pos_y: number }>(
      `SELECT pos_x, pos_y FROM combat_participants WHERE id = $1`,
      [moverParticipantId],
    );
    expect(row.rows[0]).toMatchObject({ pos_x: 0, pos_y: 0 }); // never moved
  });

  it('a move that stays entirely on the near side of the wall for the mover still succeeds', async () => {
    const { participant } = await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 4, y: 0 }, 'dm');
    expect(participant.pos_x).toBe(4);
    expect(participant.pos_y).toBe(0);
  });
});
