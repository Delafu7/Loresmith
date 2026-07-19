import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { editionQuerySchema, spellQuerySchema, itemQuerySchema, effectDefinitionQuerySchema } from '../schemas/catalog.js';
import * as catalogService from '../services/catalog.js';
import { requireMembership } from '../services/authz.js';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get('/ability-scores', async (_req, res) => {
  res.json({ abilityScores: await catalogService.listAbilityScores(pool) });
});

catalogRouter.get('/skills', async (_req, res) => {
  res.json({ skills: await catalogService.listSkills(pool) });
});

catalogRouter.get('/languages', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ languages: await catalogService.listLanguages(pool, query) });
});

catalogRouter.get('/alignments', async (_req, res) => {
  res.json({ alignments: await catalogService.listAlignments(pool) });
});

catalogRouter.get('/damage-types', async (_req, res) => {
  res.json({ damageTypes: await catalogService.listDamageTypes(pool) });
});

catalogRouter.get('/races', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ races: await catalogService.listRaces(pool, query) });
});

catalogRouter.get('/subraces', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ subraces: await catalogService.listSubraces(pool, query) });
});

catalogRouter.get('/classes', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ classes: await catalogService.listClasses(pool, query) });
});

catalogRouter.get('/subclasses', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
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
  res.json({ backgrounds: await catalogService.listBackgrounds(pool, query) });
});

catalogRouter.get('/feats', async (req, res) => {
  const query = editionQuerySchema.parse(req.query);
  res.json({ feats: await catalogService.listFeats(pool, query) });
});

// Added for Phase 2 (spell/item libraries, effect picker) — see
// services/catalog.ts's listSpells/listItems/listEffectDefinitions.
catalogRouter.get('/spells', async (req, res) => {
  const query = spellQuerySchema.parse(req.query);
  res.json({ spells: await catalogService.listSpells(pool, query) });
});

catalogRouter.get('/items', async (req, res) => {
  const query = itemQuerySchema.parse(req.query);
  res.json({ items: await catalogService.listItems(pool, query) });
});

catalogRouter.get('/effect-definitions', async (req, res) => {
  const query = effectDefinitionQuerySchema.parse(req.query);
  // effect_definitions rows are either global (owning_campaign_id IS NULL)
  // or homebrew scoped to one campaign — campaignId is an optional filter,
  // but supplying one requests THAT campaign's homebrew rows too, so it
  // must be gated by membership just like every other campaign-scoped read
  // in this codebase (pre-merge review finding: this was the one catalog
  // route that added a campaignId filter without the auth check it implies).
  if (query.campaignId !== undefined) {
    await requireMembership(pool, query.campaignId, req.user!.id);
  }
  res.json({ effectDefinitions: await catalogService.listEffectDefinitions(pool, query) });
});
