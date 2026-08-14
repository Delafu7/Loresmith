import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// campaign_members.max_characters (1784269779666_add-campaign-member-character-limits.ts)
// defaulted to NULL (unlimited) so existing rows kept today's behavior when
// the column was introduced. Now that a per-player allowance is the norm,
// new memberships (services/campaigns.ts's insertMembership, used by both
// addMember and campaignInvitations.ts's acceptInvitation) should default to
// a 1-character allowance instead. Only the column DEFAULT changes here —
// existing rows keep whatever value they already have (including NULL), so
// no current player is retroactively restricted.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE campaign_members ALTER COLUMN max_characters SET DEFAULT 1;`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE campaign_members ALTER COLUMN max_characters SET DEFAULT NULL;`);
}
