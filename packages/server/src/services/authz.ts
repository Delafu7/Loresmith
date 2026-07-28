// Shared authorization primitives (layers 2-3 of the model: campaign
// membership + DM/player role). Used both by the requireCampaignMember/
// requireRole middleware (for routes nested directly under
// /campaigns/:id/...) and directly by services for routes keyed by a
// resource id (e.g. /characters/:id) where the campaign_id has to be looked
// up from the resource itself before membership can be checked.
//
// Layer 4 (ownership) is intentionally NOT here — it's resource-specific
// (e.g. "does this character's owner_user_id match the actor") and lives
// inline in each service, per PLAN.md §4.3's tradeoff #3.

import type { Pool } from 'pg';
import { AppError } from '../middleware/errors.js';

export type CampaignRole = 'dm' | 'player';

export async function getMembership(
  pool: Pool,
  campaignId: string,
  userId: string,
): Promise<CampaignRole | null> {
  const result = await pool.query<{ role: CampaignRole }>(
    `SELECT role FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
    [campaignId, userId],
  );
  return result.rows[0]?.role ?? null;
}

/** Throws NOT_CAMPAIGN_MEMBER (403) if the user isn't in the campaign. Default-deny. */
export async function requireMembership(
  pool: Pool,
  campaignId: string,
  userId: string,
): Promise<CampaignRole> {
  const role = await getMembership(pool, campaignId, userId);
  if (!role) {
    throw new AppError('NOT_CAMPAIGN_MEMBER', 'You are not a member of this campaign');
  }
  return role;
}

/** Throws FORBIDDEN_ROLE (403) if the role isn't 'dm'. */
export function requireDm(role: CampaignRole): void {
  if (role !== 'dm') {
    throw new AppError('FORBIDDEN_ROLE', 'Only the DM can do that');
  }
}

/** Throws FORBIDDEN_NOT_OWNER (403) unless the actor is the DM or owns the resource. */
export function requireOwnerOrDm(role: CampaignRole, ownerUserId: string | null, actorUserId: string): void {
  if (role === 'dm') return;
  if (ownerUserId !== null && ownerUserId === actorUserId) return;
  throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only modify your own resources');
}
