import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `campaign_assets` (PLAN.md §3.5, Phase 3.1 — images/file-upload
// foundation) — per-campaign uploaded files (images now, `handout` reserved
// for a later phase, hence the CHECK already allowing it even though nothing
// writes it yet). Not homebrew-scoped like `effect_definitions`/`monsters`
// (no `is_homebrew`/`owning_campaign_id` pair here) since every asset row
// always belongs to exactly one campaign already via `campaign_id` — there's
// no "global" campaign_assets row that a campaign could opt into homebrewing,
// so that pattern doesn't apply here.
//
// Storage is local disk under a gitignored packages/server/uploads/
// directory, served via express.static at /uploads (see src/index.ts and
// src/middleware/upload.ts) — `file_url` stores the public path
// (/uploads/campaigns/{campaignId}/{uuid}.{ext}), never a client-supplied
// filename (crypto.randomUUID()-based, per the security note in
// src/middleware/upload.ts).
//
// `characters.portrait_asset_id` is added in the same migration (not a
// follow-up file) since it's the only consumer of campaign_assets in this
// phase and the two are conceptually one unit of work.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_assets (
      id                  BIGSERIAL PRIMARY KEY,
      campaign_id         BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
      asset_type          TEXT NOT NULL CHECK (asset_type IN ('image','handout')), -- 'handout' reserved for future use
      file_url            TEXT NOT NULL,
      mime_type           TEXT NOT NULL,
      file_size_bytes     INT NOT NULL,
      title               TEXT,
      visible_to_players  BOOLEAN NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  pgm.sql(`CREATE INDEX ON campaign_assets (campaign_id);`);

  pgm.sql(`
    ALTER TABLE characters
      ADD COLUMN portrait_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE characters DROP COLUMN IF EXISTS portrait_asset_id;`);
  pgm.sql(`DROP TABLE IF EXISTS campaign_assets;`);
}
