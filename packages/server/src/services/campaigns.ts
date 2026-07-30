import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { isUniqueViolation } from './dbErrors.js';
import { findUserByEmail } from './users.js';
import type {
  AddMemberInput,
  CreateCampaignInput,
  CreateSessionLogInput,
  UpdateCampaignInput,
  UpdateMemberInput,
  UpdateSessionLogInput,
} from '../schemas/campaigns.js';

export async function createCampaign(pool: Pool, actorId: string, input: CreateCampaignInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const campaignRes = await client.query(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.name, actorId, input.srdEdition, input.description ?? null],
    );
    const campaign = campaignRes.rows[0];
    await client.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`,
      [campaign.id, actorId],
    );
    await client.query('COMMIT');
    return campaign;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listCampaignsForUser(pool: Pool, userId: string) {
  const result = await pool.query(
    `SELECT c.*, cm.role AS my_role
     FROM campaigns c
     JOIN campaign_members cm ON cm.campaign_id = c.id
     WHERE cm.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function getCampaign(pool: Pool, campaignId: string) {
  const result = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Campaign');
  return row;
}

export async function updateCampaign(pool: Pool, campaignId: string, input: UpdateCampaignInput) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (input.name !== undefined) { sets.push(`name = $${i++}`); values.push(input.name); }
  if (input.srdEdition !== undefined) { sets.push(`srd_edition = $${i++}`); values.push(input.srdEdition); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); values.push(input.description); }
  if (input.archived !== undefined) {
    sets.push(`archived_at = ${input.archived ? 'now()' : 'NULL'}`);
  }
  if (input.allowAbilityReroll !== undefined) {
    sets.push(`allow_ability_reroll = $${i++}`);
    values.push(input.allowAbilityReroll);
  }

  if (sets.length === 0) {
    return getCampaign(pool, campaignId);
  }

  values.push(campaignId);
  const result = await pool.query(
    `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw notFound('Campaign');
  return row;
}

export async function deleteCampaign(pool: Pool, campaignId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
  if (result.rowCount === 0) throw notFound('Campaign');
}

// ---- Members ----

export async function listMembers(pool: Pool, campaignId: string) {
  const result = await pool.query(
    `SELECT cm.id, cm.campaign_id, cm.user_id, cm.role, cm.joined_at,
            cm.can_create_characters, cm.max_characters, u.email, u.display_name
     FROM campaign_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.campaign_id = $1
     ORDER BY cm.joined_at ASC`,
    [campaignId],
  );
  return result.rows;
}

export async function addMember(pool: Pool, campaignId: string, input: AddMemberInput) {
  const user = await findUserByEmail(pool, input.email);
  if (!user) throw new AppError('NOT_FOUND', 'No user with that email exists');
  return insertMembership(pool, campaignId, user.id, input.role);
}

// Shared by addMember above and services/campaignInvitations.ts's
// acceptInvitation — both need "create a campaign_members row for this exact
// (already-resolved) user, erroring if they're already a member" with no
// user-lookup step of their own. Takes a PoolClient too so acceptInvitation
// can call this inside its own transaction.
export async function insertMembership(
  pool: Pool | PoolClient,
  campaignId: string,
  userId: string,
  role: 'dm' | 'player',
) {
  const existing = await pool.query(
    `SELECT id FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
    [campaignId, userId],
  );
  if (existing.rows.length > 0) {
    throw new AppError('CONFLICT', 'That user is already a member of this campaign');
  }

  const result = await pool.query(
    `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, $3) RETURNING *`,
    [campaignId, userId, role],
  );
  return result.rows[0];
}

export async function updateMember(pool: Pool, campaignId: string, targetUserId: string, input: UpdateMemberInput) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (input.role !== undefined) { sets.push(`role = $${i++}`); values.push(input.role); }
  if (input.canCreateCharacters !== undefined) { sets.push(`can_create_characters = $${i++}`); values.push(input.canCreateCharacters); }
  if (input.maxCharacters !== undefined) { sets.push(`max_characters = $${i++}`); values.push(input.maxCharacters); }

  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT * FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
      [campaignId, targetUserId],
    );
    const row = existing.rows[0];
    if (!row) throw notFound('Campaign member');
    return row;
  }

  values.push(campaignId, targetUserId);
  const result = await pool.query(
    `UPDATE campaign_members SET ${sets.join(', ')} WHERE campaign_id = $${i++} AND user_id = $${i} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw notFound('Campaign member');
  return row;
}

export async function removeMember(pool: Pool, campaignId: string, targetUserId: string): Promise<void> {
  const campaign = await getCampaign(pool, campaignId);
  if (campaign.dm_user_id === targetUserId) {
    throw new AppError('CONFLICT', "Cannot remove the campaign's owning DM from membership; delete the campaign instead");
  }
  const result = await pool.query(
    `DELETE FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
    [campaignId, targetUserId],
  );
  if (result.rowCount === 0) throw notFound('Campaign member');
}

// ---- Session log (game-night log, NOT the HTTP auth session) ----

export async function listSessionLogs(pool: Pool, campaignId: string) {
  const result = await pool.query(
    `SELECT * FROM sessions WHERE campaign_id = $1 ORDER BY session_number ASC`,
    [campaignId],
  );
  return result.rows;
}

export async function getSessionLog(pool: Pool, campaignId: string, sessionId: string) {
  const result = await pool.query(`SELECT * FROM sessions WHERE id = $1 AND campaign_id = $2`, [sessionId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Session log entry');
  return row;
}

export async function createSessionLog(pool: Pool, campaignId: string, input: CreateSessionLogInput) {
  try {
    const result = await pool.query(
      `INSERT INTO sessions (campaign_id, session_number, title, played_at, recap)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [campaignId, input.sessionNumber, input.title ?? null, input.playedAt ?? null, input.recap ?? null],
    );
    return result.rows[0];
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', `Session number ${input.sessionNumber} already exists for this campaign`);
    }
    throw err;
  }
}

export async function updateSessionLog(pool: Pool, campaignId: string, sessionId: string, input: UpdateSessionLogInput) {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (input.sessionNumber !== undefined) { sets.push(`session_number = $${i++}`); values.push(input.sessionNumber); }
  if (input.title !== undefined) { sets.push(`title = $${i++}`); values.push(input.title); }
  if (input.playedAt !== undefined) { sets.push(`played_at = $${i++}`); values.push(input.playedAt); }
  if (input.recap !== undefined) { sets.push(`recap = $${i++}`); values.push(input.recap); }

  if (sets.length === 0) return getSessionLog(pool, campaignId, sessionId);

  sets.push('updated_at = now()');
  values.push(sessionId, campaignId);
  try {
    const result = await pool.query(
      `UPDATE sessions SET ${sets.join(', ')} WHERE id = $${i++} AND campaign_id = $${i} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw notFound('Session log entry');
    return row;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', `Session number ${input.sessionNumber} already exists for this campaign`);
    }
    throw err;
  }
}

export async function deleteSessionLog(pool: Pool, campaignId: string, sessionId: string): Promise<void> {
  const result = await pool.query(`DELETE FROM sessions WHERE id = $1 AND campaign_id = $2`, [sessionId, campaignId]);
  if (result.rowCount === 0) throw notFound('Session log entry');
}
