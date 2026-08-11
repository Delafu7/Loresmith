import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 4 "Bastion tracking" sub-phase 2 — campaign-instance tables (see
// 1784269812666_create-bastion-facility-catalog.ts for the shared catalog
// these reference, and docs/rules/bastions.md for the full sourcing/design
// writeup this schema is built from).
//
// bastions.last_turn_in_game_day and bastion_facilities carry no turn/order/
// event tables yet -- bastion_turns/bastion_orders are Phase 4 sub-phase 3,
// once order issuance itself is being built. last_turn_in_game_day and
// consecutive_turns_without_orders are on THIS table now (not deferred)
// since they're intrinsic Bastion state, not turn-history rows.
//
// bastions_enabled is a DM opt-in, per the source's own framing ("it's up
// to the DM to decide whether Bastions are available in a campaign") --
// same simple-boolean-toggle convention as campaigns.allow_ability_reroll
// (1784269760666_add-campaign-ability-reroll-setting.ts), not a JSONB
// settings blob.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaigns ADD COLUMN bastions_enabled BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE bastions (
      id                                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id                       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      owner_character_id                UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      name                              TEXT,
      -- Combining Bastions is symmetric (a set), not hierarchical -- a
      -- shared nullable group id rather than a self-referencing parent/child
      -- FK, so no single Bastion in a combined set "owns" the others. NULL
      -- = not combined with anything.
      combined_group_id                 UUID,
      bastion_points                    INT NOT NULL DEFAULT 0 CHECK (bastion_points >= 0),
      bastion_defenders                 INT NOT NULL DEFAULT 0 CHECK (bastion_defenders >= 0),
      status                            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fallen', 'abandoned')),
      -- DM-adjustable cadence (source: "the DM can alter the frequency of
      -- Bastion turns") -- modeled per-Bastion, not campaign-wide, so
      -- different PCs' Bastions can run on different cadences if the DM
      -- wants; a campaign-wide cadence can still be simulated by setting
      -- every Bastion's value identically, but the reverse isn't possible
      -- if this were a campaigns column instead.
      turn_interval_days                INT NOT NULL DEFAULT 7 CHECK (turn_interval_days > 0),
      -- Anchors to campaign_events.in_game_day's day-count convention
      -- (1784269811666_create-campaign-events.ts's own migration comment
      -- commits to this) -- an INT day count, NOT a TIMESTAMPTZ. NULL until
      -- this Bastion's first turn has ever resolved.
      last_turn_in_game_day             INT,
      -- Drives "Fall of a Bastion" (docs/rules/bastions.md §7). What
      -- exactly increments this is this app's own interpretive choice
      -- (recommended reading (a) in that doc): auto-Maintain-on-absence
      -- resets it to 0 (the Bastion is still "acting"); it only climbs when
      -- a Bastion turn goes by with no turn resolved for it at all
      -- (character dead/unreachable, nobody tracking it). Enforced in the
      -- service layer once bastion_turns exists (sub-phase 3), not here.
      consecutive_turns_without_orders  INT NOT NULL DEFAULT 0 CHECK (consecutive_turns_without_orders >= 0),
      created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON bastions (campaign_id);
    CREATE INDEX ON bastions (owner_character_id);
    -- At most one ACTIVE Bastion per character -- but a character can
    -- accumulate multiple 'fallen'/'abandoned' historical rows over a
    -- campaign's lifetime (docs/rules/bastions.md §7: a post-fall Bastion
    -- is a genuinely NEW row, the old one preserved as history), so this
    -- can't be a plain UNIQUE(owner_character_id) -- a partial index scoped
    -- to status = 'active' is the correct constraint shape.
    CREATE UNIQUE INDEX ON bastions (owner_character_id) WHERE status = 'active';

    CREATE TABLE bastion_facilities ( -- instance rows, both basic and special
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bastion_id     UUID NOT NULL REFERENCES bastions(id) ON DELETE CASCADE,
      catalog_id     UUID NOT NULL REFERENCES bastion_facility_catalog(id),
      -- May exceed the catalog's default_space if the player paid to
      -- enlarge it (basic facilities: player's choice at construction, no
      -- catalog default to compare against at all).
      space          TEXT NOT NULL CHECK (space IN ('cramped', 'roomy', 'vast')),
      -- Bastion Events (Attack/Lost Hirelings/Criminal Hireling, sub-phase
      -- 4) can force this to 'shut_down' for exactly one turn.
      status         TEXT NOT NULL DEFAULT 'operational' CHECK (status IN ('operational', 'shut_down')),
      -- Facility-specific player-selected state: Garden's chosen type,
      -- Pub's currently-tapped Pub Special, Training Area's chosen Expert
      -- Trainer, etc. -- genuinely per-facility variable, same JSONB
      -- reasoning as bastion_facility_catalog.benefits.
      config         JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON bastion_facilities (bastion_id);
    -- "Each special facility can normally be chosen only once per Bastion,
    -- but basic facilities explicitly allow duplicates" is a rule that
    -- depends on bastion_facility_catalog.facility_type -- a value on a
    -- DIFFERENT table than the one being constrained, which a CHECK/UNIQUE
    -- constraint can't express without a trigger. Enforced in the service
    -- layer at facility-add time instead (matches this project's existing
    -- precedent of validating cross-table business rules in services/, not
    -- via triggers -- e.g. the one-order-per-facility-per-turn rule
    -- documented for sub-phase 3 is likewise service-enforced, not a
    -- schema constraint).
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS bastion_facilities;
    DROP TABLE IF EXISTS bastions;
    ALTER TABLE campaigns DROP COLUMN bastions_enabled;
  `);
}
