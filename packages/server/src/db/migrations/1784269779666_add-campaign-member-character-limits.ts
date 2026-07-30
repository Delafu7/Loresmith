import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Per-player, per-campaign controls over character creation (services/
// characters.ts's createCharacter player branch, DM-settable via PATCH
// /campaigns/:id/members/:userId — see services/campaigns.ts's
// updateMember). can_create_characters defaults to true and max_characters
// defaults to NULL (unlimited) so every existing membership row keeps
// today's unrestricted behavior until a DM explicitly dials it in.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_members ADD COLUMN can_create_characters BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE campaign_members ADD COLUMN max_characters INT NULL CHECK (max_characters IS NULL OR max_characters >= 0);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_members DROP COLUMN can_create_characters;
    ALTER TABLE campaign_members DROP COLUMN max_characters;
  `);
}
