import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Interface language (en/es/fr), a personal preference stored per-user —
// same shape as ui_theme (1784269761666_add-user-ui-theme.ts): plain TEXT +
// CHECK rather than a DB enum type, so widening the supported-language list
// later is just another migration adding to the CHECK, not an enum-type
// migration. Defaults to 'en' regardless of the account's own locale at
// signup time (no Accept-Language sniffing server-side) — the web client
// detects the browser's language for a logged-out visitor and only ever
// persists an explicit choice once the user actually picks one.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'
      CHECK (locale IN ('en', 'es', 'fr'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE users DROP COLUMN locale;`);
}
