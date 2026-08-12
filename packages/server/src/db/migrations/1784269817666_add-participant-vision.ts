import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// DM battle-map vision/elements feature — per-participant vision config
// (line-of-sight radius, darkvision radius, on/off toggle) driving the
// client-side fog-of-war overlay (packages/web/src/encounters/vision/).
//
// Lives on combat_participants, not characters/monster_instances, matching
// the existing precedent of faction/visible_to_players: an encounter-scoped,
// DM-tunable board attribute, not an intrinsic property of the creature.
// There is also no structured numeric "darkvision ft" field anywhere in the
// catalog to derive this from (characters.senses / monsters' equivalent are
// free text) — a DM sets it explicitly per seating, and can plausibly want
// to change it mid-fight (e.g. a torch going out).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN vision_enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE combat_participants ADD COLUMN vision_radius_ft INT NOT NULL DEFAULT 30;
    ALTER TABLE combat_participants ADD COLUMN darkvision_radius_ft INT NOT NULL DEFAULT 0;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN darkvision_radius_ft;
    ALTER TABLE combat_participants DROP COLUMN vision_radius_ft;
    ALTER TABLE combat_participants DROP COLUMN vision_enabled;
  `);
}
