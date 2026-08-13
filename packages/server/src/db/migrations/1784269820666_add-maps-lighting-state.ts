import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Per-map lighting state (nav point 4) — 'bright' (fully visible to
// players), 'dim' (visible, rendered in a distinct low-light state),
// 'dark' (players see only what their tokens' vision reaches; the rest is
// masked by the existing client-side fog-of-war). The DM's own view is
// never masked/gated by this column regardless of value (enforced
// client-side — see VisionOverlay.tsx's `active` gate). Defaults to
// 'bright' so every existing map keeps today's "players see the whole map"
// behavior unchanged until a DM explicitly sets it darker.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE maps ADD COLUMN lighting_state TEXT NOT NULL DEFAULT 'bright'
      CHECK (lighting_state IN ('bright', 'dim', 'dark'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE maps DROP COLUMN lighting_state;
  `);
}
