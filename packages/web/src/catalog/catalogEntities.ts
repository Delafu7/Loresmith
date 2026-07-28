// Config for the 11 catalog entity types that got homebrew CRUD (server:
// routes/catalogHomebrew.ts). One generic editor (CatalogEditorPage.tsx)
// renders all of them from this data rather than 11 bespoke pages — the
// entities are structurally similar enough (a handful of scalar fields,
// each table's own edition_scope/description/etc.) that hand-building 11
// near-identical rich forms would be pure duplication; the few genuinely
// complex fields (JSONB objects/arrays like ability_bonuses, traits,
// properties) fall back to a raw-JSON textarea rather than a bespoke widget
// per field — honest and functional, not a fake-polished editor for data
// shapes this pass didn't have time to build a real widget for.

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'json';

export interface CatalogField {
  key: string; // camelCase, matches the server's Zod schema field name
  label: string;
  type: FieldType;
  options?: string[]; // for type: 'select'
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
      { key: 'schoolId', label: 'School (id)', type: 'text', required: true, helpText: 'Magic school id — see /catalog/magic-schools.' },
      { key: 'castingTime', label: 'Casting time', type: 'text', required: true },
      { key: 'range', label: 'Range', type: 'text', required: true },
      { key: 'componentV', label: 'Verbal component', type: 'boolean' },
      { key: 'componentS', label: 'Somatic component', type: 'boolean' },
      { key: 'componentM', label: 'Material component', type: 'boolean' },
      { key: 'materialDescription', label: 'Material description', type: 'text' },
      { key: 'duration', label: 'Duration', type: 'text', required: true },
      { key: 'concentration', label: 'Concentration', type: 'boolean' },
      { key: 'ritual', label: 'Ritual', type: 'boolean' },
      { key: 'savingThrowAbilityId', label: 'Saving throw ability (id)', type: 'text' },
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
      { key: 'raceId', label: 'Race (id)', type: 'text', required: true },
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
      { key: 'primaryAbilityId', label: 'Primary ability (id)', type: 'text' },
      { key: 'spellcastingType', label: 'Spellcasting type', type: 'select', required: true, options: ['full', 'half', 'third', 'pact', 'none'] },
      { key: 'savingThrowProficiencyIds', label: 'Saving throw proficiencies (JSON array of ability ids)', type: 'json' },
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
      { key: 'classId', label: 'Class (id)', type: 'text', required: true },
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
      { key: 'skillProficiencyIds', label: 'Skill proficiencies (JSON array of skill ids)', type: 'json' },
      { key: 'abilityBonusChoices', label: 'Ability bonus choices (JSON)', type: 'json' },
      { key: 'grantedFeatId', label: 'Granted feat (id)', type: 'text' },
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
];

export function catalogEntityBySegment(segment: string): CatalogEntityConfig | undefined {
  return CATALOG_ENTITIES.find((e) => e.segment === segment);
}
