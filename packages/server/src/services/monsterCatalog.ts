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

async function fetchCampaignEditionOrThrow(pool: Pool, campaignId: number): Promise<string> {
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
  campaignId: number,
  artAssetId: number | null | undefined,
): Promise<void> {
  if (artAssetId === null || artAssetId === undefined) return;
  const result = await pool.query<{ campaign_id: number }>(
    `SELECT campaign_id FROM campaign_assets WHERE id = $1`,
    [artAssetId],
  );
  const row = result.rows[0];
  if (!row || Number(row.campaign_id) !== campaignId) {
    throw notFound('Asset');
  }
}

interface MonsterRow {
  id: number;
  is_homebrew: boolean;
  owning_campaign_id: number | null;
  [key: string]: unknown;
}

// Scoped by owning_campaign_id (not just id) so this 404s for: a monster
// belonging to a DIFFERENT campaign's homebrew, AND a global/seeded monster
// (owning_campaign_id IS NULL never equals a real campaignId) — never leaks
// existence of another campaign's homebrew row, and never treats a global
// row as "editable, just not by you." Global rows are unreachable via this
// path regardless of role, full stop.
async function fetchHomebrewMonsterOrThrow(pool: Pool, campaignId: number, monsterId: number): Promise<MonsterRow> {
  const result = await pool.query<MonsterRow>(
    `SELECT * FROM monsters WHERE id = $1 AND owning_campaign_id = $2`,
    [monsterId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster');
  return row;
}

export async function createHomebrewMonster(pool: Pool, campaignId: number, input: CreateHomebrewMonsterInput) {
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

  const result = await pool.query(
    `INSERT INTO monsters (
       slug, name, edition_scope, size, creature_type, alignment, armor_class, armor_class_notes,
       hit_point_average, hit_dice, speed, str, dex, con, int, wis, cha,
       saving_throws, skills, damage_vulnerabilities, damage_resistances, damage_immunities,
       senses, languages, challenge_rating, xp_value, traits, actions, legendary_actions, reactions,
       source, is_homebrew, owning_campaign_id, art_asset_id, is_unique
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
       $31, true, $32, $33, $34
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
      input.reactions ? JSON.stringify(input.reactions) : null,
      input.source ?? null,
      campaignId, input.artAssetId ?? null, input.isUnique ?? false,
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
  reactions: 'reactions',
  source: 'source',
  artAssetId: 'art_asset_id',
  isUnique: 'is_unique',
};

export async function updateHomebrewMonster(
  pool: Pool,
  campaignId: number,
  monsterId: number,
  input: UpdateHomebrewMonsterInput,
) {
  await fetchHomebrewMonsterOrThrow(pool, campaignId, monsterId);
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
  if (sets.length === 0) return fetchHomebrewMonsterOrThrow(pool, campaignId, monsterId);

  values.push(monsterId, campaignId);
  const result = await pool.query(
    // Re-scoped by owning_campaign_id here too (defense in depth, matching
    // monsters.ts's fetchScopedInstanceOrThrow-then-scoped-write pattern) —
    // the fetch above already proved ownership, this just avoids a TOCTOU
    // gap between the read and the write.
    `UPDATE monsters SET ${sets.join(', ')} WHERE id = $${i} AND owning_campaign_id = $${i + 1} RETURNING *`,
    values,
  );
  return result.rows[0];
}

export async function deleteHomebrewMonster(pool: Pool, campaignId: number, monsterId: number): Promise<void> {
  await fetchHomebrewMonsterOrThrow(pool, campaignId, monsterId);

  // monster_instances.monster_id has no ON DELETE clause (1784269739666), so
  // a raw DELETE here would surface a confusing raw Postgres FK-violation
  // error to the client — check first and throw a clean CONFLICT instead.
  // The check and the delete run inside one transaction with the monster row
  // locked (FOR UPDATE), same concurrency-safety pattern as effects.ts's
  // insertActiveEffect: without the lock, an instance could be spawned from
  // this monster in the gap between the check and the DELETE, and the DELETE
  // would then hit the FK constraint directly instead of the clean CONFLICT.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT id FROM monsters WHERE id = $1 FOR UPDATE`, [monsterId]);

    const instances = await client.query(`SELECT 1 FROM monster_instances WHERE monster_id = $1 LIMIT 1`, [monsterId]);
    if ((instances.rowCount ?? 0) > 0) {
      throw new AppError('CONFLICT', 'Cannot delete a creature that has active instances — delete the instances first');
    }

    await client.query(`DELETE FROM monsters WHERE id = $1 AND owning_campaign_id = $2`, [monsterId, campaignId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
