// docs/roadmap/dnd-2024-gap-analysis.md P1-9 (CB-04) — Surprise, and the
// genuine 2014/2024 rules split this project's own verified rules reference
// surfaced (.claude/skills/dnd-2024-rules/references/combat.md and
// 2014-vs-2024-differences.md): 2014's Surprise locks a participant out of
// moving/acting on their own first turn and reacting until it ends; 2024's
// *sole* effect is Disadvantage on that participant's own Initiative roll,
// with no lockout at all. Confirmed by the user (AskUserQuestion,
// "Edition-aware") over implementing the roadmap's literal (2014-style)
// acceptance criteria for both editions. Throwaway campaign/user/character
// fixtures, same isolation convention as encounters.turnOrderAuthz.
// integration.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, advanceTurn, applyActionEconomy, createEncounter, setParticipantPosition, startCombat, startEncounter } from './encounters.js';

describe('Surprise (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaign2024Id: string;
  let campaign2014Id: string;
  let characterAId2024: string;
  let characterBId2024: string;
  let characterAId2014: string;
  let characterBId2014: string;

  async function makeCharacter(campaignId: string, name: string): Promise<string> {
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

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Surprise Test DM', 'x') RETURNING id`,
      [`surprise-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaign2024Res = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Surprise Test Campaign 2024', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaign2024Id = campaign2024Res.rows[0]!.id;

    const campaign2014Res = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Surprise Test Campaign 2014', $1, '2014') RETURNING id`,
      [dmUserId],
    );
    campaign2014Id = campaign2014Res.rows[0]!.id;

    characterAId2024 = await makeCharacter(campaign2024Id, 'Surprise 2024 PC A');
    characterBId2024 = await makeCharacter(campaign2024Id, 'Surprise 2024 PC B');
    characterAId2014 = await makeCharacter(campaign2014Id, 'Surprise 2014 PC A');
    characterBId2014 = await makeCharacter(campaign2014Id, 'Surprise 2014 PC B');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (campaign2024Id) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaign2024Id]);
    if (campaign2014Id) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaign2014Id]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  describe('marking surprise at combat start', () => {
    it('startCombat sets is_surprised only for the named participants, and resets everyone else', async () => {
      const encounter = await createEncounter(pool, campaign2024Id, { name: 'Surprise Marking Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2024 });
      const { participant: pB } = await addParticipant(pool, encounter.id, { characterId: characterBId2024 });

      await startCombat(pool, encounter.id, [pA.id]);

      const rows = await pool.query<{ id: string; is_surprised: boolean }>(
        `SELECT id, is_surprised FROM combat_participants WHERE encounter_id = $1`,
        [encounter.id],
      );
      const byId = new Map(rows.rows.map((r) => [r.id, r.is_surprised]));
      expect(byId.get(pA.id)).toBe(true);
      expect(byId.get(pB.id)).toBe(false);
    });
  });

  describe('2024: Disadvantage on Initiative only, no lockout', () => {
    it('a surprised participant rolls Initiative with disadvantage (2 dice) while a normal one rolls a single die', async () => {
      const encounter = await createEncounter(pool, campaign2024Id, { name: 'Surprise Initiative Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2024 });
      const { participant: pB } = await addParticipant(pool, encounter.id, { characterId: characterBId2024 });

      const randomSpy = vi.spyOn(Math, 'random');
      await startCombat(pool, encounter.id, [pA.id]);
      // 1 die for pB (normal) + 2 dice for pA (disadvantage) = 3 total calls
      // to the same RNG primitive every other roll in this app uses.
      expect(randomSpy).toHaveBeenCalledTimes(3);
    });

    it('a surprised participant can still act, move, and react freely — no lockout in 2024', async () => {
      const encounter = await createEncounter(pool, campaign2024Id, { name: 'Surprise No-Lockout Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2024 });
      await addParticipant(pool, encounter.id, { characterId: characterBId2024 });
      await startCombat(pool, encounter.id, [pA.id]);
      await pool.query(`UPDATE combat_participants SET pos_x = 0, pos_y = 0 WHERE id = $1`, [pA.id]);
      await pool.query(`UPDATE encounters SET current_turn_index = (SELECT turn_order FROM combat_participants WHERE id = $1) WHERE id = $2`, [pA.id, encounter.id]);

      const acted = await applyActionEconomy(pool, encounter.id, pA.id, { spend: 'action' });
      expect(acted.participant.action_used).toBe(true);

      const moved = await setParticipantPosition(pool, encounter.id, pA.id, { x: 1, y: 0 }, 'player');
      expect(moved.participant.pos_x).toBe(1);

      const reacted = await applyActionEconomy(pool, encounter.id, pA.id, { spend: 'reaction' });
      expect(reacted.participant.reaction_used).toBe(true);
    });
  });

  describe('2014: full lockout until the surprised participant\'s first turn ends', () => {
    it('a surprised participant\'s Initiative roll is unaffected (single die, no disadvantage)', async () => {
      const encounter = await createEncounter(pool, campaign2014Id, { name: 'Surprise 2014 Initiative Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2014 });

      const randomSpy = vi.spyOn(Math, 'random');
      await startCombat(pool, encounter.id, [pA.id]);
      expect(randomSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects the surprised participant\'s own action/movement/reaction on their first turn, but leaves an un-surprised participant unaffected', async () => {
      const encounter = await createEncounter(pool, campaign2014Id, { name: 'Surprise 2014 Lockout Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2014 });
      const { participant: pB } = await addParticipant(pool, encounter.id, { characterId: characterBId2014 });
      await startCombat(pool, encounter.id, [pA.id]);

      // Force a known order: A first (surprised), B second (not surprised).
      await pool.query(`UPDATE combat_participants SET turn_order = 0 WHERE id = $1`, [pA.id]);
      await pool.query(`UPDATE combat_participants SET turn_order = 1 WHERE id = $1`, [pB.id]);
      await pool.query(`UPDATE encounters SET active_participant_id = $1, current_turn_index = 0 WHERE id = $2`, [pA.id, encounter.id]);
      await pool.query(`UPDATE combat_participants SET pos_x = 0, pos_y = 0 WHERE id = ANY($1)`, [[pA.id, pB.id]]);

      await expect(applyActionEconomy(pool, encounter.id, pA.id, { spend: 'action' })).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'SURPRISED' },
      });
      await expect(applyActionEconomy(pool, encounter.id, pA.id, { addMovementFt: 10 })).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'SURPRISED' },
      });
      await expect(setParticipantPosition(pool, encounter.id, pA.id, { x: 1, y: 0 }, 'player')).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'SURPRISED' },
      });
      // Reactions are blocked regardless of whose turn it is right now.
      await expect(applyActionEconomy(pool, encounter.id, pA.id, { spend: 'reaction' })).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'SURPRISED' },
      });

      // B was never marked surprised, and it's not B's turn yet either — the
      // NOT_YOUR_TURN rejection (not SURPRISED) proves B's own lockout never
      // engaged at all.
      await expect(applyActionEconomy(pool, encounter.id, pB.id, { spend: 'action' })).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' },
      });
    });

    it('the DM can still move a surprised participant\'s token (DM override, same as any other turn)', async () => {
      const encounter = await createEncounter(pool, campaign2014Id, { name: 'Surprise 2014 DM Override Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2014 });
      await startCombat(pool, encounter.id, [pA.id]);
      await pool.query(`UPDATE combat_participants SET pos_x = 0, pos_y = 0 WHERE id = $1`, [pA.id]);
      await pool.query(`UPDATE encounters SET current_turn_index = (SELECT turn_order FROM combat_participants WHERE id = $1) WHERE id = $2`, [pA.id, encounter.id]);

      const moved = await setParticipantPosition(pool, encounter.id, pA.id, { x: 3, y: 0 }, 'dm');
      expect(moved.participant.pos_x).toBe(3);
    });

    it('clears is_surprised once the surprised participant\'s own first turn ends, unlocking them for the rest of combat', async () => {
      const encounter = await createEncounter(pool, campaign2014Id, { name: 'Surprise 2014 Clears On Turn End Encounter' });
      await startEncounter(pool, encounter.id);
      const { participant: pA } = await addParticipant(pool, encounter.id, { characterId: characterAId2014 });
      const { participant: pB } = await addParticipant(pool, encounter.id, { characterId: characterBId2014 });
      await startCombat(pool, encounter.id, [pA.id]);

      await pool.query(`UPDATE combat_participants SET turn_order = 0 WHERE id = $1`, [pA.id]);
      await pool.query(`UPDATE combat_participants SET turn_order = 1 WHERE id = $1`, [pB.id]);
      await pool.query(`UPDATE encounters SET active_participant_id = $1, current_turn_index = 0 WHERE id = $2`, [pA.id, encounter.id]);

      await expect(applyActionEconomy(pool, encounter.id, pA.id, { spend: 'reaction' })).rejects.toMatchObject({
        code: 'CONFLICT', details: { reason: 'SURPRISED' },
      });

      await advanceTurn(pool, encounter.id); // pA's first turn ends, pB's turn starts

      const row = await pool.query<{ is_surprised: boolean }>(`SELECT is_surprised FROM combat_participants WHERE id = $1`, [pA.id]);
      expect(row.rows[0]!.is_surprised).toBe(false);

      // Now off-turn (it's pB's turn), but no longer surprised — the
      // reaction spend that failed with SURPRISED above must now succeed.
      const reacted = await applyActionEconomy(pool, encounter.id, pA.id, { spend: 'reaction' });
      expect(reacted.participant.reaction_used).toBe(true);
    });
  });
});
