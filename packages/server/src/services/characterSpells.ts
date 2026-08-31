// character_spells: the known/prepared join (PLAN.md §3.1) — one row per
// (character, spell, granting class). Same ownership rule as every other
// character-mutation endpoint: DM or the owning player only (see
// authorizeCharacterMutation in services/characters.ts); any campaign member
// may read (matches getClasses/getSkillProficiencies's precedent).

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow, requireCharacterReadAccess } from './characters.js';
import { isUniqueViolation } from './dbErrors.js';
import type { CreateCharacterSpellInput, UpdateCharacterSpellInput } from '../schemas/characterSpells.js';

// Small local pure helper rather than importing services/armorClass.ts's
// copy — same "self-contained per service file" precedent that file's own
// comment cites for services/encounters.ts's dexModifier.
function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export async function listCharacterSpells(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireCharacterReadAccess(pool, actorId, character);
  const result = await pool.query(
    `SELECT * FROM character_spells WHERE character_id = $1 ORDER BY spell_id ASC`,
    [characterId],
  );
  return result.rows;
}

export async function learnCharacterSpell(
  pool: Pool,
  actorId: string,
  characterId: string,
  input: CreateCharacterSpellInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  if (input.isPrepared) {
    const spellRes = await pool.query<{ level: number }>(`SELECT level FROM spells WHERE id = $1`, [input.spellId]);
    const spellLevel = spellRes.rows[0]?.level;
    if (spellLevel === undefined) throw notFound('Spell');
    await assertWithinPreparedSpellCap(pool, characterId, input.classId ?? null, spellLevel, input.alwaysPrepared);
  }

  try {
    const result = await pool.query(
      `INSERT INTO character_spells (character_id, spell_id, class_id, is_prepared, always_prepared, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [characterId, input.spellId, input.classId ?? null, input.isPrepared, input.alwaysPrepared, input.source],
    );
    return result.rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('CONFLICT', 'This character already has that spell recorded for that class');
    }
    throw err;
  }
}

interface CharacterSpellRow {
  id: string;
  class_id: string | null;
  always_prepared: boolean;
  spell_level: number;
}

// Resolves a (characterId, spellId[, classId]) tuple to exactly one
// character_spells row, throwing a clear VALIDATION_ERROR (rather than
// silently picking one, or worse, updating/deleting more than one row) if a
// multiclass caster has the same spell available via more than one granting
// class and the caller didn't disambiguate with classId. Joins spells for
// `spell_level` (cantrips are exempt from the P1-7 prepared-spell cap below)
// even though unlearnCharacterSpell doesn't need it — one shared resolver
// beats a second near-identical query.
async function findOneCharacterSpellRow(
  pool: Pool,
  characterId: string,
  spellId: string,
  classId: string | undefined,
): Promise<CharacterSpellRow> {
  const params: unknown[] = [characterId, spellId];
  let query = `
    SELECT cs.id, cs.class_id, cs.always_prepared, s.level AS spell_level
    FROM character_spells cs JOIN spells s ON s.id = cs.spell_id
    WHERE cs.character_id = $1 AND cs.spell_id = $2`;
  if (classId !== undefined) {
    query += ` AND cs.class_id = $3`;
    params.push(classId);
  }
  const result = await pool.query<CharacterSpellRow>(query, params);
  if (result.rows.length === 0) throw notFound('Character spell');
  if (result.rows.length > 1) {
    throw new AppError(
      'VALIDATION_ERROR',
      'This spell is known via more than one class on this character; pass ?classId= to disambiguate',
      { candidateClassIds: result.rows.map((r) => r.class_id) },
    );
  }
  return result.rows[0]!;
}

// P1-7 (SP-03) — the 2024 PHB unified every spellcasting class onto one
// "prepare a list of level 1+ spells" mechanic: each class's own
// Spellcasting feature states the cap as that class's level + its
// spellcasting ability modifier (minimum of one spell). See
// .claude/skills/dnd-2024-rules/references/spellcasting.md's "Spell
// Preparation by Class" table (Bard/Cleric/Druid/Paladin/Ranger/Sorcerer/
// Warlock/Wizard all prepare; they differ only in swap timing/quantity,
// which this phase deliberately doesn't enforce — see docs/roadmap/
// progress.md's P1-7 entry for the scope note). Cantrips (spell level 0)
// and always-prepared spells (granted free by another feature, the
// "Always-Prepared Spells" rule) never count against this cap.
//
// `excludeCharacterSpellId` lets a re-toggle of an already-prepared row
// exclude itself from its own count instead of double-counting.
async function assertWithinPreparedSpellCap(
  pool: Pool,
  characterId: string,
  classId: string | null,
  spellLevel: number,
  alwaysPrepared: boolean,
  excludeCharacterSpellId?: string,
): Promise<void> {
  if (alwaysPrepared || spellLevel === 0 || classId === null) return;

  const classRes = await pool.query<{ level: number; ability_index: string | null; class_name: string }>(
    `SELECT cc.level, a.index_key AS ability_index, c.name AS class_name
     FROM character_classes cc
     JOIN classes c ON c.id = cc.class_id
     LEFT JOIN ability_scores a ON a.id = c.spellcasting_ability_id
     WHERE cc.character_id = $1 AND cc.class_id = $2`,
    [characterId, classId],
  );
  const cls = classRes.rows[0];
  // No character_classes row for this class (a spell recorded against a
  // class the character no longer has), or the class has no
  // spellcasting_ability_id (a non-caster class, or a homebrew class that
  // hasn't set one) — nothing to validate against. Same "can't reason about
  // it, don't block" precedent as services/casting.ts's participant-less
  // no-op branch.
  if (!cls || !cls.ability_index) return;

  const abilityRes = await pool.query<Record<string, number>>(
    `SELECT str, dex, con, int, wis, cha FROM characters WHERE id = $1`,
    [characterId],
  );
  const score = abilityRes.rows[0]?.[cls.ability_index] ?? 10;
  const cap = Math.max(1, cls.level + abilityModifier(score));

  const countParams: unknown[] = [characterId, classId];
  let countQuery = `
    SELECT COUNT(*)::int AS count
    FROM character_spells cs JOIN spells s ON s.id = cs.spell_id
    WHERE cs.character_id = $1 AND cs.class_id = $2 AND cs.is_prepared = true
      AND cs.always_prepared = false AND s.level >= 1`;
  if (excludeCharacterSpellId) {
    countQuery += ` AND cs.id != $3`;
    countParams.push(excludeCharacterSpellId);
  }
  const countRes = await pool.query<{ count: number }>(countQuery, countParams);
  const currentCount = countRes.rows[0]?.count ?? 0;

  if (currentCount + 1 > cap) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Preparing this spell would exceed ${cls.class_name}'s prepared-spell cap of ${cap} ` +
        `(class level ${cls.level} + spellcasting ability modifier, minimum 1)`,
      { cap, current: currentCount, classId },
    );
  }
}

export async function toggleCharacterSpellPrepared(
  pool: Pool,
  actorId: string,
  characterId: string,
  spellId: string,
  classId: string | undefined,
  input: UpdateCharacterSpellInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const row = await findOneCharacterSpellRow(pool, characterId, spellId, classId);

  if (input.isPrepared) {
    await assertWithinPreparedSpellCap(pool, characterId, row.class_id, row.spell_level, row.always_prepared, row.id);
  }

  const result = await pool.query(
    `UPDATE character_spells SET is_prepared = $1 WHERE id = $2 RETURNING *`,
    [input.isPrepared, row.id],
  );
  return result.rows[0];
}

export async function unlearnCharacterSpell(
  pool: Pool,
  actorId: string,
  characterId: string,
  spellId: string,
  classId: string | undefined,
): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const row = await findOneCharacterSpellRow(pool, characterId, spellId, classId);
  await pool.query(`DELETE FROM character_spells WHERE id = $1`, [row.id]);
}
