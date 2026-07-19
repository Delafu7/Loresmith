import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Customizable Styles per Role (Phase 3.9) — a personal preference on the
// USER row, not the campaign: a DM and each player pick their own theme
// independently of any campaign they're in or role they hold, and it follows
// them everywhere they're logged in. 'crimson' (the new default red theme,
// see index.css) reproduces today's visual intent for every existing user
// with no migration-time backfill needed beyond the column default.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN ui_theme TEXT NOT NULL DEFAULT 'crimson'
      CHECK (ui_theme IN ('crimson', 'amber'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN ui_theme;
  `);
}
