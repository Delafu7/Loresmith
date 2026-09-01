import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — Fall damage was
// explicitly blocked on "elevation/pit-trigger support not existing in the
// map model" (that item's own text). This is the elevation half of that
// foundation: a DM-tunable per-participant height above the map's ground
// plane, mirroring 1784269817666_add-participant-vision.ts's vision_radius_ft
// precedent exactly (an encounter-scoped board attribute, not an intrinsic
// property of the creature — there's no structured "current height" field
// anywhere in the catalog to derive this from, and a DM can plausibly want
// to correct it mid-fight, e.g. after a fly spell ends). See
// 1784269843666_add-map-cell-pit.ts for the pit-trigger half.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN elevation_ft INT NOT NULL DEFAULT 0;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN elevation_ft;
  `);
}
