import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3.3: battle map with token positions. `encounter_maps` is a separate
// optional 1:1 table (one row per encounter, not every encounter has a map
// configured yet) rather than nullable columns crammed onto `encounters` —
// same precedent as other optional-extension tables in this schema.
// `combat_participants.pos_x`/`pos_y` are grid CELL coordinates (e.g. column
// 3, row 7), not raw pixel offsets — the frontend multiplies by cell_size_px
// to get screen position. Both nullable: a participant has no position until
// the DM places their token.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE encounter_maps (
      id                  BIGSERIAL PRIMARY KEY,
      encounter_id        BIGINT NOT NULL UNIQUE REFERENCES encounters(id) ON DELETE CASCADE,
      background_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL,
      grid_columns        INT NOT NULL DEFAULT 20,
      grid_rows           INT NOT NULL DEFAULT 20,
      cell_size_px        INT NOT NULL DEFAULT 50,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`
    ALTER TABLE combat_participants ADD COLUMN pos_x INT; -- grid cell column index, not raw pixels
    ALTER TABLE combat_participants ADD COLUMN pos_y INT; -- grid cell row index, not raw pixels
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN IF EXISTS pos_x;
    ALTER TABLE combat_participants DROP COLUMN IF EXISTS pos_y;
    DROP TABLE IF EXISTS encounter_maps;
  `);
}
