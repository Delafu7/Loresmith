// Server-authoritative d20 dice roller (Phase 3.4, PLAN.md §3.5/§4.4/§5.7).
// The RNG lives here and ONLY here — the client never computes or submits a
// roll result, closing the obvious cheating vector (PLAN.md tradeoff #2,
// §4.3) where a player-supplied "result" could just be lied about. Same
// `1 + Math.floor(Math.random() * 20)` idiom as services/encounters.ts's
// rollInitiative.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireControllerOrDm, requireNotSpectator, type CampaignRole } from './authz.js';
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
  created_at: Date;
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

  // ---- server RNG: advantage/disadvantage always rolls exactly 2 d20s (the
  // schema's .refine already guarantees diceSides===20 whenever keep isn't
  // 'normal') and keeps the max/min; 'normal' rolls `diceCount` dice of
  // `diceSides` and sums ALL of them — this generalizes the old single-d20
  // case (diceCount defaults to 1, so summing "all of them" is just that one
  // die) to arbitrary NdM expressions like "2d6+3" for damage/custom rolls.
  const rollCount = input.keep === 'normal' ? input.diceCount : 2;
  const rolls = Array.from({ length: rollCount }, () => rollDie(input.diceSides));
  const keptTotal =
    input.keep === 'advantage'
      ? Math.max(...rolls)
      : input.keep === 'disadvantage'
        ? Math.min(...rolls)
        : rolls.reduce((sum, r) => sum + r, 0);
  const resultTotal = keptTotal + input.modifier;

  // A single INSERT is already atomic on its own — there's no second write
  // (no sync_seq bump, no companion row) that needs to commit alongside it,
  // unlike e.g. addParticipant/insertActiveEffect's explicit BEGIN/COMMIT
  // blocks — so plain pool.query() is enough to make this "transactional"
  // in the sense that matters here (same as createNote/createEncounter).
  const result = await pool.query<DiceRollRow>(
    `INSERT INTO dice_rolls
       (campaign_id, user_id, character_id, monster_instance_id, encounter_id, roll_type, roll_context,
        d20_rolls, keep, dice_sides, dice_count, modifier, result_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
    ],
  );
  return result.rows[0]!;
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
  _role: CampaignRole,
  query: ListDiceRollsQuery,
): Promise<ListDiceRollsResult> {
  const conditions = ['campaign_id = $1'];
  const values: unknown[] = [campaignId];

  if (query.encounterId !== undefined) {
    values.push(query.encounterId);
    conditions.push(`encounter_id = $${values.length}`);
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
