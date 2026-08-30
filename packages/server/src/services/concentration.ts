// Concentration-broken save check (Phase 2 of the backlog implementation
// plan). SRD rule: taking damage while concentrating on a spell/effect
// forces a Constitution saving throw, DC = max(10, floor(damage / 2)), capped
// at 30; a failed save ends concentration. This module only computes the DC
// and finds the effect a check would apply to — the actual save roll reuses
// the existing dice-rolls endpoint (no new roll primitive needed), and a
// failed save removes the effect via the existing DELETE /effects/:id
// (services/effects.ts's removeEffect, already DM-only — "DM adjudicates
// the failure" falls out of that for free).

import type { Pool, PoolClient } from 'pg';

// DC capped at 30 per Rules Glossary "Concentration" (docs/players-handbook-2024/
// Rules Glossary/rulesGlossary.md:515): "up to a maximum DC of 30."
export function computeConcentrationDc(damage: number): number {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

export interface ActiveConcentrationEffect {
  id: string;
  effect_definition_id: string;
  name: string;
}

// Reads the row the active_effects_one_concentration_per_character/
// _monster_instance unique indexes (1784269749666_create-active-effects.ts)
// already guarantee is at most one — the lookup is cheap and correctness-
// guaranteed by that constraint, not by anything this query does itself.
export async function findActiveConcentrationEffect(
  client: Pool | PoolClient,
  target: { characterId: string | null; monsterInstanceId: string | null },
): Promise<ActiveConcentrationEffect | null> {
  const column = target.characterId != null ? 'character_id' : 'monster_instance_id';
  const targetId = target.characterId ?? target.monsterInstanceId;
  if (targetId == null) return null;

  const result = await client.query<ActiveConcentrationEffect>(
    `SELECT ae.id, ae.effect_definition_id, ed.name
     FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.${column} = $1 AND ae.concentration = true AND ae.removed_at IS NULL
     LIMIT 1`,
    [targetId],
  );
  return result.rows[0] ?? null;
}
