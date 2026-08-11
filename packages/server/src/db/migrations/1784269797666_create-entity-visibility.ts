import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Generic per-character/per-user visibility allowlist (Phase 1.3 of the
// backlog implementation plan) — modeled directly on
// 1784269786666_create-campaign-categories.ts's entity_categories: entity_id
// is intentionally NOT a foreign key (no single target table — session
// recaps, plot threads, notes, ... later) so entity_type is carried on the
// row and validated in the service layer, same app-layer-not-declarative
// precedent. Row presence means "this user can see this entity"; absence
// falls back to a per-call-site default (visible-to-all vs hidden-until-
// granted) since different consumers want opposite defaults — that default
// is a parameter to services/visibility.ts's resolveVisibility, not encoded
// here.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE entity_visibility (
      entity_type TEXT NOT NULL,
      entity_id   UUID NOT NULL,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_type, entity_id, user_id)
    );
    CREATE INDEX ON entity_visibility (entity_type, entity_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS entity_visibility;`);
}
