import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3 "locations and factions" — executes the "Phase 3 will add it back"
// deferrals left in 1784269740666_create-encounters-and-combat-participants.ts
// and 1784269741666_create-sessions-and-notes.ts. Both new tables share the
// same minimal shape (name/description/notes, campaign-scoped) as every
// other DM-authored reference entity in this app (plot_threads, notes).
//
// location_id lands on encounters/notes/sessions (a plain nullable FK) —
// exactly the three tables those deferral comments named. Cross-linking a
// CHARACTER/monster/item to a FACTION deliberately reuses the existing
// campaign_categories/entity_categories tagging pattern (per the plan)
// rather than a new join table — a faction membership is a many-to-many
// tag relationship, the same shape entity_categories already models, not a
// new mechanism. That reuse isn't wired up in this migration (no UI/service
// changes to campaignCategories.ts here) — it's a natural follow-up, not
// blocked by anything added here (entity_categories.entity_type is already
// a free string, so `entity_type = 'faction_member'` or similar needs no
// schema change to start using later).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE locations (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON locations (campaign_id);

    CREATE TABLE factions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON factions (campaign_id);

    ALTER TABLE encounters ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
    ALTER TABLE notes ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
    ALTER TABLE sessions ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE sessions DROP COLUMN location_id;
    ALTER TABLE notes DROP COLUMN location_id;
    ALTER TABLE encounters DROP COLUMN location_id;
    DROP TABLE IF EXISTS factions;
    DROP TABLE IF EXISTS locations;
  `);
}
