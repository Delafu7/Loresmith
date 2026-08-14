// Shared entity config for the generic homebrew catalog system — one entry
// per table plugged into services/catalogHomebrew.ts's generic CRUD. Used by
// BOTH the campaign-scoped router (routes/catalogHomebrew.ts, mounted at
// /campaigns/:id/catalog) and the personal-compendium router
// (routes/compendium.ts, mounted at /compendium) so the two write surfaces
// can never drift out of sync on which 13 tables exist or how their columns
// are shaped. Extracted from routes/catalogHomebrew.ts, which previously
// held this list alone before /compendium needed the same data.
//
// urlSegment matches the existing GET /catalog/* route names
// (routes/catalog.ts) — only damage_types/effect-definitions differ
// (hyphenated in URLs, per that file's own convention).
import type { HomebrewCatalogTable } from './schemas/catalogHomebrew.js';
import type { CatalogTableConfig } from './services/catalogHomebrew.js';

export interface CatalogEntityTableEntry {
  urlSegment: string;
  table: HomebrewCatalogTable;
  keyColumn: CatalogTableConfig['keyColumn'];
  jsonbColumns?: CatalogTableConfig['jsonbColumns'];
}

export const CATALOG_ENTITY_TABLES: CatalogEntityTableEntry[] = [
  { urlSegment: 'items', table: 'items', keyColumn: 'slug', jsonbColumns: new Set(['properties']) },
  { urlSegment: 'spells', table: 'spells', keyColumn: 'slug', jsonbColumns: new Set(['damage_at_level']) },
  { urlSegment: 'races', table: 'races', keyColumn: 'index_key', jsonbColumns: new Set(['ability_bonuses', 'traits']) },
  { urlSegment: 'subraces', table: 'subraces', keyColumn: 'index_key', jsonbColumns: new Set(['ability_bonuses', 'traits']) },
  { urlSegment: 'classes', table: 'classes', keyColumn: 'index_key' },
  { urlSegment: 'subclasses', table: 'subclasses', keyColumn: 'index_key' },
  { urlSegment: 'backgrounds', table: 'backgrounds', keyColumn: 'index_key', jsonbColumns: new Set(['ability_bonus_choices']) },
  { urlSegment: 'feats', table: 'feats', keyColumn: 'index_key' },
  { urlSegment: 'alignments', table: 'alignments', keyColumn: 'index_key' },
  { urlSegment: 'languages', table: 'languages', keyColumn: 'index_key' },
  { urlSegment: 'damage-types', table: 'damage_types', keyColumn: 'index_key' },
  // No slug/index_key column on effect_definitions, so no suffix to append —
  // see services/catalogHomebrew.ts's keyColumn: null handling.
  { urlSegment: 'effect-definitions', table: 'effect_definitions', keyColumn: null },
  { urlSegment: 'conditions', table: 'conditions', keyColumn: 'index_key' },
];
