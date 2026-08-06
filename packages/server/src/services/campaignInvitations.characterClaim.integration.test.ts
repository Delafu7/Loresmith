// Integration tests for Iteration 2 "Character ownership vs. control" —
// invite-to-claim-a-specific-character, layered on top of the existing
// campaign_invitations pending/accepted flow (1784269778666). Throwaway
// campaign/user/character fixtures, same isolation convention as
// characterControl.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { acceptInvitation, createInvitation } from './campaignInvitations.js';

describe('campaign invitation character-claim (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let claimerUserId: string;
  let claimerEmailForTests: string;
  let campaignId: string;
  let unclaimedCharacterId: string;
  let alreadyOwnedCharacterId: string;
  let npcCharacterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Claim Test DM', 'x') RETURNING id`,
      [`claim-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const claimerEmail = `claim-claimer-${suffix}@example.test`;
    const claimerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Claim Test Claimer', 'x') RETURNING id`,
      [claimerEmail],
    );
    claimerUserId = claimerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Claim Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    async function makeCharacter(name: string, isPc: boolean, owner: string | null): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
            armor_class, speed, hp_max, hp_current)
         VALUES ($1, $2, $3, $4, $5, 10, 10, 10, 10, 10, 10, 12, 30, 20, 20)
         RETURNING id`,
        [campaignId, isPc, owner, dmUserId, name],
      );
      return res.rows[0]!.id;
    }

    unclaimedCharacterId = await makeCharacter('Unclaimed PC', true, null);
    alreadyOwnedCharacterId = await makeCharacter('Already Owned PC', true, dmUserId);
    npcCharacterId = await makeCharacter('Some NPC', false, null);

    claimerEmailForTests = claimerEmail;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[dmUserId, claimerUserId]]);
    await pool.end();
  });

  it('rejects inviting-to-claim an NPC', async () => {
    await expect(
      createInvitation(pool, campaignId, dmUserId, { email: claimerEmailForTests, role: 'player', characterId: npcCharacterId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects inviting-to-claim an already-owned character', async () => {
    await expect(
      createInvitation(pool, campaignId, dmUserId, { email: claimerEmailForTests, role: 'player', characterId: alreadyOwnedCharacterId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects inviting-to-claim a character from a different campaign', async () => {
    const otherCampaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Claim Test Other Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    const otherCampaignId = otherCampaignRes.rows[0]!.id;
    try {
      await expect(
        createInvitation(pool, otherCampaignId, dmUserId, { email: claimerEmailForTests, role: 'player', characterId: unclaimedCharacterId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [otherCampaignId]);
    }
  });

  it('accepting a character-claim invitation grants membership AND ownership in one transaction', async () => {
    const invitation = await createInvitation(pool, campaignId, dmUserId, {
      email: claimerEmailForTests,
      role: 'player',
      characterId: unclaimedCharacterId,
    });
    expect(invitation.character_id).toBe(unclaimedCharacterId);

    const { member, character } = await acceptInvitation(pool, invitation.id, claimerUserId, claimerEmailForTests);
    expect(member.role).toBe('player');
    expect(character).not.toBeNull();
    expect(character!.owner_user_id).toBe(claimerUserId);
    expect(character!.controller_user_id).toBeNull();

    const dbRow = await pool.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM characters WHERE id = $1`, [unclaimedCharacterId]);
    expect(dbRow.rows[0]!.owner_user_id).toBe(claimerUserId);
  });

  it('a plain membership invitation (no characterId) still works unchanged and claims nothing', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const plainEmail = `claim-plain-${suffix}@example.test`;
    const plainUserRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Plain Invitee', 'x') RETURNING id`,
      [plainEmail],
    );
    const plainUserId = plainUserRes.rows[0]!.id;
    try {
      const invitation = await createInvitation(pool, campaignId, dmUserId, { email: plainEmail, role: 'spectator' });
      expect(invitation.character_id).toBeNull();

      const { member, character } = await acceptInvitation(pool, invitation.id, plainUserId, plainEmail);
      expect(member.role).toBe('spectator');
      expect(character).toBeNull();
    } finally {
      await pool.query(`DELETE FROM campaign_members WHERE user_id = $1`, [plainUserId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [plainUserId]);
    }
  });
});
