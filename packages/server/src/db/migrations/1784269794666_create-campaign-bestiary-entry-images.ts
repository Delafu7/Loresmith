import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 4 — a bestiary entry's image gallery (multiple images per
// entry, e.g. a portrait plus a token/map-location shot), reusing the
// campaign_assets rows and their visible_to_players flag (re-added by
// 1784269793666) rather than a second per-image visibility mechanism. Just
// a join table (asset content/visibility lives on campaign_assets itself);
// deleting the underlying asset (existing DELETE /assets/:id) cascades here,
// so no dedicated remove-image endpoint is needed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_bestiary_entry_images (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bestiary_entry_id UUID NOT NULL REFERENCES campaign_bestiary_entries(id) ON DELETE CASCADE,
      asset_id          UUID NOT NULL REFERENCES campaign_assets(id) ON DELETE CASCADE,
      sort_order        INT NOT NULL DEFAULT 0,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bestiary_entry_id, asset_id)
    );
    CREATE INDEX ON campaign_bestiary_entry_images (bestiary_entry_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_bestiary_entry_images;
  `);
}
