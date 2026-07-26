import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// REFACTOR-PLAN.md §4 (movement with real cost) — see docs/rules/movement.md
// for the full SRD sourcing this schema implements.
//
// feet_per_cell is a NEW, DISTINCT column from cell_size_px — cell_size_px is
// a pixel rendering dimension (REFACTOR-PLAN.md §3's zoom/display work),
// feet_per_cell is the movement-math ratio. Conflating them would make a
// DM's display zoom change silently alter movement legality — confirmed as
// a real gap in docs/rules/movement.md §2.1, not a design choice.
//
// map_cell_overrides is a sparse table: a missing (x,y) row means normal
// terrain, cost 1 — 'normal' is deliberately not a valid cost_type value.
//
// campaigns.diagonal_movement_rule: 'flat' (2024's only confirmed grid
// variant — every entered square costs the same regardless of diagonal) is
// the default for both editions, since docs/rules/movement.md found 2014's
// grounding text silent on diagonal movement entirely (the well-known
// "alternating 5/10/5" rule is NOT confirmed SRD text in this project's
// reference data) — 'alternating_5_10_5' is offered as the DM-configurable
// alternative, not silently assumed for either edition.
//
// characters.alt_speeds mirrors monsters.speed's existing JSONB shape (minus
// 'walk', which characters already store as a plain int column) — PCs with a
// racial/class-granted fly/swim/climb/burrow speed had nowhere to record it
// before this.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE encounter_maps ADD COLUMN feet_per_cell INT NOT NULL DEFAULT 5;

    ALTER TABLE campaigns ADD COLUMN diagonal_movement_rule TEXT NOT NULL DEFAULT 'flat'
      CHECK (diagonal_movement_rule IN ('flat', 'alternating_5_10_5'));

    ALTER TABLE characters ADD COLUMN alt_speeds JSONB NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE map_cell_overrides (
      id               BIGSERIAL PRIMARY KEY,
      encounter_map_id BIGINT NOT NULL REFERENCES encounter_maps(id) ON DELETE CASCADE,
      x                INT NOT NULL,
      y                INT NOT NULL,
      cost_type        TEXT NOT NULL DEFAULT 'difficult'
                          CHECK (cost_type IN ('difficult', 'impassable', 'special')),
      medium           TEXT NOT NULL DEFAULT 'ground'
                          CHECK (medium IN ('ground', 'water', 'air', 'underground')),
      special_cost_ft  INT,
      note             TEXT,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (encounter_map_id, x, y)
    );
    CREATE INDEX ON map_cell_overrides (encounter_map_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE map_cell_overrides;
    ALTER TABLE characters DROP COLUMN alt_speeds;
    ALTER TABLE campaigns DROP COLUMN diagonal_movement_rule;
    ALTER TABLE encounter_maps DROP COLUMN feet_per_cell;
  `);
}
