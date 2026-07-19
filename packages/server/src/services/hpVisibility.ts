// DM-vs-player HP visibility (PLAN.md §5.3). Pure functions only — no DB, no
// socket access — so the room/broadcast layers can reuse the same banding
// logic for both a single HP_CHANGED event and a many-participant
// FULL_STATE_SYNC snapshot without duplicating the math.
//
// Rule of record (never weaken this): a player-role socket must NEVER
// receive hp_current/hp_temp/hp_max on the wire for a 'banded' or 'hidden'
// participant, even as an "ignore this" extra field — a modified client can
// read anything sent, so the redaction has to happen server-side per §5.2's
// "two payloads, not a client-side flag" rule.

import type { Pool } from 'pg';

export type HpVisibility = 'exact' | 'banded' | 'hidden';
export type HpBand = 'Healthy' | 'Injured' | 'Bloodied' | 'Critical' | 'Down';

export interface ExactHp {
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
}

export interface BandedHp {
  band: HpBand;
}

/** Server-side band function, PLAN.md §5.3 — mirrors 5e's own "Bloodied" language. */
export function computeHpBand(hpCurrent: number, hpMax: number): HpBand {
  if (hpCurrent <= 0) return 'Down';
  const pct = hpMax > 0 ? hpCurrent / hpMax : 0;
  if (pct > 0.75) return 'Healthy';
  if (pct > 0.5) return 'Injured';
  if (pct > 0.25) return 'Bloodied';
  return 'Critical';
}

/**
 * Computes the DM payload (always exact) and the player payload for a given
 * participant's hp_visibility. `playerPayload` is `null` for 'hidden' —
 * callers must skip emitting to player sockets entirely in that case, not
 * send a payload with an empty/placeholder hp field.
 */
export function buildHpVariants(
  visibility: HpVisibility,
  hpCurrent: number,
  hpMax: number,
  hpTemp: number,
): { dmPayload: ExactHp; playerPayload: ExactHp | BandedHp | null } {
  const dmPayload: ExactHp = { hpCurrent, hpMax, hpTemp };

  if (visibility === 'exact') {
    return { dmPayload, playerPayload: { hpCurrent, hpMax, hpTemp } };
  }
  if (visibility === 'banded') {
    return { dmPayload, playerPayload: { band: computeHpBand(hpCurrent, hpMax) } };
  }
  return { dmPayload, playerPayload: null };
}

// ---- REST read-path redaction ----
//
// The functions above were originally written for the Socket.io broadcast
// layer only. A pre-merge review found that REST reads of characters and
// monster instances (GET list/detail) returned raw hp_current/hp_max/hp_temp
// to players regardless of hp_visibility, bypassing this entire model —
// these functions close that gap using the same banding rules, so there is
// exactly one place that decides what HP a player is allowed to see.

/**
 * A participant's hp_visibility isn't stored on the character/monster
 * instance itself — it's per-encounter, on combat_participants. Outside of
 * combat (or before ever being added to one), there's nothing to read, so
 * this defaults to 'banded' (never 'exact') — a target must be explicitly
 * placed into combat with visibility set before a player can see its exact
 * numbers. Prefers an active encounter's row if the target is in more than
 * one (e.g. a recurring NPC reused across sessions).
 */
export async function resolveHpVisibility(
  pool: Pool,
  target: { characterId: number } | { monsterInstanceId: number },
): Promise<HpVisibility> {
  const column = 'characterId' in target ? 'character_id' : 'monster_instance_id';
  const id = 'characterId' in target ? target.characterId : target.monsterInstanceId;
  const result = await pool.query<{ hp_visibility: HpVisibility }>(
    `SELECT cp.hp_visibility
     FROM combat_participants cp
     JOIN encounters e ON e.id = cp.encounter_id
     WHERE cp.${column} = $1
     ORDER BY (e.status = 'active') DESC, cp.created_at DESC
     LIMIT 1`,
    [id],
  );
  return result.rows[0]?.hp_visibility ?? 'banded';
}

/**
 * Redacts hp_current/hp_max/hp_temp on a REST row per the visibility rule
 * above, adding an hp_band field for the client to render instead. Returns
 * the row unchanged when `redact` is false (DM role, or an exact-visibility
 * PC) — callers decide whether redaction applies at all before calling this.
 */
export function redactHpFields<T extends { hp_current: number; hp_max: number; hp_temp: number }>(
  row: T,
  visibility: HpVisibility,
): T & { hp_band: HpBand | null } {
  if (visibility === 'exact') {
    return { ...row, hp_band: null };
  }
  const band = visibility === 'banded' ? computeHpBand(row.hp_current, row.hp_max) : null;
  return {
    ...row,
    hp_current: null as unknown as number,
    hp_max: null as unknown as number,
    hp_temp: null as unknown as number,
    hp_band: band,
  };
}
