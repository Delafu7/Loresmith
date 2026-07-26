// Field registry for the reveal engine (PLAN.md §11.3). Lists which fields
// of a character/monster-instance stat block are individually revealable to
// players. Whole-field granularity only for v1 (§11's locked-in decision) —
// no per-array-item keys like 'actions.0'.
//
// field_key values are the actual snake_case DB/wire column names, not the
// camelCase names used in write-schema bodies (schemas/characters.ts,
// schemas/monsterCatalog.ts) — every GET in this app returns the raw DB row
// as-is (see e.g. routes/characters.ts's `res.json({ character })`), so
// redaction has to operate on the same keys the row actually carries over
// the wire. This does mean field_key doesn't match a PATCH body's camelCase
// field names one-for-one; that's an accepted asymmetry, not an oversight.
//
// Kept as a plain TS const, not derived from schemas/characters.ts or
// schemas/monsterCatalog.ts's Zod shapes, because the two lists are
// deliberately a *subset* of each entity's full field set (e.g. `name` is
// never reveal-gated — it's in campaigns.reveal_defaults's allowlist
// instead) and mixing "every persisted field" with "every revealable field"
// would make it unclear which list to extend when a new column is added.
//
// Monster-instance fields here (armor_class, traits, actions, ...) live on
// the shared `monsters` catalog row, not on `monster_instances` itself
// (PLAN.md §3.1's catalog/instance split) — services/monsters.ts joins them
// in per-instance so redaction stays scoped to one instance, never leaking
// across every instance of a shared catalog monster.

export const MONSTER_INSTANCE_REVEALABLE_FIELDS = [
  'armor_class',
  'speed',
  'saving_throws',
  'skills',
  'damage_vulnerabilities',
  'damage_resistances',
  'damage_immunities',
  'senses',
  'traits',
  'actions',
  'legendary_actions',
  'reactions',
] as const;
export type MonsterInstanceRevealableField = (typeof MONSTER_INSTANCE_REVEALABLE_FIELDS)[number];

export const CHARACTER_REVEALABLE_FIELDS = ['armor_class', 'speed', 'senses', 'languages', 'notes'] as const;
export type CharacterRevealableField = (typeof CHARACTER_REVEALABLE_FIELDS)[number];

export type RevealEntityType = 'character' | 'monster_instance';

export function revealableFieldsFor(entityType: RevealEntityType): readonly string[] {
  return entityType === 'character' ? CHARACTER_REVEALABLE_FIELDS : MONSTER_INSTANCE_REVEALABLE_FIELDS;
}

export function isRevealableField(entityType: RevealEntityType, fieldKey: string): boolean {
  return (revealableFieldsFor(entityType) as readonly string[]).includes(fieldKey);
}

// Shared SQL fragment for joining a monster instance's effective stat block
// off the `monsters` catalog row (armor_class effective-valued via
// COALESCE with the instance's own override, matching services/
// armorClass.ts's precedent). Lives here (not in services/monsters.ts)
// so services/entityFieldReveal.ts can reuse the exact same column set for
// its "true value" lookup without a monsters.ts <-> entityFieldReveal.ts
// import cycle, and so the two call sites can't drift out of sync with
// MONSTER_INSTANCE_REVEALABLE_FIELDS above. Assumes the query aliases the
// tables `mi` (monster_instances) and `m` (monsters).
export const MONSTER_INSTANCE_STAT_BLOCK_SQL = `
  COALESCE(mi.armor_class_override, m.armor_class) AS armor_class,
  m.armor_class_notes,
  m.speed,
  m.saving_throws,
  m.skills,
  m.damage_vulnerabilities,
  m.damage_resistances,
  m.damage_immunities,
  m.senses,
  m.languages,
  m.traits,
  m.actions,
  m.legendary_actions,
  m.reactions
`;
