import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 4 "DM approval before a player-submitted action resolves" —
// campaign-instance data (scoped to one encounter), not catalog. A row here
// captures exactly the input a player's attack/cast/shove/grapple would have
// resolved with; `payload` is a discriminated-by-`kind` JSONB blob rather
// than a wide sparse table, since each kind's resolution input already has
// its own zod-validated shape (ApplyDamageInput, CastFromEncounterInput,
// PerformShoveInput, PerformGrappleInput) that this just stores verbatim —
// approving a request re-validates nothing, it replays the exact same
// resolver function the DM's own unconditional path already uses.
//
// actor_participant_id is ON DELETE CASCADE (removing the participant makes
// any of their pending requests meaningless, same as combat_actions' actor
// columns). target_participant_ids is a plain UUID[] with no FK enforcement
// (Postgres can't FK into an array column) — same precedent as
// characters.languages_new from the uuid-primary-keys migration.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE pending_action_requests (
      id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id           UUID NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
      campaign_id            UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      requested_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_participant_id   UUID NOT NULL REFERENCES combat_participants(id) ON DELETE CASCADE,
      target_participant_ids UUID[] NOT NULL DEFAULT '{}',
      kind                   TEXT NOT NULL CHECK (kind IN ('attack_character','attack_monster','cast','shove','grapple')),
      label                  TEXT NOT NULL,
      payload                JSONB NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      resolved_by_user_id    UUID REFERENCES users(id),
      resolved_at            TIMESTAMPTZ,
      result                 JSONB,
      error                  TEXT,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX ON pending_action_requests (encounter_id, status);
    CREATE INDEX ON pending_action_requests (requested_by_user_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS pending_action_requests;`);
}
