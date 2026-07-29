import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import {
  editionQuerySchema,
  spellQuerySchema,
  itemQuerySchema,
  effectDefinitionQuerySchema,
  campaignScopedQuerySchema,
  editionOnlyQuerySchema,
} from '../schemas/catalog.js';
import * as catalogService from '../services/catalog.js';
import { requireMembership } from '../services/authz.js';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

// Every list route below that accepts a campaignId query param unions in
// that campaign's own homebrew rows alongside the global catalog — any
// campaignId-scoped read MUST be gated behind requireMembership, never
// trusted from the query param alone (pre-merge review finding, originally
// caught on effect-definitions, now applies uniformly).
async function requireMembershipIfCampaignScoped(campaignId: string | undefined, userId: string): Promise<void> {
  if (campaignId !== undefined) await requireMembership(pool, campaignId, userId);
}

catalogRouter.get('/ability-scores', async (_req, res) => {
  res.json({ abilityScores: await catalogService.listAbilityScores(pool) });
});

catalogRouter.get('/skills', async (_req, res) => {
  res.json({ skills: await catalogService.listSkills(pool) });
});

// Phase 2 selector work — see services/catalog.ts's listMagicSchools/listConditions.
catalogRouter.get('/magic-schools', async (_req, res) => {
  res.json({ magicSchools: await catalogService.listMagicSchools(pool) });
});

catalogRouter.get('/conditions', async (req, res) => {
  const query = editionOnlyQuerySchema.parse(req.query);
  res.json({ conditions: await catalogService.listConditions(pool, query) });
});

catalogRouter.get('/languages', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ languages: await catalogService.listLanguages(pool, query) });
});

catalogRouter.get('/alignments', async (req, res) => {
  const query = campaignScopedQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ alignments: await catalogService.listAlignments(pool, query) });
});

catalogRouter.get('/damage-types', async (req, res) => {
  const query = campaignScopedQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ damageTypes: await catalogService.listDamageTypes(pool, query) });
});

catalogRouter.get('/races', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ races: await catalogService.listRaces(pool, query) });
});

catalogRouter.get('/subraces', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ subraces: await catalogService.listSubraces(pool, query) });
});

catalogRouter.get('/classes', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ classes: await catalogService.listClasses(pool, query) });
});

catalogRouter.get('/subclasses', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ subclasses: await catalogService.listSubclasses(pool, query) });
});

catalogRouter.get('/class-levels', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ classLevels: await catalogService.listClassLevels(pool, query) });
});

catalogRouter.get('/class-features', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ classFeatures: await catalogService.listClassFeatures(pool, query) });
});

catalogRouter.get('/backgrounds', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ backgrounds: await catalogService.listBackgrounds(pool, query) });
});

catalogRouter.get('/feats', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ feats: await catalogService.listFeats(pool, query) });
});

// Added for Phase 2 (spell/item libraries, effect picker) — see
// services/catalog.ts's listSpells/listItems/listEffectDefinitions.
catalogRouter.get('/spells', async (req, res) => {
  const query = spellQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ spells: await catalogService.listSpells(pool, query) });
});

catalogRouter.get('/items', async (req, res) => {
  const query = itemQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ items: await catalogService.listItems(pool, query) });
});

catalogRouter.get('/effect-definitions', async (req, res) => {
  const query = effectDefinitionQuerySchema.parse(req.query);
  await requireMembershipIfCampaignScoped(query.campaignId, req.user!.id);
  res.json({ effectDefinitions: await catalogService.listEffectDefinitions(pool, query) });
});
