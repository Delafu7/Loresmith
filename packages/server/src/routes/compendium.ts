// Mounted at /compendium — the personal, campaign-independent counterpart to
// routes/catalogHomebrew.ts's campaign-scoped write router. Same 13 tables
// (CATALOG_ENTITY_TABLES), same generic CRUD service
// (services/catalogHomebrew.ts), same schemas — the only difference is the
// CatalogOwnerScope passed through: { kind: 'user', userId } instead of
// { kind: 'campaign', campaignId, actorId }, so authorship here is scoped to
// the caller's account, not to a campaign, and requires nothing beyond
// requireAuth (no campaign membership/role check exists to make — a
// personal compendium entry is just the caller's own thing to create,
// same discipline as monsters' "library" libraryScope).
import { Router } from 'express';
import { z } from 'zod';
import { CATALOG_ENTITY_TABLES } from '../catalogEntityTables.js';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { createHomebrewSchemas, updateHomebrewSchemas } from '../schemas/catalogHomebrew.js';
import * as catalogHomebrewService from '../services/catalogHomebrew.js';
import type { CatalogTableConfig } from '../services/catalogHomebrew.js';

function toSnakeCaseColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[column] = value;
  }
  return out;
}

const assignToCampaignBody = z.object({ campaignId: z.string().uuid() });

export const compendiumRouter = Router();
compendiumRouter.use(requireAuth);

for (const entity of CATALOG_ENTITY_TABLES) {
  const config: CatalogTableConfig = { table: entity.table, keyColumn: entity.keyColumn, jsonbColumns: entity.jsonbColumns };

  compendiumRouter.post(`/${entity.urlSegment}`, async (req, res) => {
    const input = createHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const scope = { kind: 'user' as const, userId: req.user!.id };
    const row = await catalogHomebrewService.createHomebrewCatalogRow(pool, scope, config, toSnakeCaseColumns(input));
    res.status(201).json({ entry: row });
  });

  compendiumRouter.patch(`/${entity.urlSegment}/:entryId`, async (req, res) => {
    const input = updateHomebrewSchemas[entity.table].parse(req.body) as Record<string, unknown>;
    const scope = { kind: 'user' as const, userId: req.user!.id };
    const row = await catalogHomebrewService.updateHomebrewCatalogRow(
      pool, scope, config, req.params.entryId as string, toSnakeCaseColumns(input),
    );
    res.json({ entry: row });
  });

  compendiumRouter.delete(`/${entity.urlSegment}/:entryId`, async (req, res) => {
    const scope = { kind: 'user' as const, userId: req.user!.id };
    await catalogHomebrewService.deleteHomebrewCatalogRow(pool, scope, config, req.params.entryId as string);
    res.status(204).send();
  });

  // Duplicates ANY row (global, or homebrew from any campaign/user) into a
  // new homebrew row owned by the caller's personal compendium.
  compendiumRouter.post(`/${entity.urlSegment}/:entryId/duplicate`, async (req, res) => {
    const scope = { kind: 'user' as const, userId: req.user!.id };
    const row = await catalogHomebrewService.duplicateCatalogRow(pool, scope, config, req.params.entryId as string);
    res.status(201).json({ entry: row });
  });

  // Moves a row from the caller's personal compendium into a specific
  // campaign's homebrew — the caller must DM that campaign. Mirrors
  // monsters' assign-to-campaign route (routes/monsters.ts), generalized.
  compendiumRouter.post(`/${entity.urlSegment}/:entryId/assign-to-campaign`, async (req, res) => {
    const { campaignId } = assignToCampaignBody.parse(req.body);
    const row = await catalogHomebrewService.assignCatalogRowToCampaign(
      pool, campaignId, req.user!.id, config, req.params.entryId as string,
    );
    res.json({ entry: row });
  });
}
