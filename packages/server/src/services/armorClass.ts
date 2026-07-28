// Character-only AC compute (PLAN.md §3.5). Scoped deliberately narrow: does
// NOT model class-specific Unarmored Defense (Barbarian/Monk) or any other
// exotic AC source — those stay on armor_class_mode='manual', which is
// exactly what the manual-override escape hatch is for. Monster instances
// never get an auto-recompute path at all: monster AC is either the catalog
// monsters.armor_class value or the flat manual monster_instances.
// armor_class_override (see services/monsters.ts's UPDATABLE_COLUMNS, which
// mirrors the existing hp_max_override pattern).
//
// SRD rules modeled here:
// - Unarmored: 10 + Dex modifier.
// - One equipped armor item: armor_class_base + a Dex-mod contribution that
//   depends on the armor's dex_modifier_rule ('full' Dex mod for light
//   armor, capped at +2 via 'max_2' for medium armor, none at all for heavy
//   armor).
// - A shield (a separate character_items row with item_type='shield') adds
//   a flat +2, ADDITIVE on top of whichever base above applies — never a
//   replacement.

import type { PoolClient } from 'pg';
import { notFound } from '../middleware/errors.js';

export type DexModifierRule = 'full' | 'max_2' | 'none';

export interface ArmorForAc {
  armor_class_base: number;
  dex_modifier_rule: DexModifierRule;
}

// Small local pure helper rather than importing services/encounters.ts's
// dexModifier — same "self-contained per service file" precedent
// services/rests.ts's hit-dice distribution cites for encounters.ts's
// dexModifier/computeNextTurn (pure, unit-testable, not cross-imported).
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function computeArmorClass(
  dexScore: number,
  armor: ArmorForAc | null,
  hasShield: boolean,
): number {
  const dexMod = abilityModifier(dexScore);

  let base: number;
  if (armor === null) {
    base = 10 + dexMod;
  } else {
    let dexContribution: number;
    switch (armor.dex_modifier_rule) {
      case 'full':
        dexContribution = dexMod;
        break;
      case 'max_2':
        dexContribution = Math.min(dexMod, 2);
        break;
      case 'none':
        dexContribution = 0;
        break;
    }
    base = armor.armor_class_base + dexContribution;
  }

  return base + (hasShield ? 2 : 0);
}

// ---- Characters-only recompute-and-write-back ----
//
// Callable from within an existing transaction (equip toggle in
// services/characterItems.ts, the generic character PATCH and the
// armor-class-mode toggle in services/characters.ts) since it must be atomic
// with whatever equip/dex/mode change triggered it.

export interface ArmorClassEncounterSync {
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
  participant_id: string;
}

export interface RecomputeArmorClassResult {
  character: Record<string, unknown>;
  changed: boolean;
  encounterSyncs: ArmorClassEncounterSync[];
}

interface CharacterAcRow {
  dex: number;
  armor_class_mode: 'auto' | 'manual';
  armor_class: number;
}

/**
 * Reads the character's current Dex + equipped armor/shield, recomputes AC,
 * and writes it back to characters.armor_class IF armor_class_mode='auto'
 * AND the value actually changed. A no-op (armor_class left untouched,
 * changed: false) in manual mode — the caller shouldn't even be invoking
 * this in manual mode, but it stays safe either way.
 *
 * "More than one equipped armor row simultaneously" is a pre-existing
 * data-modeling gap this app doesn't prevent anywhere else either (nothing
 * stops a client from equipping two item_type='armor' rows on the same
 * character) — this picks one deterministically (lowest character_items.id)
 * rather than adding new validation to close that gap, which is out of scope
 * here.
 *
 * Bumps every live encounter's sync_seq the character is currently a
 * combat_participants row in (same join pattern as services/characters.ts's
 * applyHpDelta / services/effects.ts's bumpAffectedEncounters) in the SAME
 * transaction as the AC write, but ONLY when the AC actually changed — an
 * unchanged recompute must not manufacture a spurious sync_seq bump that
 * would make a reconnecting client believe something changed.
 */
export async function recomputeAndApplyCharacterArmorClass(
  client: PoolClient,
  characterId: string,
): Promise<RecomputeArmorClassResult> {
  const charRes = await client.query<CharacterAcRow>(
    `SELECT dex, armor_class_mode, armor_class FROM characters WHERE id = $1 FOR UPDATE`,
    [characterId],
  );
  const current = charRes.rows[0];
  if (!current) throw notFound('Character');

  if (current.armor_class_mode !== 'auto') {
    const full = await client.query(`SELECT * FROM characters WHERE id = $1`, [characterId]);
    return { character: full.rows[0], changed: false, encounterSyncs: [] };
  }

  const armorRes = await client.query<ArmorForAc>(
    `SELECT i.armor_class_base, i.dex_modifier_rule
     FROM character_items ci
     JOIN items i ON i.id = ci.item_id
     WHERE ci.character_id = $1 AND ci.is_equipped = true AND i.item_type = 'armor'
     ORDER BY ci.id ASC
     LIMIT 1`,
    [characterId],
  );
  const armor = armorRes.rows[0] ?? null;

  const shieldRes = await client.query(
    `SELECT 1
     FROM character_items ci
     JOIN items i ON i.id = ci.item_id
     WHERE ci.character_id = $1 AND ci.is_equipped = true AND i.item_type = 'shield'
     LIMIT 1`,
    [characterId],
  );
  const hasShield = (shieldRes.rowCount ?? 0) > 0;

  const newArmorClass = computeArmorClass(current.dex, armor, hasShield);

  if (newArmorClass === current.armor_class) {
    const full = await client.query(`SELECT * FROM characters WHERE id = $1`, [characterId]);
    return { character: full.rows[0], changed: false, encounterSyncs: [] };
  }

  const result = await client.query(
    `UPDATE characters SET armor_class = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [newArmorClass, characterId],
  );

  const encounterSyncs = await client.query<ArmorClassEncounterSync>(
    `UPDATE encounters e
     SET sync_seq = sync_seq + 1
     FROM combat_participants cp
     WHERE cp.character_id = $1 AND cp.encounter_id = e.id
     RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
    [characterId],
  );

  return { character: result.rows[0], changed: true, encounterSyncs: encounterSyncs.rows };
}
