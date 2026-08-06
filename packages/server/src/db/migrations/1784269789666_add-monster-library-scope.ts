import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 2 "Shared bestiary across campaigns" — see docs from that
// planning session for the full rationale. `campaign_bestiary_entries`
// (1784269785666) already gives every campaign a many-to-many-shaped
// reference to a shared `monsters` template with copy-on-write overrides;
// the actual gap this migration closes is one level up, in the TEMPLATE's
// own authorship scope. Today a homebrew monster's `owning_campaign_id` caps
// it to exactly one campaign forever (services/monsterCatalog.ts). This adds
// a second, parallel ownership axis — `owning_user_id`, "my personal
// library, reusable across every campaign I run" — without touching the
// existing campaign-owned tier's behavior at all: every existing row already
// satisfies the new constraint unchanged (owning_campaign_id set,
// owning_user_id null), so no backfill is needed.
//
// derived_from_template_id is new provenance tracking for
// duplicateHomebrewMonster's fork flow (services/monsterCatalog.ts), which
// previously discarded the source id entirely — lets the UI show "based on
// {name}" and is purely additive, ON DELETE SET NULL so a deleted source
// template never blocks deleting the fork that was made from it.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters ADD COLUMN owning_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE monsters ADD COLUMN derived_from_template_id UUID REFERENCES monsters(id) ON DELETE SET NULL;

    ALTER TABLE monsters DROP CONSTRAINT monsters_homebrew_scope;
    ALTER TABLE monsters ADD CONSTRAINT monsters_homebrew_scope CHECK (
      (is_homebrew AND num_nonnulls(owning_campaign_id, owning_user_id) = 1)
      OR (NOT is_homebrew AND owning_campaign_id IS NULL AND owning_user_id IS NULL)
    );

    CREATE INDEX ON monsters (owning_user_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters DROP CONSTRAINT monsters_homebrew_scope;
    ALTER TABLE monsters ADD CONSTRAINT monsters_homebrew_scope CHECK (is_homebrew OR owning_campaign_id IS NULL);
    ALTER TABLE monsters DROP COLUMN derived_from_template_id;
    ALTER TABLE monsters DROP COLUMN owning_user_id;
  `);
}
