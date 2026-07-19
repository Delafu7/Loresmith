import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// `active_effects` (PLAN.md §3.2, verbatim) — the applied INSTANCE of an
// `effect_definitions` template: real duration countdown, save DC, source,
// and target. Attaches to a character OR a monster instance (dual nullable
// FK + CHECK, same pattern as `character_items`/`combat_participants`).
//
// Three SRD-validation amendments folded in here (PLAN.md §3.4 items 2-4):
//
// 1. `stack_count` — Exhaustion-style leveled effects (0-6) don't fit
//    `duration_type`/`duration_value` (a countdown), so this is a separate
//    column for "how many stacks/levels", distinct from "rounds left".
// 2. `visible_to_players` — lets the DM hide an effect (disguise, trap)
//    from the player-facing feed while still tracking it server-side.
// 3. The two partial unique indexes below are a declarative enforcement of
//    "you can't concentrate on two spells at once" — a hard 5e rule that
//    would otherwise only be an app-layer check. Scoped separately per
//    character and per monster instance since exactly one of those two FKs
//    is populated on any given row.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE active_effects (
      id                   BIGSERIAL PRIMARY KEY,
      effect_definition_id BIGINT NOT NULL REFERENCES effect_definitions(id),
      character_id         BIGINT REFERENCES characters(id) ON DELETE CASCADE,
      monster_instance_id  BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
      encounter_id         BIGINT REFERENCES encounters(id) ON DELETE SET NULL,
      source_character_id  BIGINT REFERENCES characters(id),
      source_spell_id      BIGINT REFERENCES spells(id),
      source_type          TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN
                              ('spell','class_feature','monster_ability','item','manual')),
      duration_type        TEXT NOT NULL CHECK (duration_type IN
                              ('rounds','minutes','hours','until_save','until_removed','permanent','special')),
      duration_value       INT,
      stack_count          INT,
      applied_at_round     INT,
      save_dc              INT,
      save_ability_id      BIGINT REFERENCES ability_scores(id),
      concentration        BOOLEAN NOT NULL DEFAULT false,
      visible_to_players   BOOLEAN NOT NULL DEFAULT true,
      removed_at           TIMESTAMPTZ,
      notes                TEXT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
    );
    CREATE INDEX ON active_effects (character_id) WHERE removed_at IS NULL;
    CREATE INDEX ON active_effects (monster_instance_id) WHERE removed_at IS NULL;
    CREATE INDEX ON active_effects (encounter_id);
    CREATE UNIQUE INDEX active_effects_one_concentration_per_character
      ON active_effects (character_id) WHERE concentration = true AND removed_at IS NULL;
    CREATE UNIQUE INDEX active_effects_one_concentration_per_monster_instance
      ON active_effects (monster_instance_id) WHERE concentration = true AND removed_at IS NULL;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS active_effects;`);
}
