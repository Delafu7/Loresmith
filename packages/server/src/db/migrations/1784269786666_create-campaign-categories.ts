import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Generic per-campaign category/tag system, built now (Task 1) even though
// the DM-facing manage-categories CRUD UI (create/rename/recolor/reorder/
// delete) is a later task — deliberately shaped so that work is additive,
// not a migration. campaign_categories is one row per DM-defined tag,
// scoped to both campaign AND entity_type so "Undead" as a creature tag and
// "Undead" as a shop tag don't collide. entity_categories is the many-to-
// many attach table; entity_id is intentionally NOT a foreign key (no single
// table it could point at — campaign_bestiary_entries today, characters/
// items/shops/maps later) so entity_type is carried redundantly on the join
// row and checked in the service layer against the referenced category's own
// entity_type, the same "app-layer, not declarative" precedent this codebase
// already uses for polymorphic-ish ownership checks (see services/assets.ts).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_categories (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      name        TEXT NOT NULL,
      color       TEXT,
      icon        TEXT,
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, entity_type, name)
    );
    CREATE INDEX ON campaign_categories (campaign_id, entity_type);

    CREATE TABLE entity_categories (
      category_id UUID NOT NULL REFERENCES campaign_categories(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id   UUID NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (category_id, entity_id)
    );
    CREATE INDEX ON entity_categories (entity_type, entity_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS entity_categories;
    DROP TABLE IF EXISTS campaign_categories;
  `);
}
