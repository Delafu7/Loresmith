// Read-only reference/catalog data (PLAN.md §3.1: "catalog data is shared
// across all campaigns and rarely mutated"). Almost entirely no write
// endpoints — seeded by migration/seed tooling, never the app API — with one
// deliberate exception: monsters, which as of Phase 3.2 (PLAN.md §3.5/§4.4)
// supports DM-authored homebrew rows scoped to their own campaign. That
// write path (createHomebrewMonster/updateHomebrewMonster/
// deleteHomebrewMonster) lives in services/monsterCatalog.ts, not here — this
// file stays read-only; only listMonsters below grows a campaignId filter to
// surface those homebrew rows alongside the global catalog.

import type { Pool } from 'pg';
import type { EditionQuery, MonsterQuery, SpellQuery, ItemQuery, EffectDefinitionQuery } from '../schemas/catalog.js';

// `edition=2014|2024` means "rows for that edition OR edition-agnostic
// ('both') rows"; `edition=both` or omitted means "everything, no filter" —
// this mirrors how a client picks a campaign's srd_edition and still wants
// edition-agnostic entries alongside it.
function editionFilter(column: string, edition: EditionQuery['edition'], values: unknown[]): string {
  if (edition === '2014' || edition === '2024') {
    values.push(edition);
    return `WHERE ${column} IN ($${values.length}, 'both')`;
  }
  return '';
}

export async function listAbilityScores(pool: Pool) {
  const result = await pool.query(`SELECT * FROM ability_scores ORDER BY id ASC`);
  return result.rows;
}

export async function listSkills(pool: Pool) {
  const result = await pool.query(`SELECT * FROM skills ORDER BY id ASC`);
  return result.rows;
}

export async function listLanguages(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('edition_scope', query.edition, values);
  const result = await pool.query(`SELECT * FROM languages ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listAlignments(pool: Pool) {
  const result = await pool.query(`SELECT * FROM alignments ORDER BY id ASC`);
  return result.rows;
}

// Edition-invariant lookup (Phase 3.6): items.damage_type_id and monster
// action entries both reference this by id, but nothing served it to the
// frontend before now — display code had no way to turn a damage_type_id
// into "slashing"/"fire" etc.
export async function listDamageTypes(pool: Pool) {
  const result = await pool.query(`SELECT * FROM damage_types ORDER BY id ASC`);
  return result.rows;
}

export async function listRaces(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('edition_scope', query.edition, values);
  const result = await pool.query(`SELECT * FROM races ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listSubraces(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('r.edition_scope', query.edition, values);
  const result = await pool.query(
    `SELECT s.* FROM subraces s JOIN races r ON r.id = s.race_id ${where} ORDER BY s.name ASC`,
    values,
  );
  return result.rows;
}

export async function listClasses(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('edition_scope', query.edition, values);
  const result = await pool.query(`SELECT * FROM classes ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listSubclasses(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('c.edition_scope', query.edition, values);
  const result = await pool.query(
    `SELECT s.* FROM subclasses s JOIN classes c ON c.id = s.class_id ${where} ORDER BY s.name ASC`,
    values,
  );
  return result.rows;
}

export async function listClassLevels(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('c.edition_scope', query.edition, values);
  const result = await pool.query(
    `SELECT cl.* FROM class_levels cl JOIN classes c ON c.id = cl.class_id ${where}
     ORDER BY cl.class_id ASC, cl.level ASC`,
    values,
  );
  return result.rows;
}

export async function listClassFeatures(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('c.edition_scope', query.edition, values);
  const result = await pool.query(
    `SELECT cf.* FROM class_features cf JOIN classes c ON c.id = cf.class_id ${where}
     ORDER BY cf.class_id ASC, cf.level ASC`,
    values,
  );
  return result.rows;
}

export async function listBackgrounds(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('edition_scope', query.edition, values);
  const result = await pool.query(`SELECT * FROM backgrounds ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listFeats(pool: Pool, query: EditionQuery) {
  const values: unknown[] = [];
  const where = editionFilter('edition_scope', query.edition, values);
  const result = await pool.query(`SELECT * FROM feats ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listMonsters(pool: Pool, query: MonsterQuery) {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (query.edition === '2014' || query.edition === '2024') {
    values.push(query.edition);
    clauses.push(`edition_scope IN ($${values.length}, 'both')`);
  }
  if (query.creatureType) {
    values.push(query.creatureType);
    clauses.push(`creature_type = $${values.length}`);
  }
  if (query.crMin !== undefined) {
    values.push(query.crMin);
    clauses.push(`challenge_rating >= $${values.length}`);
  }
  if (query.crMax !== undefined) {
    values.push(query.crMax);
    clauses.push(`challenge_rating <= $${values.length}`);
  }

  // Global (owning_campaign_id IS NULL) monsters are always included; a
  // campaign's own homebrew rows are unioned in ONLY when campaignId is
  // supplied — same additive-only pattern as listEffectDefinitions below.
  // With no campaignId this clause is exactly `owning_campaign_id IS NULL`,
  // so the no-campaignId case is unchanged from before homebrew existed —
  // it must never leak a stray homebrew row.
  if (query.campaignId !== undefined) {
    values.push(query.campaignId);
    clauses.push(`(owning_campaign_id IS NULL OR owning_campaign_id = $${values.length})`);
  } else {
    clauses.push(`owning_campaign_id IS NULL`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM monsters ${where} ORDER BY challenge_rating ASC, name ASC`, values);
  return result.rows;
}

// ---- Added for Phase 2 UI: spells/items/effect-definitions browse ----
// (PLAN.md §4.1 lists these as part of the catalog family; no route/service
// existed for them yet — see routes/catalog.ts for the mounted GETs.)

export async function listSpells(pool: Pool, query: SpellQuery) {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (query.edition === '2014' || query.edition === '2024') {
    values.push(query.edition);
    clauses.push(`s.edition_scope IN ($${values.length}, 'both')`);
  }
  if (query.classId !== undefined) {
    values.push(query.classId);
    clauses.push(`EXISTS (SELECT 1 FROM spell_classes sc WHERE sc.spell_id = s.id AND sc.class_id = $${values.length})`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT s.* FROM spells s ${where} ORDER BY s.level ASC, s.name ASC`,
    values,
  );
  return result.rows;
}

export async function listItems(pool: Pool, query: ItemQuery) {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (query.edition === '2014' || query.edition === '2024') {
    values.push(query.edition);
    clauses.push(`edition_scope IN ($${values.length}, 'both')`);
  }
  if (query.itemType) {
    values.push(query.itemType);
    clauses.push(`item_type = $${values.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM items ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listEffectDefinitions(pool: Pool, query: EffectDefinitionQuery) {
  const values: unknown[] = [];
  // Global (owning_campaign_id IS NULL) rows are always included; a
  // campaign's own homebrew rows are included only when campaignId is given.
  let where = `WHERE owning_campaign_id IS NULL`;
  if (query.campaignId !== undefined) {
    values.push(query.campaignId);
    where = `WHERE owning_campaign_id IS NULL OR owning_campaign_id = $${values.length}`;
  }
  const result = await pool.query(`SELECT * FROM effect_definitions ${where} ORDER BY name ASC`, values);
  return result.rows;
}
