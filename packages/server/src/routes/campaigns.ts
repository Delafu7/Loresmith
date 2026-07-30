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
import { createInvitationSchema } from '../schemas/campaignInvitations.js';
import * as campaignsService from '../services/campaigns.js';
import * as campaignInvitationsService from '../services/campaignInvitations.js';
import { rollAbilityScores } from '../services/abilityScoreRoll.js';
import { exportCampaign } from '../services/campaignExport.js';
import { importCampaign } from '../services/campaignImport.js';
import { campaignExportSchema } from '../schemas/campaignExport.js';

export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

// ---- Campaigns ----

campaignsRouter.post('/', async (req, res) => {
  const input = createCampaignSchema.parse(req.body);
  const campaign = await campaignsService.createCampaign(pool, req.user!.id, input);
  res.status(201).json({ campaign });
});

// Phase 4: JSON campaign import/export. Import always creates a brand-new
// campaign (never overwrites/merges) — see services/campaignImport.ts.
// Registered here, not under /:id, since there's no existing campaign yet.
campaignsRouter.post('/import', async (req, res) => {
  const data = campaignExportSchema.parse(req.body);
  const { campaignId } = await importCampaign(pool, req.user!.id, data);
  res.status(201).json({ campaignId });
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

// DM-only, same as every other catalog/roster write in this campaign — see
// services/campaignExport.ts for exactly what's included.
campaignsRouter.get('/:id/export', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const data = await exportCampaign(pool, req.campaignId!);
  res.json(data);
});

// Automated Ability Score Rolls (Phase 3.8). Any campaign member — not
// DM-only — since a player rolls their OWN character's scores; there's
// nothing to persist or authorize beyond "you're in this campaign" (see
// services/abilityScoreRoll.ts for why this never touches dice_rolls). The
// allow_ability_reroll toggle governs whether the frontend offers a second
// roll, not this endpoint — there's no in-progress-character row yet to
// attach a "has already rolled" flag to, so enforcement here would need new
// session-tracking state nobody asked for.
campaignsRouter.post('/:id/roll-ability-scores', requireCampaignMember(), async (_req, res) => {
  res.json({ sets: rollAbilityScores() });
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
  const member = await campaignsService.updateMember(pool, req.campaignId!, (req.params.userId as string), input);
  res.json({ member });
});

campaignsRouter.delete('/:id/members/:userId', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await campaignsService.removeMember(pool, req.campaignId!, (req.params.userId as string));
  res.status(204).send();
});

// ---- Invitations (pending/accepted; see addMember above for the older
// "invitee must already have an account, joins immediately" path this
// complements rather than replaces) ----

campaignsRouter.post('/:id/invitations', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = createInvitationSchema.parse(req.body);
  const invitation = await campaignInvitationsService.createInvitation(pool, req.campaignId!, req.user!.id, input);
  res.status(201).json({ invitation });
});

campaignsRouter.get('/:id/invitations', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const invitations = await campaignInvitationsService.listInvitationsForCampaign(pool, req.campaignId!);
  res.json({ invitations });
});

campaignsRouter.delete('/:id/invitations/:invitationId', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const invitation = await campaignInvitationsService.revokeInvitation(pool, req.campaignId!, (req.params.invitationId as string));
  res.json({ invitation });
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
  const session = await campaignsService.getSessionLog(pool, req.campaignId!, (req.params.sid as string));
  res.json({ session });
});

campaignsRouter.patch('/:id/sessions/:sid', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  const input = updateSessionLogSchema.parse(req.body);
  const session = await campaignsService.updateSessionLog(pool, req.campaignId!, (req.params.sid as string), input);
  res.json({ session });
});

campaignsRouter.delete('/:id/sessions/:sid', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await campaignsService.deleteSessionLog(pool, req.campaignId!, (req.params.sid as string));
  res.status(204).send();
});
