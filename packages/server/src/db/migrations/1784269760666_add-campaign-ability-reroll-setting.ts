import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// First-ever campaign-wide settings toggle (Phase 3.8) — every other
// "DM can do X" behavior in this app is a stateless per-request role check
// (services/authz.ts), not a persisted flag, but "can players reroll their
// automated ability score generation" needs to persist across requests
// (the whole point is a DM deciding this once, not re-approving every roll).
// Defaults to true, reproducing today's implicit behavior where nothing
// stops a player from re-rolling (there's no rate limit anywhere yet).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaigns ADD COLUMN allow_ability_reroll BOOLEAN NOT NULL DEFAULT true;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaigns DROP COLUMN allow_ability_reroll;
  `);
}
