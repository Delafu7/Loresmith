import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3.2 (Creatures / Bestiary CRUD, PLAN.md §3.5): extends the monsters
// catalog with the same homebrew-scoping escape hatch already established by
// effect_definitions (1784269747666_create-effect-definitions.ts) — a DM can
// add campaign-scoped homebrew stat blocks without polluting the global
// catalog shared by every other campaign. Purely additive: every existing
// monster row keeps is_homebrew=false, owning_campaign_id=NULL,
// art_asset_id=NULL, so nothing about today's behavior changes.
//
// Deliberately NOT touching the existing UNIQUE(slug, edition_scope)
// constraint — two campaigns homebrewing a creature with the same name would
// collide on a plain slugify(name). That's solved in the service layer
// instead (services/monsterCatalog.ts appends a short random suffix to the
// slug for homebrew rows), not here.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters ADD COLUMN is_homebrew BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE monsters ADD COLUMN owning_campaign_id BIGINT REFERENCES campaigns(id) ON DELETE CASCADE;
    ALTER TABLE monsters ADD CONSTRAINT monsters_homebrew_scope CHECK (is_homebrew OR owning_campaign_id IS NULL);
    ALTER TABLE monsters ADD COLUMN art_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE monsters DROP CONSTRAINT monsters_homebrew_scope;
    ALTER TABLE monsters DROP COLUMN is_homebrew;
    ALTER TABLE monsters DROP COLUMN owning_campaign_id;
    ALTER TABLE monsters DROP COLUMN art_asset_id;
  `);
}
