// Write shapes for the 13 catalog tables plugged into the generic homebrew
// system (the 11 from the catalog-homebrew-scope migration, plus
// effect_definitions and conditions, each onboarded in their own later
// migration). Mirrors each table's actual columns (see that
// migration + the original CREATE TABLE migrations) — every field here maps
// 1:1 to a snake_case column via services/catalog.ts's route layer. No field here
// carries a Zod `.default()`, matching schemas/monsterCatalog.ts's own
// precedent, so the `.partial()`-derived update schema can be built
// directly from the same shape without a default silently reappearing on
// a partial update.

import { z } from 'zod';

const editionScope = z.enum(['2014', '2024', 'both']);

export const itemHomebrewShape = {
  slug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  itemType: z.enum(['weapon', 'armor', 'shield', 'tool', 'adventuring_gear', 'magic_item', 'consumable', 'mount', 'vehicle']),
  rarity: z.enum(['mundane', 'common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact']),
  weightLb: z.number().nonnegative().optional().nullable(),
  costCp: z.number().int().nonnegative().optional().nullable(),
  armorClassBase: z.number().int().optional().nullable(),
  armorClassFormula: z.string().max(100).optional().nullable(),
  damageDice: z.string().max(50).optional().nullable(),
  damageTypeId: z.string().uuid().optional().nullable(),
  requiresAttunement: z.boolean(),
  properties: z.record(z.string(), z.unknown()).optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
  armorCategory: z.enum(['light', 'medium', 'heavy']).optional().nullable(),
  dexModifierRule: z.enum(['full', 'max_2', 'none']).optional().nullable(),
  strRequirement: z.number().int().optional().nullable(),
  stealthDisadvantage: z.boolean(),
};

export const spellHomebrewShape = {
  slug: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  level: z.number().int().min(0).max(9),
  schoolId: z.string().uuid(),
  castingTime: z.string().min(1).max(100),
  range: z.string().min(1).max(100),
  componentV: z.boolean(),
  componentS: z.boolean(),
  componentM: z.boolean(),
  materialDescription: z.string().max(500).optional().nullable(),
  duration: z.string().min(1).max(100),
  concentration: z.boolean(),
  ritual: z.boolean(),
  savingThrowAbilityId: z.string().uuid().optional().nullable(),
  attackType: z.enum(['melee', 'ranged']).optional().nullable(),
  damageAtLevel: z.record(z.string(), z.unknown()).optional().nullable(),
  description: z.string().min(1).max(20000),
  higherLevelDescription: z.string().max(5000).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
};

export const raceHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  speed: z.number().int().positive(),
  size: z.string().min(1).max(50),
  abilityBonuses: z.record(z.string(), z.number().int()),
  traits: z.array(z.object({ name: z.string(), description: z.string().optional() })),
  source: z.string().max(200).optional().nullable(),
};

export const subraceHomebrewShape = {
  raceId: z.string().uuid(),
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  abilityBonuses: z.record(z.string(), z.number().int()),
  traits: z.array(z.object({ name: z.string(), description: z.string().optional() })),
};

export const classHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  hitDie: z.number().int().positive(),
  primaryAbilityId: z.string().uuid().optional().nullable(),
  spellcastingType: z.enum(['full', 'half', 'third', 'pact', 'none']),
  savingThrowProficiencyIds: z.array(z.string().uuid()).optional().nullable(),
  source: z.string().max(200).optional().nullable(),
};

export const subclassHomebrewShape = {
  classId: z.string().uuid(),
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
};

export const backgroundHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  skillProficiencyIds: z.array(z.string().uuid()).optional().nullable(),
  abilityBonusChoices: z.record(z.string(), z.unknown()).optional().nullable(),
  grantedFeatId: z.string().uuid().optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
};

export const featHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  prerequisite: z.string().max(500).optional().nullable(),
  description: z.string().min(1).max(20000),
};

export const alignmentHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
};

export const languageHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
};

export const damageTypeHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
};

// effect_definitions has no slug/index_key column and no matching UNIQUE
// constraint (see the create-effect-definitions migration) — its
// CatalogTableConfig uses keyColumn: null (routes/catalogHomebrew.ts).
export const effectDefinitionHomebrewShape = {
  conditionId: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  defaultDurationType: z.enum(['rounds', 'minutes', 'hours', 'until_save', 'until_removed', 'permanent', 'special']),
  defaultDurationValue: z.number().int().optional().nullable(),
  concentration: z.boolean(),
  stackingRule: z.enum(['none', 'stack', 'refresh']),
};

export const conditionHomebrewShape = {
  indexKey: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  editionScope,
  description: z.string().min(1).max(5000),
};

const shapes = {
  items: itemHomebrewShape,
  spells: spellHomebrewShape,
  races: raceHomebrewShape,
  subraces: subraceHomebrewShape,
  classes: classHomebrewShape,
  subclasses: subclassHomebrewShape,
  backgrounds: backgroundHomebrewShape,
  feats: featHomebrewShape,
  alignments: alignmentHomebrewShape,
  languages: languageHomebrewShape,
  damage_types: damageTypeHomebrewShape,
  effect_definitions: effectDefinitionHomebrewShape,
  conditions: conditionHomebrewShape,
} as const;

export type HomebrewCatalogTable = keyof typeof shapes;

export const createHomebrewSchemas = Object.fromEntries(
  Object.entries(shapes).map(([table, shape]) => [table, z.object(shape)]),
) as unknown as Record<HomebrewCatalogTable, z.ZodTypeAny>;

export const updateHomebrewSchemas = Object.fromEntries(
  Object.entries(shapes).map(([table, shape]) => [table, z.object(shape).partial()]),
) as unknown as Record<HomebrewCatalogTable, z.ZodTypeAny>;
