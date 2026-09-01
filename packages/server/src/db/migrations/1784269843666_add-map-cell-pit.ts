import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — the pit-trigger half
// of the map-model foundation this item was blocked on (see
// 1784269842666_add-participant-elevation.ts for the elevation half). A pit
// is modeled as a NEW map_cell_overrides.cost_type value ('pit'), reusing
// the exact same DM-authored per-cell table the difficult/impassable/special
// terrain overrides already use (1784269766666_add-movement-cost-schema.ts)
// rather than a new table — a hidden pit trap is a per-cell property exactly
// like those, just one services/movement.ts's cost math deliberately does
// NOT treat as extra movement cost (walking onto a hidden trap doesn't cost
// more than a normal step; the trap's consequence is the fall, detected and
// resolved separately by services/fallDamage.ts). pit_depth_ft is only ever
// meaningful when cost_type = 'pit' (NULL for every other cost type, same
// "only meaningful for one branch" shape as special_cost_ft is for
// cost_type = 'special').
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE map_cell_overrides DROP CONSTRAINT map_cell_overrides_cost_type_check;
    ALTER TABLE map_cell_overrides ADD CONSTRAINT map_cell_overrides_cost_type_check
      CHECK (cost_type IN ('difficult', 'impassable', 'special', 'pit'));
    ALTER TABLE map_cell_overrides ADD COLUMN pit_depth_ft INT;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE map_cell_overrides DROP COLUMN pit_depth_ft;
    ALTER TABLE map_cell_overrides DROP CONSTRAINT map_cell_overrides_cost_type_check;
    ALTER TABLE map_cell_overrides ADD CONSTRAINT map_cell_overrides_cost_type_check
      CHECK (cost_type IN ('difficult', 'impassable', 'special'));
  `);
}
