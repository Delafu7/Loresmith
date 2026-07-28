// Field registry for the (now narrow) reveal mechanism: a DM can hide or
// reveal a monster instance's damage vulnerabilities/resistances/immunities
// to players, one field at a time. Everything the reveal engine used to
// cover beyond this — characters entirely, and every other monster-instance
// field (armor_class, speed, saving_throws, skills, senses, traits, actions,
// legendary_actions, reactions) — was removed; those fields are now always
// visible, same as any other stat-block column.
//
// field_key values are the raw snake_case DB/wire column names (every GET
// in this app returns the raw DB row as-is), matching entity_field_reveals'
// field_key CHECK constraint.

export const MONSTER_INSTANCE_REVEALABLE_FIELDS = [
  'damage_vulnerabilities',
  'damage_resistances',
  'damage_immunities',
] as const;
export type MonsterInstanceRevealableField = (typeof MONSTER_INSTANCE_REVEALABLE_FIELDS)[number];

export function isRevealableField(fieldKey: string): boolean {
  return (MONSTER_INSTANCE_REVEALABLE_FIELDS as readonly string[]).includes(fieldKey);
}

// A monster instance's full effective stat block, joined off the shared
// `monsters` catalog row (armor_class effective-valued via COALESCE with
// the instance's own override, matching services/armorClass.ts's
// precedent). Not reveal-specific — this is the general "give me this
// instance's actual stats" fragment, used by services/monsters.ts for every
// read regardless of role; redaction of the three weakness fields above
// happens afterward via redactEntityFields. Lives here (not in
// services/monsters.ts) so services/entityFieldReveal.ts can reuse the exact
// same column set for its "true value" lookup without an import cycle.
// Assumes the query aliases the tables `mi` (monster_instances) and `m`
// (monsters).
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
