import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Visual & Structural Redesign (REVISION-PLAN.md §10.3) — adds "ember" as a
// third selectable theme (see index.css) and makes it the new default for
// newly-created users, without disturbing existing users' saved
// preferences (an UPDATE would be needed for that, and isn't wanted here —
// crimson/amber users keep their choice; only the column default changes).
// The original CHECK constraint from 1784269761666_add-user-ui-theme.ts was
// auto-named by Postgres (no explicit name given there) — confirmed via
// information_schema.table_constraints against the live dev DB to be
// `users_ui_theme_check`.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT users_ui_theme_check;
  `);
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_ui_theme_check
      CHECK (ui_theme IN ('crimson', 'amber', 'ember'));
  `);
  pgm.sql(`
    ALTER TABLE users ALTER COLUMN ui_theme SET DEFAULT 'ember';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users ALTER COLUMN ui_theme SET DEFAULT 'crimson';
  `);
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT users_ui_theme_check;
  `);
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_ui_theme_check
      CHECK (ui_theme IN ('crimson', 'amber'));
  `);
}
