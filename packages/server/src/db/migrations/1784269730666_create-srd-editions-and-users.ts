import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Phase 1: cross-cutting foundation — the edition lookup table (2014/2024
// SRD) that every edition-scoped catalog table hangs off of, and the users
// table auth sits on top of.

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE srd_editions (
      code TEXT PRIMARY KEY CHECK (code IN ('2014','2024')),
      name TEXT NOT NULL
    );

    CREATE TABLE users (
      id            BIGSERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    INSERT INTO srd_editions (code, name) VALUES
      ('2014', 'SRD 5.1 (2014 rules)'),
      ('2024', 'SRD 5.2 (2024 rules)');
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS srd_editions;
  `);
}
