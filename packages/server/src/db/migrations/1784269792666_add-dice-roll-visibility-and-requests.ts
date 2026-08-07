import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 3 dice-engine rebuild, §2.3/2.4 of the brief — net-new capability
// (roll visibility tiers, GM roll requests, manual physical-dice entry,
// void-not-delete), not a bug fix. Scoped narrowly to `dice_rolls`
// specifically, NOT a revival of the general-purpose "hide info from
// players" engine 1784269769666 deliberately removed app-wide (that
// migration's own comment: "the feature is gone, not archived," covering
// combat_participants/active_effects/campaign_assets/notes/dice_rolls'
// visible_to_players columns and the character-scoped half of
// entity_field_reveals). This is a considered exception for dice rolls
// specifically, confirmed with the person who owns this codebase before
// implementing, not a silent reversal of that decision — a roll can
// legitimately be a DM's secret check or a player's private insight roll
// in a way none of the removed fields' use cases were.
//
// visibility default 'public' means every EXISTING row (and every roll made
// by existing callers that don't yet know about this field) is unaffected.
// Only the DM may create a non-'public' roll (services/diceRolls.ts) —
// "conditions/secrets are a DM tool" is this app's existing convention
// (see encounters/ActionEconomyPanel.tsx's own comment on Dodge).
//
// dice_roll_requests / dice_roll_request_targets: a GM-initiated "please
// roll X" ask, fanned out to one/several/every targeted player. A target
// row tracks whether that player has rolled (and which dice_rolls row
// fulfilled it) or explicitly passed — never silently disappears, matching
// this app's "don't fabricate implicit state" convention.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE dice_rolls ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
      CHECK (visibility IN ('public', 'gm_only', 'private'));
    ALTER TABLE dice_rolls ADD COLUMN visible_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE dice_rolls ADD CONSTRAINT dice_rolls_visibility_target_check CHECK (
      (visibility = 'private' AND visible_to_user_id IS NOT NULL) OR
      (visibility != 'private' AND visible_to_user_id IS NULL)
    );

    -- Manual entry (2.3/2.4 "physical dice matter equally") — the roll still
    -- goes through the exact same insert/modifier/history path as a
    -- server-rolled one; only the source of d20_rolls/dice differs. Never a
    -- second, parallel data shape.
    ALTER TABLE dice_rolls ADD COLUMN is_manual BOOLEAN NOT NULL DEFAULT false;

    -- Void, not delete — "one action = one roll record" per the brief.
    ALTER TABLE dice_rolls ADD COLUMN voided_at TIMESTAMPTZ;
    ALTER TABLE dice_rolls ADD COLUMN voided_by_user_id UUID REFERENCES users(id);

    CREATE TABLE dice_roll_requests (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id          UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      encounter_id         UUID REFERENCES encounters(id) ON DELETE SET NULL,
      requested_by_user_id UUID NOT NULL REFERENCES users(id),
      roll_type            TEXT NOT NULL,
      roll_context         TEXT,
      dc                   INT,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON dice_roll_requests (campaign_id, created_at);

    CREATE TABLE dice_roll_request_targets (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id    UUID NOT NULL REFERENCES dice_roll_requests(id) ON DELETE CASCADE,
      user_id       UUID NOT NULL REFERENCES users(id),
      character_id  UUID REFERENCES characters(id) ON DELETE SET NULL,
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rolled', 'passed')),
      dice_roll_id  UUID REFERENCES dice_rolls(id) ON DELETE SET NULL,
      responded_at  TIMESTAMPTZ
    );
    CREATE INDEX ON dice_roll_request_targets (request_id);
    CREATE UNIQUE INDEX ON dice_roll_request_targets (request_id, user_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS dice_roll_request_targets;
    DROP TABLE IF EXISTS dice_roll_requests;

    ALTER TABLE dice_rolls DROP COLUMN voided_by_user_id;
    ALTER TABLE dice_rolls DROP COLUMN voided_at;
    ALTER TABLE dice_rolls DROP COLUMN is_manual;
    ALTER TABLE dice_rolls DROP CONSTRAINT dice_rolls_visibility_target_check;
    ALTER TABLE dice_rolls DROP COLUMN visible_to_user_id;
    ALTER TABLE dice_rolls DROP COLUMN visibility;
  `);
}
