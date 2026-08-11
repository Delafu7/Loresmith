// Phase 4 "Bastion tracking" sub-phase 2 — campaign-instance CRUD for
// bastions/bastion_facilities (see docs/rules/bastions.md for the full
// rules writeup, and 1784269813666_create-bastions.ts's migration comments
// for the schema reasoning). Player-facing content: a Bastion belongs to
// one character, so writes are gated the same way character-sheet edits
// are (requireOwnerOrDm, not requireDm) — the DM enables/oversees the
// system, but a player manages their own character's Bastion, same
// ownership split as every other character-scoped resource in this app.
//
// Combining Bastions (docs/rules/bastions.md §1) is a smaller edge feature,
// deliberately deferred past everything this file covers.

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireDm, requireOwnerOrDm, type CampaignRole } from './authz.js';
import { fetchCharacterOrThrow } from './characters.js';
import { characterMeetsFacilityPrerequisite } from './bastionPrerequisites.js';
import type {
  CreateBastionInput, UpdateBastionInput, AddBastionFacilityInput, SpendBastionPointsInput,
} from '../schemas/bastions.js';

export interface BastionRow {
  id: string;
  campaign_id: string;
  owner_character_id: string;
  name: string | null;
  combined_group_id: string | null;
  bastion_points: number;
  bastion_defenders: number;
  status: 'active' | 'fallen' | 'abandoned';
  turn_interval_days: number;
  last_turn_in_game_day: number | null;
  consecutive_turns_without_orders: number;
  last_resurrection_character_level: number | null;
  created_at: string;
  updated_at: string;
}

interface BastionFacilityRow {
  id: string;
  bastion_id: string;
  catalog_id: string;
  space: 'cramped' | 'roomy' | 'vast';
  status: 'operational' | 'shut_down';
  config: Record<string, unknown> | null;
  created_at: string;
}

interface CatalogRow {
  id: string;
  index_key: string;
  name: string;
  facility_type: 'basic' | 'special';
  min_level: number | null;
  prerequisite_text: string | null;
  default_space: 'cramped' | 'roomy' | 'vast' | null;
}

// Special Facility Acquisition schedule (docs/rules/bastions.md §1,
// confirmed final): 2 @ level 5, 4 @ level 9, 5 @ level 13, 6 @ level 17.
function specialFacilityAllowance(totalLevel: number): number {
  if (totalLevel >= 17) return 6;
  if (totalLevel >= 13) return 5;
  if (totalLevel >= 9) return 4;
  if (totalLevel >= 5) return 2;
  return 0;
}

async function totalCharacterLevel(pool: Pool, characterId: string): Promise<number> {
  const res = await pool.query<{ total: number }>(
    `SELECT COALESCE(SUM(level), 0)::int AS total FROM character_classes WHERE character_id = $1`,
    [characterId],
  );
  return res.rows[0]?.total ?? 0;
}

export async function fetchBastionScoped(pool: Pool, campaignId: string, bastionId: string): Promise<BastionRow> {
  const result = await pool.query<BastionRow>(`SELECT * FROM bastions WHERE id = $1 AND campaign_id = $2`, [bastionId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Bastion');
  return row;
}

async function requireBastionsEnabled(pool: Pool, campaignId: string): Promise<void> {
  const res = await pool.query<{ bastions_enabled: boolean }>(`SELECT bastions_enabled FROM campaigns WHERE id = $1`, [campaignId]);
  if (!res.rows[0]) throw notFound('Campaign');
  if (!res.rows[0].bastions_enabled) {
    throw new AppError('VALIDATION_ERROR', 'Bastions are not enabled for this campaign');
  }
}

export async function listBastions(pool: Pool, campaignId: string): Promise<BastionRow[]> {
  const result = await pool.query<BastionRow>(`SELECT * FROM bastions WHERE campaign_id = $1 ORDER BY created_at ASC`, [campaignId]);
  return result.rows;
}

export async function getBastionWithFacilities(
  pool: Pool,
  campaignId: string,
  bastionId: string,
): Promise<BastionRow & { facilities: Array<BastionFacilityRow & { catalog: CatalogRow }> }> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const facilitiesRes = await pool.query<BastionFacilityRow & CatalogRow & { facility_id: string }>(
    `SELECT bf.id AS facility_id, bf.bastion_id, bf.catalog_id, bf.space, bf.status, bf.config, bf.created_at,
            bfc.id, bfc.index_key, bfc.name, bfc.facility_type, bfc.min_level, bfc.prerequisite_text, bfc.default_space
     FROM bastion_facilities bf
     JOIN bastion_facility_catalog bfc ON bfc.id = bf.catalog_id
     WHERE bf.bastion_id = $1
     ORDER BY bfc.facility_type ASC, bfc.name ASC`,
    [bastionId],
  );
  const facilities = facilitiesRes.rows.map((row) => ({
    id: row.facility_id,
    bastion_id: row.bastion_id,
    catalog_id: row.catalog_id,
    space: row.space,
    status: row.status,
    config: row.config,
    created_at: row.created_at,
    catalog: {
      id: row.id,
      index_key: row.index_key,
      name: row.name,
      facility_type: row.facility_type,
      min_level: row.min_level,
      prerequisite_text: row.prerequisite_text,
      default_space: row.default_space,
    },
  }));
  return { ...bastion, facilities };
}

export async function createBastion(
  pool: Pool,
  campaignId: string,
  role: CampaignRole,
  actorId: string,
  input: CreateBastionInput,
): Promise<BastionRow> {
  await requireBastionsEnabled(pool, campaignId);

  const character = await fetchCharacterOrThrow(pool, input.ownerCharacterId);
  if (character.campaign_id !== campaignId) throw notFound('Character');
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  const totalLevel = await totalCharacterLevel(pool, input.ownerCharacterId);
  if (totalLevel < 5) {
    throw new AppError('VALIDATION_ERROR', 'A character must be at least total level 5 to acquire a Bastion');
  }

  try {
    const result = await pool.query<BastionRow>(
      `INSERT INTO bastions (campaign_id, owner_character_id, name) VALUES ($1, $2, $3) RETURNING *`,
      [campaignId, input.ownerCharacterId, input.name ?? null],
    );
    return result.rows[0]!;
  } catch (err) {
    // Translates the partial unique index (owner_character_id WHERE status
    // = 'active') into a clean, expected error instead of a raw pg
    // constraint-violation leaking through — this character already has an
    // active Bastion (must be abandoned/fallen first, or reused).
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new AppError('CONFLICT', 'This character already has an active Bastion');
    }
    throw err;
  }
}

export async function updateBastion(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
  input: UpdateBastionInput,
): Promise<BastionRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);

  if (input.name !== undefined) requireOwnerOrDm(role, character.owner_user_id, actorId);
  // Turn cadence and the Bastion Defenders headcount are DM-adjustable
  // knobs (docs/rules/bastions.md §5-6), not player-editable fields — same
  // "DM sets the pace / tracks the headcount" reasoning as every other
  // DM-only campaign-configuration write in this app.
  if (input.turnIntervalDays !== undefined) requireDm(role);
  if (input.bastionDefenders !== undefined) requireDm(role);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); values.push(input.name); }
  if (input.turnIntervalDays !== undefined) { sets.push(`turn_interval_days = $${i++}`); values.push(input.turnIntervalDays); }
  if (input.bastionDefenders !== undefined) { sets.push(`bastion_defenders = $${i++}`); values.push(input.bastionDefenders); }
  if (sets.length === 0) return bastion;

  sets.push('updated_at = now()');
  values.push(bastionId);
  const result = await pool.query<BastionRow>(`UPDATE bastions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0]!;
}

export async function abandonBastion(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
): Promise<BastionRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (bastion.status !== 'active') {
    throw new AppError('VALIDATION_ERROR', 'Only an active Bastion can be abandoned');
  }
  const result = await pool.query<BastionRow>(
    `UPDATE bastions SET status = 'abandoned', updated_at = now() WHERE id = $1 RETURNING *`,
    [bastionId],
  );
  return result.rows[0]!;
}

export async function addFacility(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
  input: AddBastionFacilityInput,
): Promise<BastionFacilityRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (bastion.status !== 'active') {
    throw new AppError('VALIDATION_ERROR', 'Cannot add a facility to a Bastion that is not active');
  }

  const catalogRes = await pool.query<CatalogRow>(`SELECT * FROM bastion_facility_catalog WHERE id = $1`, [input.catalogId]);
  const catalog = catalogRes.rows[0];
  if (!catalog) throw notFound('Bastion facility catalog entry');

  const totalLevel = await totalCharacterLevel(pool, bastion.owner_character_id);

  let space: 'cramped' | 'roomy' | 'vast';
  if (catalog.facility_type === 'basic') {
    if (!input.space) throw new AppError('VALIDATION_ERROR', 'A basic facility requires a chosen space');
    space = input.space;
    // Basic facilities are flavor-only: no level gate, no prerequisite, no
    // count cap, and duplicates of the same catalog row are explicitly
    // allowed (docs/rules/bastions.md §2) — nothing else to check.
  } else {
    if (input.space) {
      throw new AppError('VALIDATION_ERROR', 'A special facility\'s space is fixed by the catalog, not player-chosen');
    }
    if (catalog.min_level !== null && totalLevel < catalog.min_level) {
      throw new AppError('VALIDATION_ERROR', `${catalog.name} requires the owning character to be at least level ${catalog.min_level}`);
    }

    // Cheap existence check before the more expensive prerequisite/count
    // gates below — also gives a more specific error ("you already have
    // this") than a prerequisite failure would, when both happen to apply.
    const existingRes = await pool.query(
      `SELECT 1 FROM bastion_facilities WHERE bastion_id = $1 AND catalog_id = $2 LIMIT 1`,
      [bastionId, input.catalogId],
    );
    if ((existingRes.rowCount ?? 0) > 0) {
      throw new AppError('CONFLICT', `This Bastion already has ${catalog.name}`);
    }

    const meetsPrereq = await characterMeetsFacilityPrerequisite(pool, bastion.owner_character_id, catalog.prerequisite_text);
    if (!meetsPrereq) {
      throw new AppError('VALIDATION_ERROR', `${catalog.name} requires: ${catalog.prerequisite_text}`);
    }

    const specialCountRes = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bastion_facilities bf
       JOIN bastion_facility_catalog bfc ON bfc.id = bf.catalog_id
       WHERE bf.bastion_id = $1 AND bfc.facility_type = 'special'`,
      [bastionId],
    );
    const allowance = specialFacilityAllowance(totalLevel);
    if ((specialCountRes.rows[0]?.count ?? 0) >= allowance) {
      throw new AppError(
        'VALIDATION_ERROR',
        `This character's Bastion can hold at most ${allowance} special facilities at level ${totalLevel}`,
      );
    }

    space = catalog.default_space!; // NOT NULL for every special-facility catalog row, per the seed
  }

  const result = await pool.query<BastionFacilityRow>(
    `INSERT INTO bastion_facilities (bastion_id, catalog_id, space) VALUES ($1, $2, $3) RETURNING *`,
    [bastionId, input.catalogId, space],
  );
  return result.rows[0]!;
}

export async function removeFacility(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  facilityId: string,
  role: CampaignRole,
  actorId: string,
): Promise<void> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  // Removing a facility (e.g. the level-up swap flow: remove then add a
  // different one) intentionally does NOT touch bastions.bastion_points —
  // BP live on the Bastion itself, never on a facility row (docs/rules/
  // bastions.md §1 Edge cases) — only the facility's own `config` is lost,
  // which is the documented, expected behavior of a swap.
  const result = await pool.query(`DELETE FROM bastion_facilities WHERE id = $1 AND bastion_id = $2`, [facilityId, bastionId]);
  if (result.rowCount === 0) throw notFound('Bastion facility');
}

/**
 * Fall of a Bastion (docs/rules/bastions.md §7) — an explicit DM/player
 * action for "a Bastion turn cycle passed with NO turn resolved for this
 * character at all" (typically because they're dead, unreachable, or the
 * table has stopped tracking their downtime). This is NOT what happens when
 * a present-but-inactive character auto-Maintains (resolveBastionTurn
 * handles that path and resets this same counter to 0) — this app has no
 * background job that could distinguish "a cycle silently passed" on its
 * own (no auto-advance precedent anywhere in this codebase), so surfacing
 * it as an explicit action is this app's own interpretive choice (reading
 * (a) from that doc), not an invented automatic rule.
 */
export async function skipBastionTurn(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
): Promise<BastionRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (bastion.status !== 'active') {
    throw new AppError('VALIDATION_ERROR', 'Only an active Bastion can accumulate a skipped turn');
  }

  const totalLevel = await totalCharacterLevel(pool, bastion.owner_character_id);
  const nextCount = bastion.consecutive_turns_without_orders + 1;
  const falls = nextCount >= totalLevel;

  const result = await pool.query<BastionRow>(
    `UPDATE bastions SET consecutive_turns_without_orders = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [bastionId, nextCount, falls ? 'fallen' : 'active'],
  );
  return result.rows[0]!;
}

// Spending BP — magic items (rarity -> level prereq / BP cost) plus the two
// flat non-item spends (docs/rules/bastions.md §3). Deliberately does NOT
// materialize a character_items row for the magic-item spend: "must be
// DM-approved" and the specific item's identity aren't modeled by this
// app's catalog lookup alone — this endpoint's job is the atomic BP
// bookkeeping and eligibility gate only; the DM adds the actual item via
// this app's existing character_items UI afterward, same division of
// responsibility as the rest of this app's DM-adjudicated content.
// Similarly, the 10 BP Charisma-check boon isn't wired into active_effects
// -- that table has no 'bastion_facility'-shaped source_type value yet (a
// real, flagged app-code change for a future pass, not faked here).
const MAGIC_ITEM_BP_COST: Record<string, { cost: number; minLevel: number | null }> = {
  common: { cost: 20, minLevel: null },
  uncommon: { cost: 70, minLevel: null },
  rare: { cost: 250, minLevel: 9 },
  very_rare: { cost: 350, minLevel: 13 },
  legendary: { cost: 700, minLevel: 17 },
};
const CHARISMA_BOOST_BP_COST = 10;
const RESURRECTION_BP_COST = 100;

export async function spendBastionPoints(
  pool: Pool,
  campaignId: string,
  bastionId: string,
  role: CampaignRole,
  actorId: string,
  input: SpendBastionPointsInput,
): Promise<BastionRow> {
  const bastion = await fetchBastionScoped(pool, campaignId, bastionId);
  const character = await fetchCharacterOrThrow(pool, bastion.owner_character_id);
  requireOwnerOrDm(role, character.owner_user_id, actorId);

  if (bastion.status !== 'active') {
    throw new AppError('VALIDATION_ERROR', 'Only an active Bastion can spend Bastion Points');
  }

  if (input.kind === 'magic_item') {
    const { cost, minLevel } = MAGIC_ITEM_BP_COST[input.rarity]!;
    if (minLevel !== null) {
      const totalLevel = await totalCharacterLevel(pool, bastion.owner_character_id);
      if (totalLevel < minLevel) {
        throw new AppError('VALIDATION_ERROR', `A ${input.rarity} item requires the owning character to be at least level ${minLevel}`);
      }
    }
    return spendBpAtomically(pool, bastionId, cost);
  }

  if (input.kind === 'charisma_boost') {
    return spendBpAtomically(pool, bastionId, CHARISMA_BOOST_BP_COST);
  }

  // resurrection
  const totalLevel = await totalCharacterLevel(pool, bastion.owner_character_id);
  if (bastion.last_resurrection_character_level !== null && totalLevel <= bastion.last_resurrection_character_level) {
    throw new AppError(
      'VALIDATION_ERROR',
      'This benefit cannot be used again until the character gains at least one level since the last use',
    );
  }
  const result = await pool.query<BastionRow>(
    `UPDATE bastions
     SET bastion_points = bastion_points - $2, last_resurrection_character_level = $3, updated_at = now()
     WHERE id = $1 AND bastion_points >= $2
     RETURNING *`,
    [bastionId, RESURRECTION_BP_COST, totalLevel],
  );
  if (!result.rows[0]) throw new AppError('VALIDATION_ERROR', `Not enough Bastion Points (needs ${RESURRECTION_BP_COST})`);
  return result.rows[0];
}

async function spendBpAtomically(pool: Pool, bastionId: string, cost: number): Promise<BastionRow> {
  const result = await pool.query<BastionRow>(
    `UPDATE bastions SET bastion_points = bastion_points - $2, updated_at = now() WHERE id = $1 AND bastion_points >= $2 RETURNING *`,
    [bastionId, cost],
  );
  if (!result.rows[0]) throw new AppError('VALIDATION_ERROR', `Not enough Bastion Points (needs ${cost})`);
  return result.rows[0];
}
