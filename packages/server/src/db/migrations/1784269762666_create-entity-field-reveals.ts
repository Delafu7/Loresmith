import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Reveal engine generalization (PLAN.md §11). Generalizes the DM/player
// redaction pattern `hp_visibility` (combat_participants) and
// `visible_to_players` (active_effects/campaign_assets/notes) already prove
// out, to arbitrary character/monster-instance stat-block fields. Those two
// existing mechanisms are deliberately left untouched — see §11's locked-in
// decision — this is strictly additive.
//
// Same "attaches to a character OR a monster instance" shape as
// active_effects/character_items/combat_participants: dual-nullable-FK +
// CHECK(num_nonnulls(...)=1), not a polymorphic entity_type/entity_id pair,
// so referential integrity stays declarative rather than app-enforced.
//
// A missing row for a given (entity, field_key) means "fall back to
// campaigns.reveal_defaults," not "hidden by construction" — this is what
// lets a campaign-wide default allowlist (name/image/size/type visible by
// default) work without pre-seeding a row per field per entity that's ever
// created.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE entity_field_reveals (
      id                  BIGSERIAL PRIMARY KEY,
      character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
      monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
      field_key           TEXT NOT NULL, -- validated against a per-entity-type field registry in app code (src/domain/revealFields.ts), not a DB CHECK
      revealed            BOOLEAN NOT NULL DEFAULT false,
      player_override     TEXT,
      revealed_at         TIMESTAMPTZ,
      revealed_by_user_id BIGINT REFERENCES users(id),
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
    );
    CREATE UNIQUE INDEX ON entity_field_reveals (character_id, field_key) WHERE character_id IS NOT NULL;
    CREATE UNIQUE INDEX ON entity_field_reveals (monster_instance_id, field_key) WHERE monster_instance_id IS NOT NULL;

    ALTER TABLE campaigns ADD COLUMN reveal_defaults JSONB NOT NULL DEFAULT
      '{"character": ["name","portraitAssetId"], "monster_instance": ["name","size","creatureType","portraitAssetId"]}';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaigns DROP COLUMN reveal_defaults;
    DROP TABLE IF EXISTS entity_field_reveals;
  `);
}
