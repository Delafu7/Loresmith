import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE character_classes (
      character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      class_id     BIGINT NOT NULL REFERENCES classes(id),
      subclass_id  BIGINT REFERENCES subclasses(id),
      level        INT NOT NULL CHECK (level BETWEEN 1 AND 20),
      PRIMARY KEY (character_id, class_id)
    );

    CREATE TABLE character_skill_proficiencies (
      character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      skill_id     BIGINT NOT NULL REFERENCES skills(id),
      level        TEXT NOT NULL CHECK (level IN ('proficient','expertise')),
      PRIMARY KEY (character_id, skill_id)
    );

    CREATE TABLE character_saving_throw_proficiencies (
      character_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id),
      PRIMARY KEY (character_id, ability_score_id)
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS character_saving_throw_proficiencies;
    DROP TABLE IF EXISTS character_skill_proficiencies;
    DROP TABLE IF EXISTS character_classes;
  `);
}
