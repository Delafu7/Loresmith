// Mounted at /campaigns/:id/bestiary and /campaigns/:id/categories (Task 1).
// Structurally mirrors routes/monsters.ts's campaignMonstersRouter: both
// Router({ mergeParams: true }), requireAuth + requireCampaignMember() on
// the whole router, requireRole('dm') added per-route for writes.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { addToBestiarySchema, updateBestiaryEntrySchema, attachCategorySchema } from '../schemas/campaignBestiary.js';
import { listCategoriesQuerySchema } from '../schemas/campaignCategories.js';
import * as campaignBestiaryService from '../services/campaignBestiary.js';
import * as campaignCategoriesService from '../services/campaignCategories.js';
import { getIo, broadcastBestiaryUpdated } from '../sockets/broadcast.js';

export const campaignBestiaryRouter = Router({ mergeParams: true });
campaignBestiaryRouter.use(requireAuth, requireCampaignMember());

campaignBestiaryRouter.get('/', async (req, res) => {
  const entries = await campaignBestiaryService.listCampaignBestiary(pool, req.campaignId!, req.campaignRole!);
  res.json({ entries });
});

campaignBestiaryRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = addToBestiarySchema.parse(req.body);
  const result = await campaignBestiaryService.addToCampaignBestiary(pool, req.campaignId!, req.user!.id, input.monsterIds);
  broadcastBestiaryUpdated(getIo(req.app), req.campaignId!);
  res.status(201).json(result);
});

campaignBestiaryRouter.get('/:entryId', async (req, res) => {
  const entry = await campaignBestiaryService.getCampaignBestiaryEntry(pool, req.campaignId!, (req.params.entryId as string), req.campaignRole!);
  res.json({ entry });
});

campaignBestiaryRouter.patch('/:entryId', requireRole('dm'), async (req, res) => {
  const input = updateBestiaryEntrySchema.parse(req.body);
  const entry = await campaignBestiaryService.updateCampaignBestiaryEntry(pool, req.campaignId!, (req.params.entryId as string), input);
  broadcastBestiaryUpdated(getIo(req.app), req.campaignId!);
  res.json({ entry });
});

campaignBestiaryRouter.delete('/:entryId', requireRole('dm'), async (req, res) => {
  await campaignBestiaryService.removeCampaignBestiaryEntry(pool, req.campaignId!, (req.params.entryId as string));
  broadcastBestiaryUpdated(getIo(req.app), req.campaignId!);
  res.status(204).send();
});

campaignBestiaryRouter.post('/:entryId/categories', requireRole('dm'), async (req, res) => {
  const input = attachCategorySchema.parse(req.body);
  const entryId = req.params.entryId as string;
  // Confirms the entry actually belongs to this campaign before attaching —
  // reuses the get-one path (role is always 'dm' here, so it never trips the
  // discovered-only filter) rather than duplicating that lookup.
  await campaignBestiaryService.getCampaignBestiaryEntry(pool, req.campaignId!, entryId, 'dm');

  const categoryId = input.categoryId
    ? input.categoryId
    : (await campaignCategoriesService.findOrCreateCategory(
        pool, req.campaignId!, campaignBestiaryService.BESTIARY_ENTITY_TYPE, input.name!, input.color, input.icon,
      )).id;
  await campaignCategoriesService.attachCategory(pool, req.campaignId!, campaignBestiaryService.BESTIARY_ENTITY_TYPE, entryId, categoryId);

  broadcastBestiaryUpdated(getIo(req.app), req.campaignId!);
  const entry = await campaignBestiaryService.getCampaignBestiaryEntry(pool, req.campaignId!, entryId, 'dm');
  res.status(201).json({ entry });
});

campaignBestiaryRouter.delete('/:entryId/categories/:categoryId', requireRole('dm'), async (req, res) => {
  await campaignCategoriesService.detachCategory(pool, req.params.categoryId as string, req.params.entryId as string);
  broadcastBestiaryUpdated(getIo(req.app), req.campaignId!);
  res.status(204).send();
});

// Generic category listing — any entity type, not just creatures (Task 2/3/5
// will call this same route with a different entityType). Mounted at
// /campaigns/:id/categories, a sibling prefix to /campaigns/:id/bestiary.
export const campaignCategoriesRouter = Router({ mergeParams: true });
campaignCategoriesRouter.use(requireAuth, requireCampaignMember());

campaignCategoriesRouter.get('/', async (req, res) => {
  const query = listCategoriesQuerySchema.parse(req.query);
  const categories = await campaignCategoriesService.listCampaignCategories(pool, req.campaignId!, query.entityType);
  res.json({ categories });
});
