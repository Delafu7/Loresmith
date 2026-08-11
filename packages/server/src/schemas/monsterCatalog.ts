import { z } from 'zod';

// Validation for the homebrew monster stat-block write API (Phase 3.2,
// PLAN.md §3.5/§4.4 — the first write endpoint for a catalog table in this
// app). Every field mirrors a column on `monsters`
// (1784269736666_create-catalog-monsters.ts / 1784269753666_add-monster-
// homebrew-scope.ts).
//
// actions/traits/legendaryActions/reactions use the NEW {name, description,
// ...} shape (PLAN.md §3.5's design note) rather than the old seeded data's
// {name, desc} shape — this is a forward-only convention for anything
// created via this endpoint; existing seeded rows are left as-is (see
// db/seeds/demo.ts's hand backfill of the four starter creatures).
const statBlockEntrySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
  attackBonus: z.number().int().optional(),
  damageDice: z.string().max(50).optional(),
  damageType: z.string().max(50).optional(),
  saveDc: z.number().int().positive().optional(),
  saveAbilityIndex: z.string().max(10).optional(),
  // Phase 2 "legendary actions per-round counters" — only meaningful on a
  // legendaryActions entry (a normal action/trait/reaction just never sets
  // it); a missing value defaults to 1 wherever this is read, both server
  // and client side, per the SRD default cost of a legendary action.
  cost: z.number().int().positive().optional(),
});

const abilityScore = z.number().int().min(1).max(30);

// No fields here carry a Zod `.default()` — see schemas/monsters.ts's
// comment on why that matters for `.partial()`-derived update schemas; since
// nothing defaults, updateHomebrewMonsterSchema can safely be built directly
// from this shape.
const homebrewMonsterShape = {
  name: z.string().min(1).max(200),
  size: z.string().min(1).max(50),
  creatureType: z.string().min(1).max(100),
  alignment: z.string().max(100).optional().nullable(),
  armorClass: z.number().int().positive(),
  armorClassNotes: z.string().max(200).optional().nullable(),
  hitPointAverage: z.number().int().positive(),
  hitDice: z.string().min(1).max(50),
  speed: z.object({ walk: z.number().int().nonnegative() }).catchall(z.number().int().nonnegative()),
  str: abilityScore,
  dex: abilityScore,
  con: abilityScore,
  int: abilityScore,
  wis: abilityScore,
  cha: abilityScore,
  savingThrows: z.record(z.string(), z.number().int()).optional().nullable(),
  skills: z.record(z.string(), z.number().int()).optional().nullable(),
  damageVulnerabilities: z.array(z.string()).optional(),
  damageResistances: z.array(z.string()).optional(),
  damageImmunities: z.array(z.string()).optional(),
  senses: z.string().max(200).optional().nullable(),
  languages: z.string().max(200).optional().nullable(),
  challengeRating: z.number().min(0).max(30),
  xpValue: z.number().int().nonnegative(),
  traits: z.array(statBlockEntrySchema).optional().nullable(),
  actions: z.array(statBlockEntrySchema).min(1),
  legendaryActions: z.array(statBlockEntrySchema).optional().nullable(),
  // Phase 2 "legendary actions per-round counters" — the budget per round,
  // not the count of legendaryActions entries above (a creature can have 3
  // legendary actions worth 1/1/2 to spend against a budget of 3, not "3
  // uses of any one action"). Null/omitted for a creature with no legendary
  // actions at all.
  legendaryActionCount: z.number().int().positive().optional().nullable(),
  reactions: z.array(statBlockEntrySchema).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
  // Caps monster_instances at 1 per campaign for this catalog row (see
  // services/monsters.ts's createMonsterInstance). No `.default()` here —
  // same reason as every other field in this shape (see top-of-file
  // comment); createHomebrewMonster treats an omitted value as false.
  isUnique: z.boolean().optional(),
  // No client-settable edition field: a homebrew monster's edition_scope
  // always matches its owning campaign's own srd_edition, set server-side
  // (see services/monsterCatalog.ts's createHomebrewMonster) and never
  // updatable afterward — letting it diverge would make listMonsters'
  // edition-filtered union hide the row from its own campaign's bestiary.
  // Must belong to the SAME campaign that will own this monster —
  // service-layer check, same "app-layer, not declarative" precedent as
  // services/assets.ts's authorizeAssetUpload characterId check.
  artAssetId: z.string().uuid().optional().nullable(),
  // REFACTOR-PLAN.md §1.1: a plain URL, distinct from artAssetId (which only
  // works for homebrew rows uploaded into a campaign's own asset library) —
  // this one also works for global/seeded monsters that have no campaign to
  // upload into. When both are set, the client prefers artAssetId (a real
  // uploaded asset) and falls back to imageUrl, then the placeholder.
  imageUrl: z.string().url().max(2000).optional().nullable(),
};

// Iteration 2 "Shared bestiary" — chosen once, at creation time, never
// changed via a generic PATCH (that's what the dedicated promote/assign
// routes are for, see services/monsterCatalog.ts). 'campaign' (default)
// matches every pre-existing caller's behavior unchanged; 'library' scopes
// the new row to the creating user instead of the campaign.
export const createHomebrewMonsterSchema = z.object({
  ...homebrewMonsterShape,
  libraryScope: z.enum(['campaign', 'library']).optional(),
});
export type CreateHomebrewMonsterInput = z.infer<typeof createHomebrewMonsterSchema>;

export const updateHomebrewMonsterSchema = z.object(homebrewMonsterShape).partial();
export type UpdateHomebrewMonsterInput = z.infer<typeof updateHomebrewMonsterSchema>;
