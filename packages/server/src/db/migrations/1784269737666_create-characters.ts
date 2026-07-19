import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Campaign-instance: the persistent character/NPC sheet (PLAN.md §3.2).
// Phase 1 includes the full column set (including `exhaustion_level`) even
// though nothing sets exhaustion yet — harmless default 0, avoids an ALTER
// TABLE later. Spells/items/resource-pools are NOT referenced here; those
// join tables are Phase 2.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE characters (
      id                 BIGSERIAL PRIMARY KEY,
      campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      is_pc              BOOLEAN NOT NULL,
      owner_user_id      BIGINT REFERENCES users(id),   -- player who owns this PC; NULL for NPCs
      created_by_user_id BIGINT NOT NULL REFERENCES users(id),
      name               TEXT NOT NULL,
      race_id            BIGINT REFERENCES races(id),
      subrace_id         BIGINT REFERENCES subraces(id),
      background_id      BIGINT REFERENCES backgrounds(id),
      alignment          TEXT,
      str INT NOT NULL, dex INT NOT NULL, con INT NOT NULL,
      int INT NOT NULL, wis INT NOT NULL, cha INT NOT NULL,
      armor_class         INT NOT NULL,
      speed               INT NOT NULL DEFAULT 30,
      hp_max               INT NOT NULL,
      hp_current           INT NOT NULL,
      hp_temp              INT NOT NULL DEFAULT 0,
      hit_dice_remaining   JSONB,  -- {"d8":3} per class; recovery-on-long-rest arithmetic is app logic
      exhaustion_level     INT NOT NULL DEFAULT 0 CHECK (exhaustion_level BETWEEN 0 AND 6),
      senses               TEXT,
      languages            BIGINT[],
      is_alive             BOOLEAN NOT NULL DEFAULT true,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (NOT is_pc OR owner_user_id IS NOT NULL)
    );
    CREATE INDEX ON characters (campaign_id);
    CREATE INDEX ON characters (owner_user_id);
    -- Passive perception is NOT a stored column: computed at the query/app layer
    -- from character_skill_proficiencies + WIS.
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS characters;`);
}
