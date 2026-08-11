// Phase 4 "Bastion tracking" — turn resolution: issuing special orders (or
// Maintain) to a Bastion, awarding Bastion Points, and (sub-phase 4)
// rolling the Bastion Events table on a Maintain turn. See docs/rules/
// bastions.md §3-4-6 and services/bastionEvents.ts for the event-resolution
// logic itself.

import type { Pool, PoolClient } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireOwnerOrDm, type CampaignRole } from './authz.js';
import { fetchCharacterOrThrow } from './characters.js';
import { fetchBastionScoped } from './bastions.js';
import { applyBastionEvent, eventKeyForD20Roll } from './bastionEvents.js';
import type { ResolveBastionTurnInput } from '../schemas/bastionTurns.js';

interface BastionTurnRow {
  id: string;
  bastion_id: string;
  turn_number: number;
  in_game_day: number;
  was_maintain: boolean;
  event_roll: number | null;
  event_key: string | null;
  event_outcome: Record<string, unknown> | null;
  created_at: string;
}

interface BastionOrderRow {
  id: string;
  bastion_turn_id: string;
  bastion_facility_id: string;
  order_type: string;
  paid_reroll_gp: number | null;
  bp_die_roll: number;
  bp_awarded: number;
  result: Record<string, unknown> | null;
  created_at: string;
}

const BP_DIE_SIDES: Record<string, number> = { '1d4': 4, '1d6': 6, '1d8': 8, '1d10': 10 };
const MEDITATION_CHAMBER_INDEX_KEY = 'bastion_meditation_chamber';
const REROLL_COST_GP = 25;

function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

async function rollBpDie(client: PoolClient, characterId: string, bpDie: string, payReroll: boolean): Promise<{ roll: number; paidGp: number | null }> {
  const sides = BP_DIE_SIDES[bpDie];
  if (!sides) throw new AppError('INTERNAL', `Unrecognized BP die '${bpDie}'`);

  if (!payReroll) return { roll: rollDie(sides), paidGp: null };

  // Atomic conditional decrement, matching this project's existing
  // "UPDATE ... WHERE balance >= cost" standard for resource spends (see
  // PLAN.md's multiplayer-sync-engineer precedent) — 0 rows updated means
  // insufficient funds, translated into a clean AppError rather than
  // silently granting the reroll anyway. A character with no
  // character_currency row at all (0 implied gold) correctly matches zero
  // rows here too, with no special-case needed.
  const spendRes = await client.query(
    `UPDATE character_currency SET gp = gp - $2, updated_at = now() WHERE character_id = $1 AND gp >= $2 RETURNING gp`,
    [characterId, REROLL_COST_GP],
  );
  if (spendRes.rowCount === 0) {
    throw new AppError('VALIDATION_ERROR', `Not enough gold to pay the ${REROLL_COST_GP} GP reroll cost`);
  }
  const first = rollDie(sides);
  const second = rollDie(sides);
  return { roll: Math.max(first, second), paidGp: REROLL_COST_GP };
}

export async function resolveBastionTurn(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
  input: ResolveBastionTurnInput,
): Promise<BastionTurnRow & { orders: BastionOrderRow[] }> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (bastion.status !== 'active') {
    throw new AppError('VALIDATION_ERROR', 'Only an active Bastion can resolve a turn');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const turnNumberRes = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(turn_number), 0) + 1 AS next FROM bastion_turns WHERE bastion_id = $1`,
      [bastionId],
    );
    const turnNumber = turnNumberRes.rows[0]!.next;

    const turnRes = await client.query<BastionTurnRow>(
      `INSERT INTO bastion_turns (bastion_id, turn_number, in_game_day, was_maintain) VALUES ($1, $2, $3, $4) RETURNING *`,
      [bastionId, turnNumber, input.inGameDay, input.maintain],
    );
    let turn = turnRes.rows[0]!;

    let orders: BastionOrderRow[] = [];
    let totalBpAwarded = 0;
    let defenderDelta = 0;

    if (input.maintain) {
      const specialFacilitiesRes = await client.query<{ id: string }>(
        `SELECT bf.id FROM bastion_facilities bf JOIN bastion_facility_catalog bfc ON bfc.id = bf.catalog_id
         WHERE bf.bastion_id = $1 AND bfc.facility_type = 'special' AND bf.status = 'operational'`,
        [bastionId],
      );
      const maintainRolls: Array<{ facilityId: string; roll: number }> = [];
      for (const row of specialFacilitiesRes.rows) {
        const roll = rollDie(4);
        maintainRolls.push({ facilityId: row.id, roll });
        totalBpAwarded += roll;
      }

      // "At the end of any Bastion turn in which a character issues the
      // Maintain order to their Bastion, the DM rolls once on the Bastion
      // Events table" (docs/rules/bastions.md §6) — every Maintain turn
      // rolls, including auto-Maintain-on-absence (which this endpoint
      // treats identically to an explicit Maintain choice; there is no
      // separate "auto" flag).
      const eventRoll = rollDie(20);
      const eventKey = eventKeyForD20Roll(eventRoll);
      const event = await applyBastionEvent(client, bastionId, bastion.owner_character_id, eventKey);
      totalBpAwarded += event.bpAwarded;
      defenderDelta += event.defenderDelta;

      const eventOutcome = { maintainBp: maintainRolls, event: event.outcome };
      await client.query(`UPDATE bastion_turns SET event_roll = $2, event_key = $3, event_outcome = $4 WHERE id = $1`, [
        turn.id, eventRoll, eventKey, JSON.stringify(eventOutcome),
      ]);
      turn = { ...turn, event_roll: eventRoll, event_key: eventKey, event_outcome: eventOutcome };
    } else {
      const facilityIds = input.orders.map((o) => o.facilityId);
      const facilitiesRes = await client.query<{
        id: string; status: string; order_type: string; bp_die: string; name: string; index_key: string;
      }>(
        `SELECT bf.id, bf.status, bfc.order_type, bfc.bp_die, bfc.name, bfc.index_key
         FROM bastion_facilities bf JOIN bastion_facility_catalog bfc ON bfc.id = bf.catalog_id
         WHERE bf.bastion_id = $1 AND bf.id = ANY($2)`,
        [bastionId, facilityIds],
      );
      const facilityById = new Map(facilitiesRes.rows.map((r) => [r.id, r]));
      if (facilityById.size !== new Set(facilityIds).size) throw notFound('Bastion facility');

      for (const row of facilitiesRes.rows) {
        if (row.status !== 'operational') {
          throw new AppError('VALIDATION_ERROR', `${row.name} is shut down and cannot receive an order this turn`);
        }
      }

      // "One order per facility per turn" (docs/rules/bastions.md §4),
      // except Meditation Chamber's Empower order grants one bonus slot
      // usable on a DIFFERENT, already-ordered facility this same turn.
      // Since bastion_facilities already guarantees at most one Meditation
      // Chamber instance per Bastion, at most one bonus slot can ever be
      // granted per turn under this rule.
      const orderCountByFacility = new Map<string, number>();
      for (const facilityId of facilityIds) {
        orderCountByFacility.set(facilityId, (orderCountByFacility.get(facilityId) ?? 0) + 1);
      }
      const meditationChamberOrdered = facilitiesRes.rows.some(
        (r) => r.index_key === MEDITATION_CHAMBER_INDEX_KEY && orderCountByFacility.get(r.id) === 1,
      );
      let bonusSlotsAvailable = meditationChamberOrdered ? 1 : 0;
      for (const [facilityId, count] of orderCountByFacility) {
        const extra = count - 1;
        if (extra <= 0) continue;
        if (facilityById.get(facilityId)?.index_key === MEDITATION_CHAMBER_INDEX_KEY) {
          throw new AppError('VALIDATION_ERROR', 'Meditation Chamber itself cannot receive more than one order this turn');
        }
        if (extra > bonusSlotsAvailable) {
          throw new AppError(
            'VALIDATION_ERROR',
            `${facilityById.get(facilityId)!.name} already has an order this turn (no Meditation Chamber bonus order available)`,
          );
        }
        bonusSlotsAvailable -= extra;
      }

      for (const orderInput of input.orders) {
        const facility = facilityById.get(orderInput.facilityId)!;
        const { roll, paidGp } = await rollBpDie(client, bastion.owner_character_id, facility.bp_die, orderInput.payReroll);
        totalBpAwarded += roll;
        const orderRes = await client.query<BastionOrderRow>(
          `INSERT INTO bastion_orders (bastion_turn_id, bastion_facility_id, order_type, paid_reroll_gp, bp_die_roll, bp_awarded, result)
           VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING *`,
          [
            turn.id, orderInput.facilityId, facility.order_type, paidGp, roll,
            orderInput.resultNote ? JSON.stringify({ note: orderInput.resultNote }) : null,
          ],
        );
        orders.push(orderRes.rows[0]!);
      }
    }

    // Any resolved turn (Maintain or explicit orders) counts as the Bastion
    // having acted -- resets the fall-tracking counter to 0 per this app's
    // documented interpretive choice (docs/rules/bastions.md §7, recommended
    // reading (a)). The counter only INCREMENTS via the explicit
    // markBastionTurnSkipped action (services/bastions.ts) — a cycle where
    // no turn was resolved at all, which by definition never runs through
    // this function.
    await client.query(
      `UPDATE bastions
       SET bastion_points = bastion_points + $2,
           bastion_defenders = GREATEST(0, bastion_defenders + $4),
           last_turn_in_game_day = $3,
           consecutive_turns_without_orders = 0,
           updated_at = now()
       WHERE id = $1`,
      [bastionId, totalBpAwarded, input.inGameDay, defenderDelta],
    );

    await client.query('COMMIT');
    return { ...turn, orders };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Request for Aid (docs/rules/bastions.md §6, confirmed final mechanic) has
 * no rules-given default number of defenders to dispatch, so
 * bastionEvents.ts deliberately leaves it `pending` instead of guessing.
 * This is the explicit follow-up action a player/DM takes once they decide
 * how many Bastion Defenders to send.
 */
export async function resolveRequestForAid(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  turnId: string,
  role: CampaignRole,
  actorId: string,
  defendersSent: number,
): Promise<BastionTurnRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (!Number.isInteger(defendersSent) || defendersSent < 0) {
    throw new AppError('VALIDATION_ERROR', 'defendersSent must be a non-negative integer');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const turnRes = await client.query<BastionTurnRow>(
      `SELECT * FROM bastion_turns WHERE id = $1 AND bastion_id = $2 FOR UPDATE`,
      [turnId, bastionId],
    );
    const turn = turnRes.rows[0];
    if (!turn) throw notFound('Bastion turn');
    if (turn.event_key !== 'request_for_aid') {
      throw new AppError('VALIDATION_ERROR', 'This turn did not roll Request for Aid');
    }
    const existingEvent = (turn.event_outcome as { event?: { pending?: boolean } } | null)?.event;
    if (!existingEvent?.pending) {
      throw new AppError('CONFLICT', 'Request for Aid on this turn has already been resolved');
    }

    const bastionRow = await client.query<{ bastion_defenders: number }>(
      `SELECT bastion_defenders FROM bastions WHERE id = $1 FOR UPDATE`,
      [bastionId],
    );
    const currentDefenders = bastionRow.rows[0]!.bastion_defenders;
    if (defendersSent > currentDefenders) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Cannot dispatch more defenders (${defendersSent}) than the Bastion currently has (${currentDefenders})`,
      );
    }

    const rolls = Array.from({ length: defendersSent }, () => 1 + Math.floor(Math.random() * 6));
    const total = rolls.reduce((a, b) => a + b, 0);
    const success = total >= 10;
    const rewardRoll = 1 + Math.floor(Math.random() * 6);
    const fullReward = rewardRoll * 100;
    const gpAwarded = success ? fullReward : Math.floor(fullReward / 2);
    const defenderLoss = success ? 0 : Math.min(1, defendersSent);

    await client.query(
      `INSERT INTO character_currency (character_id, gp) VALUES ($1, $2)
       ON CONFLICT (character_id) DO UPDATE SET gp = character_currency.gp + $2, updated_at = now()`,
      [bastion.owner_character_id, gpAwarded],
    );
    await client.query(
      `UPDATE bastions SET bastion_defenders = GREATEST(0, bastion_defenders - $2), updated_at = now() WHERE id = $1`,
      [bastionId, defenderLoss],
    );

    const newOutcome = {
      ...(turn.event_outcome as Record<string, unknown>),
      event: { pending: false, defendersSent, rolls, total, success, gpAwarded, defenderLoss },
    };
    const updatedRes = await client.query<BastionTurnRow>(
      `UPDATE bastion_turns SET event_outcome = $2 WHERE id = $1 RETURNING *`,
      [turnId, JSON.stringify(newOutcome)],
    );

    await client.query('COMMIT');
    return updatedRes.rows[0]!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listBastionTurns(pool: Pool, campaignId: string, bastionId: string): Promise<BastionTurnRow[]> {
  await fetchBastionScoped(pool, campaignId, bastionId);
  const result = await pool.query<BastionTurnRow>(
    `SELECT * FROM bastion_turns WHERE bastion_id = $1 ORDER BY turn_number ASC`,
    [bastionId],
  );
  return result.rows;
}
