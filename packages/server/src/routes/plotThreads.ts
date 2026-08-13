import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import { createPlotThreadSchema, setPlotThreadVisibilitySchema, updatePlotThreadSchema } from '../schemas/plotThreads.js';
import * as plotThreadsService from '../services/plotThreads.js';

// Mounted at /campaigns/:id/plot-threads
export const plotThreadsRouter = Router({ mergeParams: true });
plotThreadsRouter.use(requireAuth, requireCampaignMember());

plotThreadsRouter.get('/', async (req, res) => {
  const threads = await plotThreadsService.listPlotThreads(pool, req.campaignId!, req.user!.id, req.campaignRole!);
  res.json({ plotThreads: threads });
});

plotThreadsRouter.post('/', requireRole('dm'), async (req, res) => {
  const input = createPlotThreadSchema.parse(req.body);
  const thread = await plotThreadsService.createPlotThread(pool, req.campaignId!, req.campaignRole!, input);
  res.status(201).json({ plotThread: thread });
});

plotThreadsRouter.patch('/:threadId', requireRole('dm'), async (req, res) => {
  const input = updatePlotThreadSchema.parse(req.body);
  const thread = await plotThreadsService.updatePlotThread(
    pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!, input,
  );
  res.json({ plotThread: thread });
});

plotThreadsRouter.post('/:threadId/touch', requireRole('dm'), async (req, res) => {
  const thread = await plotThreadsService.touchPlotThread(pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!);
  res.json({ plotThread: thread });
});

plotThreadsRouter.delete('/:threadId', requireRole('dm'), async (req, res) => {
  await plotThreadsService.deletePlotThread(pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!);
  res.status(204).send();
});

plotThreadsRouter.put('/:threadId/visibility', requireRole('dm'), async (req, res) => {
  const input = setPlotThreadVisibilitySchema.parse(req.body);
  await plotThreadsService.setPlotThreadVisibility(pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!, input);
  res.status(204).send();
});

// GM-only visibility layer — one-click reveal/hide for the plot threads
// page's per-item buttons and multi-select bulk bar.
plotThreadsRouter.post('/:threadId/reveal-all', requireRole('dm'), async (req, res) => {
  await plotThreadsService.revealPlotThreadToAllPlayers(pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!);
  res.status(204).send();
});

plotThreadsRouter.post('/:threadId/hide-all', requireRole('dm'), async (req, res) => {
  await plotThreadsService.hidePlotThreadFromAllPlayers(pool, req.campaignId!, (req.params.threadId as string), req.campaignRole!);
  res.status(204).send();
});
