// Email invitations with pending/accepted state (campaign_invitations,
// 1784269778666_create-campaign-invitations.ts). Distinct from addMember
// (services/campaigns.ts), which requires the invitee to already have an
// account and grants membership immediately — this is for inviting someone
// who may not have signed up yet. Deliberately does NOT resolve
// invited_email to a user_id up front: resolution happens at accept-time
// (acceptInvitation below), by exact email match against whoever is logged
// in when they accept, same case-sensitive-email convention the rest of
// this codebase already uses (services/auth.ts's register/login, addMember).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isUniqueViolation } from './dbErrors.js';
import { insertMembership } from './campaigns.js';
import type { CreateInvitationInput } from '../schemas/campaignInvitations.js';

export async function createInvitation(pool: Pool, campaignId: string, invitedByUserId: string, input: CreateInvitationInput) {
  if (input.characterId !== undefined) {
    // Must be an unclaimed PC belonging to THIS campaign — never leaks
    // another campaign's character via a crafted id (404, not a validation
    // error, same "don't confirm existence" posture used throughout this
    // codebase), and never lets an invite silently steal an already-owned
    // character out from under its current player.
    const characterRes = await pool.query<{ campaign_id: string; is_pc: boolean; owner_user_id: string | null }>(
      `SELECT campaign_id, is_pc, owner_user_id FROM characters WHERE id = $1`,
      [input.characterId],
    );
    const character = characterRes.rows[0];
    if (!character || character.campaign_id !== campaignId) throw notFound('Character');
    if (!character.is_pc) {
      throw new AppError('VALIDATION_ERROR', 'Only a player character can be claimed via invitation');
    }
    if (character.owner_user_id !== null) {
      throw new AppError('CONFLICT', 'This character already has an owner');
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO campaign_invitations (campaign_id, invited_email, invited_by_user_id, role, character_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [campaignId, input.email, invitedByUserId, input.role, input.characterId ?? null],
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'An invitation to this email is already pending for this campaign');
    }
    throw err;
  }
}

export async function listInvitationsForCampaign(pool: Pool, campaignId: string) {
  const result = await pool.query(
    `SELECT * FROM campaign_invitations WHERE campaign_id = $1 ORDER BY created_at DESC`,
    [campaignId],
  );
  return result.rows;
}

export async function revokeInvitation(pool: Pool, campaignId: string, invitationId: string) {
  const updated = await pool.query(
    `UPDATE campaign_invitations SET status = 'revoked', responded_at = now()
     WHERE id = $1 AND campaign_id = $2 AND status = 'pending'
     RETURNING *`,
    [invitationId, campaignId],
  );
  if (updated.rows[0]) return updated.rows[0];

  const existing = await pool.query<{ status: string }>(
    `SELECT status FROM campaign_invitations WHERE id = $1 AND campaign_id = $2`,
    [invitationId, campaignId],
  );
  if (!existing.rows[0]) throw notFound('Invitation');
  throw new AppError('CONFLICT', `Cannot revoke an invitation in status '${existing.rows[0].status}'`);
}

// GET /me/invitations — pending invites addressed to the logged-in user's
// own email, across every campaign (not scoped to one).
export async function listInvitationsForUser(pool: Pool, userEmail: string) {
  const result = await pool.query(
    `SELECT ci.*, c.name AS campaign_name
     FROM campaign_invitations ci
     JOIN campaigns c ON c.id = ci.campaign_id
     WHERE ci.invited_email = $1 AND ci.status = 'pending'
     ORDER BY ci.created_at DESC`,
    [userEmail],
  );
  return result.rows;
}

export async function acceptInvitation(pool: Pool, invitationId: string, actorId: string, actorEmail: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT * FROM campaign_invitations WHERE id = $1 FOR UPDATE`,
      [invitationId],
    );
    const invitation = locked.rows[0];
    if (!invitation) throw notFound('Invitation');
    if (invitation.status !== 'pending') {
      throw new AppError('CONFLICT', `Cannot accept an invitation in status '${invitation.status}'`);
    }
    if (invitation.invited_email !== actorEmail) {
      throw new AppError('FORBIDDEN_NOT_OWNER', 'This invitation was not addressed to your account');
    }

    const member = await insertMembership(client, invitation.campaign_id, actorId, invitation.role);

    // Claim the character in the SAME transaction as granting membership —
    // both succeed or both roll back together. Re-checks owner_user_id IS
    // NULL at accept-time (not just at invite-creation-time): the character
    // could have been claimed by someone else, or assigned by the DM, in
    // the window between the invite being sent and being accepted.
    let claimedCharacter = null;
    if (invitation.character_id !== null) {
      const claimed = await client.query(
        `UPDATE characters SET owner_user_id = $1, controller_user_id = NULL
         WHERE id = $2 AND owner_user_id IS NULL
         RETURNING *`,
        [actorId, invitation.character_id],
      );
      claimedCharacter = claimed.rows[0];
      if (!claimedCharacter) {
        throw new AppError('CONFLICT', 'This character has already been claimed by someone else');
      }
    }

    const updated = await client.query(
      `UPDATE campaign_invitations SET status = 'accepted', responded_at = now() WHERE id = $1 RETURNING *`,
      [invitationId],
    );

    await client.query('COMMIT');
    return { invitation: updated.rows[0], member, character: claimedCharacter };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
