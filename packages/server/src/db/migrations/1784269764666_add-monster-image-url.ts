import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// REFACTOR-PLAN.md §1.1: "every creature gets a descriptive image, with a
// placeholder fallback." Homebrew creatures already get an image via
// art_asset_id -> campaign_assets (1784269753666), but that path needs a
// campaign to upload into — global/seeded catalog monsters have no campaign
// context, so they can never have one. A plain nullable URL column works for
// BOTH global and homebrew rows without pulling in the deferred
// content-addressed media rewrite (REVISION-PLAN.md §3) just for this.
// NULL (the default for every existing row) keeps today's placeholder-initial
// rendering exactly as-is.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters ADD COLUMN image_url TEXT;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters DROP COLUMN image_url;
  `);
}
