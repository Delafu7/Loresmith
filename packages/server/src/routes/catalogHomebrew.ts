// Mounted at /campaigns/:id/catalog — write access (create/update/delete/
// duplicate) for the 11 catalog tables covered by the catalog-homebrew-
// scope migration. One sub-router per entity, generated from a small config
// list rather than hand-written 11 times, since the actual route shape is
// identical across all of them (see services/catalogHomebrew.ts for why the
// service layer is generic too). Read access is unchanged — the existing
// GET /catalog/* routes (routes/catalog.ts) already union in a campaign's
// homebrew rows when given a campaignId, same as monsters/effect-definitions.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import {
  createHomebrewSchemas,
  updateHomebrewSchemas,
  type HomebrewCatalogTable,
} from '../schemas/catalogHomebrew.js';
import * as catalogHomebrewService from '../services/catalogHomebrew.js';
import type { CatalogTableConfig } from '../services/catalogHomebrew.js';

// urlSegment matches the existing GET /catalog/* route names (routes/catalog.ts) —
// only damage_types differs (hyphenated in URLs, per that file's own convention).
const ENTITIES: Array<{ urlSegment: string; table: HomebrewCatalogTable; keyColumn: CatalogTableConfig['keyColumn'] }> = [
  { urlSegment: 'items', table: 'items', keyColumn: 'slug' },
  { urlSegment: 'spells', table: 'spells', keyColumn: 'slug' },
  { urlSegment: 'races', table: 'races', keyColumn: 'index_key' },
  { urlSegment: 'subraces', table: 'subraces', keyColumn: 'index_key' },
  { urlSegment: 'classes', table: 'classes', keyColumn: 'index_key' },
  { urlSegment: 'subclasses', table: 'subclasses', keyColumn: 'index_key' },
  { urlSegment: 'backgrounds', table: 'backgrounds', keyColumn: 'index_key' },
  { urlSegment: 'feats', table: 'feats', keyColumn: 'index_key' },
  { urlSegment: 'alignments', table: 'alignments', keyColumn: 'index_key' },
  { urlSegment: 'languages', table: 'languages', keyColumn: 'index_key' },
  { urlSegment: 'damage-types', table: 'damage_types', keyColumn: 'index_key' },
];

// zod schemas are camelCase (schemas/catalogHomebrew.ts); every table column
// is plain snake_case with no unusual abbreviations, so a mechanical
// camelCase -> snake_case conversion is exact here (verified against every
// field in every shape) rather than needing a per-entity mapping table.
function toSnakeCaseColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[column] = value;
  }
  return out;
}

export const campaignCatalogRouter = Router({ mergeParams: true });
campaignCatalogRouter.use(requireAuth, requireCampaignMember());

for (const entity of ENTITIES) {
  const config: CatalogTableConfig = { table: entity.table, keyColumn: entity.keyColumn };

  campaignCatalogRouter.post(`/${entity.urlSegment}`, requireRole('dm'), async (req, res) => {
    const input = createHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const row = await catalogHomebrewService.createHomebrewCatalogRow(
      pool, req.user!.id, req.campaignId!, config, toSnakeCaseColumns(input),
    );
    res.status(201).json({ entry: row });
  });

  campaignCatalogRouter.patch(`/${entity.urlSegment}/:entryId`, requireRole('dm'), async (req, res) => {
    const input = updateHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const row = await catalogHomebrewService.updateHomebrewCatalogRow(
      pool, req.user!.id, req.campaignId!, config, req.params.entryId as string, toSnakeCaseColumns(input),
    );
    res.json({ entry: row });
  });

  campaignCatalogRouter.delete(`/${entity.urlSegment}/:entryId`, requireRole('dm'), async (req, res) => {
    await catalogHomebrewService.deleteHomebrewCatalogRow(pool, req.user!.id, req.campaignId!, config, req.params.entryId as string);
    res.status(204).send();
  });

  // Duplicates ANY row (global or another campaign's homebrew) into a new
  // homebrew row owned by THIS campaign — the "fork" half of fork-on-edit:
  // editing official content means duplicating it into your own campaign
  // first, then editing your own copy via the PATCH route above.
  campaignCatalogRouter.post(`/${entity.urlSegment}/:entryId/duplicate`, requireRole('dm'), async (req, res) => {
    const row = await catalogHomebrewService.duplicateCatalogRow(pool, req.user!.id, req.campaignId!, config, req.params.entryId as string);
    res.status(201).json({ entry: row });
  });
}
