import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Compendium feature, Phase 3: generalizes the `owning_user_id` personal-
// library axis that 1784269789666_add-monster-library-scope.ts proved out
// for `monsters` ("my personal library, reusable across every campaign I
// run") to every other homebrew-scoped catalog table. Same shape every
// time: a homebrew row now belongs to exactly one of {a campaign, a user},
// never both, never neither; a global row still has both NULL. Every
// existing row already satisfies the widened constraint unchanged
// (owning_user_id defaults to NULL, and existing rows have exactly one of
// is_homebrew=false or owning_campaign_id set), so no backfill is needed.
//
// Eleven of these tables got is_homebrew/owning_campaign_id from
// 1784269771666_catalog-homebrew-scope.ts, whose CHECK constraints were
// named `<table>_homebrew_scope`. `effect_definitions` got the same columns
// earlier, inline in its own create migration
// (1784269747666_create-effect-definitions.ts) with an unnamed CHECK that
// Postgres auto-named `effect_definitions_check` — handled separately below
// so this migration doesn't guess a constraint name that doesn't exist.
const NAMED_CONSTRAINT_TABLES = [
  'items', 'spells', 'races', 'subraces', 'classes', 'subclasses',
  'backgrounds', 'feats', 'alignments', 'languages', 'damage_types',
];

export async function up(pgm: MigrationBuilder): Promise<void> {
  for (const t of NAMED_CONSTRAINT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${t} ADD COLUMN owning_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
      CREATE INDEX ON ${t} (owning_user_id);
      ALTER TABLE ${t} DROP CONSTRAINT ${t}_homebrew_scope;
      ALTER TABLE ${t} ADD CONSTRAINT ${t}_homebrew_scope CHECK (
        (is_homebrew AND num_nonnulls(owning_campaign_id, owning_user_id) = 1)
        OR (NOT is_homebrew AND owning_campaign_id IS NULL AND owning_user_id IS NULL)
      );
    `);
  }

  pgm.sql(`
    ALTER TABLE effect_definitions ADD COLUMN owning_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    CREATE INDEX ON effect_definitions (owning_user_id);
    ALTER TABLE effect_definitions DROP CONSTRAINT effect_definitions_check;
    ALTER TABLE effect_definitions ADD CONSTRAINT effect_definitions_homebrew_scope CHECK (
      (is_homebrew AND num_nonnulls(owning_campaign_id, owning_user_id) = 1)
      OR (NOT is_homebrew AND owning_campaign_id IS NULL AND owning_user_id IS NULL)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE effect_definitions DROP CONSTRAINT effect_definitions_homebrew_scope;
    ALTER TABLE effect_definitions ADD CONSTRAINT effect_definitions_check CHECK (is_homebrew OR owning_campaign_id IS NULL);
    ALTER TABLE effect_definitions DROP COLUMN owning_user_id;
  `);

  for (const t of NAMED_CONSTRAINT_TABLES) {
    pgm.sql(`
      ALTER TABLE ${t} DROP CONSTRAINT ${t}_homebrew_scope;
      ALTER TABLE ${t} ADD CONSTRAINT ${t}_homebrew_scope CHECK (is_homebrew OR owning_campaign_id IS NULL);
      ALTER TABLE ${t} DROP COLUMN owning_user_id;
    `);
  }
}
