import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Distance-unit account preference (Iteration 4) — exact sibling of
// 1784269780666_add-user-avatar-and-text-size.ts's text_size column: a
// personal, requireAuth-only preference, not tied to any campaign/role.
// Stored values everywhere else stay in feet; only read-only display
// converts (packages/web/src/lib/units.ts's formatDistance).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'imperial' CHECK (unit_system IN ('imperial', 'metric'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN unit_system;
  `);
}
