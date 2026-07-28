import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// campaign_assets had created_at but no updated_at (unlike the catalog
// tables touched by 1784269771666/1784269772666) — the new PATCH /assets/:id
// rename endpoint needs somewhere to record "last renamed", same pattern as
// those two migrations. Unlike those two (which added BOTH columns fresh, so
// existing rows got identical created_at/updated_at), created_at already
// existed here — backfilling updated_at to match it (rather than leaving it
// at DEFAULT now()) avoids every pre-existing asset looking like it was just
// renamed the moment this migration ran.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_assets ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    UPDATE campaign_assets SET updated_at = created_at;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE campaign_assets DROP COLUMN updated_at;`);
}
