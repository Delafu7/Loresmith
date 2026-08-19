import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Adds "arcane" ("Arcane Console" — see index.css) as a fourth selectable
// theme. Purely additive: the column default stays 'ember' (Field Ledger) —
// Arcane Console is an opt-in choice, not a change to what new users get.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT users_ui_theme_check;
  `);
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_ui_theme_check
      CHECK (ui_theme IN ('crimson', 'amber', 'ember', 'arcane'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT users_ui_theme_check;
  `);
  pgm.sql(`
    ALTER TABLE users ADD CONSTRAINT users_ui_theme_check
      CHECK (ui_theme IN ('crimson', 'amber', 'ember'));
  `);
}
