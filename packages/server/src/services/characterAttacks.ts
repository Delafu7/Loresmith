// character_attacks: a character's structured, selectable attack list
// (REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.1) — a real
// table, not JSONB (unlike monsters' catalog actions), since a PC's attack
// list mutates often in play and each row needs a stable id for the
// apply-damage endpoint (services/characters.ts) to reference. Same
// ownership rule as character_items/character_spells — DM or the owning
// player only for mutations, any campaign member for reads.

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireMembership } from './authz.js';
import { authorizeCharacterMutation, fetchCharacterOrThrow } from './characters.js';
import type { CreateCharacterAttackInput, UpdateCharacterAttackInput } from '../schemas/characterAttacks.js';

export async function listCharacterAttacks(pool: Pool, actorId: string, characterId: string) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await requireMembership(pool, character.campaign_id, actorId);
  const result = await pool.query(
    `SELECT * FROM character_attacks WHERE character_id = $1 ORDER BY sort_order ASC, id ASC`,
    [characterId],
  );
  return result.rows;
}

export async function addCharacterAttack(pool: Pool, actorId: string, characterId: string, input: CreateCharacterAttackInput) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(
    `INSERT INTO character_attacks
       (character_id, name, attack_bonus, damage_dice, damage_type, save_dc, save_ability_index, half_on_save, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      characterId, input.name, input.attackBonus ?? null, input.damageDice ?? null, input.damageType ?? null,
      input.saveDc ?? null, input.saveAbilityIndex ?? null, input.halfOnSave, input.notes ?? null, input.sortOrder,
    ],
  );
  return result.rows[0];
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  attackBonus: 'attack_bonus',
  damageDice: 'damage_dice',
  damageType: 'damage_type',
  saveDc: 'save_dc',
  saveAbilityIndex: 'save_ability_index',
  halfOnSave: 'half_on_save',
  notes: 'notes',
  sortOrder: 'sort_order',
};

export async function updateCharacterAttack(
  pool: Pool,
  actorId: string,
  characterId: string,
  attackId: string,
  input: UpdateCharacterAttackInput,
) {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = UPDATABLE_COLUMNS[key];
    if (!column) continue;
    sets.push(`${column} = $${i++}`);
    values.push(value);
  }
  if (sets.length === 0) {
    const existing = await pool.query(`SELECT * FROM character_attacks WHERE id = $1 AND character_id = $2`, [attackId, characterId]);
    const row = existing.rows[0];
    if (!row) throw notFound('Character attack');
    return row;
  }

  values.push(attackId, characterId);
  const result = await pool.query(
    `UPDATE character_attacks SET ${sets.join(', ')} WHERE id = $${i++} AND character_id = $${i} RETURNING *`,
    values,
  );
  const row = result.rows[0];
  if (!row) throw notFound('Character attack');
  return row;
}

export async function removeCharacterAttack(pool: Pool, actorId: string, characterId: string, attackId: string): Promise<void> {
  const character = await fetchCharacterOrThrow(pool, characterId);
  await authorizeCharacterMutation(pool, actorId, character);

  const result = await pool.query(`DELETE FROM character_attacks WHERE id = $1 AND character_id = $2`, [attackId, characterId]);
  if (result.rowCount === 0) throw notFound('Character attack');
}
