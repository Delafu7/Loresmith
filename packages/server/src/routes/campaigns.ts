import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember, requireRole } from '../middleware/campaign.js';
import {
  addMemberSchema,
  createCampaignSchema,
  createSessionLogSchema,
  updateCampaignSchema,
  updateMemberSchema,
  updateSessionLogSchema,
} from '../schemas/campaigns.js';
import * as campaignsService from '../services/campaigns.js';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

// ---- Campaigns ----

campaignsRouter.post('/', async (req, res) => {
  const input = createCampaignSchema.parse(req.body);
  const campaign = await campaignsService.createCampaign(pool, req.user!.id, input);
  res.status(201).json({ campaign });
});

campaignsRouter.get('/', async (req, res) => {
  const campaigns = await campaignsService.listCampaignsForUser(pool, req.user!.id);
  res.json({ campaigns });
});

campaignsRouter.get('/:id', requireCampaignMember(), async (req, res) => {
  const campaign = await campaignsService.getCampaign(pool, req.campaignId!);
  res.json({ campaign, myRole: req.campaignRole });
});

campaignsRouter.patch('/:id', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = updateCampaignSchema.parse(req.body);
  const campaign = await campaignsService.updateCampaign(pool, req.campaignId!, input);
  res.json({ campaign });
});

campaignsRouter.delete('/:id', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await campaignsService.deleteCampaign(pool, req.campaignId!);
  res.status(204).send();
});

// ---- Members ----

campaignsRouter.post('/:id/members', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = addMemberSchema.parse(req.body);
  const member = await campaignsService.addMember(pool, req.campaignId!, input);
  res.status(201).json({ member });
});

campaignsRouter.get('/:id/members', requireCampaignMember(), async (req, res) => {
  const members = await campaignsService.listMembers(pool, req.campaignId!);
  res.json({ members });
});

campaignsRouter.patch('/:id/members/:userId', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = updateMemberSchema.parse(req.body);
  const member = await campaignsService.updateMember(pool, req.campaignId!, Number(req.params.userId), input);
  res.json({ member });
});

campaignsRouter.delete('/:id/members/:userId', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await campaignsService.removeMember(pool, req.campaignId!, Number(req.params.userId));
  res.status(204).send();
});

// ---- Session log (game-night log; NOT the HTTP auth session) ----

campaignsRouter.post('/:id/sessions', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = createSessionLogSchema.parse(req.body);
  const session = await campaignsService.createSessionLog(pool, req.campaignId!, input);
  res.status(201).json({ session });
});

campaignsRouter.get('/:id/sessions', requireCampaignMember(), async (req, res) => {
  const sessions = await campaignsService.listSessionLogs(pool, req.campaignId!);
  res.json({ sessions });
});

campaignsRouter.get('/:id/sessions/:sid', requireCampaignMember(), async (req, res) => {
  const session = await campaignsService.getSessionLog(pool, req.campaignId!, Number(req.params.sid));
  res.json({ session });
});

campaignsRouter.patch('/:id/sessions/:sid', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = updateSessionLogSchema.parse(req.body);
  const session = await campaignsService.updateSessionLog(pool, req.campaignId!, Number(req.params.sid), input);
  res.json({ session });
});

campaignsRouter.delete('/:id/sessions/:sid', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await campaignsService.deleteSessionLog(pool, req.campaignId!, Number(req.params.sid));
  res.status(204).send();
});
