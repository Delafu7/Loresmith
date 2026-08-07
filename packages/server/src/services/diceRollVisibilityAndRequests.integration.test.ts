// Integration tests for Iteration 3's net-new dice capability (§2.3/2.4):
// roll visibility tiers, manual physical-dice entry, void-not-delete, and
// the GM roll-request lifecycle. Throwaway campaign/user fixtures, same
// isolation convention as characters.gmNotesRedaction.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { rollDice, listDiceRolls, voidDiceRoll, isRollVisibleToViewer } from './diceRolls.js';
import { createDiceRollRequest, listDiceRollRequests, passDiceRollRequestTarget } from './diceRollRequests.js';
import type { CreateDiceRollInput } from '../schemas/diceRolls.js';

describe('dice roll visibility, manual entry, void, and roll requests (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    async function makeUser(label: string): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
        [`dice-v2-${label}-${suffix}@example.test`, `Dice V2 Test ${label}`],
      );
      return res.rows[0]!.id;
    }
    dmUserId = await makeUser('dm');
    playerAUserId = await makeUser('player-a');
    playerBUserId = await makeUser('player-b');

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Dice V2 Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm'), ($1, $3, 'player'), ($1, $4, 'player')`,
      [campaignId, dmUserId, playerAUserId, playerBUserId],
    );
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dmUserId, playerAUserId, playerBUserId]]);
    await pool.end();
  });

  const baseRoll: CreateDiceRollInput = {
    rollType: 'custom',
    keep: 'normal',
    modifier: 0,
    diceSides: 20,
    diceCount: 1,
    visibility: 'public',
  };

  describe('visibility authorization', () => {
    it('a player cannot create a gm_only or private roll', async () => {
      await expect(
        rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, visibility: 'gm_only' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
      await expect(
        rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, visibility: 'private', visibleToUserId: playerBUserId }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    it('the DM can create a gm_only roll', async () => {
      const roll = await rollDice(pool, campaignId, dmUserId, 'dm', { ...baseRoll, visibility: 'gm_only' });
      expect(roll.visibility).toBe('gm_only');
    });

    it('a private roll must target an actual campaign member', async () => {
      await expect(
        rollDice(pool, campaignId, dmUserId, 'dm', {
          ...baseRoll,
          visibility: 'private',
          visibleToUserId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('isRollVisibleToViewer', () => {
    // Built inside each `it`, not at describe-body scope — describe bodies
    // run synchronously at collection time, BEFORE beforeAll populates
    // dmUserId/playerAUserId/playerBUserId, so a describe-scoped const here
    // would silently capture undefined.
    function gmOnlyRoll() {
      return { user_id: dmUserId, visibility: 'gm_only' as const, visible_to_user_id: null };
    }
    function privateRoll() {
      return { user_id: dmUserId, visibility: 'private' as const, visible_to_user_id: playerAUserId };
    }
    function publicRoll() {
      return { user_id: playerAUserId, visibility: 'public' as const, visible_to_user_id: null };
    }

    it('the DM sees everything', () => {
      const gmOnlyRollV = gmOnlyRoll();
      const privateRollV = privateRoll();
      expect(isRollVisibleToViewer(gmOnlyRollV, dmUserId, 'dm')).toBe(true);
      expect(isRollVisibleToViewer(privateRollV, dmUserId, 'dm')).toBe(true);
    });
    it('a public roll is visible to anyone', () => {
      expect(isRollVisibleToViewer(publicRoll(), playerBUserId, 'player')).toBe(true);
    });
    it('gm_only is invisible to a non-DM, non-roller viewer', () => {
      expect(isRollVisibleToViewer(gmOnlyRoll(), playerAUserId, 'player')).toBe(false);
    });
    it('a private roll is visible only to its named target', () => {
      const privateRollV = privateRoll();
      expect(isRollVisibleToViewer(privateRollV, playerAUserId, 'player')).toBe(true);
      expect(isRollVisibleToViewer(privateRollV, playerBUserId, 'player')).toBe(false);
    });
    it('the roller can always see their own roll regardless of visibility', () => {
      expect(isRollVisibleToViewer(gmOnlyRoll(), dmUserId, 'player')).toBe(true); // hypothetical role mismatch, still true
    });
  });

  describe('listDiceRolls visibility filtering', () => {
    it('a player never sees a gm_only roll, and only sees a private roll addressed to them', async () => {
      const gmOnly = await rollDice(pool, campaignId, dmUserId, 'dm', {
        ...baseRoll, rollContext: 'gm-only-filter-test', visibility: 'gm_only',
      });
      const privateToA = await rollDice(pool, campaignId, dmUserId, 'dm', {
        ...baseRoll, rollContext: 'private-to-a-filter-test', visibility: 'private', visibleToUserId: playerAUserId,
      });

      const asPlayerA = await listDiceRolls(pool, campaignId, playerAUserId, 'player', {});
      const idsForA = asPlayerA.rolls.map((r) => r.id);
      expect(idsForA).toContain(privateToA.id);
      expect(idsForA).not.toContain(gmOnly.id);

      const asPlayerB = await listDiceRolls(pool, campaignId, playerBUserId, 'player', {});
      const idsForB = asPlayerB.rolls.map((r) => r.id);
      expect(idsForB).not.toContain(privateToA.id);
      expect(idsForB).not.toContain(gmOnly.id);

      const asDm = await listDiceRolls(pool, campaignId, dmUserId, 'dm', {});
      const idsForDm = asDm.rolls.map((r) => r.id);
      expect(idsForDm).toContain(gmOnly.id);
      expect(idsForDm).toContain(privateToA.id);
    });
  });

  describe('manual entry', () => {
    it('records the caller-supplied physical dice values verbatim and flags is_manual', async () => {
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', {
        ...baseRoll,
        diceSides: 6,
        diceCount: 3,
        manualRolls: [6, 1, 4],
      });
      expect(roll.d20_rolls).toEqual([6, 1, 4]);
      expect(roll.is_manual).toBe(true);
      expect(roll.result_total).toBe(11); // 6+1+4 + modifier(0)
    });

    it('a normal server-rolled roll is never flagged is_manual', async () => {
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', baseRoll);
      expect(roll.is_manual).toBe(false);
    });
  });

  describe('void, not delete', () => {
    it('the roller can void their own roll; a second void is rejected; the row survives', async () => {
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, rollContext: 'void-test-own' });
      const voided = await voidDiceRoll(pool, campaignId, playerAUserId, 'player', roll.id);
      expect(voided.voided_at).not.toBeNull();
      expect(voided.voided_by_user_id).toBe(playerAUserId);

      await expect(voidDiceRoll(pool, campaignId, playerAUserId, 'player', roll.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      const stillThere = await pool.query(`SELECT id FROM dice_rolls WHERE id = $1`, [roll.id]);
      expect(stillThere.rows).toHaveLength(1);
    });

    it('a different player cannot void someone else\'s roll', async () => {
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, rollContext: 'void-test-forbidden' });
      await expect(voidDiceRoll(pool, campaignId, playerBUserId, 'player', roll.id)).rejects.toMatchObject({
        code: 'FORBIDDEN_NOT_OWNER',
      });
    });

    it('the DM can void any roll', async () => {
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, rollContext: 'void-test-dm' });
      const voided = await voidDiceRoll(pool, campaignId, dmUserId, 'dm', roll.id);
      expect(voided.voided_by_user_id).toBe(dmUserId);
    });
  });

  describe('roll requests', () => {
    it('a player cannot create a roll request', async () => {
      await expect(
        createDiceRollRequest(pool, campaignId, playerAUserId, 'player', {
          targetUserIds: [playerAUserId],
          rollType: 'saving_throw',
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    it('rejects targeting a user who is not a campaign member', async () => {
      await expect(
        createDiceRollRequest(pool, campaignId, dmUserId, 'dm', {
          targetUserIds: ['00000000-0000-0000-0000-000000000000'],
          rollType: 'saving_throw',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('the DM can request a roll from several players; fulfilling it marks the target rolled; passing marks it passed', async () => {
      const { request, targets } = await createDiceRollRequest(pool, campaignId, dmUserId, 'dm', {
        targetUserIds: [playerAUserId, playerBUserId],
        rollType: 'saving_throw',
        rollContext: 'Group DEX save',
        dc: 15,
      });
      expect(targets).toHaveLength(2);
      expect(targets.every((t) => t.status === 'pending')).toBe(true);

      const targetForA = targets.find((t) => t.user_id === playerAUserId)!;
      const roll = await rollDice(pool, campaignId, playerAUserId, 'player', {
        ...baseRoll,
        rollType: 'saving_throw',
        fulfillsRequestTargetId: targetForA.id,
      });

      const targetForB = targets.find((t) => t.user_id === playerBUserId)!;
      await passDiceRollRequestTarget(pool, campaignId, playerBUserId, 'player', targetForB.id);

      const list = await listDiceRollRequests(pool, campaignId, dmUserId, 'dm');
      const found = list.find((r) => r.request.id === request.id)!;
      const foundTargetA = found.targets.find((t) => t.user_id === playerAUserId)!;
      const foundTargetB = found.targets.find((t) => t.user_id === playerBUserId)!;
      expect(foundTargetA.status).toBe('rolled');
      expect(foundTargetA.dice_roll_id).toBe(roll.id);
      expect(foundTargetB.status).toBe('passed');
    });

    it('a roll cannot fulfill someone else\'s request target', async () => {
      const { targets } = await createDiceRollRequest(pool, campaignId, dmUserId, 'dm', {
        targetUserIds: [playerAUserId],
        rollType: 'saving_throw',
      });
      await expect(
        rollDice(pool, campaignId, playerBUserId, 'player', { ...baseRoll, fulfillsRequestTargetId: targets[0]!.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });
    });

    it('a request target cannot be fulfilled twice', async () => {
      const { targets } = await createDiceRollRequest(pool, campaignId, dmUserId, 'dm', {
        targetUserIds: [playerAUserId],
        rollType: 'saving_throw',
      });
      await rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, fulfillsRequestTargetId: targets[0]!.id });
      await expect(
        rollDice(pool, campaignId, playerAUserId, 'player', { ...baseRoll, fulfillsRequestTargetId: targets[0]!.id }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('a gm_only-fulfilled request target still shows status=rolled to another player, without exposing the roll', async () => {
      const { targets } = await createDiceRollRequest(pool, campaignId, dmUserId, 'dm', {
        targetUserIds: [playerAUserId],
        rollType: 'saving_throw',
      });
      // The DM rolls a secret check FOR playerA's target on their own —
      // fulfillment is normally done by the targeted player, but nothing
      // stops the DM from marking it via a gm_only roll of their own; this
      // exercises the visibility-enrichment path in listDiceRollRequests.
      await rollDice(pool, campaignId, dmUserId, 'dm', { ...baseRoll, visibility: 'gm_only', fulfillsRequestTargetId: targets[0]!.id });

      const asPlayerB = await listDiceRollRequests(pool, campaignId, playerBUserId, 'player');
      const targetSeenByB = asPlayerB.flatMap((r) => r.targets).find((t) => t.id === targets[0]!.id)!;
      expect(targetSeenByB.status).toBe('rolled');
      expect(targetSeenByB.rollVisible).toBe(false);

      const asDm = await listDiceRollRequests(pool, campaignId, dmUserId, 'dm');
      const targetSeenByDm = asDm.flatMap((r) => r.targets).find((t) => t.id === targets[0]!.id)!;
      expect(targetSeenByDm.rollVisible).toBe(true);
    });
  });
});
