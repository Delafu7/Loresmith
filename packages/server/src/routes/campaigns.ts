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
import * as entityFieldRevealService from '../services/entityFieldReveal.js';
import { rollAbilityScores } from '../services/abilityScoreRoll.js';
import { getIo, broadcastFullStateResync } from '../sockets/broadcast.js';

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

// ---- Reveal engine panic button (PLAN.md §11.5) ----
//
// Cross-cutting by design (see hideAllForCampaign's own comment) — a single
// per-field REVEAL_CHANGED per affected entity would be a lot of noise for
// what's meant to be an instant, all-at-once "get me out of trouble" action,
// so this pushes a fresh FULL_STATE_SYNC to every non-completed encounter's
// room instead, same as resetRevealsForEncounter below.
campaignsRouter.post('/:id/reveals/hide-all', requireCampaignMember(), requireRole('dm'), async (req, res) => {
  await entityFieldRevealService.hideAllForCampaign(pool, req.user!.id, req.campaignId!);

  const encountersRes = await pool.query<{ id: number }>(
    `SELECT id FROM encounters WHERE campaign_id = $1 AND status != 'completed'`,
    [req.campaignId],
  );
  const io = getIo(req.app);
  for (const row of encountersRes.rows) {
    await broadcastFullStateResync(io, row.id, req.campaignId!);
  }
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
