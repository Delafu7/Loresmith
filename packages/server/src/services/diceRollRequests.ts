// GM-initiated "please roll X" fan-out (Iteration 3 §2.3) — the DM asks
// one/several/the whole party for a roll; each targeted player's status
// (pending/rolled/passed) collects in one place rather than the DM having
// to ask verbally and track responses themselves. Fulfillment itself
// happens through the normal POST .../dice-rolls path (see
// services/diceRolls.ts's rollDice `fulfillsRequestTargetId` handling) —
// this file owns only the request/target lifecycle, never rolls dice
// itself.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, type CampaignRole } from './authz.js';
import { isRollVisibleToViewer, type DiceRollRow } from './diceRolls.js';
import type { CreateDiceRollRequestInput } from '../schemas/diceRollRequests.js';

export interface DiceRollRequestRow {
  id: string;
  campaign_id: string;
  encounter_id: string | null;
  requested_by_user_id: string;
  roll_type: string;
  roll_context: string | null;
  dc: number | null;
  created_at: Date;
}

export interface DiceRollRequestTargetRow {
  id: string;
  request_id: string;
  user_id: string;
  character_id: string | null;
  status: 'pending' | 'rolled' | 'passed';
  dice_roll_id: string | null;
  responded_at: Date | null;
}

export interface DiceRollRequestWithTargets {
  request: DiceRollRequestRow;
  targets: DiceRollRequestTargetRow[];
}

// DM-only — every targeted user must actually be a campaign member (never
// silently create a target row for someone outside the campaign). One
// target character per user is resolved from whichever PC that user owns
// in this campaign, if any (best-effort display only — a roll request
// doesn't require the target to have a character, e.g. requesting an
// initiative roll works the same for a spectatorless party member).
export async function createDiceRollRequest(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  input: CreateDiceRollRequestInput,
): Promise<DiceRollRequestWithTargets> {
  requireDm(role);

  const uniqueTargetIds = [...new Set(input.targetUserIds)];
  const memberRes = await pool.query<{ user_id: string; character_id: string | null }>(
    `SELECT cm.user_id, c.id AS character_id
     FROM campaign_members cm
     LEFT JOIN characters c ON c.campaign_id = cm.campaign_id AND c.owner_user_id = cm.user_id AND c.is_pc = true
     WHERE cm.campaign_id = $1 AND cm.user_id = ANY($2::uuid[])`,
    [campaignId, uniqueTargetIds],
  );
  // Any owned PC works if a member owns more than one — first match; the
  // request is addressed to the PLAYER, not a specific character, this is
  // just a display convenience.
  const characterByUser = new Map<string, string | null>();
  for (const row of memberRes.rows) {
    if (!characterByUser.has(row.user_id)) characterByUser.set(row.user_id, row.character_id);
  }
  const missing = uniqueTargetIds.filter((id) => !characterByUser.has(id));
  if (missing.length > 0) throw notFound('Campaign member');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestRes = await client.query<DiceRollRequestRow>(
      `INSERT INTO dice_roll_requests (campaign_id, encounter_id, requested_by_user_id, roll_type, roll_context, dc)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [campaignId, input.encounterId ?? null, actorId, input.rollType, input.rollContext ?? null, input.dc ?? null],
    );
    const request = requestRes.rows[0]!;

    const targets: DiceRollRequestTargetRow[] = [];
    for (const userId of uniqueTargetIds) {
      const targetRes = await client.query<DiceRollRequestTargetRow>(
        `INSERT INTO dice_roll_request_targets (request_id, user_id, character_id)
         VALUES ($1,$2,$3) RETURNING *`,
        [request.id, userId, characterByUser.get(userId) ?? null],
      );
      targets.push(targetRes.rows[0]!);
    }

    await client.query('COMMIT');
    return { request, targets };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const RECENT_REQUEST_LIMIT = 20;

// Any campaign member may read the request list (matches the "whole table
// can see who's rolled" spirit of a group check) — but each target's
// dice_roll_id/roll details are only enriched with the actual roll when
// isRollVisibleToViewer says the viewer is allowed to see that specific
// roll (a request fulfilled by a 'gm_only' or someone-else's-'private'
// roll still shows status='rolled', just without exposing the value).
export async function listDiceRollRequests(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
): Promise<Array<DiceRollRequestWithTargets & { targets: Array<DiceRollRequestTargetRow & { rollVisible: boolean }> }>> {
  const requestsRes = await pool.query<DiceRollRequestRow>(
    `SELECT * FROM dice_roll_requests WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [campaignId, RECENT_REQUEST_LIMIT],
  );
  const requests = requestsRes.rows;
  if (requests.length === 0) return [];

  const targetsRes = await pool.query<DiceRollRequestTargetRow>(
    `SELECT * FROM dice_roll_request_targets WHERE request_id = ANY($1::uuid[]) ORDER BY responded_at NULLS LAST, id`,
    [requests.map((r) => r.id)],
  );
  const rollIds = targetsRes.rows.filter((t) => t.dice_roll_id !== null).map((t) => t.dice_roll_id as string);
  const rollsRes =
    rollIds.length > 0
      ? await pool.query<DiceRollRow>(`SELECT * FROM dice_rolls WHERE id = ANY($1::uuid[])`, [rollIds])
      : { rows: [] as DiceRollRow[] };
  const rollById = new Map(rollsRes.rows.map((r) => [r.id, r]));

  const targetsByRequest = new Map<string, Array<DiceRollRequestTargetRow & { rollVisible: boolean }>>();
  for (const target of targetsRes.rows) {
    const roll = target.dice_roll_id !== null ? rollById.get(target.dice_roll_id) : undefined;
    const rollVisible = roll !== undefined && isRollVisibleToViewer(roll, actorId, role);
    const list = targetsByRequest.get(target.request_id) ?? [];
    list.push({ ...target, rollVisible });
    targetsByRequest.set(target.request_id, list);
  }

  return requests.map((request) => ({ request, targets: targetsByRequest.get(request.id) ?? [] }));
}

// A targeted player (or the DM, correcting on their behalf) explicitly
// declining — never a silent disappearance, per the brief's
// "results collect in one place showing who's rolled/passed/failed."
export async function passDiceRollRequestTarget(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  targetId: string,
): Promise<DiceRollRequestTargetRow> {
  const targetRes = await pool.query<DiceRollRequestTargetRow & { campaign_id: string }>(
    `SELECT t.*, r.campaign_id
     FROM dice_roll_request_targets t JOIN dice_roll_requests r ON r.id = t.request_id
     WHERE t.id = $1`,
    [targetId],
  );
  const target = targetRes.rows[0];
  if (!target || target.campaign_id !== campaignId) throw notFound('Roll request');
  if (role !== 'dm' && target.user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'This roll request was not sent to you');
  }
  if (target.status !== 'pending') throw new AppError('CONFLICT', 'This roll request has already been fulfilled or passed');

  const result = await pool.query<DiceRollRequestTargetRow>(
    `UPDATE dice_roll_request_targets SET status = 'passed', responded_at = now() WHERE id = $1 RETURNING *`,
    [targetId],
  );
  return result.rows[0]!;
}
