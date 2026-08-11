import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 4 "Bastion tracking" sub-phase 3 — turn resolution (orders + Bastion
// Points). See docs/rules/bastions.md §3-4 for the rules writeup and
// 1784269813666_create-bastions.ts for the campaign-instance tables this
// builds on.
//
// bastion_turns is the audit trail: one row per resolved Bastion turn,
// whether that turn was Maintain or a batch of per-facility special orders
// (mutually exclusive per turn, per §4). event_roll/event_key/event_outcome
// exist now (matching the doc's full schema) but are NOT populated by this
// sub-phase's service logic yet -- Bastion Events (the d20 random-events
// table triggered by Maintain) are Phase 4 sub-phase 4's scope. A Maintain
// turn resolved by THIS sub-phase's code only awards the flat 1d4-per-
// facility BP; the event columns stay NULL until sub-phase 4 wires up the
// event roll on top of the same row shape.
//
// bastion_orders excludes 'maintain' from order_type for the same reason
// bastion_facility_catalog.order_type does (see that migration's comment):
// Maintain is whole-Bastion, tracked via bastion_turns.was_maintain, never
// a per-facility order row.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE bastion_turns (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bastion_id     UUID NOT NULL REFERENCES bastions(id) ON DELETE CASCADE,
      turn_number    INT NOT NULL,
      -- Anchors to campaign_events.in_game_day's convention (see that
      -- migration's comment and 1784269813666_create-bastions.ts's own
      -- reiteration of it) -- supplied by the caller at resolution time,
      -- never auto-advanced by a timer (this app has no precedent for
      -- background-job time advancement; campaign_events doesn't either).
      in_game_day    INT NOT NULL,
      was_maintain   BOOLEAN NOT NULL,
      event_roll     INT,     -- d20 result; NOT populated until sub-phase 4
      event_key      TEXT CHECK (event_key IN (
        'nothing', 'attack', 'lost_hirelings', 'refugees', 'friendly_visitors', 'request_for_aid',
        'honored_guest', 'extraordinary_opportunity', 'criminal_hireling', 'magical_discovery'
      )),
      event_outcome  JSONB,   -- variable per event type; NOT populated until sub-phase 4. This sub-phase DOES use
                               -- this column for one thing: a Maintain turn's per-facility 1d4 BP roll breakdown,
                               -- e.g. {"maintainBp": [{"facilityId": "...", "roll": 3}, ...]} -- genuinely variable,
                               -- unqueried structure, same JSONB precedent as bastion_facility_catalog.benefits.
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bastion_id, turn_number)
    );
    CREATE INDEX ON bastion_turns (bastion_id);

    CREATE TABLE bastion_orders (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bastion_turn_id     UUID NOT NULL REFERENCES bastion_turns(id) ON DELETE CASCADE,
      -- ON DELETE CASCADE (not the doc's own sketch, which left this bare):
      -- a campaign delete cascades campaigns -> bastions -> bastion_facilities
      -- AND, independently, campaigns -> bastions -> bastion_turns ->
      -- bastion_orders in the same statement. Postgres checks each FK
      -- immediately (not deferred), so a bare REFERENCES here can raise a
      -- spurious violation if the bastion_facilities row is removed by its
      -- own cascade path before this row's cascade path catches up -- not a
      -- hypothetical, this is exactly what threw during test cleanup.
      bastion_facility_id UUID NOT NULL REFERENCES bastion_facilities(id) ON DELETE CASCADE,
      order_type          TEXT NOT NULL CHECK (order_type IN ('craft', 'empower', 'harvest', 'recruit', 'research', 'trade')),
      paid_reroll_gp      INT,     -- the optional 25 GP "roll BP die twice, take higher" spend; NULL if not paid
      bp_die_roll         INT NOT NULL,
      bp_awarded          INT NOT NULL,
      result              JSONB,   -- which Craft/Harvest/etc. sub-option was chosen, item produced, etc.
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON bastion_orders (bastion_turn_id);
    -- "One order per facility per Bastion turn" (Meditation Chamber's
    -- Empower-granted bonus order is the one documented exception, §2/§4)
    -- can't be a plain UNIQUE(bastion_turn_id, bastion_facility_id): the
    -- exception means a facility CAN legitimately receive 2 orders on the
    -- same turn if a Meditation Chamber bonus slot covers the second one.
    -- Enforced in the service layer (which tracks bonus-slot consumption
    -- per turn), not the schema -- same "cross-row business rule, not a
    -- constraint" precedent as bastion_facilities' duplicate-catalog-row
    -- rule in the prior migration.
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS bastion_orders;
    DROP TABLE IF EXISTS bastion_turns;
  `);
}
