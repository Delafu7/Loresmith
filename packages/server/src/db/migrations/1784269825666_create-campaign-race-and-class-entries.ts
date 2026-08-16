import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign race/class curation — extends the campaign_bestiary_entries
// pattern (1784269785666) to the `races` and `classes` catalog tables: "this
// campaign has imported the High Elf, and the DM tweaked its traits." A
// campaign_race_entries/campaign_class_entries row is a reference to a
// races/classes catalog row plus DM-authored overrides, distinct from that
// catalog row's own homebrew-fork mechanism (routes/catalogHomebrew.ts's
// duplicate route, which copies a row into a brand-new campaign-owned catalog
// row entirely). Same two-tier duality monsters already have: a full fork
// (new catalog row) vs. a lightweight curated reference with a shallow JSON
// override blob. No FK from characters.race_id/class_id to either of these
// tables — a character keeps referencing the races/classes catalog row
// directly (global or homebrew), so importing/removing a campaign entry never
// affects any character that already picked that race or class, and a
// campaign with zero imports still works normally for character creation.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_race_entries (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      race_id          UUID NOT NULL REFERENCES races(id) ON DELETE CASCADE,
      custom_name      TEXT,
      overrides        JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes            TEXT,
      added_by_user_id UUID REFERENCES users(id),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, race_id)
    );
    CREATE INDEX ON campaign_race_entries (campaign_id);
    CREATE INDEX ON campaign_race_entries (race_id);

    CREATE TABLE campaign_class_entries (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      class_id         UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      custom_name      TEXT,
      overrides        JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes            TEXT,
      added_by_user_id UUID REFERENCES users(id),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, class_id)
    );
    CREATE INDEX ON campaign_class_entries (campaign_id);
    CREATE INDEX ON campaign_class_entries (class_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_class_entries;
    DROP TABLE IF EXISTS campaign_race_entries;
  `);
}
