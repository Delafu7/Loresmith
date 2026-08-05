import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Promotes maps from a 1:1-embedded-in-an-encounter concept (encounter_maps,
// 1784269754666) to a reusable, campaign-scoped library (`maps`), linked to
// encounters N:M via `encounter_maps_link`, with `encounters.active_map_id`
// pointing at "the map currently shown in the live view" — the same
// stable-pointer pattern as `active_participant_id`
// (1784269784666_add-active-participant-tracking.ts). A GM reuses a
// location (e.g. "The Sunless Vale — Entrance") across multiple encounters
// or sessions; the old 1:1 embedding made that impossible without
// recreating the same map by hand each time.
//
// Backfill strategy: one `maps` row per existing `encounter_maps` row,
// REUSING THE SAME id. This means `map_cell_overrides.encounter_map_id`
// values stay valid unchanged — only the FK's target table needs
// repointing, not every override row. `encounter_maps` itself is left in
// place (not dropped) so this migration's `down` needs no data
// reconstruction; dropping it is a deliberate separate follow-up migration
// once the new path is confirmed stable (see the plan doc), not bundled
// here.
//
// `maps` is DM-facing only for now (see routes/maps.ts) — `notes` may hold
// GM prep text, so the whole library, not just write access, is gated to
// the DM role, unlike e.g. campaign_bestiary_entries which players can read.
// No `gm_only_notes`/fog-of-war split yet — deferred, not blocked: a future
// per-cell visibility layer can hang off `maps.id` the same way
// `map_cell_overrides` already does.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE maps (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id         UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name                TEXT NOT NULL,
      description         TEXT,
      background_asset_id UUID REFERENCES campaign_assets(id) ON DELETE SET NULL,
      grid_columns        INT NOT NULL DEFAULT 20,
      grid_rows           INT NOT NULL DEFAULT 20,
      cell_size_px        INT NOT NULL DEFAULT 50,
      feet_per_cell       INT NOT NULL DEFAULT 5,
      notes               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON maps (campaign_id);

    CREATE TABLE encounter_maps_link (
      encounter_id UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      map_id       UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (encounter_id, map_id)
    );
    CREATE INDEX ON encounter_maps_link (map_id);

    ALTER TABLE encounters ADD COLUMN active_map_id UUID REFERENCES maps(id) ON DELETE SET NULL;

    -- Backfill: same id preserved, so map_cell_overrides rows need no rewrite.
    INSERT INTO maps (id, campaign_id, name, background_asset_id, grid_columns, grid_rows, cell_size_px, feet_per_cell, updated_at)
    SELECT em.id, e.campaign_id, COALESCE(e.name, 'Encounter') || ' Map',
           em.background_asset_id, em.grid_columns, em.grid_rows, em.cell_size_px, em.feet_per_cell, em.updated_at
    FROM encounter_maps em
    JOIN encounters e ON e.id = em.encounter_id;

    INSERT INTO encounter_maps_link (encounter_id, map_id)
    SELECT encounter_id, id FROM encounter_maps;

    UPDATE encounters e SET active_map_id = em.id
    FROM encounter_maps em
    WHERE em.encounter_id = e.id;

    ALTER TABLE map_cell_overrides DROP CONSTRAINT map_cell_overrides_encounter_map_id_fkey;
    ALTER TABLE map_cell_overrides ADD CONSTRAINT map_cell_overrides_encounter_map_id_fkey
      FOREIGN KEY (encounter_map_id) REFERENCES maps(id) ON DELETE CASCADE;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE map_cell_overrides DROP CONSTRAINT map_cell_overrides_encounter_map_id_fkey;
    ALTER TABLE map_cell_overrides ADD CONSTRAINT map_cell_overrides_encounter_map_id_fkey
      FOREIGN KEY (encounter_map_id) REFERENCES encounter_maps(id) ON DELETE CASCADE;

    ALTER TABLE encounters DROP COLUMN active_map_id;
    DROP TABLE encounter_maps_link;
    DROP TABLE maps;
  `);
}
