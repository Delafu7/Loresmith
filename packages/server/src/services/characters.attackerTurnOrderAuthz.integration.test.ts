// Integration test for Phase 2 "close the parity gap on character-vs-
// character damage" — authorizeAttackerOnTurn as wired into applyDamage
// (services/characters.ts). Deliberately does NOT test PC-vs-PC "friendly
// fire" (attacking a character you don't control) — that's a separate,
// not-yet-decided scope question (see OPEN_QUESTIONS conversation); this
// only confirms the existing target-control-gated path additionally enforces
// the attacking participant's turn once attackerParticipantId is supplied,
// same as monsters.playerAttackAuthz.integration.test.ts already does for
// monster-instance targets.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { applyDamage } from './characters.js';

describe('applyDamage attacker turn-order authorization (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let campaignId: string;
  let encounterId: string;
  let characterA1Id: string;
  let characterA2Id: string;
  let onTurnParticipantId: string; // characterA1, turn_order 0
  let waitingParticipantId: string; // characterA2, turn_order 1

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CharAttackerTurnOrder Test DM', 'x') RETURNING id`,
      [`char-attacker-turn-order-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'CharAttackerTurnOrder Test Player A', 'x') RETURNING id`,
      [`char-attacker-turn-order-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('CharAttackerTurnOrder Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);

    // Both characters owned by the SAME player — the only shape today's
    // target-control check (authorizeCharacterAction) permits for a non-DM
    // caller, matching the "delegated second character" case
    // applyDamage's own comment describes.
    const charA1Res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'CharAttackerTurnOrder PC A1', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    characterA1Id = charA1Res.rows[0]!.id;

    const charA2Res = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'CharAttackerTurnOrder PC A2', 14, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    characterA2Id = charA2Res.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'CharAttackerTurnOrder Test Encounter' });
    encounterId = encounter.id;

    const { participant: participantA1 } = await addParticipant(pool, encounterId, { characterId: characterA1Id });
    onTurnParticipantId = participantA1.id; // turn_order 0
    const { participant: participantA2 } = await addParticipant(pool, encounterId, { characterId: characterA2Id });
    waitingParticipantId = participantA2.id; // turn_order 1

    await pool.query(`UPDATE encounters SET status = 'active', current_turn_index = 0 WHERE id = $1`, [encounterId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerAUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerAUserId]);
    await pool.end();
  });

  const dmg = { diceSides: 6 as const, diceCount: 1, modifier: 0, damageType: null, isCritical: false };

  it('a controlled-character attack with the named attacking participant on turn queues a pending request, not an immediate resolution (Phase 4)', async () => {
    const result = await applyDamage(pool, playerAUserId, characterA1Id, {
      ...dmg,
      encounterId,
      attackerParticipantId: onTurnParticipantId,
    });
    expect(result).toMatchObject({
      pending: true,
      request: { status: 'pending', kind: 'attack_character', requested_by_user_id: playerAUserId },
    });
  });

  it('rejects a controlled-character attack when the named attacking participant is not on turn', async () => {
    await expect(
      applyDamage(pool, playerAUserId, characterA2Id, { ...dmg, encounterId, attackerParticipantId: waitingParticipantId }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });

  it("the DM's own path stays unconditional even when attackerParticipantId is supplied off-turn", async () => {
    // waitingParticipantId (characterA2) is NOT on turn — a player naming it
    // gets rejected (test above), but the DM keeps full, turn-independent
    // access exactly as before Phase 2 (authorizeAttackerOnTurn only runs
    // its turn check for a non-DM role).
    await expect(
      applyDamage(pool, dmUserId, characterA2Id, { ...dmg, encounterId, attackerParticipantId: waitingParticipantId }),
    ).resolves.toMatchObject({ appliedDamage: expect.any(Number) });
  });
});
