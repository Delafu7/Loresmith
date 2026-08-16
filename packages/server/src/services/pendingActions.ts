// Phase 4 "DM approval before a player-submitted action resolves" — pure
// CRUD + authorization for the pending-request queue. Deliberately has NO
// knowledge of how to actually resolve a request (roll dice, apply damage,
// spend a resource) — that dispatch lives in routes/pendingActions.ts, which
// already needs to import applyDamage/applyMonsterInstanceDamage/
// castFromEncounter/performShove/performGrapple for the DM's own
// unconditional path elsewhere; keeping this file a leaf module (only
// authz.ts + errors.ts) avoids a five-way import cycle with those services,
// each of which calls createPendingAction below.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm } from './authz.js';

export type PendingActionKind = 'attack_character' | 'attack_monster' | 'cast' | 'shove' | 'grapple';
export type PendingActionStatus = 'pending' | 'approved' | 'rejected';

export interface PendingActionRequestRow {
  id: string;
  encounter_id: string;
  campaign_id: string;
  requested_by_user_id: string;
  actor_participant_id: string;
  target_participant_ids: string[];
  kind: PendingActionKind;
  label: string;
  payload: unknown;
  status: PendingActionStatus;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
}

/** Returned by a resolver (applyDamage/applyMonsterInstanceDamage/castFromEncounter/
 * performShove/performGrapple) instead of its normal result when the caller is a
 * non-DM whose action must wait for DM approval — the route checks for this
 * shape and responds/broadcasts differently instead of the normal success path. */
export interface PendingActionCreated {
  pending: true;
  request: PendingActionRequestRow;
}

export async function createPendingAction(
  pool: Pool,
  params: {
    encounterId: string;
    campaignId: string;
    requestedByUserId: string;
    actorParticipantId: string;
    targetParticipantIds: string[];
    kind: PendingActionKind;
    label: string;
    payload: unknown;
  },
): Promise<PendingActionRequestRow> {
  const result = await pool.query<PendingActionRequestRow>(
    `INSERT INTO pending_action_requests
       (encounter_id, campaign_id, requested_by_user_id, actor_participant_id, target_participant_ids, kind, label, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [
      params.encounterId,
      params.campaignId,
      params.requestedByUserId,
      params.actorParticipantId,
      params.targetParticipantIds,
      params.kind,
      params.label,
      JSON.stringify(params.payload),
    ],
  );
  return result.rows[0]!;
}

// DM sees every pending/resolved request for the encounter (a real review
// queue needs the full history, not just what's still open); a player sees
// only their OWN requests, at any status — enough to watch a submission move
// from pending to approved/rejected, never another player's.
export async function listPendingActions(
  pool: Pool,
  actorId: string,
  encounterId: string,
): Promise<PendingActionRequestRow[]> {
  const encounterRes = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM encounters WHERE id = $1`, [encounterId]);
  const row = encounterRes.rows[0];
  if (!row) throw notFound('Encounter');
  const role = await requireMembership(pool, row.campaign_id, actorId);

  if (role === 'dm') {
    const result = await pool.query<PendingActionRequestRow>(
      `SELECT * FROM pending_action_requests WHERE encounter_id = $1 ORDER BY created_at ASC`,
      [encounterId],
    );
    return result.rows;
  }
  const result = await pool.query<PendingActionRequestRow>(
    `SELECT * FROM pending_action_requests WHERE encounter_id = $1 AND requested_by_user_id = $2 ORDER BY created_at ASC`,
    [encounterId, actorId],
  );
  return result.rows;
}

/** Unauthorized, unfiltered read-by-id — for routes/pendingActions.ts to
 * re-read the final row right after it just resolved/authorized the same
 * request itself within the same call, where re-running the pending-only
 * check in fetchPendingForResolution below would spuriously reject it. */
export async function fetchPendingById(pool: Pool, requestId: string): Promise<PendingActionRequestRow> {
  const result = await pool.query<PendingActionRequestRow>(`SELECT * FROM pending_action_requests WHERE id = $1`, [requestId]);
  const row = result.rows[0];
  if (!row) throw notFound('Pending action request');
  return row;
}

/** DM-authorizes and returns the row if it's still pending — the shared entry
 * point both the approve and reject routes call before doing anything else. */
export async function fetchPendingForResolution(pool: Pool, actorId: string, requestId: string): Promise<PendingActionRequestRow> {
  const result = await pool.query<PendingActionRequestRow>(`SELECT * FROM pending_action_requests WHERE id = $1`, [requestId]);
  const row = result.rows[0];
  if (!row) throw notFound('Pending action request');
  const role = await requireMembership(pool, row.campaign_id, actorId);
  requireDm(role);
  if (row.status !== 'pending') {
    throw new AppError('CONFLICT', 'This request has already been resolved');
  }
  return row;
}

export async function markPendingApproved(
  pool: Pool,
  actorId: string,
  requestId: string,
  result: unknown,
): Promise<PendingActionRequestRow> {
  const updated = await pool.query<PendingActionRequestRow>(
    `UPDATE pending_action_requests
     SET status = 'approved', resolved_by_user_id = $1, resolved_at = now(), result = $2::jsonb, error = NULL
     WHERE id = $3
     RETURNING *`,
    [actorId, JSON.stringify(result), requestId],
  );
  return updated.rows[0]!;
}

export async function markPendingFailed(pool: Pool, requestId: string, errorMessage: string): Promise<void> {
  // Stays 'pending' — a failed resolution attempt (e.g. stale target data)
  // shouldn't silently discard the request; the DM sees the error and can
  // retry approval or reject it outright.
  await pool.query(`UPDATE pending_action_requests SET error = $1 WHERE id = $2`, [errorMessage, requestId]);
}

export async function markPendingRejected(pool: Pool, actorId: string, requestId: string): Promise<PendingActionRequestRow> {
  const updated = await pool.query<PendingActionRequestRow>(
    `UPDATE pending_action_requests
     SET status = 'rejected', resolved_by_user_id = $1, resolved_at = now()
     WHERE id = $2
     RETURNING *`,
    [actorId, requestId],
  );
  return updated.rows[0]!;
}
