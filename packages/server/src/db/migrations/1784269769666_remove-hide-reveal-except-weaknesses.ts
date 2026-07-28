import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Removes the general-purpose "hide information from players" feature
// (combat_participants.hp_visibility, and visible_to_players on
// active_effects/campaign_assets/notes/dice_rolls), and narrows the
// entity_field_reveals engine down to the one thing that's staying: a DM
// can still hide/reveal a monster instance's damage vulnerabilities,
// resistances, and immunities. Everything else that engine covered
// (character fields entirely; armor_class/speed/saving_throws/skills/senses/
// traits/actions/legendary_actions/reactions on monster instances) is now
// always visible to players, same as any other stat-block field.
//
// This is a data-destroying migration by design — the feature is gone, not
// archived. down() restores the columns/rows with safe defaults, not the
// original hidden/revealed state (that information is intentionally not
// preserved).

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE combat_participants DROP COLUMN hp_visibility;
    ALTER TABLE active_effects DROP COLUMN visible_to_players;
    ALTER TABLE campaign_assets DROP COLUMN visible_to_players;
    ALTER TABLE notes DROP COLUMN visible_to_players;
    ALTER TABLE dice_rolls DROP COLUMN visible_to_players;

    -- Drop every reveal row except the three weakness fields on monster
    -- instances (this also drops every character-scoped row outright).
    DELETE FROM entity_field_reveals
    WHERE character_id IS NOT NULL
       OR field_key NOT IN ('damage_vulnerabilities', 'damage_resistances', 'damage_immunities');

    -- character_id CASCADE also drops the two-column CHECK(num_nonnulls(...)=1)
    -- and the character_id partial unique index, since both depend on it.
    ALTER TABLE entity_field_reveals DROP COLUMN character_id CASCADE;
    ALTER TABLE entity_field_reveals ALTER COLUMN monster_instance_id SET NOT NULL;
    ALTER TABLE entity_field_reveals ADD CONSTRAINT entity_field_reveals_field_key_check
      CHECK (field_key IN ('damage_vulnerabilities', 'damage_resistances', 'damage_immunities'));

    -- The monster_instance_id partial unique index (WHERE monster_instance_id
    -- IS NOT NULL) is now redundant with the column's own NOT NULL — replaced
    -- with a plain unique index so an unqualified
    -- ON CONFLICT (monster_instance_id, field_key) (services/
    -- entityFieldReveal.ts's upsert) can target it; Postgres only infers a
    -- partial index for ON CONFLICT when the predicate is repeated verbatim
    -- in the ON CONFLICT clause itself.
    DROP INDEX entity_field_reveals_monster_instance_id_field_key_idx;
    CREATE UNIQUE INDEX ON entity_field_reveals (monster_instance_id, field_key);

    -- reveal_defaults keyed by entity type is no longer meaningful (only
    -- monster_instance weakness fields remain revealable, and none default
    -- to revealed — a weakness starts secret until the DM reveals it).
    UPDATE campaigns SET reveal_defaults = '[]'::jsonb;
    ALTER TABLE campaigns ALTER COLUMN reveal_defaults SET DEFAULT '[]'::jsonb;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaigns ALTER COLUMN reveal_defaults SET DEFAULT
      '{"character": ["name","portraitAssetId"], "monster_instance": ["name","size","creatureType","portraitAssetId"]}';
    UPDATE campaigns SET reveal_defaults =
      '{"character": ["name","portraitAssetId"], "monster_instance": ["name","size","creatureType","portraitAssetId"]}';

    ALTER TABLE entity_field_reveals DROP CONSTRAINT entity_field_reveals_field_key_check;
    DROP INDEX entity_field_reveals_monster_instance_id_field_key_idx;
    CREATE UNIQUE INDEX ON entity_field_reveals (monster_instance_id, field_key) WHERE monster_instance_id IS NOT NULL;
    ALTER TABLE entity_field_reveals ALTER COLUMN monster_instance_id DROP NOT NULL;
    ALTER TABLE entity_field_reveals ADD COLUMN character_id BIGINT REFERENCES characters(id) ON DELETE CASCADE;
    ALTER TABLE entity_field_reveals ADD CONSTRAINT entity_field_reveals_check
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1);
    CREATE UNIQUE INDEX ON entity_field_reveals (character_id, field_key) WHERE character_id IS NOT NULL;

    ALTER TABLE dice_rolls ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE notes ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE campaign_assets ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE active_effects ADD COLUMN visible_to_players BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE combat_participants ADD COLUMN hp_visibility TEXT NOT NULL DEFAULT 'banded'
      CHECK (hp_visibility IN ('exact','banded','hidden'));
  `);
}
