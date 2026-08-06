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

// 'spectator' added for Iteration 2 "Character ownership vs. control" —
// strictly read-only. Every existing `role === 'dm'` / `role === 'player'`
// / `role !== 'dm'` branch elsewhere in the codebase was audited when this
// was added (see requireNotSpectator below and its call sites) — a
// spectator falls out of `requireDm`/`requireOwnerOrDm`/
// `requireControllerOrDm` for free (never matches 'dm', never owns/controls
// anything), but a handful of routes that only gated on "any member" needed
// an explicit reject added.
export type CampaignRole = 'dm' | 'player' | 'spectator';

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

/**
 * Iteration 2 "Character ownership vs. control" — the sibling of
 * requireOwnerOrDm for "who may act AS this character right now" (spend HP/
 * resources, roll dice as it, drive its combat-participant actions), as
 * opposed to "who may edit its sheet" (still requireOwnerOrDm, unchanged —
 * see the plan's explicit split: ownership gates the sheet, control gates
 * acting). controllerUserId is checked first; a NULL controller means "no
 * active delegation, defer to the owner," so the two collapse to identical
 * behavior for every character that's never had control delegated — this
 * function is a strict superset of requireOwnerOrDm's behavior in that case,
 * not a parallel/conflicting rule.
 */
export function requireControllerOrDm(
  role: CampaignRole,
  controllerUserId: string | null,
  ownerUserId: string | null,
  actorUserId: string,
): void {
  if (role === 'dm') return;
  const effectiveController = controllerUserId ?? ownerUserId;
  if (effectiveController !== null && effectiveController === actorUserId) return;
  throw new AppError('FORBIDDEN_NOT_OWNER', 'You are not currently controlling this character');
}

/** Throws FORBIDDEN_ROLE (403) if the role is 'spectator'. Read access is never gated this way — only writes. */
export function requireNotSpectator(role: CampaignRole): void {
  if (role === 'spectator') {
    throw new AppError('FORBIDDEN_ROLE', 'Spectators have read-only access to this campaign');
  }
}
