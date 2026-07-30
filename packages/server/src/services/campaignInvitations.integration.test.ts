// Integration test for the email-invitation flow (campaign_invitations,
// services/campaignInvitations.ts). DM-only authorization on the create/
// list/revoke routes is enforced by the same requireCampaignMember() +
// requireRole('dm') middleware every other DM-gated route in this app uses
// (routes/campaigns.ts) — not re-tested here, since it's not novel to this
// feature. What IS novel and covered below: the pending/accepted/revoked
// lifecycle, the partial-unique-index duplicate-pending guard, and
// accept-time (not invite-time) email resolution — including the case where
// the invited account doesn't exist yet when the invite is created.
// Throwaway campaign/user fixtures, same isolation convention as
// characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitationsForCampaign,
  listInvitationsForUser,
  revokeInvitation,
} from './campaignInvitations.js';

describe('campaign invitations (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const invitedEmail = `invitee-${suffix}@example.test`;
  const otherEmail = `not-invited-${suffix}@example.test`;

  beforeAll(async () => {
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Invitations Test DM', 'x') RETURNING id`,
      [`invitations-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Invitations Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [[invitedEmail, otherEmail]]);
    await pool.end();
  });

  it('creates a pending invitation and lists it for the campaign', async () => {
    const invitation = await createInvitation(pool, campaignId, dmUserId, { email: invitedEmail, role: 'player' });
    expect(invitation.status).toBe('pending');
    expect(invitation.invited_email).toBe(invitedEmail);

    const forCampaign = await listInvitationsForCampaign(pool, campaignId);
    expect(forCampaign.map((i) => i.id)).toContain(invitation.id);
  });

  it('a second pending invite to the same email in the same campaign is rejected', async () => {
    await expect(
      createInvitation(pool, campaignId, dmUserId, { email: invitedEmail, role: 'player' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects accepting with an account whose email does not match the invite', async () => {
    const [invitation] = await listInvitationsForCampaign(pool, campaignId);
    const outsiderRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Outsider', 'x') RETURNING id`,
      [otherEmail],
    );
    try {
      await expect(
        acceptInvitation(pool, invitation!.id, outsiderRes.rows[0]!.id, otherEmail),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [outsiderRes.rows[0]!.id]);
    }
  });

  it('accepting works even when the invited account is registered AFTER the invitation was created', async () => {
    const [invitation] = await listInvitationsForCampaign(pool, campaignId);

    // GET /me/invitations should already surface it before the account exists.
    // (It won't resolve to this specific not-yet-created user, but the row
    // is queryable by email regardless of whether an account exists yet.)
    const pendingByEmail = await listInvitationsForUser(pool, invitedEmail);
    expect(pendingByEmail.map((i) => i.id)).toContain(invitation!.id);

    const invitedUserRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Invitee', 'x') RETURNING id`,
      [invitedEmail],
    );
    const invitedUserId = invitedUserRes.rows[0]!.id;

    const { invitation: accepted, member } = await acceptInvitation(pool, invitation!.id, invitedUserId, invitedEmail);
    expect(accepted.status).toBe('accepted');
    expect(member.user_id).toBe(invitedUserId);
    expect(member.role).toBe('player');

    const membershipRes = await pool.query(
      `SELECT * FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
      [campaignId, invitedUserId],
    );
    expect(membershipRes.rows).toHaveLength(1);
  });

  it('accepting an already-accepted invitation is rejected', async () => {
    const [invitation] = await listInvitationsForCampaign(pool, campaignId);
    const invitedUser = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [invitedEmail]);
    await expect(
      acceptInvitation(pool, invitation!.id, invitedUser.rows[0]!.id, invitedEmail),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('revoking a pending invitation works; revoking a non-pending one is rejected', async () => {
    const fresh = await createInvitation(pool, campaignId, dmUserId, { email: otherEmail, role: 'dm' });
    const revoked = await revokeInvitation(pool, campaignId, fresh.id);
    expect(revoked.status).toBe('revoked');

    await expect(revokeInvitation(pool, campaignId, fresh.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('re-inviting the same email after a revoke is allowed (the partial unique index only guards pending rows)', async () => {
    const reinvited = await createInvitation(pool, campaignId, dmUserId, { email: otherEmail, role: 'player' });
    expect(reinvited.status).toBe('pending');
  });

  it('revoking a nonexistent invitation 404s', async () => {
    await expect(
      revokeInvitation(pool, campaignId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
