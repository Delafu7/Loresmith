import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `sessions` (the session-LOG table, see 1784269741666_create-sessions-and-notes.ts)
// had created_at but no updated_at — same gap campaign_assets had
// (1784269773666_campaign-assets-updated-at.ts). The new PATCH
// /campaigns/:id/sessions/:sid edit flow needs somewhere to record "last
// edited". Backfilling updated_at to match created_at (rather than DEFAULT
// now()) avoids every pre-existing session log entry looking like it was
// just edited the moment this migration ran.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE sessions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    UPDATE sessions SET updated_at = created_at;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE sessions DROP COLUMN updated_at;`);
}
