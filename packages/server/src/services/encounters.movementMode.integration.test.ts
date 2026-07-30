// Integration test for exploration/combat mode's effect on
// setParticipantPosition (services/encounters.ts's computeValidatedMoveCost,
// extended with an `actorRole` param — see 1784269777666_add-encounter-mode.ts).
// Ownership authorization itself (own participant vs. someone else's, DM
// bypass) is the SAME requireOwnParticipantOrDm/authorizeParticipantAction
// gate already covered end-to-end by encounters.actionEconomyAuthz.integration.test.ts
// — the position route now reuses that exact function, so that boundary
// isn't re-tested here. This file covers what's new: exploration mode's free
// movement, and combat mode's turn-order gate for a non-DM actor. Throwaway
// campaign/encounter fixtures, same isolation convention as
// encounters.movement.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  setEncounterMode,
  setParticipantPosition,
  startEncounter,
  upsertEncounterMap,
} from './encounters.js';

describe('setParticipantPosition mode/turn enforcement (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let participantAId: string; // turn_order 0, speed 30
  let participantBId: string; // turn_order 1, speed 30

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'MovementMode Test DM', 'x') RETURNING id`,
      [`movement-mode-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('MovementMode Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'MovementMode PC A', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterAId = charARes.rows[0]!.id;

    const charBRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'MovementMode PC B', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterBId = charBRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'MovementMode Test Encounter' });
    encounterId = encounter.id;
    // Oversized grid (well beyond anything this test actually walks) so a
    // budget-exceeding move target is rejected for BEING TOO FAR, never for
    // running off the edge of the board — that would surface as the wrong
    // machine-readable reason (BLOCKED_PATH instead of INSUFFICIENT_MOVEMENT).
    await upsertEncounterMap(pool, encounterId, { gridColumns: 40, gridRows: 40, feetPerCell: 5 });

    const { participant: participantA } = await addParticipant(pool, encounterId, { characterId: characterAId });
    participantAId = participantA.id; // turn_order 0
    const { participant: participantB } = await addParticipant(pool, encounterId, { characterId: characterBId });
    participantBId = participantB.id; // turn_order 1

    // Initial placement is always free regardless of actor/mode/status.
    await setParticipantPosition(pool, encounterId, participantAId, { x: 0, y: 0 }, 'dm');
    await setParticipantPosition(pool, encounterId, participantBId, { x: 0, y: 5 }, 'dm');
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a new encounter defaults to exploration mode, where a player moves freely with no budget spent, regardless of the (fictional) distance', async () => {
    // 7 cells * 5 ft = 35 ft, which would exceed a 30 ft budget under combat
    // enforcement — exploration mode must not care.
    const { participant } = await setParticipantPosition(pool, encounterId, participantAId, { x: 7, y: 0 }, 'player');
    expect(participant.pos_x).toBe(7);
    expect(participant.movement_used_ft).toBe(0);
  });

  it('combat mode while the encounter is still "preparing" (not active) is also a free move for a player', async () => {
    await setEncounterMode(pool, encounterId, { mode: 'combat' });
    const { participant } = await setParticipantPosition(pool, encounterId, participantAId, { x: 14, y: 0 }, 'player');
    expect(participant.pos_x).toBe(14);
    expect(participant.movement_used_ft).toBe(0);
  });

  it('once combat mode is active, a player moving on their own turn is budget-enforced', async () => {
    await startEncounter(pool, encounterId); // current_turn_index 0 -> participant A's turn

    // 7 cells * 5 ft = 35 ft > 30 ft budget.
    await expect(
      setParticipantPosition(pool, encounterId, participantAId, { x: 21, y: 0 }, 'player'),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'INSUFFICIENT_MOVEMENT' } });

    // 6 cells * 5 ft = 30 ft, exactly the budget.
    const { participant } = await setParticipantPosition(pool, encounterId, participantAId, { x: 20, y: 0 }, 'player');
    expect(participant.pos_x).toBe(20);
    expect(participant.movement_used_ft).toBe(30);
  });

  it('a player cannot move a token off-turn in active combat mode, even their own', async () => {
    // It's participant A's turn (turn_order 0); participant B is turn_order 1.
    await expect(
      setParticipantPosition(pool, encounterId, participantBId, { x: 3, y: 5 }, 'player'),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it('the DM stays unconditional in active combat mode — no turn check, budget still applies', async () => {
    // Participant B still hasn't moved (movement_used_ft 0) — well within
    // budget, and it's still not B's turn, but the DM may act anyway.
    const { participant } = await setParticipantPosition(pool, encounterId, participantBId, { x: 3, y: 5 }, 'dm');
    expect(participant.pos_x).toBe(3);
    expect(participant.movement_used_ft).toBe(15); // 3 cells * 5 ft
  });
});
