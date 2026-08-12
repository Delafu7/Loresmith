// Integration test for the DM battle-map vision feature's server plumbing
// (1784269817666_add-participant-vision.ts): defaults on a freshly-added
// participant, setParticipantVision's partial-patch (COALESCE) semantics,
// and that the fields actually flow through getEncounterCombatSnapshot (the
// query FULL_STATE_SYNC is built from) — not just exist as unused columns.
// Throwaway campaign/encounter fixtures, same isolation convention as
// encounters.movementMode.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter, getEncounterCombatSnapshot, setParticipantVision } from './encounters.js';

describe('participant vision fields (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let participantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Vision Test DM', 'x') RETURNING id`,
      [`vision-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Vision Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Vision Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const characterId = charRes.rows[0]!.id;

    const encounter = await createEncounter(pool, campaignId, { name: 'Vision Test Encounter' });
    encounterId = encounter.id;

    const { participant } = await addParticipant(pool, encounterId, { characterId });
    participantId = participant.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a freshly-added participant defaults to vision enabled, 30ft radius, no darkvision', async () => {
    const { participants } = await getEncounterCombatSnapshot(pool, encounterId);
    const p = participants.find((x) => x.participant_id === participantId)!;
    expect(p.vision_enabled).toBe(true);
    expect(p.vision_radius_ft).toBe(30);
    expect(p.darkvision_radius_ft).toBe(0);
  });

  it('patches only the fields supplied, leaving the rest untouched (COALESCE semantics)', async () => {
    const { participant: afterFirst } = await setParticipantVision(pool, encounterId, participantId, { darkvisionRadiusFt: 60 });
    expect(afterFirst.darkvision_radius_ft).toBe(60);
    expect(afterFirst.vision_enabled).toBe(true);
    expect(afterFirst.vision_radius_ft).toBe(30);

    const { participant: afterSecond } = await setParticipantVision(pool, encounterId, participantId, { visionEnabled: false });
    expect(afterSecond.vision_enabled).toBe(false);
    // Untouched by the second call.
    expect(afterSecond.darkvision_radius_ft).toBe(60);
    expect(afterSecond.vision_radius_ft).toBe(30);
  });

  it('the patched values flow through to the combat snapshot', async () => {
    await setParticipantVision(pool, encounterId, participantId, { visionEnabled: true, visionRadiusFt: 45, darkvisionRadiusFt: 60 });
    const { participants } = await getEncounterCombatSnapshot(pool, encounterId);
    const p = participants.find((x) => x.participant_id === participantId)!;
    expect(p.vision_enabled).toBe(true);
    expect(p.vision_radius_ft).toBe(45);
    expect(p.darkvision_radius_ft).toBe(60);
  });
});
