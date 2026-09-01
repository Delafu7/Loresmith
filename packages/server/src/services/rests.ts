// rest_events/rest_event_characters: short/long rest handling for
// POST /campaigns/:id/rests (DM-only, see routes/rests.ts for the
// authorization-matrix note this endpoint's role gate follows).
//
// Long rest: hp_current -> hp_max, restore hit dice (capped per die type;
// 2024 restores all spent dice, 2014 restores floor(total_hit_dice/2) min 1
// — see computeHitDiceRestore), reset every character_resource_pools row
// with recharge_on IN ('short_rest','long_rest','dawn') to max_value.
// Short rest: only recharge_on='short_rest' pools reset — no HP, no hit
// dice. A real short rest lets a player optionally SPEND hit dice to heal,
// which is a player choice/action, not a bulk DM effect; that's out of scope
// here per the task brief, so this endpoint deliberately does not touch HP
// or hit_dice_remaining on a short rest.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm } from './authz.js';
import type { RestInput, CompleteRestInput, InterruptRestInput, RestInterruptionReason } from '../schemas/rests.js';

interface HitDieTypeProgression {
  dieType: string; // e.g. 'd10'
  maxForType: number; // total hit dice of this die type the character has (sum of levels across classes sharing it)
}

/**
 * Pure function (unit-testable without a DB, matching the
 * dexModifier/computeNextTurn precedent in services/encounters.ts, and the
 * edition-branching signature of domain/xpBudget.ts's assessEncounterXp):
 * distributes a long rest's hit-dice recovery across a character's die
 * types. 5e lets the PLAYER choose which dice to restore; this endpoint is a
 * bulk DM action with no such choice available, so it picks a fixed,
 * deterministic order (largest die type first) and documents that as the
 * stand-in for the player's choice, rather than inventing a smarter
 * heuristic nothing in the task brief asked for.
 *
 * Edition determines how many dice a Long Rest restores:
 * - 2024: "You regain all lost Hit Points and all spent Hit Point Dice."
 *   (docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:1135, "Long
 *   Rest" § Benefits of the Rest)
 * - 2014: restores only half the character's total hit dice (min 1) — the
 *   2014 SRD formula, kept for campaigns still running that edition.
 */
export function computeHitDiceRestore(
  progression: HitDieTypeProgression[],
  current: Record<string, number>,
  edition: '2014' | '2024',
): { hitDiceRemaining: Record<string, number>; restoredCount: number } {
  const totalHitDice = progression.reduce((sum, p) => sum + p.maxForType, 0);
  const toRestore =
    totalHitDice > 0 ? (edition === '2024' ? totalHitDice : Math.max(1, Math.floor(totalHitDice / 2))) : 0;

  const hitDiceRemaining: Record<string, number> = { ...current };
  let remaining = toRestore;
  const sortedByDieSizeDesc = [...progression].sort(
    (a, b) => parseInt(b.dieType.slice(1), 10) - parseInt(a.dieType.slice(1), 10),
  );
  for (const p of sortedByDieSizeDesc) {
    if (remaining <= 0) break;
    const have = hitDiceRemaining[p.dieType] ?? 0;
    const capacity = p.maxForType - have;
    const take = Math.min(capacity, remaining);
    if (take > 0) {
      hitDiceRemaining[p.dieType] = have + take;
      remaining -= take;
    }
  }
  return { hitDiceRemaining, restoredCount: toRestore - remaining };
}

function mergeProgressionByDieType(progression: HitDieTypeProgression[]): HitDieTypeProgression[] {
  const byType = new Map<string, number>();
  for (const p of progression) byType.set(p.dieType, (byType.get(p.dieType) ?? 0) + p.maxForType);
  return [...byType.entries()].map(([dieType, maxForType]) => ({ dieType, maxForType }));
}

// Exported for services/characters.ts's spendHitDice (P1-8) — the player-
// facing "spend a hit die during a short rest" action needs the same
// per-die-type max a long rest's restore does, to validate both `dieType`
// (must be one this character actually has) and that a spend never needs to
// exceed what character_classes actually grants.
export async function fetchHitDieProgression(db: Pool | PoolClient, characterId: string): Promise<HitDieTypeProgression[]> {
  const result = await db.query<{ level: number; hit_die: number }>(
    `SELECT cc.level, c.hit_die FROM character_classes cc JOIN classes c ON c.id = cc.class_id WHERE cc.character_id = $1`,
    [characterId],
  );
  return mergeProgressionByDieType(result.rows.map((r) => ({ dieType: `d${r.hit_die}`, maxForType: r.level })));
}

interface CharacterForRest {
  id: string;
  hp_max: number;
  hp_current: number;
  hit_dice_remaining: Record<string, number> | null;
  exhaustion_level: number;
}

export interface RestCharacterResult {
  characterId: string;
  hpBefore: number;
  hpAfter: number;
  // docs/roadmap/dnd-2024-gap-analysis.md P2-4 (ER-03) — same "always
  // populated, unchanged outside the branch that actually touches it"
  // pattern as hpBefore/hpAfter: a Short Rest never reduces Exhaustion
  // (rulesGlossary.md line 838 names only the Long Rest), so these are
  // equal for a 'short' rest and exhaustionAfter is exhaustionBefore-1
  // (floored at 0) for a 'long' one.
  exhaustionBefore: number;
  exhaustionAfter: number;
  resourcesRestored: Record<string, unknown>;
}

// docs/roadmap/dnd-2024-gap-analysis.md P2-5 (ER-04) — the actual
// benefit-granting math, extracted out of performRest's loop unchanged so
// completeRest (below) can share it exactly rather than duplicating the
// HP/hit-dice/pool/exhaustion logic a second time. `character` must already
// be locked (`FOR UPDATE`) by the caller — this function only issues the
// UPDATE, it doesn't do its own row-locking read.
async function applyRestBenefits(
  client: PoolClient,
  characterId: string,
  restType: 'short' | 'long',
  srdEdition: '2014' | '2024',
  character: Pick<CharacterForRest, 'hp_max' | 'hit_dice_remaining' | 'exhaustion_level'>,
): Promise<{ hpAfter: number | null; exhaustionAfter: number; resourcesRestored: Record<string, unknown> }> {
  const exhaustionBefore = character.exhaustion_level;
  const resourcesRestored: Record<string, unknown> = {};
  // null = this rest type never touches HP (short rest, per this app's own
  // "spending hit dice is a separate player action" scoping — see the
  // module header comment) — the caller falls back to hpBefore.
  let hpAfter: number | null = null;
  let exhaustionAfter = exhaustionBefore;

  if (restType === 'long') {
    hpAfter = character.hp_max;
    // P2-4 (ER-03) — rulesGlossary.md line 838: "Finishing a Long Rest
    // removes 1 of your Exhaustion levels." Floored at 0, never negative
    // (the CHECK constraint on this column already enforces 0-6, but
    // clamping here keeps the UPDATE's intent explicit rather than relying
    // on the DB to reject an out-of-range write).
    exhaustionAfter = Math.max(0, exhaustionBefore - 1);

    const progression = await fetchHitDieProgression(client, characterId);
    const restore = computeHitDiceRestore(progression, character.hit_dice_remaining ?? {}, srdEdition);
    resourcesRestored.hitDiceRestored = restore.restoredCount;
    resourcesRestored.hitDiceRemaining = restore.hitDiceRemaining;

    await client.query(
      `UPDATE characters SET hp_current = $1, hit_dice_remaining = $2, exhaustion_level = $3, updated_at = now() WHERE id = $4`,
      [hpAfter, JSON.stringify(restore.hitDiceRemaining), exhaustionAfter, characterId],
    );

    const poolsRes = await client.query<{ resource_key: string }>(
      `UPDATE character_resource_pools SET current_value = max_value
       WHERE character_id = $1 AND recharge_on IN ('short_rest','long_rest','dawn')
       RETURNING resource_key`,
      [characterId],
    );
    resourcesRestored.poolsReset = poolsRes.rows.map((r) => r.resource_key);
  } else {
    const poolsRes = await client.query<{ resource_key: string }>(
      `UPDATE character_resource_pools SET current_value = max_value
       WHERE character_id = $1 AND recharge_on = 'short_rest'
       RETURNING resource_key`,
      [characterId],
    );
    resourcesRestored.poolsReset = poolsRes.rows.map((r) => r.resource_key);
  }

  return { hpAfter, exhaustionAfter, resourcesRestored };
}

export async function performRest(
  pool: Pool,
  actorId: string,
  campaignId: string,
  input: RestInput,
): Promise<{ restEvent: Record<string, unknown>; characters: RestCharacterResult[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const campaignRes = await client.query<{ srd_edition: '2014' | '2024' }>(
      `SELECT srd_edition FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    const srdEdition = campaignRes.rows[0]?.srd_edition;
    if (!srdEdition) throw notFound('Campaign');

    const restEventRes = await client.query(
      `INSERT INTO rest_events (campaign_id, rest_type, initiated_by_user_id, status) VALUES ($1, $2, $3, 'completed') RETURNING *`,
      [campaignId, input.restType, actorId],
    );
    const restEvent = restEventRes.rows[0];

    const results: RestCharacterResult[] = [];

    for (const characterId of input.characterIds) {
      // FOR UPDATE: two rests racing against the same character (unlikely,
      // but this is a bulk DM action across possibly-overlapping characterIds
      // lists from concurrent requests) shouldn't interleave their hp/hit-dice
      // read-modify-write.
      const charRes = await client.query<CharacterForRest>(
        `SELECT id, hp_max, hp_current, hit_dice_remaining, exhaustion_level FROM characters WHERE id = $1 AND campaign_id = $2 FOR UPDATE`,
        [characterId, campaignId],
      );
      const character = charRes.rows[0];
      if (!character) throw notFound(`Character ${characterId} in this campaign`);

      const hpBefore = character.hp_current;
      const exhaustionBefore = character.exhaustion_level;
      const { hpAfter, exhaustionAfter, resourcesRestored } = await applyRestBenefits(client, characterId, input.restType, srdEdition, character);
      const effectiveHpAfter = hpAfter ?? hpBefore;

      await client.query(
        `INSERT INTO rest_event_characters (rest_event_id, character_id, hp_before, hp_after, resources_restored)
         VALUES ($1, $2, $3, $4, $5)`,
        [restEvent.id, characterId, hpBefore, effectiveHpAfter, JSON.stringify(resourcesRestored)],
      );

      results.push({ characterId, hpBefore, hpAfter: effectiveHpAfter, exhaustionBefore, exhaustionAfter, resourcesRestored });
    }

    await client.query('COMMIT');
    return { restEvent, characters: results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// P2-5 (ER-04) — interruptible rests. performRest above is UNCHANGED and
// stays the primary path for the common case (DM knows nothing interrupted
// the rest, resolves it instantly). This is a separate, additive flow for
// when a rest genuinely needs to be tracked as IN PROGRESS so an
// interruption partway through can be detected/recorded before the DM
// decides what benefits (if any) it ultimately earned.
//
// Scope, confirmed with the user first (docs/roadmap/progress.md has the
// full writeup): this app has no in-game clock anywhere, so "1 hour of
// exertion" and "rested at least 1 hour before the interruption" can't be
// evaluated automatically. Of the 4 rulesGlossary.md interruption sources
// (rolling Initiative, taking damage, casting a non-cantrip spell, 1 hour of
// exertion), only the first two are auto-detected from state this app
// already tracks (services/encounters.ts's rollAndReorderInitiative,
// services/characters.ts's applyDamage); the other two are flagged
// explicitly by the DM via interruptRest below. The "≥1 hour rested before
// the interruption" threshold is likewise DM-supplied (completeRest's
// elapsedMinutes) rather than fabricated from a clock this app doesn't have.
// ============================================================

// Exported for services/characters.ts (applyDamage) and services/
// encounters.ts (rollAndReorderInitiative) — the two auto-detectable
// interruption sources. A no-op (not an error) when the character has no
// in-progress rest, or already-interrupted one: this runs unconditionally
// on every damage application/initiative roll in the app, most of which
// have nothing to do with a rest at all, so silently doing nothing is the
// correct behavior for the overwhelming majority of calls, not an
// exceptional case worth throwing over.
export async function interruptInProgressRest(
  client: Pool | PoolClient,
  characterId: string,
  reason: RestInterruptionReason,
): Promise<void> {
  await client.query(
    `UPDATE rest_event_characters rec
     SET interrupted_at = now(), interruption_reason = $2
     FROM rest_events re
     WHERE rec.rest_event_id = re.id AND re.status = 'in_progress'
       AND rec.character_id = $1 AND rec.interrupted_at IS NULL`,
    [characterId, reason],
  );
}

export interface RestEventRow {
  id: string;
  campaign_id: string;
  rest_type: 'short' | 'long';
  status: 'in_progress' | 'completed';
  occurred_at: string;
  initiated_by_user_id: string | null;
  notes: string | null;
}

export async function startRest(
  pool: Pool,
  actorId: string,
  campaignId: string,
  input: RestInput,
): Promise<{ restEvent: RestEventRow }> {
  requireDm(await requireMembership(pool, campaignId, actorId));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const restEventRes = await client.query<RestEventRow>(
      `INSERT INTO rest_events (campaign_id, rest_type, initiated_by_user_id, status) VALUES ($1, $2, $3, 'in_progress') RETURNING *`,
      [campaignId, input.restType, actorId],
    );
    const restEvent = restEventRes.rows[0]!;

    for (const characterId of input.characterIds) {
      const charRes = await client.query<{ hp_current: number }>(
        `SELECT hp_current FROM characters WHERE id = $1 AND campaign_id = $2 FOR UPDATE`,
        [characterId, campaignId],
      );
      const character = charRes.rows[0];
      if (!character) throw notFound(`Character ${characterId} in this campaign`);
      // rulesGlossary.md lines 1133/1397 — "To start a [Long/Short] Rest,
      // you must have at least 1 Hit Point."
      if (character.hp_current <= 0) {
        throw new AppError('VALIDATION_ERROR', `Character ${characterId} has no Hit Points and can't start a rest`);
      }

      await client.query(
        `INSERT INTO rest_event_characters (rest_event_id, character_id, hp_before) VALUES ($1, $2, $3)`,
        [restEvent.id, characterId, character.hp_current],
      );
    }

    await client.query('COMMIT');
    return { restEvent };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function requireInProgressRestOwnedByCampaign(pool: Pool, actorId: string, restEventId: string): Promise<RestEventRow> {
  const res = await pool.query<RestEventRow>(`SELECT * FROM rest_events WHERE id = $1`, [restEventId]);
  const event = res.rows[0];
  if (!event) throw notFound('Rest event');
  requireDm(await requireMembership(pool, event.campaign_id, actorId));
  return event;
}

export async function interruptRest(pool: Pool, actorId: string, restEventId: string, input: InterruptRestInput): Promise<RestEventRow> {
  const event = await requireInProgressRestOwnedByCampaign(pool, actorId, restEventId);
  if (event.status !== 'in_progress') {
    throw new AppError('CONFLICT', 'This rest has already been completed');
  }

  const updated = await pool.query(
    `UPDATE rest_event_characters SET interrupted_at = now(), interruption_reason = $1
     WHERE rest_event_id = $2 AND character_id = $3 AND interrupted_at IS NULL
     RETURNING character_id`,
    [input.reason, restEventId, input.characterId],
  );
  if (updated.rowCount === 0) {
    throw new AppError('VALIDATION_ERROR', 'That character is not part of this rest, or was already interrupted');
  }
  return event;
}

export interface CompletedRestCharacterResult extends RestCharacterResult {
  wasInterrupted: boolean;
  interruptionReason: RestInterruptionReason | null;
  /** What the character actually got: the rest's own type if uninterrupted;
   * 'short' if a Long Rest was interrupted after >= completeRest's
   * elapsedMinutes threshold (rulesGlossary.md line 1150's partial-credit
   * rule); 'none' otherwise (an interrupted Short Rest, per line 1411,
   * "confers no benefits" — or a Long Rest interrupted too early). */
  effectiveRestType: 'short' | 'long' | 'none';
}

const PARTIAL_CREDIT_THRESHOLD_MINUTES = 60;

export async function completeRest(
  pool: Pool,
  actorId: string,
  restEventId: string,
  input: CompleteRestInput,
): Promise<{ restEvent: RestEventRow; characters: CompletedRestCharacterResult[] }> {
  // Authorize with a plain (pre-transaction) query first — same "check
  // membership/role against `pool`, THEN open the transaction against
  // `client`" split every other resolver in this app uses (shove.ts/
  // grapple.ts/hide.ts), since a PoolClient doesn't structurally satisfy
  // requireMembership's Pool-typed parameter.
  await requireInProgressRestOwnedByCampaign(pool, actorId, restEventId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventRes = await client.query<RestEventRow>(`SELECT * FROM rest_events WHERE id = $1 FOR UPDATE`, [restEventId]);
    const event = eventRes.rows[0];
    if (!event) throw notFound('Rest event');
    if (event.status !== 'in_progress') {
      throw new AppError('CONFLICT', 'This rest has already been completed');
    }

    const campaignRes = await client.query<{ srd_edition: '2014' | '2024' }>(`SELECT srd_edition FROM campaigns WHERE id = $1`, [event.campaign_id]);
    const srdEdition = campaignRes.rows[0]!.srd_edition;

    const participantsRes = await client.query<{
      character_id: string;
      hp_before: number;
      interrupted_at: string | null;
      interruption_reason: RestInterruptionReason | null;
    }>(
      `SELECT character_id, hp_before, interrupted_at, interruption_reason FROM rest_event_characters WHERE rest_event_id = $1`,
      [restEventId],
    );

    const results: CompletedRestCharacterResult[] = [];
    for (const row of participantsRes.rows) {
      const wasInterrupted = row.interrupted_at !== null;
      // rulesGlossary.md lines 1150/1411 — see this section's own header
      // comment for why elapsedMinutes is DM-supplied rather than clocked.
      const effectiveRestType: 'short' | 'long' | 'none' = !wasInterrupted
        ? event.rest_type
        : event.rest_type === 'long' && input.elapsedMinutes >= PARTIAL_CREDIT_THRESHOLD_MINUTES
          ? 'short'
          : 'none';

      const charRes = await client.query<CharacterForRest>(
        `SELECT id, hp_max, hp_current, hit_dice_remaining, exhaustion_level FROM characters WHERE id = $1 FOR UPDATE`,
        [row.character_id],
      );
      const character = charRes.rows[0]!;
      const exhaustionBefore = character.exhaustion_level;

      let hpAfter = row.hp_before;
      let exhaustionAfter = exhaustionBefore;
      let resourcesRestored: Record<string, unknown> = {};
      if (effectiveRestType !== 'none') {
        const applied = await applyRestBenefits(client, row.character_id, effectiveRestType, srdEdition, character);
        hpAfter = applied.hpAfter ?? row.hp_before;
        exhaustionAfter = applied.exhaustionAfter;
        resourcesRestored = applied.resourcesRestored;
      }

      await client.query(
        `UPDATE rest_event_characters SET hp_after = $1, resources_restored = $2 WHERE rest_event_id = $3 AND character_id = $4`,
        [hpAfter, JSON.stringify(resourcesRestored), restEventId, row.character_id],
      );

      results.push({
        characterId: row.character_id,
        hpBefore: row.hp_before,
        hpAfter,
        exhaustionBefore,
        exhaustionAfter,
        resourcesRestored,
        wasInterrupted,
        interruptionReason: row.interruption_reason,
        effectiveRestType,
      });
    }

    const completedRes = await client.query<RestEventRow>(
      `UPDATE rest_events SET status = 'completed' WHERE id = $1 RETURNING *`,
      [restEventId],
    );

    await client.query('COMMIT');
    return { restEvent: completedRes.rows[0]!, characters: results };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listRests(pool: Pool, campaignId: string) {
  const eventsRes = await pool.query(`SELECT * FROM rest_events WHERE campaign_id = $1 ORDER BY occurred_at DESC`, [campaignId]);
  const events = eventsRes.rows;
  if (events.length === 0) return [];

  const ids = events.map((e) => e.id);
  const charsRes = await pool.query(`SELECT * FROM rest_event_characters WHERE rest_event_id = ANY($1)`, [ids]);
  const byEvent = new Map<number, unknown[]>();
  for (const row of charsRes.rows) {
    const list = byEvent.get(row.rest_event_id) ?? [];
    list.push(row);
    byEvent.set(row.rest_event_id, list);
  }
  return events.map((e) => ({ ...e, characters: byEvent.get(e.id) ?? [] }));
}
