import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Action recording (nav point 2) — every action records actor, target(s),
// type, specific means, and result, so the combat log can render structured
// lines ("Aria attacks Goblin Scout with Shortbow -> 14 (hit) -> 6 piercing
// damage") from fields, not free-text parsing. `dice_rolls` (already
// existing) stays the roll ledger — this is a new, separate ledger for the
// ACTION itself, optionally correlated to a dice_rolls row via dice_roll_id.
//
// means_* are all independently nullable, not a num_nonnulls CHECK: an
// unarmed strike or a narrative-only ability has no catalog referent at all,
// and character_attacks (a PC's structured attack list) isn't itself FK'd to
// items/spells today (see 1784269768666's own header comment) — so
// means_label is the durable, always-present display fallback, and the FKs
// are best-effort enrichment where a real catalog row exists. ON DELETE SET
// NULL on means_character_attack_id so editing/removing an attack later
// never breaks historical log rows, only drops the live reference (means_label
// still renders the name as it was at the time).
//
// actor_character_id/actor_monster_instance_id are ON DELETE CASCADE, NOT
// SET NULL, despite means_character_attack_id just above using SET NULL —
// the actor columns are covered by a num_nonnulls=1 CHECK (exactly one must
// always be set), so nulling one out on delete would leave a row with BOTH
// null, which the CHECK correctly rejects. Deleting the actor's underlying
// character/monster instance removes their action-log history with them,
// same as combat_action_targets' target_* columns already do.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE combat_actions (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id               UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      actor_character_id         UUID REFERENCES characters(id) ON DELETE CASCADE,
      actor_monster_instance_id  UUID REFERENCES monster_instances(id) ON DELETE CASCADE,
      action_type                TEXT NOT NULL CHECK (action_type IN
                                    ('melee_attack','ranged_attack','spell','ability','item','healing','movement','other')),
      means_item_id              UUID REFERENCES items(id),
      means_spell_id             UUID REFERENCES spells(id),
      means_character_attack_id  UUID REFERENCES character_attacks(id) ON DELETE SET NULL,
      means_label                TEXT,
      dice_roll_id                UUID REFERENCES dice_rolls(id) ON DELETE SET NULL,
      result_kind                 TEXT NOT NULL DEFAULT 'n/a' CHECK (result_kind IN ('hit','miss','save_success','save_fail','effect','n/a')),
      damage_amount                INT,
      damage_type_id                UUID REFERENCES damage_types(id),
      effect_description             TEXT,
      created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (num_nonnulls(actor_character_id, actor_monster_instance_id) = 1)
    );
    CREATE INDEX ON combat_actions (encounter_id, created_at);

    CREATE TABLE combat_action_targets (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action_id                   UUID NOT NULL REFERENCES combat_actions(id) ON DELETE CASCADE,
      target_character_id         UUID REFERENCES characters(id) ON DELETE CASCADE,
      target_monster_instance_id  UUID REFERENCES monster_instances(id) ON DELETE CASCADE,
      CHECK (num_nonnulls(target_character_id, target_monster_instance_id) = 1)
    );
    CREATE INDEX ON combat_action_targets (action_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS combat_action_targets;
    DROP TABLE IF EXISTS combat_actions;
  `);
}
