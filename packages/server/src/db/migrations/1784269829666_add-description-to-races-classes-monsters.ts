import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Content-catalog refactor: items/spells/backgrounds already have a
// freeform `description` column (see their create migrations), editable via
// the generic homebrew CRUD (services/catalogHomebrew.ts) and rendered by
// CatalogEditorPage.tsx. `races`/`classes`/`monsters` never got one — races/
// classes only had structured `traits`/`class_features.description`, and
// monsters only had per-entry `actions[].description` etc. — so there was no
// single free-text overview field an entity's own catalog row (or a
// campaign's `overrides`/`stat_overrides` JSONB blob layered on top of it)
// could carry. Purely additive, nullable, no backfill needed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE races ADD COLUMN description TEXT;
    ALTER TABLE classes ADD COLUMN description TEXT;
    ALTER TABLE monsters ADD COLUMN description TEXT;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters DROP COLUMN description;
    ALTER TABLE classes DROP COLUMN description;
    ALTER TABLE races DROP COLUMN description;
  `);
}
