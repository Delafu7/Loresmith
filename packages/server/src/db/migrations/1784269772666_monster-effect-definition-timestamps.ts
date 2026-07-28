import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 1 follow-up: 1784269771666_catalog-homebrew-scope.ts added
// created_at/updated_at to the 11 catalog tables it newly homebrew-scoped,
// but monsters and effect_definitions already had homebrew scoping from
// earlier work and were missed — they're just as much "content someone is
// actively creating and iterating on" as the other 11, so they get the same
// two columns here.
export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const t of ['monsters', 'effect_definitions']) {
    pgm.sql(`
      ALTER TABLE ${t} ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
      ALTER TABLE ${t} ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    `);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  for (const t of ['monsters', 'effect_definitions']) {
    pgm.sql(`
      ALTER TABLE ${t} DROP COLUMN created_at;
      ALTER TABLE ${t} DROP COLUMN updated_at;
    `);
  }
}
