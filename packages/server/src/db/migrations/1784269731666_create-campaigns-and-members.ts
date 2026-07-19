import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE campaigns (
      id          BIGSERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      dm_user_id  BIGINT NOT NULL REFERENCES users(id),
      srd_edition TEXT NOT NULL REFERENCES srd_editions(code),
      description TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at TIMESTAMPTZ
    );
    CREATE INDEX ON campaigns (dm_user_id);

    CREATE TABLE campaign_members (
      id          BIGSERIAL PRIMARY KEY,
      campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      user_id     BIGINT NOT NULL REFERENCES users(id),
      role        TEXT NOT NULL CHECK (role IN ('dm','player')),
      joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (campaign_id, user_id)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS campaign_members;
    DROP TABLE IF EXISTS campaigns;
  `);
}
