// Phase 4 "Bastion tracking" — dynamic prerequisite checks for special
// facilities (docs/rules/bastions.md §1's Edge cases: "does character X
// currently have class feature Y" must be evaluated live against the
// character's actual current class/skill data, never a cached/denormalized
// flag, since feats/multiclass dips/homebrew can change what a character
// qualifies for at any time).
//
// bastion_facility_catalog.prerequisite_text is deliberately prose, not a
// structured rule (see that table's migration) — every prerequisite this
// app currently seeds is built from one of the four fixed phrases below
// (seeds/catalog.ts's HOLY_FOCUS_PREREQ/ARCANE_FOCUS_PREREQ/
// FIGHTING_STYLE_OR_UNARMORED_PREREQ/EXPERTISE_PREREQ constants), so
// substring-matching against those same phrases here is a safe, faithful
// translation of that same seed data — not fragile prose parsing of
// arbitrary text. A prerequisite whose text doesn't contain any recognized
// phrase is treated as UNSATISFIABLE (fail closed), matching this project's
// default-deny authorization stance, rather than silently waving it through.

import type { Pool } from 'pg';

async function hasAnyRow(pool: Pool, sql: string, values: unknown[]): Promise<boolean> {
  const result = await pool.query(sql, values);
  return (result.rowCount ?? 0) > 0;
}

async function hasFightingStyleOrUnarmoredDefense(pool: Pool, characterId: string): Promise<boolean> {
  return hasAnyRow(
    pool,
    `SELECT 1 FROM character_classes cc
     JOIN class_features cf ON cf.class_id = cc.class_id AND cf.level <= cc.level
     WHERE cc.character_id = $1 AND (cf.name ILIKE '%fighting style%' OR cf.name ILIKE '%unarmored defense%')
     LIMIT 1`,
    [characterId],
  );
}

async function hasExpertiseInAnySkill(pool: Pool, characterId: string): Promise<boolean> {
  return hasAnyRow(
    pool,
    `SELECT 1 FROM character_skill_proficiencies WHERE character_id = $1 AND level = 'expertise' LIMIT 1`,
    [characterId],
  );
}

// "Ability to use an Arcane/Holy Symbol/Druidic Focus as a Spellcasting
// Focus" can't be checked precisely: this app has no per-class "focus type"
// data (Arcane vs. Holy Symbol vs. Druidic), and docs/rules/bastions.md is
// explicit that faking it with a hardcoded class-name lookup would drift
// from homebrew classes and multiclass dips. This checks the coarser,
// always-necessary precondition instead — does the character have ANY
// spellcasting class at all — which correctly REJECTS a non-caster, but a
// character who passes still needs the specific focus type informally
// confirmed by the DM until this app models focus type explicitly. Flagged
// here (not silently narrowed) exactly as that doc instructs.
async function isAnySpellcaster(pool: Pool, characterId: string): Promise<boolean> {
  return hasAnyRow(
    pool,
    `SELECT 1 FROM character_classes cc JOIN classes c ON c.id = cc.class_id
     WHERE cc.character_id = $1 AND c.spellcasting_type <> 'none' LIMIT 1`,
    [characterId],
  );
}

const FIGHTING_STYLE_PHRASE = 'Fighting Style feature';
const UNARMORED_DEFENSE_PHRASE = 'Unarmored Defense feature';
const EXPERTISE_PHRASE = 'Expertise in a skill';
const SPELLCASTING_FOCUS_PHRASE = 'Spellcasting Focus';

/**
 * A facility's clauses are always OR'd together in this app's seeded data
 * (e.g. "Fighting Style feature or Unarmored Defense feature") — the
 * character qualifies if they satisfy ANY recognized clause found in the
 * text. `prerequisiteText === null` means no prerequisite at all (trivially
 * satisfied).
 */
export async function characterMeetsFacilityPrerequisite(
  pool: Pool,
  characterId: string,
  prerequisiteText: string | null,
): Promise<boolean> {
  if (prerequisiteText === null) return true;

  const checks: Promise<boolean>[] = [];
  if (prerequisiteText.includes(FIGHTING_STYLE_PHRASE) || prerequisiteText.includes(UNARMORED_DEFENSE_PHRASE)) {
    checks.push(hasFightingStyleOrUnarmoredDefense(pool, characterId));
  }
  if (prerequisiteText.includes(EXPERTISE_PHRASE)) {
    checks.push(hasExpertiseInAnySkill(pool, characterId));
  }
  if (prerequisiteText.includes(SPELLCASTING_FOCUS_PHRASE)) {
    checks.push(isAnySpellcaster(pool, characterId));
  }
  if (checks.length === 0) return false; // unrecognized prerequisite text -- fail closed, not silently passed

  const results = await Promise.all(checks);
  return results.some(Boolean);
}
