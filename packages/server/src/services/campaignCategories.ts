// Generic per-campaign category/tag system (Task 1's forward-looking
// schema — see db/migrations/1784269786666's header comment). Written
// entity-type-agnostic on purpose: every function here takes an entityType
// string and works identically for 'creature' today and 'character'/'item'/
// 'shop'/'map' once later tasks start calling it — nothing below assumes
// creatures specifically. Campaign membership/role checks are the caller's
// responsibility (route-level requireCampaignMember/requireRole, same
// convention as services/monsterCatalog.ts) — this file only enforces
// resource scoping (a category must belong to the campaign/entityType it's
// used with).

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';

export interface CampaignCategory {
  id: string;
  campaign_id: string;
  entity_type: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export async function listCampaignCategories(pool: Pool, campaignId: string, entityType: string): Promise<CampaignCategory[]> {
  const result = await pool.query<CampaignCategory>(
    `SELECT * FROM campaign_categories WHERE campaign_id = $1 AND entity_type = $2 ORDER BY sort_order ASC, name ASC`,
    [campaignId, entityType],
  );
  return result.rows;
}

// Upsert-and-return in one round trip: the DO UPDATE (a harmless no-op —
// name is set back to itself) is what makes Postgres populate RETURNING on
// a conflict, same trick used elsewhere in this app for idempotent bulk
// inserts. color/icon are only applied on first creation, never overwritten
// by a later find-or-create call with different values — this is "find or
// create," not "upsert."
export async function findOrCreateCategory(
  pool: Pool,
  campaignId: string,
  entityType: string,
  name: string,
  color?: string | null,
  icon?: string | null,
): Promise<CampaignCategory> {
  const result = await pool.query<CampaignCategory>(
    `INSERT INTO campaign_categories (campaign_id, entity_type, name, color, icon)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (campaign_id, entity_type, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [campaignId, entityType, name, color ?? null, icon ?? null],
  );
  return result.rows[0]!;
}

// Scoped by campaign_id + entity_type (not just id) so this 404s for a
// category belonging to a different campaign, or the right campaign but the
// wrong entity_type (e.g. a 'shop' category id used against a creature
// entry) — never silently attaches a mismatched category.
async function fetchCategoryOrThrow(pool: Pool, campaignId: string, entityType: string, categoryId: string): Promise<CampaignCategory> {
  const result = await pool.query<CampaignCategory>(
    `SELECT * FROM campaign_categories WHERE id = $1 AND campaign_id = $2 AND entity_type = $3`,
    [categoryId, campaignId, entityType],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Category');
  return row;
}

export async function attachCategory(
  pool: Pool,
  campaignId: string,
  entityType: string,
  entityId: string,
  categoryId: string,
): Promise<CampaignCategory> {
  const category = await fetchCategoryOrThrow(pool, campaignId, entityType, categoryId);
  await pool.query(
    `INSERT INTO entity_categories (category_id, entity_type, entity_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [categoryId, entityType, entityId],
  );
  return category;
}

export async function detachCategory(pool: Pool, categoryId: string, entityId: string): Promise<void> {
  await pool.query(`DELETE FROM entity_categories WHERE category_id = $1 AND entity_id = $2`, [categoryId, entityId]);
}

// Batch lookup for embedding categories into a list response (e.g.
// services/campaignBestiary.ts's listCampaignBestiary) without an N+1 query
// per row.
export async function listCategoriesForEntities(
  pool: Pool,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, CampaignCategory[]>> {
  const map = new Map<string, CampaignCategory[]>();
  if (entityIds.length === 0) return map;

  const result = await pool.query<CampaignCategory & { entity_id: string }>(
    `SELECT cc.*, ec.entity_id
     FROM entity_categories ec
     JOIN campaign_categories cc ON cc.id = ec.category_id
     WHERE ec.entity_type = $1 AND ec.entity_id = ANY($2::uuid[])
     ORDER BY cc.sort_order ASC, cc.name ASC`,
    [entityType, entityIds],
  );
  for (const row of result.rows) {
    const { entity_id, ...category } = row;
    const list = map.get(entity_id) ?? [];
    list.push(category);
    map.set(entity_id, list);
  }
  return map;
}
