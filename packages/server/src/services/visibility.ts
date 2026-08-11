// Unified visibility filter (Phase 1.1 of the backlog implementation plan).
// Before this module, the app had five independently-implemented visibility
// mechanisms with the same shape of rule ("DM always, owner/roller always,
// then something role- or flag-dependent") re-derived in each place:
// redactGmNotes (characters.ts), isRollVisibleToViewer (diceRolls.ts),
// filterParticipantsForViewer/emitToEncounterRespectingVisibility
// (encounters.ts/sockets/broadcast.ts), listAssets's inline SQL WHERE
// (assets.ts, campaignBestiary.ts), and redactEntityFields/resolveReveals
// (entityFieldReveal.ts). This is the one place that rule now lives for the
// mechanisms that fit its shape — see each call site's comment for why it
// was or wasn't migrated onto this.
//
// listAssets/campaignBestiary's boolean WHERE clauses deliberately stay in
// SQL, not JS (same reasoning as diceRolls.ts's listDiceRolls predicate:
// list-endpoint filtering belongs in the query, not a post-fetch filter) —
// this module documents that rule (see 'role_split' below) without replacing
// those queries. redactEntityFields stays independent too: its output is a
// redacted field VALUE (true value / player override / null), not a boolean
// gate, and its `revealed` state is already fully resolved per-field by
// resolveReveals before this module would ever see it.

import type { Pool, PoolClient } from 'pg';
import type { CampaignRole } from './authz.js';

// - 'public': visible to every campaign member regardless of role.
// - 'gm_only': visible only to the DM (and the owner, if `ownerUserId` is set).
// - 'role_split': DM always; non-DM sees it iff `visibleToPlayers !== false`.
//   The generalized shape of combat_participants/campaign_assets/campaign_
//   bestiary_entry_images' `visible_to_players` flag.
// - 'targeted_user': DM and `ownerUserId` always; otherwise only the viewer
//   named in `targetUserId`. The generalized shape of dice_rolls' 'private'
//   visibility.
// - 'per_character_allowlist': DM always; otherwise visible iff a row exists
//   in entity_visibility for (entityType, entityId, viewerId), falling back
//   to `allowlistDefault` when no row exists. Requires a DB lookup — see
//   resolveVisibility/resolveAllowlistVisibilityBatch.
export type SyncVisibilityMode = 'public' | 'gm_only' | 'role_split' | 'targeted_user';
export type VisibilityMode = SyncVisibilityMode | 'per_character_allowlist';

export interface SyncVisibilityContext {
  mode: SyncVisibilityMode;
  ownerUserId?: string | null;
  visibleToPlayers?: boolean;
  targetUserId?: string | null;
}

export interface VisibilityContext extends Omit<SyncVisibilityContext, 'mode'> {
  mode: VisibilityMode;
  entityType?: string;
  entityId?: string;
  allowlistDefault?: boolean;
}

/**
 * The pure (no DB) half of the rule — covers every mode except
 * 'per_character_allowlist'. `viewerId` is nullable for call sites (like
 * redactGmNotes) that only ever had a role in scope, never a user id; those
 * call sites simply can't hit the ownerUserId/targetUserId short-circuits.
 */
export function resolveVisibilitySync(ctx: SyncVisibilityContext, viewerId: string | null, viewerRole: CampaignRole): boolean {
  if (viewerRole === 'dm') return true;
  if (viewerId != null && ctx.ownerUserId != null && ctx.ownerUserId === viewerId) return true;
  switch (ctx.mode) {
    case 'public':
      return true;
    case 'gm_only':
      return false;
    case 'role_split':
      return ctx.visibleToPlayers !== false;
    case 'targeted_user':
      return viewerId != null && ctx.targetUserId != null && ctx.targetUserId === viewerId;
  }
}

/** Full rule including 'per_character_allowlist', which needs `pool`. */
export async function resolveVisibility(
  pool: Pool | PoolClient,
  ctx: VisibilityContext,
  viewerId: string | null,
  viewerRole: CampaignRole,
): Promise<boolean> {
  if (ctx.mode !== 'per_character_allowlist') {
    return resolveVisibilitySync({ mode: ctx.mode, ownerUserId: ctx.ownerUserId, visibleToPlayers: ctx.visibleToPlayers, targetUserId: ctx.targetUserId }, viewerId, viewerRole);
  }
  if (viewerRole === 'dm') return true;
  if (viewerId != null && ctx.ownerUserId != null && ctx.ownerUserId === viewerId) return true;
  if (viewerId == null) return ctx.allowlistDefault ?? false;
  if (!ctx.entityType || !ctx.entityId) {
    throw new Error('resolveVisibility: entityType/entityId are required for per_character_allowlist mode');
  }
  const result = await pool.query(
    `SELECT 1 FROM entity_visibility WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3 LIMIT 1`,
    [ctx.entityType, ctx.entityId, viewerId],
  );
  if (result.rows.length > 0) return true;
  return ctx.allowlistDefault ?? false;
}

/**
 * Batched 'per_character_allowlist' lookup for list endpoints, modeled on
 * campaignCategories.ts's listCategoriesForEntities — one query for N
 * entities rather than N+1.
 */
export async function resolveAllowlistVisibilityBatch(
  pool: Pool | PoolClient,
  entityType: string,
  entityIds: string[],
  viewerId: string,
  viewerRole: CampaignRole,
  allowlistDefault: boolean,
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (entityIds.length === 0) return map;
  if (viewerRole === 'dm') {
    for (const id of entityIds) map.set(id, true);
    return map;
  }
  const result = await pool.query<{ entity_id: string }>(
    `SELECT entity_id FROM entity_visibility WHERE entity_type = $1 AND entity_id = ANY($2::uuid[]) AND user_id = $3`,
    [entityType, entityIds, viewerId],
  );
  const allowed = new Set(result.rows.map((r) => r.entity_id));
  for (const id of entityIds) map.set(id, allowlistDefault || allowed.has(id));
  return map;
}
