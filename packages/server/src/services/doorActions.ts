// Player-facing door interaction (open/close/force) — the map-elements CRUD
// surface (routes/encounters.ts's PATCH .../map/elements/:elementId) stays
// requireEncounterDm-only for arbitrary edits, but a door specifically needs
// a genuine player-triggered, server-authoritative action: the client sends
// an intention ("I try to open/close/force this door"), never a claimed
// result — the server rolls (for 'force'), decides the outcome, persists it,
// and the route broadcasts it, same "server is always authoritative" rule
// this app's multiplayer sync already follows everywhere else (HP, combat
// actions, action economy).
//
// docs/rules/actions.md "Doors" section (consulted before writing this file)
// is the source of truth for the mechanics below:
//  - open/close an already-operable door = the free per-turn object
//    interaction (§1.1), same combat_participants.object_interaction_used
//    resource every other object interaction already shares — reuses
//    services/encounters.ts's applyActionEconomy directly rather than a
//    second, independent counter.
//  - forcing a locked/stuck door = a Strength (Athletics) check that spends
//    the Action slot, NOT the object interaction (§1.3) — independent of
//    object_interaction_used, per that doc's own "don't gate one on the
//    other" edge-case note.
//  - the DC is never an SRD number (none exists in either edition) — always
//    read from the door's own props.forceDC, falling back to
//    DEFAULT_FORCE_DOOR_DC only as an app convenience, never silently
//    presented as a rule.
//  - a failed force leaves the door's state untouched; the attempt is
//    logged via the same public dice_rolls row every other check-based
//    action (Shove, Grapple) already uses for this, not a second log.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { applyActionEconomy, getEncounterMap, type ParticipantMutationResult } from './encounters.js';
import { rollDice, type DiceRollRow } from './diceRolls.js';
import { bumpLinkedEncounters, ELEMENT_ROW_COLUMNS, type MapElementRow, type AffectedEncounter } from './mapElements.js';
import type { CampaignRole } from './authz.js';

// App convenience default only — the SRD gives no fixed door-breaking DC in
// either edition (docs/rules/actions.md "Doors" §1.3/§2.4), so this is never
// treated as a rule, only a fallback when a door's own props.forceDC (GM-set
// per door, ElementPropertyPanel.tsx) is absent.
const DEFAULT_FORCE_DOOR_DC = 15;

// Same self-contained per-file helper precedent as services/shove.ts's own
// abilityModifier (not cross-imported from services/armorClass.ts).
function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export type DoorActionKind = 'open' | 'close' | 'force';

export interface DoorActionResult {
  element: MapElementRow;
  affectedEncounters: AffectedEncounter[];
  roll: DiceRollRow | null;
  success: boolean | null;
  message: string;
  /** The action-economy spend this action just made (object interaction for
   * open/close, the action slot for force) — the route broadcasts
   * ACTION_ECONOMY_CHANGED from this, same as every other spend-then-act
   * combat mutation (Shove, Grapple). */
  economy: ParticipantMutationResult;
}

interface DoorProps {
  state?: string;
  forceDC?: number;
}

async function fetchDoorOrThrow(pool: Pool, mapId: string, elementId: string): Promise<MapElementRow> {
  const res = await pool.query<MapElementRow>(
    `SELECT ${ELEMENT_ROW_COLUMNS} FROM map_elements WHERE id = $1 AND map_id = $2 AND type = 'door'`,
    [elementId, mapId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('Door');
  return row;
}

async function performOpenOrClose(
  pool: Pool,
  encounterId: string,
  mapId: string,
  participantId: string,
  elementId: string,
  action: 'open' | 'close',
): Promise<DoorActionResult> {
  const expectedState = action === 'open' ? 'closed' : 'open';
  const nextState = action === 'open' ? 'open' : 'closed';

  // Unlocked pre-check purely to fail fast (and with a clear reason) before
  // spending the player's object interaction on a doomed request — the
  // actual transition below is still guarded by a conditional UPDATE, so a
  // genuine concurrent race (two players opening the same door at once) is
  // rejected with CONFLICT, never silently double-applied.
  const existing = await fetchDoorOrThrow(pool, mapId, elementId);
  const currentState = (existing.props as DoorProps).state;
  if (currentState !== expectedState) {
    throw new AppError('CONFLICT', `Door is ${currentState} — cannot ${action} it`, { reason: 'INVALID_DOOR_STATE' });
  }

  // docs/rules/actions.md §1.1/§1.6/§2.3 — the free per-turn object
  // interaction; throws CONFLICT itself if it's not this participant's turn
  // (during active combat) or the interaction was already spent this turn.
  const economy = await applyActionEconomy(pool, encounterId, participantId, { spend: 'object_interaction' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<MapElementRow>(
      `UPDATE map_elements SET props = jsonb_set(props, '{state}', to_jsonb($1::text)), updated_at = now()
       WHERE id = $2 AND map_id = $3 AND type = 'door' AND props->>'state' = $4
       RETURNING ${ELEMENT_ROW_COLUMNS}`,
      [nextState, elementId, mapId, expectedState],
    );
    const element = updated.rows[0];
    if (!element) {
      await client.query('ROLLBACK');
      // The object interaction above is already spent — same accepted
      // small-inconsistency window services/shove.ts's own "slot spent, then
      // the roll happens after" precedent already carries; a real
      // concurrent state change here is rare enough not to warrant undoing
      // the spend transactionally.
      throw new AppError('CONFLICT', 'Door state changed before this action completed — try again', { reason: 'INVALID_DOOR_STATE' });
    }
    const affectedEncounters = await bumpLinkedEncounters(client, mapId);
    await client.query('COMMIT');
    return {
      element,
      affectedEncounters,
      roll: null,
      success: null,
      message: action === 'open' ? 'The door opens.' : 'The door closes.',
      economy,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function performForce(
  pool: Pool,
  encounterId: string,
  mapId: string,
  participantId: string,
  actorUserId: string,
  actorRole: CampaignRole,
  elementId: string,
): Promise<DoorActionResult> {
  const existing = await fetchDoorOrThrow(pool, mapId, elementId);
  const props = existing.props as DoorProps;
  if (props.state !== 'locked' && props.state !== 'stuck') {
    throw new AppError('CONFLICT', `Door is ${props.state} — nothing to force`, { reason: 'INVALID_DOOR_STATE' });
  }
  const dc = props.forceDC ?? DEFAULT_FORCE_DOOR_DC;

  // docs/rules/actions.md §1.3/§3 — forcing a door spends the Action slot,
  // independent of object_interaction_used (never gate one on the other).
  const economy = await applyActionEconomy(pool, encounterId, participantId, { spend: 'action' });

  const actorRes = await pool.query<{
    character_id: string | null;
    monster_instance_id: string | null;
    str: number | null;
    campaign_id: string;
  }>(
    `SELECT cp.character_id, cp.monster_instance_id, COALESCE(c.str, m.str) AS str, e.campaign_id
     FROM combat_participants cp
     JOIN encounters e ON e.id = cp.encounter_id
     LEFT JOIN characters c ON c.id = cp.character_id
     LEFT JOIN monster_instances mi ON mi.id = cp.monster_instance_id
     LEFT JOIN monsters m ON m.id = mi.monster_id
     WHERE cp.id = $1 AND cp.encounter_id = $2`,
    [participantId, encounterId],
  );
  const actor = actorRes.rows[0];
  if (!actor) throw notFound('Participant');
  const modifier = abilityModifier(actor.str ?? 10);

  // docs/rules/actions.md §1.3 — Strength (Athletics) check; this app's own
  // shove/grapple precedent already simplifies the acting side to a plain
  // ability modifier (no proficiency-bonus lookup), matched here for the
  // same reason those two don't add one either.
  const roll = await rollDice(pool, actor.campaign_id, actorUserId, actorRole, {
    rollType: 'skill_check',
    rollContext: 'Force Door (Athletics)',
    keep: 'normal',
    modifier,
    diceSides: 20,
    diceCount: 1,
    ...(actor.character_id ? { characterId: actor.character_id } : { monsterInstanceId: actor.monster_instance_id! }),
    encounterId,
    visibility: 'public' as const,
  });

  const success = roll.result_total >= dc;
  if (!success) {
    // docs/rules/actions.md §1.3 — no RAW failure consequence beyond "no
    // progress"; the door's state is left untouched, and the (public) roll
    // itself is the log the GM (and everyone else) can see.
    return {
      element: existing,
      affectedEncounters: [],
      roll,
      success,
      message: `Force fails (rolled ${roll.result_total} vs DC ${dc}) — the door holds.`,
      economy,
    };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<MapElementRow>(
      `UPDATE map_elements SET props = jsonb_set(props, '{state}', '"open"'), updated_at = now()
       WHERE id = $1 AND map_id = $2 AND type = 'door' AND props->>'state' IN ('locked', 'stuck')
       RETURNING ${ELEMENT_ROW_COLUMNS}`,
      [elementId, mapId],
    );
    // A concurrent GM edit (or another player's successful force) already
    // resolved this door between the pre-check above and here — rare edge
    // case, not re-thrown as an error: the roll still succeeded and is still
    // reported, it just has nothing left to apply.
    const element = updated.rows[0] ?? existing;
    const affectedEncounters = updated.rows[0] ? await bumpLinkedEncounters(client, mapId) : [];
    await client.query('COMMIT');
    return {
      element,
      affectedEncounters,
      roll,
      success,
      message: `Force succeeds (rolled ${roll.result_total} vs DC ${dc}) — the door bursts open.`,
      economy,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function performDoorAction(
  pool: Pool,
  encounterId: string,
  participantId: string,
  actorUserId: string,
  actorRole: CampaignRole,
  elementId: string,
  action: DoorActionKind,
): Promise<DoorActionResult> {
  const map = await getEncounterMap(pool, encounterId);
  if (!map) throw new AppError('CONFLICT', 'No map configured for this encounter yet');

  if (action === 'force') {
    return performForce(pool, encounterId, map.id, participantId, actorUserId, actorRole, elementId);
  }
  return performOpenOrClose(pool, encounterId, map.id, participantId, elementId, action);
}
