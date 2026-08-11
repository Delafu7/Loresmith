import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { requireCampaignMember } from '../middleware/campaign.js';
import {
  createBastionSchema, updateBastionSchema, addBastionFacilitySchema, spendBastionPointsSchema, resolveRequestForAidSchema,
} from '../schemas/bastions.js';
import { resolveBastionTurnSchema } from '../schemas/bastionTurns.js';
import * as bastionsService from '../services/bastions.js';
import * as bastionTurnsService from '../services/bastionTurns.js';

// Mounted at /campaigns/:id/bastions. Every write is gated ownership-or-DM
// inside the service (a Bastion belongs to one character, same as a
// character sheet) rather than requireRole('dm') here — see services/
// bastions.ts's header comment.
export const bastionsRouter = Router({ mergeParams: true });
bastionsRouter.use(requireAuth, requireCampaignMember());

bastionsRouter.get('/', async (req, res) => {
  const bastions = await bastionsService.listBastions(pool, req.campaignId!);
  res.json({ bastions });
});

bastionsRouter.get('/:bastionId', async (req, res) => {
  const bastion = await bastionsService.getBastionWithFacilities(pool, req.campaignId!, (req.params.bastionId as string));
  res.json({ bastion });
});

bastionsRouter.post('/', async (req, res) => {
  const input = createBastionSchema.parse(req.body);
  const bastion = await bastionsService.createBastion(pool, req.campaignId!, req.campaignRole!, req.user!.id, input);
  res.status(201).json({ bastion });
});

bastionsRouter.patch('/:bastionId', async (req, res) => {
  const input = updateBastionSchema.parse(req.body);
  const bastion = await bastionsService.updateBastion(
    pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id, input,
  );
  res.json({ bastion });
});

bastionsRouter.post('/:bastionId/abandon', async (req, res) => {
  const bastion = await bastionsService.abandonBastion(pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id);
  res.json({ bastion });
});

bastionsRouter.post('/:bastionId/facilities', async (req, res) => {
  const input = addBastionFacilitySchema.parse(req.body);
  const facility = await bastionsService.addFacility(
    pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id, input,
  );
  res.status(201).json({ facility });
});

bastionsRouter.delete('/:bastionId/facilities/:facilityId', async (req, res) => {
  await bastionsService.removeFacility(
    pool, req.campaignId!, (req.params.bastionId as string), (req.params.facilityId as string), req.campaignRole!, req.user!.id,
  );
  res.status(204).send();
});

bastionsRouter.get('/:bastionId/turns', async (req, res) => {
  const turns = await bastionTurnsService.listBastionTurns(pool, req.campaignId!, (req.params.bastionId as string));
  res.json({ turns });
});

bastionsRouter.post('/:bastionId/turns', async (req, res) => {
  const input = resolveBastionTurnSchema.parse(req.body);
  const turn = await bastionTurnsService.resolveBastionTurn(
    pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id, input,
  );
  res.status(201).json({ turn });
});

bastionsRouter.post('/:bastionId/turns/:turnId/resolve-request-for-aid', async (req, res) => {
  const input = resolveRequestForAidSchema.parse(req.body);
  const turn = await bastionTurnsService.resolveRequestForAid(
    pool, req.campaignId!, (req.params.bastionId as string), (req.params.turnId as string),
    req.campaignRole!, req.user!.id, input.defendersSent,
  );
  res.json({ turn });
});

bastionsRouter.post('/:bastionId/skip-turn', async (req, res) => {
  const bastion = await bastionsService.skipBastionTurn(pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id);
  res.json({ bastion });
});

bastionsRouter.post('/:bastionId/spend-bp', async (req, res) => {
  const input = spendBastionPointsSchema.parse(req.body);
  const bastion = await bastionsService.spendBastionPoints(
    pool, req.campaignId!, (req.params.bastionId as string), req.campaignRole!, req.user!.id, input,
  );
  res.json({ bastion });
});
