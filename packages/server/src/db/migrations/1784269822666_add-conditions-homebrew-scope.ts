import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Compendium feature, Phase 3: brings `conditions` into the same
// homebrew/campaign/personal-library scoping every other catalog table
// already has (1784269771666_catalog-homebrew-scope.ts +
// 1784269821666_add-catalog-user-library-scope.ts), and doubles as the
// "add a new content type" proof for the generic registry — see
// catalogEntities.ts (web) and catalogEntityTables.ts (server) for the
// corresponding registry-only wiring. `conditions` never got the homebrew
// columns earlier because it predates the catalog-homebrew system; it's
// otherwise a plain reference table today, so this adds is_homebrew /
// owning_campaign_id / owning_user_id / created_at / updated_at in one
// shot (rather than two migrations like the other tables got) with the
// final three-way CHECK from the start.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE conditions ADD COLUMN is_homebrew BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE conditions ADD COLUMN owning_campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE;
    ALTER TABLE conditions ADD COLUMN owning_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    ALTER TABLE conditions ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE conditions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    ALTER TABLE conditions ADD CONSTRAINT conditions_homebrew_scope CHECK (
      (is_homebrew AND num_nonnulls(owning_campaign_id, owning_user_id) = 1)
      OR (NOT is_homebrew AND owning_campaign_id IS NULL AND owning_user_id IS NULL)
    );
    CREATE INDEX ON conditions (owning_campaign_id);
    CREATE INDEX ON conditions (owning_user_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE conditions DROP CONSTRAINT conditions_homebrew_scope;
    ALTER TABLE conditions DROP COLUMN is_homebrew;
    ALTER TABLE conditions DROP COLUMN owning_campaign_id;
    ALTER TABLE conditions DROP COLUMN owning_user_id;
    ALTER TABLE conditions DROP COLUMN created_at;
    ALTER TABLE conditions DROP COLUMN updated_at;
  `);
}
