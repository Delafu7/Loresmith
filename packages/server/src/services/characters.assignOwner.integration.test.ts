// Integration test for assignCharacterToPlayer (services/characters.ts) —
// the DM-only "assign this PC to a player by email" flow, distinct from
// updateCharacter's raw ownerUserId field (a user_id, no membership check).
// Throwaway campaign/user/character fixtures, same isolation convention as
// characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { assignCharacterToPlayer } from './characters.js';

describe('assignCharacterToPlayer (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let memberPlayerUserId: string;
  let outsiderUserId: string;
  let campaignId: string;
  let unassignedPcId: string;
  let npcId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nonexistentEmail = `nobody-${suffix}@example.test`;

  beforeAll(async () => {
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'AssignOwner Test DM', 'x') RETURNING id`,
      [`assign-owner-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const memberRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'AssignOwner Test Member', 'x') RETURNING id`,
      [`assign-owner-member-${suffix}@example.test`],
    );
    memberPlayerUserId = memberRes.rows[0]!.id;

    const outsiderRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'AssignOwner Test Outsider', 'x') RETURNING id`,
      [`assign-owner-outsider-${suffix}@example.test`],
    );
    outsiderUserId = outsiderRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('AssignOwner Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, memberPlayerUserId]);
    // outsiderUserId is deliberately NOT a member of this campaign.

    const pcRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, NULL, $2, 'Unassigned Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    unassignedPcId = pcRes.rows[0]!.id;

    const npcRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, false, NULL, $2, 'AssignOwner Test NPC', 10, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId],
    );
    npcId = npcRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (memberPlayerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [memberPlayerUserId]);
    if (outsiderUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [outsiderUserId]);
    await pool.end();
  });

  it('a non-DM caller is rejected', async () => {
    await expect(
      assignCharacterToPlayer(pool, memberPlayerUserId, unassignedPcId, { email: `assign-owner-member-${suffix}@example.test` }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('assigning to an email with no account 404s', async () => {
    await expect(
      assignCharacterToPlayer(pool, dmUserId, unassignedPcId, { email: nonexistentEmail }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('assigning to an account that is not a member of this campaign is rejected', async () => {
    await expect(
      assignCharacterToPlayer(pool, dmUserId, unassignedPcId, { email: `assign-owner-outsider-${suffix}@example.test` }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('assigning an owner to an NPC is rejected', async () => {
    await expect(
      assignCharacterToPlayer(pool, dmUserId, npcId, { email: `assign-owner-member-${suffix}@example.test` }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('the DM can assign an unassigned PC to a campaign member by email', async () => {
    const character = await assignCharacterToPlayer(pool, dmUserId, unassignedPcId, {
      email: `assign-owner-member-${suffix}@example.test`,
    });
    expect(character.owner_user_id).toBe(memberPlayerUserId);
  });
});
