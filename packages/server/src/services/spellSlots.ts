// Multiclass prerequisite validation + spell-slot computation. Both hang off
// PUT /characters/:id/classes (services/characters.ts's replaceClasses):
// prerequisites gate whether the write is even allowed, and slot computation
// runs right after a successful replace to keep character_resource_pools'
// spell_slot_N / warlock_pact_slot_N rows in sync with character_classes —
// those rows are a COMPUTED CACHE (PLAN.md §3.2), never source of truth.

import type { Pool, PoolClient } from 'pg';
import { AppError } from '../middleware/errors.js';

type SpellcastingType = 'full' | 'half' | 'third' | 'pact' | 'none';

// ---- Multiclass prerequisites ----

export interface MulticlassPrereqFailure {
  classId: number;
  className: string;
  abilityIndex: string;
  required: number;
  actual: number;
}

interface MulticlassPrereqRow {
  class_id: number;
  class_name: string;
  ability_index: string;
  minimum_score: number;
  requirement_group: number;
}

interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

/**
 * 5e's real multiclassing rule: to end a level-up multiclassed, EVERY class
 * you'll have — the one(s) you already have AND the new one you're taking —
 * must have its class_multiclass_prerequisites ability score(s) at their
 * minimum. A character that ends this write single-classed (one distinct
 * class_id) is exempt entirely — those requirements only gate the ACT of
 * multiclassing, never starting play in one class at level 1 (task brief,
 * explicit). Since PUT /characters/:id/classes is a bulk replace-all, "more
 * than one distinct class_id in the new input" is exactly "multiclassed
 * after this write" — there's no meaningful "old vs new" distinction to draw
 * beyond that for a full replace, so this checks every class in the final
 * set, which already covers "keeps an old class and adds a different one."
 */
export async function validateMulticlassPrerequisites(
  db: Pool | PoolClient,
  character: AbilityScores,
  classIds: number[],
): Promise<void> {
  const distinctClassIds = [...new Set(classIds)];
  if (distinctClassIds.length <= 1) return;

  const result = await db.query<MulticlassPrereqRow>(
    `SELECT cmp.class_id, c.name AS class_name, a.index_key AS ability_index, cmp.minimum_score, cmp.requirement_group
     FROM class_multiclass_prerequisites cmp
     JOIN classes c ON c.id = cmp.class_id
     JOIN ability_scores a ON a.id = cmp.ability_score_id
     WHERE cmp.class_id = ANY($1::bigint[])`,
    [distinctClassIds],
  );

  const abilityByIndex: Record<string, number> = {
    str: character.str,
    dex: character.dex,
    con: character.con,
    int: character.int,
    wis: character.wis,
    cha: character.cha,
  };

  // Rows sharing (class_id, requirement_group) are OR'd — the group is
  // satisfied if ANY row in it meets its minimum (this is how Fighter's real
  // "STR 13 OR DEX 13" is modeled). A class's distinct groups are still AND'd
  // — every group needs at least one satisfied row. See the migration
  // comment on class_multiclass_prerequisites.requirement_group.
  const groups = new Map<string, MulticlassPrereqRow[]>();
  for (const row of result.rows) {
    const key = `${row.class_id}:${row.requirement_group}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }

  const failures: MulticlassPrereqFailure[] = [];
  for (const rows of groups.values()) {
    const satisfied = rows.some((r) => (abilityByIndex[r.ability_index] ?? 0) >= r.minimum_score);
    if (satisfied) continue;
    // Report every option in an unsatisfied OR-group so the message reads
    // "requires STR 13 or DEX 13", not just the first option checked.
    for (const row of rows) {
      failures.push({
        classId: row.class_id,
        className: row.class_name,
        abilityIndex: row.ability_index,
        required: row.minimum_score,
        actual: abilityByIndex[row.ability_index] ?? 0,
      });
    }
  }

  if (failures.length > 0) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Multiclass prerequisites not met: ' +
        failures.map((f) => `${f.className} requires ${f.abilityIndex.toUpperCase()} ${f.required} (has ${f.actual})`).join('; '),
      { failures },
    );
  }
}

// ---- Spell slot computation ----

const MULTICLASS_MULTIPLIER: Partial<Record<SpellcastingType, number>> = {
  full: 1,
  half: 0.5,
  third: 1 / 3,
};

interface CharacterClassRow {
  class_id: number;
  level: number;
  spellcasting_type: SpellcastingType;
}

async function fetchCharacterClasses(db: Pool | PoolClient, characterId: number): Promise<CharacterClassRow[]> {
  const result = await db.query<CharacterClassRow>(
    `SELECT cc.class_id, cc.level, c.spellcasting_type
     FROM character_classes cc JOIN classes c ON c.id = cc.class_id
     WHERE cc.character_id = $1`,
    [characterId],
  );
  return result.rows;
}

// class_levels.spell_slots (seeded from the dnd5e-srd skill's Levels.json,
// see db/seeds/catalog.ts's seedClassLevels) is shaped like
// {cantrips_known, prepared_spells, spell_slots_level_1..spell_slots_level_9}
// — pull out just the nonzero slot-level entries, in slot-level order.
function slotLevelEntries(spellSlots: Record<string, number> | null): Array<[level: number, count: number]> {
  if (!spellSlots) return [];
  const entries: Array<[number, number]> = [];
  for (let level = 1; level <= 9; level++) {
    const count = spellSlots[`spell_slots_level_${level}`] ?? 0;
    if (count > 0) entries.push([level, count]);
  }
  return entries;
}

async function fetchOwnSpellSlots(db: Pool | PoolClient, classId: number, level: number): Promise<Record<string, number> | null> {
  const result = await db.query<{ spell_slots: Record<string, number> | null }>(
    `SELECT spell_slots FROM class_levels WHERE class_id = $1 AND level = $2`,
    [classId, level],
  );
  return result.rows[0]?.spell_slots ?? null;
}

const SPELL_SLOT_KEY_RE = /^(spell_slot|warlock_pact_slot)_\d+$/;

/**
 * Recomputes and upserts a character's spell_slot_N / warlock_pact_slot_N
 * character_resource_pools rows from their current character_classes.
 *
 *  - Single-classed (0 or 1 character_classes rows): pull straight from that
 *    one class's OWN class_levels.spell_slots at their level — this works
 *    whether the class is a full/half/third caster (its own table already
 *    IS its correct single-class progression) or a Warlock (its own table
 *    already IS the real Pact Magic progression per level, sourced from the
 *    SRD data — see fetchOwnSpellSlots).
 *  - Multiclassed (>1 row): combined caster level = the sum, with each
 *    class's contribution rounded down INDIVIDUALLY before summing (not
 *    summed-then-rounded — these differ: Paladin 1/Ranger 1 is
 *    floor(1/2)+floor(1/2) = 0, not floor(2/2) = 1), of full casters' levels
 *    x1, half casters x0.5, third casters x1/3 — EXCLUDING Warlock entirely.
 *    That combined level indexes multiclass_spell_slot_table for the
 *    spell_slot_N pools.
 *  - Warlock (pact caster) ALWAYS gets its own separate warlock_pact_slot_N
 *    pool from ITS OWN class_levels row at its own Warlock level, regardless
 *    of single- or multiclassed — Pact Magic never merges into the
 *    multiclass table or its combined-level sum, per RAW. See the demo
 *    seed's Kessia Duskbane (Paladin 3/Warlock 2) for the worked example
 *    this function is verified against: spell_slot_1=2 (combined caster
 *    level floor(3/2)=1 -> multiclass_spell_slot_table[1]) kept separate
 *    from warlock_pact_slot_1=2 (Warlock's own level-2 Pact Magic row).
 *
 * Existing spell_slot_ and warlock_pact_slot_ rows that no longer apply (a
 * class was removed, or a slot level dropped to 0) are deleted rather than
 * left stale. Rows that still apply are upserted: max_value/recharge_on are
 * refreshed and current_value is clamped DOWN to the new max (never bumped
 * up) — this is a recompute of the cap, not a free refill of spent slots.
 */
export async function recomputeSpellSlots(db: Pool | PoolClient, characterId: number): Promise<void> {
  const classes = await fetchCharacterClasses(db, characterId);
  const targets = new Map<string, number>();

  const pactClasses = classes.filter((c) => c.spellcasting_type === 'pact');
  for (const cls of pactClasses) {
    const ownSlots = await fetchOwnSpellSlots(db, cls.class_id, cls.level);
    for (const [level, count] of slotLevelEntries(ownSlots)) {
      const key = `warlock_pact_slot_${level}`;
      targets.set(key, (targets.get(key) ?? 0) + count);
    }
  }

  const nonPactCasters = classes.filter(
    (c) => c.spellcasting_type === 'full' || c.spellcasting_type === 'half' || c.spellcasting_type === 'third',
  );

  if (classes.length <= 1) {
    // Single-classed (or, degenerately, no classes at all): use that one
    // class's own table directly — pact already handled above, and a
    // non-casting solo class (spellcasting_type='none') contributes nothing.
    const solo = nonPactCasters[0];
    if (solo) {
      const ownSlots = await fetchOwnSpellSlots(db, solo.class_id, solo.level);
      for (const [level, count] of slotLevelEntries(ownSlots)) {
        targets.set(`spell_slot_${level}`, count);
      }
    }
  } else if (nonPactCasters.length > 0) {
    const combinedCasterLevel = nonPactCasters.reduce(
      (sum, c) => sum + Math.floor(c.level * (MULTICLASS_MULTIPLIER[c.spellcasting_type] ?? 0)),
      0,
    );
    if (combinedCasterLevel > 0) {
      const tableRes = await db.query<{ spell_slots: Record<string, number> }>(
        `SELECT spell_slots FROM multiclass_spell_slot_table WHERE combined_caster_level = $1`,
        [Math.min(combinedCasterLevel, 20)],
      );
      const slots = tableRes.rows[0]?.spell_slots ?? {};
      for (const [levelKey, count] of Object.entries(slots)) {
        if (Number(count) > 0) targets.set(`spell_slot_${levelKey}`, Number(count));
      }
    }
  }

  const existing = await db.query<{ resource_key: string }>(
    `SELECT resource_key FROM character_resource_pools WHERE character_id = $1`,
    [characterId],
  );
  const stale = existing.rows
    .map((r) => r.resource_key)
    .filter((key) => SPELL_SLOT_KEY_RE.test(key) && !targets.has(key));
  if (stale.length > 0) {
    await db.query(`DELETE FROM character_resource_pools WHERE character_id = $1 AND resource_key = ANY($2)`, [characterId, stale]);
  }

  for (const [resourceKey, count] of targets) {
    const rechargeOn = resourceKey.startsWith('warlock_pact_slot_') ? 'short_rest' : 'long_rest';
    await db.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1, $2, $3, $3, $4)
       ON CONFLICT (character_id, resource_key) DO UPDATE SET
         max_value = EXCLUDED.max_value,
         current_value = LEAST(character_resource_pools.current_value, EXCLUDED.max_value),
         recharge_on = EXCLUDED.recharge_on`,
      [characterId, resourceKey, count, rechargeOn],
    );
  }
}
