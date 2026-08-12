import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// DM battle-map vision/elements feature — generic non-token map elements
// (walls, doors, lights, difficult-terrain areas, DM-only notes, decorative
// images). Sparse table keyed on `map_id`, same convention as
// map_cell_overrides (1784269766666_add-movement-cost-schema.ts): elements
// persist per campaign-scoped `maps` row, not per encounter, so a wall drawn
// while prepping one fight is still there the next time that map is loaded
// (mirrors how map_cell_overrides already behaves, and matches the maps-
// library migration's own comment deferring "a future per-cell visibility
// layer" onto maps.id).
//
// Geometry is stored uniformly across types rather than as one shape per
// type: x1/y1/x2/y2 cover both a single anchor point (x1/y1 only — light,
// note, image) and a two-point segment (wall, door); `points` is a JSONB
// array of {x,y} vertices for the one polygon type (area). All coordinates
// are GRID-FRACTIONAL (float cell units — a wall along a cell edge sits at a
// half-integer), never raw pixels; conversion to/from pixels happens
// entirely client-side (see packages/web/src/encounters/geometry.ts).
//
// `props` is a JSONB catch-all for type-specific fields (door open/closed/
// locked state, light radius/color/intensity, area shape/cost/color, note
// body, image asset/size/rotation/opacity) — deliberately NOT modeled as
// individual columns, so that adding a new element type in the future is a
// registry-only change on the client, never a new migration on the server.
// The DB does not validate `props`' shape beyond it being an object; that's
// the Zod discriminated-union schema's job (schemas/mapElements.ts).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE map_elements (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      map_id             UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      type               TEXT NOT NULL CHECK (type IN ('wall', 'door', 'light', 'area', 'note', 'image')),
      x1                 DOUBLE PRECISION NOT NULL,
      y1                 DOUBLE PRECISION NOT NULL,
      x2                 DOUBLE PRECISION,
      y2                 DOUBLE PRECISION,
      points             JSONB,
      props              JSONB NOT NULL DEFAULT '{}'::jsonb,
      label              TEXT,
      visible_to_players BOOLEAN NOT NULL DEFAULT true,
      locked             BOOLEAN NOT NULL DEFAULT false,
      z_index            INT NOT NULL DEFAULT 0,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON map_elements (map_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE map_elements;
  `);
}
