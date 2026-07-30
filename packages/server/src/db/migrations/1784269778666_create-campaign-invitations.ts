import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Email invitations with pending/accepted state — addMember (services/
// campaigns.ts) grants membership immediately and requires the invitee to
// already have a registered account; this table is the missing "invite
// someone who may not have signed up yet" flow. `invited_email` is stored
// as plain text (not a user_id FK) deliberately: resolution to an actual
// account happens at accept-time (services/campaignInvitations.ts's
// acceptInvitation), not up front, since the account may not exist when the
// invite is created.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaign_invitations (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id        UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      invited_email      TEXT NOT NULL,
      invited_by_user_id UUID NOT NULL REFERENCES users(id),
      role               TEXT NOT NULL CHECK (role IN ('dm', 'player')),
      status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      responded_at       TIMESTAMPTZ
    );
    CREATE INDEX ON campaign_invitations (campaign_id, status);
    CREATE INDEX ON campaign_invitations (invited_email, status);
    -- Only one PENDING invite per (campaign, email) at a time — a prior
    -- revoked/accepted row must never block re-inviting the same address.
    CREATE UNIQUE INDEX campaign_invitations_pending_unique
      ON campaign_invitations (campaign_id, invited_email)
      WHERE status = 'pending';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE campaign_invitations;`);
}
