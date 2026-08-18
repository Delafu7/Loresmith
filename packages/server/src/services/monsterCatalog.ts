// Homebrew monster catalog CRUD (Phase 3.2, PLAN.md §3.5/§4.4) — the first
// write path onto the `monsters` catalog table in this app. Every function
// here is scoped to a single campaign's homebrew rows
// (is_homebrew=true, owning_campaign_id=<that campaign>); global/seeded
// monsters (owning_campaign_id IS NULL) are never reachable through this
// file, regardless of caller role — routes/monsters.ts's
// campaignMonstersRouter gates all three routes behind requireRole('dm') on
// top of that.
//
// services/catalog.ts stays read-only/reference-data-only per its own
// header comment; this is the one deliberate exception, kept in its own
// file rather than folded in there.

import crypto from 'node:crypto';
import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import type { CreateHomebrewMonsterInput, UpdateHomebrewMonsterInput } from '../schemas/monsterCatalog.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'monster';
}

// Two different campaigns can both homebrew a creature called e.g. "Swamp
// Ooze" — a plain slugify(name) would collide on monsters' existing
// UNIQUE(slug, edition_scope) constraint (deliberately left untouched by
// 1784269753666_add-monster-homebrew-scope.ts). Appending a short random
// suffix keeps every homebrew slug unique regardless of what other campaigns
// have named their creatures, without touching that DB constraint.
function homebrewSlug(name: string): string {
  return `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function fetchCampaignEditionOrThrow(pool: Pool, campaignId: string): Promise<string> {
  const result = await pool.query<{ srd_edition: string }>(`SELECT srd_edition FROM campaigns WHERE id = $1`, [campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Campaign');
  return row.srd_edition;
}

// Cross-campaign consistency (artAssetId's row must belong to the SAME
// campaign that owns this monster) is a service-layer check, not a DB
// constraint — same "app-layer, not declarative" precedent as
// services/assets.ts's authorizeAssetUpload characterId check.
async function validateArtAssetBelongsToCampaign(
  pool: Pool,
  campaignId: string,
  artAssetId: string | null | undefined,
): Promise<void> {
  if (artAssetId === null || artAssetId === undefined) return;
  const result = await pool.query<{ campaign_id: string }>(
    `SELECT campaign_id FROM campaign_assets WHERE id = $1`,
    [artAssetId],
  );
  const row = result.rows[0];
  if (!row || row.campaign_id !== campaignId) {
    throw notFound('Asset');
  }
}

interface MonsterRow {
  id: string;
  is_homebrew: boolean;
  owning_campaign_id: string | null;
  owning_user_id: string | null;
  [key: string]: unknown;
}

// Scoped by (owning_campaign_id = campaignId OR owning_user_id = actorUserId)
// — a homebrew row is editable from within the campaign that owns it
// (unchanged behavior) OR, new in Iteration 2, from any campaign context by
// the user who owns it in their personal library. Never matches a global row
// (owning_campaign_id/owning_user_id both NULL can't equal either
// comparison) or another user's/campaign's homebrew — 404, never leaking
// existence, same discipline as before.
async function fetchHomebrewMonsterOrThrow(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  monsterId: string,
): Promise<MonsterRow> {
  const result = await pool.query<MonsterRow>(
    `SELECT * FROM monsters WHERE id = $1 AND (owning_campaign_id = $2 OR owning_user_id = $3)`,
    [monsterId, campaignId, actorUserId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster');
  return row;
}

export async function createHomebrewMonster(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  input: CreateHomebrewMonsterInput,
) {
  await validateArtAssetBelongsToCampaign(pool, campaignId, input.artAssetId);
  // Always the owning campaign's own edition, never caller-supplied: a
  // homebrew row is only ever visible inside that one campaign (listMonsters
  // ANDs the edition filter with the homebrew-union clause), so letting it
  // diverge from the campaign's edition would make the row invisible in its
  // own bestiary the moment it's created — a self-inflicted lockout a
  // pre-merge review caught. Nothing legitimate is lost: there's no reason a
  // campaign's own homebrew creature would need a different edition tag than
  // the campaign it lives in.
  const editionScope = await fetchCampaignEditionOrThrow(pool, campaignId);
  const slug = homebrewSlug(input.name);
  // 'library' scopes the new row to the creating user (reusable across every
  // campaign they run) instead of this one campaign — see the migration's
  // header comment. Default matches every pre-existing caller unchanged.
  const owningCampaignId = input.libraryScope === 'library' ? null : campaignId;
  const owningUserId = input.libraryScope === 'library' ? actorUserId : null;

  const result = await pool.query(
    `INSERT INTO monsters (
       slug, name, edition_scope, size, creature_type, alignment, armor_class, armor_class_notes,
       hit_point_average, hit_dice, speed, str, dex, con, int, wis, cha,
       saving_throws, skills, damage_vulnerabilities, damage_resistances, damage_immunities,
       senses, languages, challenge_rating, xp_value, traits, actions, legendary_actions, legendary_action_count, reactions,
       source, description, is_homebrew, owning_campaign_id, owning_user_id, art_asset_id, is_unique, image_url
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
       $32, $33, true, $34, $35, $36, $37, $38
     )
     RETURNING *`,
    [
      slug, input.name, editionScope, input.size, input.creatureType, input.alignment ?? null,
      input.armorClass, input.armorClassNotes ?? null,
      input.hitPointAverage, input.hitDice, JSON.stringify(input.speed),
      input.str, input.dex, input.con, input.int, input.wis, input.cha,
      input.savingThrows ? JSON.stringify(input.savingThrows) : null,
      input.skills ? JSON.stringify(input.skills) : null,
      input.damageVulnerabilities ?? [], input.damageResistances ?? [], input.damageImmunities ?? [],
      input.senses ?? null, input.languages ?? null,
      input.challengeRating, input.xpValue,
      input.traits ? JSON.stringify(input.traits) : null,
      JSON.stringify(input.actions),
      input.legendaryActions ? JSON.stringify(input.legendaryActions) : null,
      input.legendaryActionCount ?? null,
      input.reactions ? JSON.stringify(input.reactions) : null,
      input.source ?? null, input.description ?? null,
      owningCampaignId, owningUserId, input.artAssetId ?? null, input.isUnique ?? false, input.imageUrl ?? null,
    ],
  );
  return result.rows[0];
}

// JSONB columns need JSON.stringify before going over the wire; everything
// else (including the TEXT[] damage_* arrays) can go through as-is.
const JSONB_FIELDS = new Set(['speed', 'savingThrows', 'skills', 'traits', 'actions', 'legendaryActions', 'reactions']);

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  size: 'size',
  creatureType: 'creature_type',
  alignment: 'alignment',
  armorClass: 'armor_class',
  armorClassNotes: 'armor_class_notes',
  hitPointAverage: 'hit_point_average',
  hitDice: 'hit_dice',
  speed: 'speed',
  str: 'str',
  dex: 'dex',
  con: 'con',
  int: 'int',
  wis: 'wis',
  cha: 'cha',
  savingThrows: 'saving_throws',
  skills: 'skills',
  damageVulnerabilities: 'damage_vulnerabilities',
  damageResistances: 'damage_resistances',
  damageImmunities: 'damage_immunities',
  senses: 'senses',
  languages: 'languages',
  challengeRating: 'challenge_rating',
  xpValue: 'xp_value',
  traits: 'traits',
  actions: 'actions',
  legendaryActions: 'legendary_actions',
  legendaryActionCount: 'legendary_action_count',
  reactions: 'reactions',
  source: 'source',
  description: 'description',
  artAssetId: 'art_asset_id',
  isUnique: 'is_unique',
  imageUrl: 'image_url',
};

export async function updateHomebrewMonster(
  pool: Pool,
  campaignId: string,
  actorUserId: string,
  monsterId: string,
  input: UpdateHomebrewMonsterInput,
) {
  await fetchHomebrewMonsterOrThrow(pool, campaignId, actorUserId, monsterId);
  if (input.artAssetId !== undefined) {
    await validateArtAssetBelongsToCampaign(pool, campaignId, input.artAssetId);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = UPDATABLE_COLUMNS[key];
    if (!column) continue;
    sets.push(`${column} = $${i++}`);
    values.push(JSONB_FIELDS.has(key) && value !== null ? JSON.stringify(value) : value);
  }
  if (sets.length === 0) return fetchHomebrewMonsterOrThrow(pool, campaignId, actorUserId, monsterId);

  sets.push('updated_at = now()');
  values.push(monsterId, campaignId, actorUserId);
  const result = await pool.query(
    // Re-scoped here too (defense in depth, matching monsters.ts's
    // fetchScopedInstanceOrThrow-then-scoped-write pattern) — the fetch
    // above already proved ownership, this just avoids a TOCTOU gap between
    // the read and the write.
    `UPDATE monsters SET ${sets.join(', ')}
     WHERE id = $${i} AND (owning_campaign_id = $${i + 1} OR owning_user_id = $${i + 2})
     RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function deleteHomebrewMonster(pool: Pool, campaignId: string, actorUserId: string, monsterId: string): Promise<void> {
  await fetchHomebrewMonsterOrThrow(pool, campaignId, actorUserId, monsterId);

  // monster_instances.monster_id has no ON DELETE clause (1784269739666), so
  // a raw DELETE here would surface a confusing raw Postgres FK-violation
  // error to the client — check first and throw a clean CONFLICT instead.
  // Iteration 2 "Shared bestiary": a template can now be curated by MANY
  // campaigns' campaign_bestiary_entries (not just its owning campaign), so
  // this guard now checks across ALL campaigns, not just this one — deleting
  // a shared template out from under another campaign's curated bestiary
  // used to be an unguarded silent cascade (campaign_bestiary_entries.
  // monster_id is ON DELETE CASCADE); this closes that gap. The check and
  // the delete run inside one transaction with the monster row locked (FOR
  // UPDATE), same concurrency-safety pattern as effects.ts's
  // insertActiveEffect: without the lock, an instance or a new bestiary
  // entry could be created from this monster in the gap between the check
  // and the DELETE.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM monsters WHERE id = $1 FOR UPDATE`, [monsterId]);

    const instances = await client.query(`SELECT 1 FROM monster_instances WHERE monster_id = $1 LIMIT 1`, [monsterId]);
    if ((instances.rowCount ?? 0) > 0) {
      throw new AppError('CONFLICT', 'Cannot delete a creature that has active instances — delete the instances first');
    }
    const bestiaryEntries = await client.query(`SELECT 1 FROM campaign_bestiary_entries WHERE monster_id = $1 LIMIT 1`, [monsterId]);
    if ((bestiaryEntries.rowCount ?? 0) > 0) {
      throw new AppError('CONFLICT', 'Cannot delete a creature that is in a campaign bestiary — remove it from every campaign bestiary first');
    }

    await client.query(
      `DELETE FROM monsters WHERE id = $1 AND (owning_campaign_id = $2 OR owning_user_id = $3)`,
      [monsterId, campaignId, actorUserId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Column-name (snake_case) counterpart to JSONB_FIELDS above — needed here
// because this copies a SELECT * row (already snake_case, and already
// parsed back into JS objects/arrays by the pg driver) rather than a
// camelCase input payload, so it has to re-stringify before the INSERT.
const JSONB_COLUMNS = new Set(['speed', 'saving_throws', 'skills', 'traits', 'actions', 'legendary_actions', 'reactions']);

// Forks ANY monster — official/global, or another campaign's homebrew —
// into a new homebrew row owned by this campaign. Unlike
// fetchHomebrewMonsterOrThrow, the source lookup is deliberately unscoped by
// owning_campaign_id: that's what makes forking an official creature
// possible at all, matching the "duplicate an official row to fork it, then
// edit your own copy" flow already established for the 11 generic catalog
// entities (services/catalogHomebrew.ts's duplicateCatalogRow).
export async function duplicateHomebrewMonster(pool: Pool, campaignId: string, sourceMonsterId: string) {
  const sourceRes = await pool.query<MonsterRow>(`SELECT * FROM monsters WHERE id = $1`, [sourceMonsterId]);
  const source = sourceRes.rows[0];
  if (!source) throw notFound('Monster');

  // art_asset_id is a campaign_assets FK scoped to the SOURCE campaign — an
  // official monster's is always null, but a fork of another campaign's
  // homebrew (unreachable via the normal bestiary list, but not otherwise
  // blocked here) could carry one. Copying it verbatim would leave the new
  // row pointing at an asset owned by a different campaign, so it's dropped
  // unless it actually belongs to the destination campaign — same rule
  // createHomebrewMonster enforces on create via validateArtAssetBelongsToCampaign.
  let artAssetId = source.art_asset_id as string | null;
  if (artAssetId !== null) {
    const assetRes = await pool.query<{ campaign_id: string }>(`SELECT campaign_id FROM campaign_assets WHERE id = $1`, [artAssetId]);
    if (assetRes.rows[0]?.campaign_id !== campaignId) artAssetId = null;
  }

  const omit = new Set([
    'id', 'slug', 'edition_scope', 'is_homebrew', 'owning_campaign_id', 'owning_user_id',
    'derived_from_template_id', 'created_at', 'updated_at', 'art_asset_id',
  ]);
  const columns: string[] = ['art_asset_id'];
  const values: unknown[] = [artAssetId];
  for (const [col, val] of Object.entries(source)) {
    if (omit.has(col) || col.endsWith('_legacy')) continue;
    columns.push(col);
    values.push(JSONB_COLUMNS.has(col) && val !== null ? JSON.stringify(val) : val);
  }

  // Always forks into the OWNING campaign's own edition, same reasoning as
  // createHomebrewMonster: a copy visible only inside this campaign must
  // carry this campaign's edition tag, not the source's (which could be an
  // official monster tagged for either edition, or another campaign running
  // a different one). derived_from_template_id records provenance — new in
  // Iteration 2, previously discarded entirely — so the UI can show "based
  // on {name}" (see docs/rules or the plan for this iteration).
  const editionScope = await fetchCampaignEditionOrThrow(pool, campaignId);
  columns.push('slug', 'edition_scope', 'is_homebrew', 'owning_campaign_id', 'derived_from_template_id');
  values.push(homebrewSlug(source.name as string), editionScope, true, campaignId, sourceMonsterId);

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const result = await pool.query(
    `INSERT INTO monsters (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    values,
  );
  return result.rows[0];
}

async function fetchUserLibraryMonsterOrThrow(pool: Pool, actorUserId: string, monsterId: string): Promise<MonsterRow> {
  const result = await pool.query<MonsterRow>(
    `SELECT * FROM monsters WHERE id = $1 AND owning_user_id = $2`,
    [monsterId, actorUserId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster');
  return row;
}

// ---- Library scope conversion (Iteration 2 "Shared bestiary") ----
//
// In-place scope changes on the SAME row (not a copy — that's
// duplicateHomebrewMonster above). Safe in both directions without touching
// any other campaign's data: a campaign-owned row can only ever be
// referenced by its own campaign's campaign_bestiary_entries (see
// addToCampaignBestiary's ownership check, services/campaignBestiary.ts), so
// promoting it never orphans another campaign's reference; a user-library
// row's existing campaign_bestiary_entries (from however many campaigns
// added it) are keyed by monster_id and are completely unaffected by who
// currently authors the template.

export async function promoteHomebrewMonsterToLibrary(pool: Pool, campaignId: string, actorUserId: string, monsterId: string) {
  // Must currently be owned by THIS campaign specifically — a strict check
  // (not the broadened OR-scoped fetchHomebrewMonsterOrThrow above, which
  // would also match a row the actor already owns in their library, making
  // "promote" a confusing no-op instead of a clean 404 on the wrong resource).
  const result = await pool.query(
    `UPDATE monsters SET owning_campaign_id = NULL, owning_user_id = $1, updated_at = now()
     WHERE id = $2 AND owning_campaign_id = $3
     RETURNING *`,
    [actorUserId, monsterId, campaignId],
  );
  if (!result.rows[0]) throw notFound('Monster');
  return result.rows[0];
}

// M4 fix: converting a shared user-library monster into a specific
// campaign's homebrew used to have no guard at all, unlike
// deleteHomebrewMonster's own cross-campaign check just above — a template
// still curated by OTHER campaigns' campaign_bestiary_entries could be
// silently reassigned out from under them. Those entries survive the
// conversion (they're keyed by monster_id, not by owner), but the OTHER
// campaigns would then need the GET /:id shared-bestiary bypass just to
// keep reading a row they no longer have any ownership claim to — blocking
// the conversion instead is the same "ask the DM to remove it from every
// other campaign's bestiary first" discipline delete already uses, applied
// here before scope changes rather than after data loss.
export async function assignHomebrewMonsterToCampaign(pool: Pool, campaignId: string, actorUserId: string, monsterId: string) {
  await fetchUserLibraryMonsterOrThrow(pool, actorUserId, monsterId);

  const otherCampaignEntries = await pool.query(
    `SELECT 1 FROM campaign_bestiary_entries WHERE monster_id = $1 AND campaign_id != $2 LIMIT 1`,
    [monsterId, campaignId],
  );
  if ((otherCampaignEntries.rowCount ?? 0) > 0) {
    throw new AppError(
      'CONFLICT',
      'This creature is still curated in another campaign\'s bestiary — remove it there first before assigning it to a specific campaign',
    );
  }

  const result = await pool.query(
    `UPDATE monsters SET owning_user_id = NULL, owning_campaign_id = $1, updated_at = now()
     WHERE id = $2 AND owning_user_id = $3
     RETURNING *`,
    [campaignId, monsterId, actorUserId],
  );
  return result.rows[0];
}
