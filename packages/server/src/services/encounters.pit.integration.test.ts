// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) —
// proves the actual wiring (loadMovementContext's new pit_depth_ft read,
// feeding computeValidatedMoveCost's pitTriggered report), not just the
// pure movement.ts cost math (movement.test.ts already covers "a pit cell
// costs normal movement" in isolation). Same "no cheaper diagonal detour"
// single-row corridor trick as encounters.incapacitatedOccupancy.integration.
// test.ts. Throwaway campaign/encounter fixtures, same isolation convention.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  setEncounterMode,
  setParticipantPosition,
  startEncounter,
  upsertEncounterMap,
  upsertMapCellOverride,
} from './encounters.js';

describe('pit-trigger reporting on move (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let moverParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Pit Test DM', 'x') RETURNING id`,
      [`pit-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Pit Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Pit Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterId = characterRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'Pit Test Encounter' });
    encounterId = encounter.id;
    await upsertEncounterMap(pool, encounterId, { gridColumns: 3, gridRows: 1, feetPerCell: 5 });
    await upsertMapCellOverride(pool, encounterId, 1, 0, { costType: 'pit', pitDepthFt: 20 });

    const { participant: mover } = await addParticipant(pool, encounterId, { characterId });
    moverParticipantId = mover.id;
    await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 0, y: 0 }, 'dm');

    await setEncounterMode(pool, encounterId, { mode: 'combat' });
    await startEncounter(pool, encounterId);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('moving onto a pit cell costs normal movement AND reports pitTriggered with its depth', async () => {
    const result = await setParticipantPosition(pool, encounterId, moverParticipantId, { x: 1, y: 0 }, 'dm');
    expect(result.participant.movement_used_ft).toBe(5); // normal cost, not doubled
    expect(result.pitTriggered).toEqual({ depthFt: 20 });
  });

  it('a move that does NOT land on the pit cell reports pitTriggered: null', async () => {
    // Fresh mover seat so pos_x/movement_used_ft start over.
    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Pit Test PC Two', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const { participant: secondMover } = await addParticipant(pool, encounterId, { characterId: characterRes.rows[0]!.id, initiativeRoll: 1 });
    await pool.query(`UPDATE encounters SET current_turn_index = $1 WHERE id = $2`, [secondMover.turn_order, encounterId]);

    const placed = await setParticipantPosition(pool, encounterId, secondMover.id, { x: 2, y: 0 }, 'dm');
    expect(placed.pitTriggered).toBeNull(); // initial placement (pos was null) — no validation performed at all

    // A same-cell "move" onto a cell with no override still exercises
    // computeValidatedMoveCost's destination lookup end-to-end (unlike the
    // initial placement above, which short-circuits before ever reading
    // grid.overrides) and confirms an ordinary cell reports null.
    const noMove = await setParticipantPosition(pool, encounterId, secondMover.id, { x: 2, y: 0 }, 'dm');
    expect(noMove.pitTriggered).toBeNull();
  });
});
