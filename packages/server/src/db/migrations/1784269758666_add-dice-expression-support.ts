import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

// Extends the Phase 3.4 d20-only roller to arbitrary dice (quick d4/d6/d8/
// d10/d12/d20/d100 buttons, and NdM+K expressions like "2d6+3"). Additive
// only: existing d20 ability/save/skill/attack/initiative rolls are
// untouched — `dice_sides`/`dice_count` default to 20/1, which is exactly
// what every pre-existing row already was, and `d20_rolls` keeps holding
// "every die actually rolled" regardless of die size (the array name is a
// historical artifact from when only d20s existed; renaming the column
// would touch ~10 files purely cosmetically for no behavioral gain, so it's
// left as-is and just documented here). `keep` (advantage/disadvantage)
// stays meaningful only for d20 rolls — the new 'damage' roll_type and any
// non-d20 dice_sides always use keep='normal', enforced service-side rather
// than by a cross-column CHECK (same "app-layer, not declarative"
// precedent used throughout this codebase).
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE dice_rolls ADD COLUMN dice_sides INT NOT NULL DEFAULT 20 CHECK (dice_sides IN (4,6,8,10,12,20,100));
    ALTER TABLE dice_rolls ADD COLUMN dice_count INT NOT NULL DEFAULT 1 CHECK (dice_count BETWEEN 1 AND 20);
    ALTER TABLE dice_rolls DROP CONSTRAINT dice_rolls_roll_type_check;
    ALTER TABLE dice_rolls ADD CONSTRAINT dice_rolls_roll_type_check CHECK (roll_type IN
      ('ability_check','saving_throw','skill_check','attack','initiative','death_save','custom','damage'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE dice_rolls DROP CONSTRAINT dice_rolls_roll_type_check;
    ALTER TABLE dice_rolls ADD CONSTRAINT dice_rolls_roll_type_check CHECK (roll_type IN
      ('ability_check','saving_throw','skill_check','attack','initiative','death_save','custom'));
    ALTER TABLE dice_rolls DROP COLUMN dice_sides;
    ALTER TABLE dice_rolls DROP COLUMN dice_count;
  `);
}
