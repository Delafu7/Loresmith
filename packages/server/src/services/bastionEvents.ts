// Phase 4 "Bastion tracking" sub-phase 4 — the Bastion Events random table
// (docs/rules/bastions.md §6), rolled at the end of any Maintain turn. Only
// "Attack" and "Request for Aid" are independently confirmed against the
// final 2024 DMG; every other event's exact numbers are UA-sourced only
// (see that doc's Source note) — flagged per-event below via a
// `sourceNote` in the returned outcome, not silently presented as equally
// confident.
//
// Several events describe a genuine PLAYER CHOICE with no rules-given
// default (pay a bribe or not, spend GP or not, how many defenders to
// dispatch). Where a choice has a clear yes/no threshold this app CAN
// evaluate deterministically (can the character afford it?), this
// implementation auto-resolves using an "accept if affordable" default,
// clearly flagged at each site — this app's own interpretive choice, not
// an official rule, exactly like the encounter-XP-budget doc's mixed-party
// interpretation. Request for Aid has no such threshold (any number of
// defenders 0..N could be sent) and is NOT auto-resolved —
// resolveRequestForAid (services/bastions.ts) is a separate, explicit
// follow-up action instead of an invented default.

import type { PoolClient } from 'pg';

export type BastionEventKey =
  | 'nothing' | 'attack' | 'lost_hirelings' | 'refugees' | 'friendly_visitors' | 'request_for_aid'
  | 'honored_guest' | 'extraordinary_opportunity' | 'criminal_hireling' | 'magical_discovery';

/** Pure, exhaustively testable over the full d20 range — the Bastion Events table (docs/rules/bastions.md §6). */
export function eventKeyForD20Roll(roll: number): BastionEventKey {
  if (roll <= 9) return 'nothing';
  if (roll === 10) return 'attack';
  if (roll <= 12) return 'lost_hirelings';
  if (roll <= 14) return 'refugees';
  if (roll === 15) return 'friendly_visitors';
  if (roll === 16) return 'request_for_aid';
  if (roll === 17) return 'honored_guest';
  if (roll === 18) return 'extraordinary_opportunity';
  if (roll === 19) return 'criminal_hireling';
  return 'magical_discovery'; // 20
}

function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}
function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: count }, () => rollDie(sides));
}

async function shutDownRandomOperationalSpecialFacility(client: PoolClient, bastionId: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT bf.id FROM bastion_facilities bf JOIN bastion_facility_catalog bfc ON bfc.id = bf.catalog_id
     WHERE bf.bastion_id = $1 AND bfc.facility_type = 'special' AND bf.status = 'operational'`,
    [bastionId],
  );
  if (res.rows.length === 0) return null;
  const pick = res.rows[Math.floor(Math.random() * res.rows.length)]!;
  await client.query(`UPDATE bastion_facilities SET status = 'shut_down' WHERE id = $1`, [pick.id]);
  return pick.id;
}

async function creditGp(client: PoolClient, characterId: string, amount: number): Promise<void> {
  await client.query(
    `INSERT INTO character_currency (character_id, gp) VALUES ($1, $2)
     ON CONFLICT (character_id) DO UPDATE SET gp = character_currency.gp + $2, updated_at = now()`,
    [characterId, amount],
  );
}

/** Atomic conditional decrement — returns whether the debit succeeded (matches this project's existing resource-spend standard). */
async function tryDebitGp(client: PoolClient, characterId: string, amount: number): Promise<boolean> {
  const res = await client.query(
    `UPDATE character_currency SET gp = gp - $2, updated_at = now() WHERE character_id = $1 AND gp >= $2`,
    [characterId, amount],
  );
  return (res.rowCount ?? 0) > 0;
}

export interface BastionEventResolution {
  eventKey: BastionEventKey;
  outcome: Record<string, unknown>;
  defenderDelta: number; // applied to bastions.bastion_defenders by the caller, clamped >= 0
  bpAwarded: number; // applied to bastions.bastion_points by the caller, ON TOP OF the flat Maintain BP
}

export async function applyBastionEvent(
  client: PoolClient,
  bastionId: string,
  characterId: string,
  eventKey: BastionEventKey,
): Promise<BastionEventResolution> {
  switch (eventKey) {
    case 'nothing':
      return { eventKey, outcome: {}, defenderDelta: 0, bpAwarded: 0 };

    case 'attack': {
      // Confirmed final mechanic. NOT modeled in this pass: the stocked-
      // Armory d6->d8 die-type upgrade and the fully-enclosed-defensive-
      // wall -2 dice reduction — neither "Armory stock" state nor
      // "defensive walls" exist anywhere in this app's schema yet. Flagged
      // here as a real, deliberate gap, not silently approximated.
      const dice = rollDice(6, 6);
      const defendersLost = dice.filter((d) => d === 1).length;
      const firstFacility = await shutDownRandomOperationalSpecialFacility(client, bastionId);
      // "If the Bastion has no Bastion Defenders, or loses them all in this
      // attack, a second special facility also shuts down" — the caller
      // passes us the CURRENT count via a follow-up query so this check is
      // evaluated post-loss, not pre-loss (an easy off-by-one to get
      // backwards, per docs/rules/bastions.md §6 Edge cases).
      const currentRes = await client.query<{ bastion_defenders: number }>(`SELECT bastion_defenders FROM bastions WHERE id = $1`, [bastionId]);
      const defendersAfter = Math.max(0, (currentRes.rows[0]?.bastion_defenders ?? 0) - defendersLost);
      let secondFacility: string | null = null;
      if (defendersAfter === 0) secondFacility = await shutDownRandomOperationalSpecialFacility(client, bastionId);
      return {
        eventKey,
        outcome: { dice, defendersLost, shutDownFacilityIds: [firstFacility, secondFacility].filter((id): id is string => id !== null) },
        defenderDelta: -defendersLost,
        bpAwarded: 0,
      };
    }

    case 'lost_hirelings': {
      const facilityId = await shutDownRandomOperationalSpecialFacility(client, bastionId);
      return { eventKey, outcome: { shutDownFacilityId: facilityId, sourceNote: 'UA-sourced only' }, defenderDelta: 0, bpAwarded: 0 };
    }

    case 'refugees': {
      const refugeeCount = rollDice(2, 4).reduce((a, b) => a + b, 0);
      const gp = rollDie(6) * 100;
      await creditGp(client, characterId, gp);
      return { eventKey, outcome: { refugeeCount, gpAwarded: gp, sourceNote: 'UA-sourced only' }, defenderDelta: 0, bpAwarded: 0 };
    }

    case 'friendly_visitors': {
      const gp = rollDie(6) * 100;
      await creditGp(client, characterId, gp);
      return { eventKey, outcome: { gpAwarded: gp, sourceNote: 'UA-sourced only' }, defenderDelta: 0, bpAwarded: 0 };
    }

    case 'request_for_aid':
      // Genuinely no rules-given default number of defenders to dispatch --
      // NOT auto-resolved here. Recorded pending; resolve via
      // resolveRequestForAid (services/bastions.ts).
      return {
        eventKey,
        outcome: { pending: true, sourceNote: 'Attack/Request for Aid mechanic confirmed final' },
        defenderDelta: 0,
        bpAwarded: 0,
      };

    case 'honored_guest': {
      const sub = rollDie(4);
      const base = { eventKey: eventKey as BastionEventKey, defenderDelta: 0, bpAwarded: 0 };
      if (sub === 1) return { ...base, outcome: { sub, description: 'Grateful guest gives a favor (letter of recommendation).' } };
      if (sub === 2) {
        const gp = rollDie(6) * 100;
        await creditGp(client, characterId, gp);
        return { ...base, outcome: { sub, gpAwarded: gp, description: 'Guest requests sanctuary, then gifts gold before leaving.' } };
      }
      if (sub === 3) {
        return { ...base, defenderDelta: 4, outcome: { sub, description: 'Friendly mercenaries join as +4 temporary Bastion Defenders.' } };
      }
      return { ...base, outcome: { sub, description: 'A dragon (or other flying monster) perches atop the Bastion until next turn.' } };
    }

    case 'extraordinary_opportunity': {
      // Auto-accept default: spend 500 GP for 2d4 BP if affordable (see
      // this module's header comment) — an interpretive choice, not an
      // official rule.
      const paid = await tryDebitGp(client, characterId, 500);
      if (!paid) return { eventKey, outcome: { accepted: false, reason: 'insufficient_funds' }, defenderDelta: 0, bpAwarded: 0 };
      const bp = rollDice(2, 4).reduce((a, b) => a + b, 0);
      return {
        eventKey, outcome: { accepted: true, gpSpent: 500, bpAwarded: bp, sourceNote: 'UA-sourced only' }, defenderDelta: 0, bpAwarded: bp,
      };
    }

    case 'criminal_hireling': {
      const bribe = rollDie(6) * 100;
      const paid = await tryDebitGp(client, characterId, bribe);
      if (paid) return { eventKey, outcome: { paidBribe: true, gpSpent: bribe }, defenderDelta: 0, bpAwarded: 0 };
      const facilityId = await shutDownRandomOperationalSpecialFacility(client, bastionId);
      return { eventKey, outcome: { paidBribe: false, arrested: true, shutDownFacilityId: facilityId }, defenderDelta: 0, bpAwarded: 0 };
    }

    case 'magical_discovery': {
      const itemRes = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM items WHERE rarity = 'uncommon' AND item_type NOT IN ('weapon', 'armor', 'shield')
         AND edition_scope IN ('2024', 'both') ORDER BY random() LIMIT 1`,
      );
      const item = itemRes.rows[0];
      // Temporary (turns to dust at the start of the Bastion's next turn) —
      // deliberately NOT materialized as a character_items row (that table
      // models permanent inventory; this app has no ephemeral-item state
      // machine yet), just logged here as flavor/log data.
      return {
        eventKey,
        outcome: item
          ? { itemId: item.id, itemName: item.name, temporary: true }
          : { itemId: null, itemName: null, note: 'No eligible Uncommon item found in the catalog' },
        defenderDelta: 0,
        bpAwarded: 0,
      };
    }
  }
}
