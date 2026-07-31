import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// My Profile (nav point 6) — account/preferences consolidation.
// `avatar_url` is a plain URL, not a campaign_assets FK: unlike a character
// portrait (always scoped to one campaign's asset list), a user's avatar
// follows them across every campaign, so there's no single campaign_assets
// row it could belong to. Uploads are served the same way (local disk under
// uploads/, see middleware/upload.ts's new avatarUpload config) — just
// stored under uploads/users/{userId}/ instead of uploads/campaigns/{id}/.
//
// `text_size` is the one accessibility preference actually being built this
// pass (a scalable "larger text" toggle, applied via a root font-size
// override in index.css so every existing rem-based Tailwind text-* class
// scales with zero component changes). No `email_notifications`-style
// toggle is added: this app has no email-sending capability at all today
// (grepped — no nodemailer/SMTP anywhere), so a checkbox for it would
// control nothing real.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN avatar_url TEXT,
      ADD COLUMN text_size TEXT NOT NULL DEFAULT 'normal' CHECK (text_size IN ('normal', 'large'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE users
      DROP COLUMN avatar_url,
      DROP COLUMN text_size;
  `);
}
