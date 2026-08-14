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
import type { EditionQuery, MonsterQuery, SpellQuery, ItemQuery, EffectDefinitionQuery, CampaignScopedQuery } from '../schemas/catalog.js';

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

// Global rows are always included; a campaign's own homebrew rows are
// unioned in only when campaignId is supplied — same additive-only pattern
// listMonsters/listEffectDefinitions already established. Additionally, the
// caller's OWN personal-compendium homebrew (owning_user_id = actorUserId)
// is unioned in unconditionally — "my compendium, reusable across every
// campaign I run" should show up whether or not the caller happens to be
// browsing from inside a specific campaign right now, mirroring the
// ownLibraryClause pattern listMonsters established first. With no
// campaignId and no compendium rows of the caller's own, this reduces to
// exactly `campaignColumn IS NULL`, so a user with no homebrew sees
// unchanged results.
function catalogScopeClause(
  campaignColumn: string,
  userColumn: string,
  campaignId: string | undefined,
  actorUserId: string,
  values: unknown[],
): string {
  values.push(actorUserId);
  const ownLibraryClause = `${userColumn} = $${values.length}`;
  if (campaignId === undefined) {
    return `(${campaignColumn} IS NULL AND (${userColumn} IS NULL OR ${ownLibraryClause}))`;
  }
  values.push(campaignId);
  return `(${campaignColumn} IS NULL OR ${campaignColumn} = $${values.length} OR ${ownLibraryClause})`;
}

export async function listAbilityScores(pool: Pool) {
  const result = await pool.query(`SELECT * FROM ability_scores ORDER BY id ASC`);
  return result.rows;
}

export async function listSkills(pool: Pool) {
  const result = await pool.query(`SELECT * FROM skills ORDER BY id ASC`);
  return result.rows;
}

// Phase 2 selector work: magic_schools/conditions were seeded as FK targets
// (spells.school_id, effect_definitions.condition_id) but never got a list
// endpoint, so the UI had no way to turn either id into a name — same gap
// listDamageTypes closed for items.damage_type_id. Neither table has an
// owning_campaign_id column (both are global-only, non-homebrew-forkable),
// so no campaign scoping here, matching listAbilityScores/listSkills above.
export async function listMagicSchools(pool: Pool) {
  const result = await pool.query(`SELECT * FROM magic_schools ORDER BY name ASC`);
  return result.rows;
}

// Phase 2 "weapon mastery (2024)" — same "no campaign scoping" reasoning as
// listAbilityScores/listSkills/listMagicSchools above (a fixed 8-row list,
// not homebrewable).
export async function listWeaponMasteryProperties(pool: Pool) {
  const result = await pool.query(`SELECT * FROM weapon_mastery_properties ORDER BY name ASC`);
  return result.rows;
}

// Phase 4 "Bastion tracking" sub-phase 1 — same "no campaign scoping"
// reasoning as listWeaponMasteryProperties above (fixed catalog, not
// homebrewable). Ordered by (facility_type, min_level, name) so basic
// facilities sort before special ones and special ones sort by their
// level-gate breakpoint, matching how docs/rules/bastions.md itself
// presents the catalog.
export async function listBastionFacilityCatalog(pool: Pool) {
  const result = await pool.query(
    `SELECT * FROM bastion_facility_catalog ORDER BY facility_type ASC, min_level ASC NULLS FIRST, name ASC`,
  );
  return result.rows;
}

export async function listConditions(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM conditions WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listLanguages(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM languages WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listAlignments(pool: Pool, query: CampaignScopedQuery, actorUserId: string) {
  const values: unknown[] = [];
  const where = catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values);
  const result = await pool.query(`SELECT * FROM alignments WHERE ${where} ORDER BY name ASC`, values);
  return result.rows;
}

// Edition-invariant lookup (Phase 3.6): items.damage_type_id and monster
// action entries both reference this by id, but nothing served it to the
// frontend before now — display code had no way to turn a damage_type_id
// into "slashing"/"fire" etc.
export async function listDamageTypes(pool: Pool, query: CampaignScopedQuery, actorUserId: string) {
  const values: unknown[] = [];
  const where = catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values);
  const result = await pool.query(`SELECT * FROM damage_types WHERE ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listRaces(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM races WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listSubraces(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('r.edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('s.owning_campaign_id', 's.owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(
    `SELECT s.* FROM subraces s JOIN races r ON r.id = s.race_id WHERE ${clauses.join(' AND ')} ORDER BY s.name ASC`,
    values,
  );
  return result.rows;
}

export async function listClasses(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM classes WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listSubclasses(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('c.edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('s.owning_campaign_id', 's.owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(
    `SELECT s.* FROM subclasses s JOIN classes c ON c.id = s.class_id WHERE ${clauses.join(' AND ')} ORDER BY s.name ASC`,
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

export async function listBackgrounds(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM backgrounds WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listFeats(pool: Pool, query: EditionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const editionClause = editionFilter('edition_scope', query.edition, values).replace(/^WHERE /, '');
  if (editionClause) clauses.push(editionClause);
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));
  const result = await pool.query(`SELECT * FROM feats WHERE ${clauses.join(' AND ')} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listMonsters(pool: Pool, query: MonsterQuery, actorUserId: string) {
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

  // Global (owning_campaign_id IS NULL AND owning_user_id IS NULL) monsters
  // are always included; a campaign's own homebrew rows are unioned in ONLY
  // when campaignId is supplied — same additive-only pattern as
  // listEffectDefinitions below. Iteration 2 "Shared bestiary": the caller's
  // OWN user-library homebrew (owning_user_id = actorUserId) is unioned in
  // unconditionally (not gated on campaignId) — "my library, reusable
  // across every campaign I run" needs to show up whether or not the caller
  // happens to be browsing from inside a specific campaign right now. With
  // no campaignId and no library rows of the caller's own, this clause
  // reduces to exactly `owning_campaign_id IS NULL AND owning_user_id IS
  // NULL`, so a user with no homebrew sees unchanged pre-Iteration-2 results.
  values.push(actorUserId);
  const ownLibraryClause = `owning_user_id = $${values.length}`;
  if (query.campaignId !== undefined && query.homebrewOnly) {
    values.push(query.campaignId);
    clauses.push(`((is_homebrew AND owning_campaign_id = $${values.length}) OR ${ownLibraryClause})`);
  } else if (query.campaignId !== undefined) {
    values.push(query.campaignId);
    clauses.push(`(owning_campaign_id IS NULL OR owning_campaign_id = $${values.length} OR ${ownLibraryClause})`);
  } else {
    clauses.push(`(owning_campaign_id IS NULL AND (owning_user_id IS NULL OR ${ownLibraryClause}))`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM monsters ${where} ORDER BY challenge_rating ASC, name ASC`, values);
  return result.rows;
}

// Single-creature fetch (REFACTOR-PLAN.md §1: /creature/:id, its own route
// rather than only reachable via the list). A homebrew row's membership check
// is the caller's responsibility (see routes/catalog.ts) — this just 404s if
// the id doesn't exist at all, same "don't leak existence" posture as
// fetchHomebrewMonsterOrThrow in services/monsterCatalog.ts.
export async function getMonsterById(pool: Pool, id: string) {
  const result = await pool.query(`SELECT * FROM monsters WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

// ---- Added for Phase 2 UI: spells/items/effect-definitions browse ----
// (PLAN.md §4.1 lists these as part of the catalog family; no route/service
// existed for them yet — see routes/catalog.ts for the mounted GETs.)

export async function listSpells(pool: Pool, query: SpellQuery, actorUserId: string) {
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
  clauses.push(catalogScopeClause('s.owning_campaign_id', 's.owning_user_id', query.campaignId, actorUserId, values));

  const where = `WHERE ${clauses.join(' AND ')}`;
  const result = await pool.query(
    `SELECT s.* FROM spells s ${where} ORDER BY s.level ASC, s.name ASC`,
    values,
  );
  return result.rows;
}

export async function listItems(pool: Pool, query: ItemQuery, actorUserId: string) {
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
  clauses.push(catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values));

  const where = `WHERE ${clauses.join(' AND ')}`;
  const result = await pool.query(`SELECT * FROM items ${where} ORDER BY name ASC`, values);
  return result.rows;
}

export async function listEffectDefinitions(pool: Pool, query: EffectDefinitionQuery, actorUserId: string) {
  const values: unknown[] = [];
  const where = catalogScopeClause('owning_campaign_id', 'owning_user_id', query.campaignId, actorUserId, values);
  const result = await pool.query(`SELECT * FROM effect_definitions WHERE ${where} ORDER BY name ASC`, values);
  return result.rows;
}
