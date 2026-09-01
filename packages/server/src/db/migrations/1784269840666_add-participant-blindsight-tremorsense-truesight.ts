import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// docs/roadmap/dnd-2024-gap-analysis.md P2-6 (ER-09) — Blindsight/
// Tremorsense/Truesight as tracked senses, mirroring
// 1784269817666_add-participant-vision.ts's vision_radius_ft/
// darkvision_radius_ft precedent exactly: lives on combat_participants, not
// characters/monster_instances — same reasoning as that migration's own
// comment (no structured numeric "blindsight ft" field anywhere in the
// catalog to derive this from; a DM sets it explicitly per seating).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN blindsight_radius_ft INT NOT NULL DEFAULT 0;
    ALTER TABLE combat_participants ADD COLUMN tremorsense_radius_ft INT NOT NULL DEFAULT 0;
    ALTER TABLE combat_participants ADD COLUMN truesight_radius_ft INT NOT NULL DEFAULT 0;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN truesight_radius_ft;
    ALTER TABLE combat_participants DROP COLUMN tremorsense_radius_ft;
    ALTER TABLE combat_participants DROP COLUMN blindsight_radius_ft;
  `);
}
