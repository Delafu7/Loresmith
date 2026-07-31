// Mounted at /campaigns/:id/item-stash — the campaign-owned item repository
// (nav point 5). Any campaign member can browse the stash (matches the
// layered authz model's "players can read everything in their campaigns");
// only the DM can import/edit/remove/give-away, same DM-only-for-campaign-
// resources rule as monster instances and NPCs.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import {
  giveStashItemToCharacterSchema,
  importCampaignStashItemSchema,
  updateCampaignStashItemSchema,
} from '../schemas/campaignItems.js';
import * as campaignItemsService from '../services/campaignItems.js';

export const campaignItemStashRouter = Router({ mergeParams: true });
campaignItemStashRouter.use(requireAuth, requireCampaignMember());

campaignItemStashRouter.get('/', async (req, res) => {
  const items = await campaignItemsService.listCampaignStashItems(pool, req.campaignId!);
  res.json({ items });
});

campaignItemStashRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = importCampaignStashItemSchema.parse(req.body);
  const item = await campaignItemsService.importCampaignStashItem(pool, req.campaignId!, input);
  res.status(201).json({ item });
});

campaignItemStashRouter.patch('/:itemId', requireRole('dm'), async (req, res) => {
  const input = updateCampaignStashItemSchema.parse(req.body);
  const item = await campaignItemsService.updateCampaignStashItem(pool, req.campaignId!, (req.params.itemId as string), input);
  res.json({ item });
});

campaignItemStashRouter.delete('/:itemId', requireRole('dm'), async (req, res) => {
  await campaignItemsService.removeCampaignStashItem(pool, req.campaignId!, (req.params.itemId as string));
  res.status(204).send();
});

campaignItemStashRouter.post('/:itemId/give', requireRole('dm'), async (req, res) => {
  const input = giveStashItemToCharacterSchema.parse(req.body);
  const item = await campaignItemsService.giveCampaignStashItemToCharacter(
    pool, req.campaignId!, (req.params.itemId as string), input.characterId,
  );
  res.json({ item });
});
