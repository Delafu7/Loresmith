// docs/roadmap/dnd-2024-gap-analysis.md P1-10 — Cover: a DM-set per-
// participant degree (`combat_participants.cover`), surfaced via
// getEncounterCombatSnapshot as a derived armor_class_effective/
// cover_ac_bonus/cover_blocks_targeting for the DM/players to use when
// adjudicating (this app has no server-side attack hit/miss resolution to
// enforce it against — see progress.md's P1-10 entry for that scope
// decision). Throwaway campaign/character/encounter fixtures, same
// isolation convention as encounters.turnOrderAuthz.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  addParticipant,
  coverAcBonus,
  coverBlocksTargeting,
  createEncounter,
  getEncounterCombatSnapshot,
  setParticipantCover,
  startEncounter,
} from './encounters.js';

describe('Cover (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let characterId: string; // armor_class 15

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Cover Test DM', 'x') RETURNING id`,
      [`cover-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Cover Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Cover Test PC', 10, 10, 10, 10, 10, 10, 15, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    characterId = charRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  describe('pure bonus math', () => {
    it('Half Cover is +2, Three-Quarters is +5, None and Total contribute no "+X" bonus', () => {
      expect(coverAcBonus('none')).toBe(0);
      expect(coverAcBonus('half')).toBe(2);
      expect(coverAcBonus('three_quarters')).toBe(5);
      expect(coverAcBonus('total')).toBe(0);
    });

    it('only Total Cover blocks targeting', () => {
      expect(coverBlocksTargeting('none')).toBe(false);
      expect(coverBlocksTargeting('half')).toBe(false);
      expect(coverBlocksTargeting('three_quarters')).toBe(false);
      expect(coverBlocksTargeting('total')).toBe(true);
    });
  });

  describe('setParticipantCover + getEncounterCombatSnapshot', () => {
    it('defaults to none, with no AC bonus and targetable', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover Default Encounter' });
      await startEncounter(pool, encounter.id);
      await addParticipant(pool, encounter.id, { characterId });

      const { participants } = await getEncounterCombatSnapshot(pool, encounter.id);
      const p = participants[0]!;
      expect(p.cover).toBe('none');
      expect(p.cover_ac_bonus).toBe(0);
      expect(p.armor_class_effective).toBe(15);
      expect(p.cover_blocks_targeting).toBe(false);
    });

    it('Half Cover raises armor_class_effective by 2 and stays targetable', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover Half Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant } = await addParticipant(pool, encounter.id, { characterId });

      await setParticipantCover(pool, encounter.id, participant.id, { cover: 'half' });

      const { participants } = await getEncounterCombatSnapshot(pool, encounter.id);
      const p = participants[0]!;
      expect(p.cover).toBe('half');
      expect(p.cover_ac_bonus).toBe(2);
      expect(p.armor_class_effective).toBe(17);
      expect(p.cover_blocks_targeting).toBe(false);
    });

    it('Three-Quarters Cover raises armor_class_effective by 5', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover Three-Quarters Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant } = await addParticipant(pool, encounter.id, { characterId });

      await setParticipantCover(pool, encounter.id, participant.id, { cover: 'three_quarters' });

      const { participants } = await getEncounterCombatSnapshot(pool, encounter.id);
      const p = participants[0]!;
      expect(p.cover_ac_bonus).toBe(5);
      expect(p.armor_class_effective).toBe(20);
      expect(p.cover_blocks_targeting).toBe(false);
    });

    it('Total Cover reports cover_blocks_targeting instead of a "+X" bonus', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover Total Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant } = await addParticipant(pool, encounter.id, { characterId });

      await setParticipantCover(pool, encounter.id, participant.id, { cover: 'total' });

      const { participants } = await getEncounterCombatSnapshot(pool, encounter.id);
      const p = participants[0]!;
      expect(p.cover).toBe('total');
      expect(p.cover_blocks_targeting).toBe(true);
    });

    it('switching cover back to none restores the plain base AC', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover Revert Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant } = await addParticipant(pool, encounter.id, { characterId });

      await setParticipantCover(pool, encounter.id, participant.id, { cover: 'three_quarters' });
      await setParticipantCover(pool, encounter.id, participant.id, { cover: 'none' });

      const { participants } = await getEncounterCombatSnapshot(pool, encounter.id);
      const p = participants[0]!;
      expect(p.cover).toBe('none');
      expect(p.armor_class_effective).toBe(15);
    });

    it('404s for a participant id that does not belong to the given encounter', async () => {
      const encounter = await createEncounter(pool, campaignId, { name: 'Cover 404 Encounter' });
      await startEncounter(pool, encounter.id);
      await expect(
        setParticipantCover(pool, encounter.id, '00000000-0000-0000-0000-000000000000', { cover: 'half' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
