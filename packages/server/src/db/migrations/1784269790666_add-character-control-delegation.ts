import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Iteration 2 "Character ownership vs. control" — separates stable
// OWNERSHIP (characters.owner_user_id, unchanged) from live CONTROL: who is
// actually driving a character right now. NULL means "defer to the owner"
// (the 99% case — no behavior change for any existing row), non-NULL means
// "this user currently drives it regardless of ownership" (the DM took over
// an absent player's PC, or handed an NPC companion to a player for a
// scene). Logged via character_control_delegations, mirroring
// encounter_disposition_events' exact shape (1784269787666): read the
// current value from a locked row rather than trusting a caller-supplied
// "from," reject nothing here (no-op delegation isn't harmful the way a
// no-op disposition transition is, so unlike that table this one doesn't
// need a rejection rule — services/characterControl.ts still skips logging
// a true no-op to keep history meaningful).
//
// gm_notes is a new DM-only field on characters — the only concrete
// "GM-only field" this iteration ships (a generic per-field redaction
// system is explicitly out of scope, see the plan).
//
// campaign_invitations.character_id makes the existing pending-invite flow
// (1784269778666) double as "invite this specific person to claim this
// pre-built character" — nullable, so every existing invitation row and
// every existing caller of createInvitation is unaffected.
//
// campaign_members.role gains a third value, 'spectator' — strictly
// read-only. Existing rows are untouched (only 'dm'/'player' exist today).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE characters ADD COLUMN controller_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE characters ADD COLUMN gm_notes TEXT;

    CREATE TABLE character_control_delegations (
      id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      character_id            UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      from_controller_user_id UUID REFERENCES users(id),
      to_controller_user_id   UUID REFERENCES users(id),
      granted_by_user_id      UUID NOT NULL REFERENCES users(id),
      reason                  TEXT,
      encounter_id            UUID REFERENCES encounters(id) ON DELETE SET NULL,
      expires_at              TIMESTAMPTZ,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON character_control_delegations (character_id, created_at);

    ALTER TABLE campaign_invitations ADD COLUMN character_id UUID REFERENCES characters(id) ON DELETE SET NULL;

    ALTER TABLE campaign_members DROP CONSTRAINT campaign_members_role_check;
    ALTER TABLE campaign_members ADD CONSTRAINT campaign_members_role_check CHECK (role IN ('dm','player','spectator'));

    -- campaign_invitations has its OWN separate role CHECK (not reused from
    -- campaign_members) — an invitation must be able to offer 'spectator'
    -- too, same reasoning as the campaign_members change just above.
    ALTER TABLE campaign_invitations DROP CONSTRAINT campaign_invitations_role_check;
    ALTER TABLE campaign_invitations ADD CONSTRAINT campaign_invitations_role_check CHECK (role IN ('dm','player','spectator'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE campaign_invitations DROP CONSTRAINT campaign_invitations_role_check;
    ALTER TABLE campaign_invitations ADD CONSTRAINT campaign_invitations_role_check CHECK (role IN ('dm','player'));

    ALTER TABLE campaign_members DROP CONSTRAINT campaign_members_role_check;
    ALTER TABLE campaign_members ADD CONSTRAINT campaign_members_role_check CHECK (role IN ('dm','player'));

    ALTER TABLE campaign_invitations DROP COLUMN character_id;

    DROP TABLE IF EXISTS character_control_delegations;
    ALTER TABLE characters DROP COLUMN gm_notes;
    ALTER TABLE characters DROP COLUMN controller_user_id;
  `);
}
