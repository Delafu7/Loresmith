// rest_events/rest_event_characters: short/long rest handling for
// POST /campaigns/:id/rests (DM-only, see routes/rests.ts for the
// authorization-matrix note this endpoint's role gate follows).
//
// Long rest: hp_current -> hp_max, restore floor(total_hit_dice/2) (min 1)
// hit dice (capped per die type), reset every character_resource_pools row
// with recharge_on IN ('short_rest','long_rest','dawn') to max_value.
// Short rest: only recharge_on='short_rest' pools reset — no HP, no hit
// dice. A real short rest lets a player optionally SPEND hit dice to heal,
// which is a player choice/action, not a bulk DM effect; that's out of scope
// here per the task brief, so this endpoint deliberately does not touch HP
// or hit_dice_remaining on a short rest.

import type { Pool, PoolClient } from 'pg';
import { notFound } from '../middleware/errors.js';
import type { RestInput } from '../schemas/rests.js';

interface HitDieTypeProgression {
  dieType: string; // e.g. 'd10'
  maxForType: number; // total hit dice of this die type the character has (sum of levels across classes sharing it)
}

/**
 * Pure function (unit-testable without a DB, matching the
 * dexModifier/computeNextTurn precedent in services/encounters.ts):
 * distributes a long rest's hit-dice recovery across a character's die
 * types. 5e lets the PLAYER choose which dice to restore; this endpoint is a
 * bulk DM action with no such choice available, so it picks a fixed,
 * deterministic order (largest die type first) and documents that as the
 * stand-in for the player's choice, rather than inventing a smarter
 * heuristic nothing in the task brief asked for.
 */
export function computeHitDiceRestore(
  progression: HitDieTypeProgression[],
  current: Record<string, number>,
): { hitDiceRemaining: Record<string, number>; restoredCount: number } {
  const totalHitDice = progression.reduce((sum, p) => sum + p.maxForType, 0);
  const toRestore = totalHitDice > 0 ? Math.max(1, Math.floor(totalHitDice / 2)) : 0;

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

async function fetchHitDieProgression(db: Pool | PoolClient, characterId: number): Promise<HitDieTypeProgression[]> {
  const result = await db.query<{ level: number; hit_die: number }>(
    `SELECT cc.level, c.hit_die FROM character_classes cc JOIN classes c ON c.id = cc.class_id WHERE cc.character_id = $1`,
    [characterId],
  );
  return mergeProgressionByDieType(result.rows.map((r) => ({ dieType: `d${r.hit_die}`, maxForType: r.level })));
}

interface CharacterForRest {
  id: number;
  hp_max: number;
  hp_current: number;
  hit_dice_remaining: Record<string, number> | null;
}

export interface RestCharacterResult {
  characterId: number;
  hpBefore: number;
  hpAfter: number;
  resourcesRestored: Record<string, unknown>;
}

export async function performRest(
  pool: Pool,
  actorId: number,
  campaignId: number,
  input: RestInput,
): Promise<{ restEvent: Record<string, unknown>; characters: RestCharacterResult[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const restEventRes = await client.query(
      `INSERT INTO rest_events (campaign_id, rest_type, initiated_by_user_id) VALUES ($1, $2, $3) RETURNING *`,
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
        `SELECT id, hp_max, hp_current, hit_dice_remaining FROM characters WHERE id = $1 AND campaign_id = $2 FOR UPDATE`,
        [characterId, campaignId],
      );
      const character = charRes.rows[0];
      if (!character) throw notFound(`Character ${characterId} in this campaign`);

      const hpBefore = character.hp_current;
      let hpAfter = hpBefore;
      const resourcesRestored: Record<string, unknown> = {};

      if (input.restType === 'long') {
        hpAfter = character.hp_max;

        const progression = await fetchHitDieProgression(client, characterId);
        const restore = computeHitDiceRestore(progression, character.hit_dice_remaining ?? {});
        resourcesRestored.hitDiceRestored = restore.restoredCount;
        resourcesRestored.hitDiceRemaining = restore.hitDiceRemaining;

        await client.query(
          `UPDATE characters SET hp_current = $1, hit_dice_remaining = $2, updated_at = now() WHERE id = $3`,
          [hpAfter, JSON.stringify(restore.hitDiceRemaining), characterId],
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

      await client.query(
        `INSERT INTO rest_event_characters (rest_event_id, character_id, hp_before, hp_after, resources_restored)
         VALUES ($1, $2, $3, $4, $5)`,
        [restEvent.id, characterId, hpBefore, hpAfter, JSON.stringify(resourcesRestored)],
      );

      results.push({ characterId, hpBefore, hpAfter, resourcesRestored });
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

export async function listRests(pool: Pool, campaignId: number) {
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
