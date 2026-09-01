// Integration test for docs/roadmap/dnd-2024-gap-analysis.md P2-6 (ER-09) —
// proves the actual wiring (getParticipantSightReport: reading a real map's
// lighting_state + two real participants' positions/senses/cover), not just
// the pure domain/obscurement.ts functions (obscurement.test.ts already
// covers those in isolation). Throwaway campaign/encounter fixtures, same
// isolation convention as encounters.incapacitatedOccupancy.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  createEncounter,
  getParticipantSightReport,
  setMapLighting,
  setParticipantCover,
  setParticipantPosition,
  setParticipantVision,
  upsertEncounterMap,
} from './encounters.js';

describe('getParticipantSightReport (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;
  let viewerParticipantId: string;
  let targetParticipantId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Obscurement Test DM', 'x') RETURNING id`,
      [`obscurement-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Obscurement Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const viewerCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Obscurement Test Viewer', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const targetCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Obscurement Test Target', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );

    const encounter = await createEncounter(pool, campaignId, { name: 'Obscurement Test Encounter' });
    encounterId = encounter.id;
    await upsertEncounterMap(pool, encounterId, { gridColumns: 20, gridRows: 20, feetPerCell: 5 });

    const { participant: viewer } = await addParticipant(pool, encounterId, { characterId: viewerCharRes.rows[0]!.id });
    viewerParticipantId = viewer.id;
    const { participant: target } = await addParticipant(pool, encounterId, { characterId: targetCharRes.rows[0]!.id });
    targetParticipantId = target.id;

    await setParticipantPosition(pool, encounterId, viewerParticipantId, { x: 0, y: 0 }, 'dm');
    // (2,0) at feetPerCell=5 -> 10 ft away.
    await setParticipantPosition(pool, encounterId, targetParticipantId, { x: 2, y: 0 }, 'dm');
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('dark lighting, no special senses: Heavily Obscured, effectively Blinded for this target', async () => {
    await setMapLighting(pool, encounterId, 'dark');
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({
      lightLevel: 'dark', distanceFt: 10, obscurement: 'heavily',
      perceptionCheckDisadvantage: false, effectivelyBlindedForThisTarget: true, source: 'normal',
    });
  });

  it('dim lighting, no special senses: Lightly Obscured, Perception disadvantage only', async () => {
    await setMapLighting(pool, encounterId, 'dim');
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({ lightLevel: 'dim', obscurement: 'lightly', perceptionCheckDisadvantage: true, effectivelyBlindedForThisTarget: false });
  });

  it('bright lighting: no obscurement at all', async () => {
    await setMapLighting(pool, encounterId, 'bright');
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({ lightLevel: 'bright', obscurement: 'none', perceptionCheckDisadvantage: false, effectivelyBlindedForThisTarget: false });
  });

  it('dark lighting + Darkvision covering the distance downgrades Heavily -> Lightly Obscured', async () => {
    await setMapLighting(pool, encounterId, 'dark');
    await setParticipantVision(pool, encounterId, viewerParticipantId, { darkvisionRadiusFt: 60 });
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({ obscurement: 'lightly', source: 'darkvision', perceivesInvisible: false });
    await setParticipantVision(pool, encounterId, viewerParticipantId, { darkvisionRadiusFt: 0 });
  });

  it('dark lighting + Blindsight covering the distance fully negates obscurement and perceives Invisible', async () => {
    await setMapLighting(pool, encounterId, 'dark');
    await setParticipantVision(pool, encounterId, viewerParticipantId, { blindsightRadiusFt: 60 });
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({ obscurement: 'none', source: 'blindsight', perceivesInvisible: true });
  });

  it("Blindsight does NOT help against a target with Total Cover — falls back to the base obscurement", async () => {
    await setParticipantCover(pool, encounterId, targetParticipantId, { cover: 'total' });
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, targetParticipantId);
    expect(report).toMatchObject({ obscurement: 'heavily', source: 'normal', perceivesInvisible: false });
    await setParticipantCover(pool, encounterId, targetParticipantId, { cover: 'none' });
    await setParticipantVision(pool, encounterId, viewerParticipantId, { blindsightRadiusFt: 0 });
  });

  it('returns null when either participant has no position on the map yet', async () => {
    const unplacedCharRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Obscurement Test Unplaced', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    const { participant: unplaced } = await addParticipant(pool, encounterId, { characterId: unplacedCharRes.rows[0]!.id });
    const report = await getParticipantSightReport(pool, encounterId, viewerParticipantId, unplaced.id);
    expect(report).toBeNull();
  });
});
