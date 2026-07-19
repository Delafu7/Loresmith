import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 3.4: server-authoritative d20 dice roller (PLAN.md §3.5/§4.4/§5.7).
// `character_id`/`monster_instance_id` are independently nullable — NOT a
// num_nonnulls=1 CHECK — a roll can belong to neither (a DM rolling "for the
// room") or, in principle, to a monster_instance one (a DM rolling an NPC's
// attack) while also touching a character (no constraint forbids both being
// set either). `encounter_id` is nullable too: rolls can happen outside
// combat. `d20_rolls` holds every die actually rolled (1 normally, 2 for
// advantage/disadvantage) so a client can highlight both dice, not just the
// kept one; nat20/nat1 highlighting is computed client-side from this array
// rather than stored as a separate boolean.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE dice_rolls (
      id                  BIGSERIAL PRIMARY KEY,
      campaign_id         BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id             BIGINT NOT NULL REFERENCES users(id),
      character_id        BIGINT REFERENCES characters(id) ON DELETE SET NULL,
      monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE SET NULL,
      encounter_id        BIGINT REFERENCES encounters(id) ON DELETE SET NULL, -- nullable: rolls can happen outside combat
      roll_type           TEXT NOT NULL CHECK (roll_type IN
                             ('ability_check','saving_throw','skill_check','attack','initiative','death_save','custom')),
      roll_context        TEXT, -- display label, e.g. 'Stealth', 'STR Save', 'Scimitar'
      d20_rolls           INT[] NOT NULL, -- 1 element normally, 2 for advantage/disadvantage
      keep                TEXT NOT NULL DEFAULT 'normal' CHECK (keep IN ('normal','advantage','disadvantage')),
      modifier            INT NOT NULL DEFAULT 0,
      result_total        INT NOT NULL, -- kept die + modifier
      visible_to_players  BOOLEAN NOT NULL DEFAULT true,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  pgm.sql(`CREATE INDEX ON dice_rolls (campaign_id, created_at);`);
  pgm.sql(`CREATE INDEX ON dice_rolls (encounter_id);`);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS dice_rolls;`);
}
