// Server-authoritative d20 dice roller (Phase 3.4, PLAN.md §3.5/§4.4/§5.7).
// The RNG lives here and ONLY here — the client never computes or submits a
// roll result, closing the obvious cheating vector (PLAN.md tradeoff #2,
// §4.3) where a player-supplied "result" could just be lied about. Same
// `1 + Math.floor(Math.random() * 20)` idiom as services/encounters.ts's
// rollInitiative.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireControllerOrDm, requireDm, requireNotSpectator, type CampaignRole } from './authz.js';
import { fetchCharacterOrThrow } from './characters.js';
import type { CreateDiceRollInput, ListDiceRollsQuery } from '../schemas/diceRolls.js';

export interface DiceRollRow {
  id: string;
  campaign_id: string;
  user_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  encounter_id: string | null;
  roll_type: string;
  roll_context: string | null;
  d20_rolls: number[];
  keep: 'normal' | 'advantage' | 'disadvantage';
  dice_sides: number;
  dice_count: number;
  modifier: number;
  result_total: number;
  is_critical: boolean;
  visibility: 'public' | 'gm_only' | 'private';
  visible_to_user_id: string | null;
  is_manual: boolean;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  created_at: Date;
}

// Iteration 3 §2.4 — a roll is visible to a viewer if: the viewer is the
// DM (always), the roll is 'public', the viewer IS the roller (you can
// always see your own roll regardless of who else can), or the roll is
// 'private' and addressed to exactly this viewer. 'gm_only' is the one
// visibility a non-DM, non-roller can never see. Shared between
// listDiceRolls' SQL predicate and any JS-side enrichment (e.g. roll-request
// target views) that needs the identical rule — never two independently
// maintained copies of this logic.
export function isRollVisibleToViewer(
  roll: Pick<DiceRollRow, 'user_id' | 'visibility' | 'visible_to_user_id'>,
  viewerId: string,
  viewerRole: CampaignRole,
): boolean {
  if (viewerRole === 'dm') return true;
  if (roll.user_id === viewerId) return true;
  if (roll.visibility === 'public') return true;
  if (roll.visibility === 'private' && roll.visible_to_user_id === viewerId) return true;
  return false;
}

// Exported for services/characters.ts's/services/monsters.ts's applyDamage
// (REFACTOR-PLAN.md §6) — the damage-application endpoint rolls its own
// dice server-side via this exact same primitive, preserving the "RNG lives
// here and only here" invariant for damage rolls too, not just d20s.
export function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

// Exported for services/spawn.ts's "rolled" HP-on-spawn strategy — parses a
// stat-block hit-dice string like "2d8+2" (monsters.hit_dice) into its three
// components. Never used for player-facing input (nothing in this codebase
// accepts a free-text dice expression from a client — schemas/diceRolls.ts's
// CreateDiceRollInput always supplies diceSides/diceCount/modifier as
// separate numbers), only for parsing this app's own catalog data, so a
// malformed row is a data problem worth surfacing as an error rather than
// silently defaulting.
export interface ParsedHitDice {
  count: number;
  sides: number;
  modifier: number;
}

export function parseHitDice(hitDice: string): ParsedHitDice {
  const match = /^(\d+)d(\d+)\s*([+-]\s*\d+)?$/i.exec(hitDice.trim());
  if (!match) {
    throw new AppError('VALIDATION_ERROR', `Cannot parse hit dice expression "${hitDice}"`);
  }
  return {
    count: Number(match[1]),
    sides: Number(match[2]),
    modifier: match[3] ? Number(match[3].replace(/\s+/g, '')) : 0,
  };
}

// Rolls `count` dice of `sides` and adds `modifier`, floored at 1 — a
// creature's hit-dice roll (unlike a raw damage roll) can never sensibly
// resolve to 0 or negative HP for a freshly-spawned instance.
export function rollHitDice(hitDice: string): number {
  const { count, sides, modifier } = parseHitDice(hitDice);
  let total = modifier;
  for (let i = 0; i < count; i++) total += rollDie(sides);
  return Math.max(1, total);
}

export async function rollDice(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  input: CreateDiceRollInput,
): Promise<DiceRollRow> {
  // Security major M1 — a "bare" roll (neither characterId nor
  // monsterInstanceId) was the only branch of this function with no role
  // check at all: the characterId branch rejects a spectator via
  // requireControllerOrDm, and the monsterInstanceId branch is DM-only, but
  // a spectator supplying neither could still insert a roll row and have it
  // broadcast, violating the "spectator is strictly read-only" contract.
  if (input.characterId === undefined && input.monsterInstanceId === undefined) {
    requireNotSpectator(role);
  }

  // ---- characterId: must belong to THIS campaign; a player may only roll
  // as their own PC, never someone else's (or an NPC) — mirrors the
  // Control-gated, not ownership-gated — rolling dice AS a character is
  // "acting right now" (same reasoning as services/characters.ts's
  // applyHpDelta/applyDamage, see authorizeCharacterAction's comment there).
  // Cross-campaign characterId 404s rather than 403s, same "don't leak
  // existence of another campaign's row" convention as
  // services/monsterCatalog.ts's fetchHomebrewMonsterOrThrow.
  let characterId: string | null = null;
  if (input.characterId !== undefined) {
    const character = await fetchCharacterOrThrow(pool, input.characterId);
    if (character.campaign_id !== campaignId) throw notFound('Character');
    requireControllerOrDm(role, character.controller_user_id, character.owner_user_id, actorId);
    characterId = input.characterId;
  }

  // ---- monsterInstanceId: DM-only (players never roll for monsters), and
  // must belong to this campaign.
  let monsterInstanceId: string | null = null;
  if (input.monsterInstanceId !== undefined) {
    if (role !== 'dm') {
      throw new AppError('FORBIDDEN_ROLE', 'Only the DM can roll for a monster instance');
    }
    const instanceRes = await pool.query<{ campaign_id: string }>(
      `SELECT campaign_id FROM monster_instances WHERE id = $1`,
      [input.monsterInstanceId],
    );
    const instanceRow = instanceRes.rows[0];
    if (!instanceRow || instanceRow.campaign_id !== campaignId) throw notFound('Monster instance');
    monsterInstanceId = input.monsterInstanceId;
  }

  // ---- encounterId: optional (rolls can happen outside combat), but if
  // supplied it must belong to this campaign — same cross-campaign 404
  // convention as above.
  let encounterId: string | null = null;
  if (input.encounterId !== undefined) {
    const encounterRes = await pool.query<{ campaign_id: string }>(
      `SELECT campaign_id FROM encounters WHERE id = $1`,
      [input.encounterId],
    );
    const encounterRow = encounterRes.rows[0];
    if (!encounterRow || encounterRow.campaign_id !== campaignId) throw notFound('Encounter');
    encounterId = input.encounterId;
  }

  // ---- visibility: only the DM may create anything but a 'public' roll —
  // "conditions/secrets are a DM tool" is this app's existing convention
  // (see encounters/ActionEconomyPanel.tsx's Dodge comment). A 'private'
  // roll's target must be an actual campaign member — never leak whether
  // an arbitrary user id exists by letting a private roll silently address
  // someone outside the campaign.
  if (input.visibility !== 'public') requireDm(role);
  if (input.visibility === 'private') {
    const targetRes = await pool.query(
      `SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
      [campaignId, input.visibleToUserId],
    );
    if ((targetRes.rowCount ?? 0) === 0) throw notFound('Campaign member');
  }

  // ---- fulfilling a GM roll request: the target row must belong to THIS
  // actor, in THIS campaign, and still be pending — never let a roll claim
  // to fulfill someone else's request or double-fulfill an already-rolled
  // one.
  let requestTargetId: string | null = null;
  if (input.fulfillsRequestTargetId !== undefined) {
    const targetRes = await pool.query<{ id: string; user_id: string; campaign_id: string; status: string }>(
      `SELECT t.id, t.user_id, t.status, r.campaign_id
       FROM dice_roll_request_targets t JOIN dice_roll_requests r ON r.id = t.request_id
       WHERE t.id = $1`,
      [input.fulfillsRequestTargetId],
    );
    const target = targetRes.rows[0];
    if (!target || target.campaign_id !== campaignId) throw notFound('Roll request');
    // The targeted player fulfills their own request normally; the DM may
    // also fulfill it on a player's behalf (e.g. secretly rolling a passive
    // check FOR them, gm_only) — no other player may fulfill someone else's.
    if (role !== 'dm' && target.user_id !== actorId) {
      throw new AppError('FORBIDDEN_NOT_OWNER', 'This roll request was not sent to you');
    }
    if (target.status !== 'pending') throw new AppError('CONFLICT', 'This roll request has already been fulfilled or passed');
    requestTargetId = target.id;
  }

  // ---- server RNG: advantage/disadvantage always rolls exactly 2 d20s (the
  // schema's .refine already guarantees diceSides===20 whenever keep isn't
  // 'normal') and keeps the max/min; 'normal' rolls `diceCount` dice of
  // `diceSides` and sums ALL of them — this generalizes the old single-d20
  // case (diceCount defaults to 1, so summing "all of them" is just that one
  // die) to arbitrary NdM expressions like "2d6+3" for damage/custom rolls.
  // Manual entry (physical dice, schema-validated to already have the right
  // length/range) substitutes for rollDie entirely — same downstream
  // math either way, only the SOURCE of the raw values differs.
  const rollCount = input.keep === 'normal' ? input.diceCount : 2;
  const rolls = input.manualRolls ?? Array.from({ length: rollCount }, () => rollDie(input.diceSides));
  const keptTotal =
    input.keep === 'advantage'
      ? Math.max(...rolls)
      : input.keep === 'disadvantage'
        ? Math.min(...rolls)
        : rolls.reduce((sum, r) => sum + r, 0);
  const resultTotal = keptTotal + input.modifier;

  // A plain single INSERT is atomic on its own — no second write needed
  // unless this roll fulfills a request, in which case the target-row
  // update must commit atomically alongside it (never leave a request
  // target 'pending' after its roll already exists, or vice versa).
  const client = requestTargetId !== null ? await pool.connect() : pool;
  try {
    if (requestTargetId !== null) await (client as PoolClient).query('BEGIN');

    const result = await client.query<DiceRollRow>(
      `INSERT INTO dice_rolls
         (campaign_id, user_id, character_id, monster_instance_id, encounter_id, roll_type, roll_context,
          d20_rolls, keep, dice_sides, dice_count, modifier, result_total, visibility, visible_to_user_id, is_manual)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        campaignId,
        actorId,
        characterId,
        monsterInstanceId,
        encounterId,
        input.rollType,
        input.rollContext ?? null,
        rolls,
        input.keep,
        input.diceSides,
        input.diceCount,
        input.modifier,
        resultTotal,
        input.visibility,
        input.visibleToUserId ?? null,
        input.manualRolls !== undefined,
      ],
    );
    const roll = result.rows[0]!;

    if (requestTargetId !== null) {
      await client.query(
        `UPDATE dice_roll_request_targets SET status = 'rolled', dice_roll_id = $1, responded_at = now() WHERE id = $2`,
        [roll.id, requestTargetId],
      );
      await (client as PoolClient).query('COMMIT');
    }
    return roll;
  } catch (err) {
    if (requestTargetId !== null) await (client as PoolClient).query('ROLLBACK');
    throw err;
  } finally {
    if (requestTargetId !== null) (client as PoolClient).release();
  }
}

// Security major M3 — services/characters.ts's applyDamage and
// services/monsters.ts's applyMonsterInstanceDamage used to trust a plain
// client-supplied `isCritical` boolean to decide whether to double the
// damage dice, letting any authorized caller request double damage
// regardless of what was actually rolled. This re-derives criticality from
// the ACTUAL stored d20 roll the damage claims to follow from — the kept
// die (never the discarded one under disadvantage, matching docs/rules/
// attacks-and-damage.md §1.5/§3, same logic as the frontend's own
// keptDieIndex in components/DiceRoller.tsx) must be a natural 20 on a d20
// roll belonging to the SAME campaign as the actor. A missing/foreign/
// non-d20 roll id is never a critical, not an error — the caller may
// legitimately have no attack roll to reference (a DM's manual correction).
export async function deriveIsCriticalFromAttackRoll(
  pool: Pool,
  campaignId: string,
  attackRollId: string | undefined,
): Promise<boolean> {
  if (!attackRollId) return false;
  const res = await pool.query<Pick<DiceRollRow, 'd20_rolls' | 'keep' | 'dice_sides'>>(
    `SELECT d20_rolls, keep, dice_sides FROM dice_rolls WHERE id = $1 AND campaign_id = $2`,
    [attackRollId, campaignId],
  );
  const row = res.rows[0];
  if (!row || row.dice_sides !== 20 || row.d20_rolls.length === 0) return false;
  const keptIndex =
    row.d20_rolls.length <= 1
      ? 0
      : row.keep === 'disadvantage'
        ? row.d20_rolls.indexOf(Math.min(...row.d20_rolls))
        : row.d20_rolls.indexOf(Math.max(...row.d20_rolls));
  return row.d20_rolls[keptIndex] === 20;
}

// ---- GET /campaigns/:id/dice-rolls — keyset (cursor) pagination ----
//
// First cursor-paginated endpoint in this codebase, so there's no existing
// pattern to copy. Keyset over (created_at DESC, id DESC): the cursor is an
// opaque base64url-encoded {createdAt, id} pointing at the last row of the
// previous page, and the next page selects strictly-older rows via a
// tuple comparison. This avoids the classic OFFSET-pagination problem where
// a new roll landing mid-scroll shifts every subsequent page by one.

const PAGE_SIZE = 30;

interface DecodedCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(row: Pick<DiceRollRow, 'created_at' | 'id'>): string {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return Buffer.from(JSON.stringify({ createdAt, id: row.id })).toString('base64url');
}

function decodeCursor(cursor: string): DecodedCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
      typeof (parsed as Record<string, unknown>).id !== 'string'
    ) {
      throw new Error('malformed cursor shape');
    }
    return parsed as DecodedCursor;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid cursor');
  }
}

export interface ListDiceRollsResult {
  rolls: DiceRollRow[];
  nextCursor: string | null;
}

export async function listDiceRolls(
  pool: Pool,
  campaignId: string,
  actorId: string,
  role: CampaignRole,
  query: ListDiceRollsQuery,
): Promise<ListDiceRollsResult> {
  const conditions = ['campaign_id = $1'];
  const values: unknown[] = [campaignId];

  if (query.encounterId !== undefined) {
    values.push(query.encounterId);
    conditions.push(`encounter_id = $${values.length}`);
  }

  if (query.characterId !== undefined) {
    values.push(query.characterId);
    conditions.push(`character_id = $${values.length}`);
  }

  // Iteration 3 §2.4 visibility — same rule as isRollVisibleToViewer, kept
  // as SQL (not a JS filter after the fact) so keyset pagination sees a
  // consistent page size: a 'gm_only' row hidden from a player must never
  // count toward that player's PAGE_SIZE-row page only to be silently
  // dropped client-side.
  if (role !== 'dm') {
    values.push(actorId);
    const actorParam = values.length;
    conditions.push(`(visibility = 'public' OR user_id = $${actorParam} OR visible_to_user_id = $${actorParam})`);
  }

  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor);
    values.push(decoded.createdAt, decoded.id);
    const createdAtParam = values.length - 1;
    const idParam = values.length;
    conditions.push(`(created_at, id) < ($${createdAtParam}::timestamptz, $${idParam})`);
  }

  // Fetch one extra row past the page size purely to detect "is there a next
  // page" without a second COUNT query; the extra row is trimmed below and
  // never returned to the caller.
  values.push(PAGE_SIZE + 1);
  const limitParam = values.length;

  const result = await pool.query<DiceRollRow>(
    `SELECT * FROM dice_rolls WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${limitParam}`,
    values,
  );

  const hasMore = result.rows.length > PAGE_SIZE;
  const rolls = hasMore ? result.rows.slice(0, PAGE_SIZE) : result.rows;
  const nextCursor = hasMore ? encodeCursor(rolls[rolls.length - 1]!) : null;
  return { rolls, nextCursor };
}

// ---- Void, not delete (Iteration 3 §2.4) ----
//
// "One action = one roll record" — a voided roll stays in history (struck
// through in the UI, never physically removed), same discipline as
// combat_participants rows being marked left_round rather than deleted, or
// active_effects using removed_at rather than DELETE. DM, or the roller
// themself, may void — matches this app's existing "DM tool, or your own
// resource" authorization shape (e.g. requireOwnerOrDm).
export async function voidDiceRoll(pool: Pool, campaignId: string, actorId: string, role: CampaignRole, rollId: string): Promise<DiceRollRow> {
  const existing = await pool.query<DiceRollRow>(`SELECT * FROM dice_rolls WHERE id = $1 AND campaign_id = $2`, [rollId, campaignId]);
  const roll = existing.rows[0];
  if (!roll) throw notFound('Dice roll');
  if (role !== 'dm' && roll.user_id !== actorId) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You can only void your own rolls');
  }
  if (roll.voided_at !== null) throw new AppError('CONFLICT', 'This roll has already been voided');

  const result = await pool.query<DiceRollRow>(
    `UPDATE dice_rolls SET voided_at = now(), voided_by_user_id = $1 WHERE id = $2 RETURNING *`,
    [actorId, rollId],
  );
  return result.rows[0]!;
}
