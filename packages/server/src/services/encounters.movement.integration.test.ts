// Integration test for REFACTOR-PLAN.md §4's server-side movement
// enforcement — proves the actual wiring (setParticipantPosition against a
// live encounter/map/participant), not just the pure movement.ts functions
// (movement.test.ts already covers those in isolation). Throwaway campaign/
// encounter fixtures, same isolation convention as
// monsters.uniqueness.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  setParticipantPosition,
  startEncounter,
  upsertEncounterMap,
} from './encounters.js';

describe('setParticipantPosition movement enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let campaignId: number;
  let characterId: number;
  let encounterId: number;
  let participantId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Movement Test DM', 'x') RETURNING id`,
      [`movement-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Movement Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    // speed 30 ft — the exact figure docs/rules/movement.md's dash worked
    // example uses, so a boundary of "30 ft accepted, more rejected" reads
    // directly against that doc.
    const characterRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Movement Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = characterRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'Movement Test Encounter' });
    encounterId = encounter.id;
    await upsertEncounterMap(pool, encounterId, { gridColumns: 20, gridRows: 20, feetPerCell: 5 });

    const { participant } = await addParticipant(pool, encounterId, { characterId });
    participantId = participant.id;

    // Initial placement (from null,null) is always free, regardless of
    // encounter status — this is the "unplaced -> drop at a starting cell"
    // path, not a validated move.
    await setParticipantPosition(pool, encounterId, participantId, { x: 0, y: 0 });
    await startEncounter(pool, encounterId);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('rejects a move exceeding remaining speed, with a machine-readable reason, and does not move the token', async () => {
    // 7 cells * 5 ft = 35 ft > 30 ft budget.
    await expect(
      setParticipantPosition(pool, encounterId, participantId, { x: 7, y: 0 }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'INSUFFICIENT_MOVEMENT' } });

    const row = await pool.query<{ pos_x: number; pos_y: number; movement_used_ft: number }>(
      `SELECT pos_x, pos_y, movement_used_ft FROM combat_participants WHERE id = $1`,
      [participantId],
    );
    expect(row.rows[0]).toMatchObject({ pos_x: 0, pos_y: 0, movement_used_ft: 0 });
  });

  it('accepts a move exactly at the budget boundary and spends movement_used_ft accordingly', async () => {
    // 6 cells * 5 ft = 30 ft, exactly the budget.
    const { participant } = await setParticipantPosition(pool, encounterId, participantId, { x: 6, y: 0 });
    expect(participant.pos_x).toBe(6);
    expect(participant.pos_y).toBe(0);
    expect(participant.movement_used_ft).toBe(30);
  });

  it('a second move in the same turn is rejected once the budget is exhausted', async () => {
    await expect(
      setParticipantPosition(pool, encounterId, participantId, { x: 7, y: 0 }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'INSUFFICIENT_MOVEMENT' } });
  });
});
