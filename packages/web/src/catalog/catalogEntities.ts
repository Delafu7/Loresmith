// Config for the 13 catalog entity types that got homebrew CRUD (server:
// routes/catalogHomebrew.ts + routes/compendium.ts). One generic editor
// (CatalogEditorPage.tsx / CompendiumEditorPage.tsx) renders all of them
// from this data rather than 13 bespoke pages — the entities are
// structurally similar enough (a handful of scalar fields, each table's own
// edition_scope/description/etc.) that hand-building that many
// near-identical rich forms would be pure duplication; the few genuinely
// complex fields (JSONB objects/arrays like ability_bonuses, traits,
// properties) fall back to a raw-JSON textarea rather than a bespoke widget
// per field — honest and functional, not a fake-polished editor for data
// shapes this pass didn't have time to build a real widget for.
//
// `conditions` (added alongside the personal-compendium feature) is the
// proof this registry is genuinely generic: it's a real 13th entry with no
// changes anywhere else — CatalogEditorPage.tsx, CompendiumEditorPage.tsx,
// and CatalogEntryForm.tsx render it exactly like the other 12 already
// solely from this data.

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json' | 'reference' | 'reference-array';

// Describes another catalog list to fetch and render as a dropdown/checklist
// rather than making the user type a raw uuid. `endpoint` is the segment
// under GET /catalog/{endpoint}; `campaignScoped`/`editioned` control which
// query params get sent (mirrors each list function's actual signature in
// server/src/services/catalog.ts — ability-scores/skills/magic-schools take
// neither, conditions takes edition only, damage-types takes campaignId
// only, races/classes/feats take both).
export interface ReferenceConfig {
  endpoint: string;
  listResponseKey: string;
  campaignScoped: boolean;
  editioned: boolean;
}

export const REFERENCE_CATALOGS = {
  abilityScores: { endpoint: 'ability-scores', listResponseKey: 'abilityScores', campaignScoped: false, editioned: false },
  skills: { endpoint: 'skills', listResponseKey: 'skills', campaignScoped: false, editioned: false },
  magicSchools: { endpoint: 'magic-schools', listResponseKey: 'magicSchools', campaignScoped: false, editioned: false },
  conditions: { endpoint: 'conditions', listResponseKey: 'conditions', campaignScoped: false, editioned: true },
  damageTypes: { endpoint: 'damage-types', listResponseKey: 'damageTypes', campaignScoped: true, editioned: false },
  races: { endpoint: 'races', listResponseKey: 'races', campaignScoped: true, editioned: true },
  classes: { endpoint: 'classes', listResponseKey: 'classes', campaignScoped: true, editioned: true },
  feats: { endpoint: 'feats', listResponseKey: 'feats', campaignScoped: true, editioned: true },
} as const satisfies Record<string, ReferenceConfig>;

export interface CatalogField {
  key: string; // camelCase, matches the server's Zod schema field name
  label: string;
  type: FieldType;
  options?: string[]; // for type: 'select'
  reference?: ReferenceConfig; // for type: 'reference' | 'reference-array'
  required?: boolean;
  helpText?: string;
}

export interface CatalogEntityConfig {
  segment: string; // URL segment, matches server's routes/catalog.ts + routes/catalogHomebrew.ts
  label: string;
  pluralLabel: string;
  listResponseKey: string; // key on the GET /catalog/{segment} JSON response
  hasEdition: boolean; // whether this entity has an edition_scope filter/field
  fields: CatalogField[];
}

const editionField: CatalogField = {
  key: 'editionScope',
  label: 'Edition',
  type: 'select',
  options: ['2014', '2024', 'both'],
  required: true,
};

export const CATALOG_ENTITIES: CatalogEntityConfig[] = [
  {
    segment: 'items',
    label: 'Item',
    pluralLabel: 'Items',
    listResponseKey: 'items',
    hasEdition: true,
    fields: [
      { key: 'slug', label: 'Slug', type: 'text', required: true, helpText: 'A short unique identifier, e.g. "flametongue-dagger".' },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'itemType', label: 'Item type', type: 'select', required: true, options: ['weapon', 'armor', 'shield', 'tool', 'adventuring_gear', 'magic_item', 'consumable', 'mount', 'vehicle'] },
      { key: 'rarity', label: 'Rarity', type: 'select', required: true, options: ['mundane', 'common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'] },
      { key: 'weightLb', label: 'Weight (lb)', type: 'number' },
      { key: 'costCp', label: 'Cost (cp)', type: 'number' },
      { key: 'armorClassBase', label: 'Armor class (base)', type: 'number' },
      { key: 'armorClassFormula', label: 'Armor class formula', type: 'text' },
      { key: 'armorCategory', label: 'Armor category', type: 'select', options: ['light', 'medium', 'heavy'] },
      { key: 'dexModifierRule', label: 'Dex modifier rule', type: 'select', options: ['full', 'max_2', 'none'] },
      { key: 'strRequirement', label: 'Strength requirement', type: 'number' },
      { key: 'damageDice', label: 'Damage dice', type: 'text', helpText: 'e.g. "1d8"' },
      { key: 'damageTypeId', label: 'Damage type', type: 'reference', reference: REFERENCE_CATALOGS.damageTypes },
      { key: 'requiresAttunement', label: 'Requires attunement', type: 'boolean' },
      { key: 'stealthDisadvantage', label: 'Stealth disadvantage', type: 'boolean' },
      { key: 'properties', label: 'Properties (JSON)', type: 'json' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'source', label: 'Source', type: 'text' },
    ],
  },
  {
    segment: 'spells',
    label: 'Spell',
    pluralLabel: 'Spells',
    listResponseKey: 'spells',
    hasEdition: true,
    fields: [
      { key: 'slug', label: 'Slug', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'level', label: 'Level (0 = cantrip)', type: 'number', required: true },
      { key: 'schoolId', label: 'School', type: 'reference', required: true, reference: REFERENCE_CATALOGS.magicSchools },
      { key: 'castingTime', label: 'Casting time', type: 'text', required: true },
      { key: 'range', label: 'Range', type: 'text', required: true },
      { key: 'componentV', label: 'Verbal component', type: 'boolean' },
      { key: 'componentS', label: 'Somatic component', type: 'boolean' },
      { key: 'componentM', label: 'Material component', type: 'boolean' },
      { key: 'materialDescription', label: 'Material description', type: 'text' },
      { key: 'duration', label: 'Duration', type: 'text', required: true },
      { key: 'concentration', label: 'Concentration', type: 'boolean' },
      { key: 'ritual', label: 'Ritual', type: 'boolean' },
      { key: 'savingThrowAbilityId', label: 'Saving throw ability', type: 'reference', reference: REFERENCE_CATALOGS.abilityScores },
      { key: 'attackType', label: 'Attack type', type: 'select', options: ['melee', 'ranged'] },
      { key: 'damageAtLevel', label: 'Damage at level (JSON)', type: 'json' },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'higherLevelDescription', label: 'At higher levels', type: 'textarea' },
      { key: 'source', label: 'Source', type: 'text' },
    ],
  },
  {
    segment: 'races',
    label: 'Race',
    pluralLabel: 'Races',
    listResponseKey: 'races',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'speed', label: 'Speed (ft)', type: 'number', required: true },
      { key: 'size', label: 'Size', type: 'text', required: true },
      { key: 'abilityBonuses', label: 'Ability bonuses (JSON)', type: 'json', required: true },
      { key: 'traits', label: 'Traits (JSON array)', type: 'json', required: true },
      { key: 'source', label: 'Source', type: 'text' },
    ],
  },
  {
    segment: 'subraces',
    label: 'Subrace',
    pluralLabel: 'Subraces',
    listResponseKey: 'subraces',
    hasEdition: false,
    fields: [
      { key: 'raceId', label: 'Race', type: 'reference', required: true, reference: REFERENCE_CATALOGS.races },
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'abilityBonuses', label: 'Ability bonuses (JSON)', type: 'json', required: true },
      { key: 'traits', label: 'Traits (JSON array)', type: 'json', required: true },
    ],
  },
  {
    segment: 'classes',
    label: 'Class',
    pluralLabel: 'Classes',
    listResponseKey: 'classes',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'hitDie', label: 'Hit die', type: 'number', required: true, helpText: 'e.g. 8 for a d8' },
      { key: 'primaryAbilityId', label: 'Primary ability', type: 'reference', reference: REFERENCE_CATALOGS.abilityScores },
      { key: 'spellcastingType', label: 'Spellcasting type', type: 'select', required: true, options: ['full', 'half', 'third', 'pact', 'none'] },
      { key: 'savingThrowProficiencyIds', label: 'Saving throw proficiencies', type: 'reference-array', reference: REFERENCE_CATALOGS.abilityScores },
      { key: 'source', label: 'Source', type: 'text' },
    ],
  },
  {
    segment: 'subclasses',
    label: 'Subclass',
    pluralLabel: 'Subclasses',
    listResponseKey: 'subclasses',
    hasEdition: false,
    fields: [
      { key: 'classId', label: 'Class', type: 'reference', required: true, reference: REFERENCE_CATALOGS.classes },
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ],
  },
  {
    segment: 'backgrounds',
    label: 'Background',
    pluralLabel: 'Backgrounds',
    listResponseKey: 'backgrounds',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'skillProficiencyIds', label: 'Skill proficiencies', type: 'reference-array', reference: REFERENCE_CATALOGS.skills },
      { key: 'abilityBonusChoices', label: 'Ability bonus choices (JSON)', type: 'json' },
      { key: 'grantedFeatId', label: 'Granted feat', type: 'reference', reference: REFERENCE_CATALOGS.feats },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  {
    segment: 'feats',
    label: 'Feat',
    pluralLabel: 'Feats',
    listResponseKey: 'feats',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'prerequisite', label: 'Prerequisite', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
    ],
  },
  {
    segment: 'alignments',
    label: 'Alignment',
    pluralLabel: 'Alignments',
    listResponseKey: 'alignments',
    hasEdition: false,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
    ],
  },
  {
    segment: 'languages',
    label: 'Language',
    pluralLabel: 'Languages',
    listResponseKey: 'languages',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
    ],
  },
  {
    segment: 'damage-types',
    label: 'Damage type',
    pluralLabel: 'Damage types',
    listResponseKey: 'damageTypes',
    hasEdition: false,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
  },
  {
    segment: 'effect-definitions',
    label: 'Effect definition',
    pluralLabel: 'Effect definitions',
    listResponseKey: 'effectDefinitions',
    hasEdition: false,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'defaultDurationType', label: 'Default duration type', type: 'select', required: true, options: ['rounds', 'minutes', 'hours', 'until_save', 'until_removed', 'permanent', 'special'] },
      { key: 'defaultDurationValue', label: 'Default duration value', type: 'number' },
      { key: 'concentration', label: 'Concentration', type: 'boolean' },
      { key: 'stackingRule', label: 'Stacking rule', type: 'select', required: true, options: ['none', 'stack', 'refresh'] },
      { key: 'conditionId', label: 'Condition', type: 'reference', reference: REFERENCE_CATALOGS.conditions },
    ],
  },
  {
    segment: 'conditions',
    label: 'Condition',
    pluralLabel: 'Conditions',
    listResponseKey: 'conditions',
    hasEdition: true,
    fields: [
      { key: 'indexKey', label: 'Key', type: 'text', required: true },
      { key: 'name', label: 'Name', type: 'text', required: true },
      editionField,
      { key: 'description', label: 'Description', type: 'textarea', required: true },
    ],
  },
];

export function catalogEntityBySegment(segment: string): CatalogEntityConfig | undefined {
  return CATALOG_ENTITIES.find((e) => e.segment === segment);
}
