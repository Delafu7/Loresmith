// Mounted at /campaigns/:id/catalog — write access (create/update/delete/
// duplicate/promote) for the 13 catalog tables plugged into the generic
// homebrew system (CATALOG_ENTITY_TABLES). One sub-router per entity,
// generated from a small config list rather than hand-written 13 times,
// since the actual route shape is identical across all of them (see
// services/catalogHomebrew.ts for why the service layer is generic too).
// Read access is unchanged — the existing GET /catalog/* routes
// (routes/catalog.ts) already union in a campaign's homebrew rows when given
// a campaignId, same as monsters/effect-definitions.
import { Router } from 'express';
import { CATALOG_ENTITY_TABLES } from '../catalogEntityTables.js';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createHomebrewSchemas, updateHomebrewSchemas } from '../schemas/catalogHomebrew.js';
import * as catalogHomebrewService from '../services/catalogHomebrew.js';
import type { CatalogTableConfig } from '../services/catalogHomebrew.js';

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

for (const entity of CATALOG_ENTITY_TABLES) {
  const config: CatalogTableConfig = { table: entity.table, keyColumn: entity.keyColumn, jsonbColumns: entity.jsonbColumns };

  campaignCatalogRouter.post(`/${entity.urlSegment}`, requireRole('dm'), async (req, res) => {
    const input = createHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const scope = { kind: 'campaign' as const, campaignId: req.campaignId!, actorId: req.user!.id };
    const row = await catalogHomebrewService.createHomebrewCatalogRow(pool, scope, config, toSnakeCaseColumns(input));
    res.status(201).json({ entry: row });
  });

  campaignCatalogRouter.patch(`/${entity.urlSegment}/:entryId`, requireRole('dm'), async (req, res) => {
    const input = updateHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const scope = { kind: 'campaign' as const, campaignId: req.campaignId!, actorId: req.user!.id };
    const row = await catalogHomebrewService.updateHomebrewCatalogRow(
      pool, scope, config, req.params.entryId as string, toSnakeCaseColumns(input),
    );
    res.json({ entry: row });
  });

  campaignCatalogRouter.delete(`/${entity.urlSegment}/:entryId`, requireRole('dm'), async (req, res) => {
    const scope = { kind: 'campaign' as const, campaignId: req.campaignId!, actorId: req.user!.id };
    await catalogHomebrewService.deleteHomebrewCatalogRow(pool, scope, config, req.params.entryId as string);
    res.status(204).send();
  });

  // Duplicates ANY row (global or another campaign's/user's homebrew) into a
  // new homebrew row owned by THIS campaign — the "fork" half of
  // fork-on-edit: editing official content means duplicating it into your
  // own campaign first, then editing your own copy via the PATCH route
  // above.
  campaignCatalogRouter.post(`/${entity.urlSegment}/:entryId/duplicate`, requireRole('dm'), async (req, res) => {
    const scope = { kind: 'campaign' as const, campaignId: req.campaignId!, actorId: req.user!.id };
    const row = await catalogHomebrewService.duplicateCatalogRow(pool, scope, config, req.params.entryId as string);
    res.status(201).json({ entry: row });
  });

  // Moves a row this campaign authored into the DM's personal compendium,
  // reusable across every campaign they run afterward — mirrors monsters'
  // promote-to-library route (routes/monsters.ts).
  campaignCatalogRouter.post(`/${entity.urlSegment}/:entryId/promote-to-library`, requireRole('dm'), async (req, res) => {
    const row = await catalogHomebrewService.promoteCatalogRowToLibrary(
      pool, req.campaignId!, req.user!.id, config, req.params.entryId as string,
    );
    res.json({ entry: row });
  });
}
