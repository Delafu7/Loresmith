import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import * as dashboardService from '../services/dashboard.js';
import * as campaignInvitationsService from '../services/campaignInvitations.js';

// Mounted at /me — the logged-in user's aggregated home view. Nothing here
// takes a campaignId, unlike every other resource in this app: it's scoped
// entirely to req.user!.id.
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/dashboard', async (req, res) => {
  const dashboard = await dashboardService.getUserDashboard(pool, req.user!.id);
  res.json(dashboard);
});

// Pending campaign invitations addressed to this user's own email — no
// campaign membership is possible yet, that's the whole point, so this is
// requireAuth-only same as /dashboard above.
dashboardRouter.get('/invitations', async (req, res) => {
  const invitations = await campaignInvitationsService.listInvitationsForUser(pool, req.user!.email);
  res.json({ invitations });
});

dashboardRouter.post('/invitations/:invitationId/accept', async (req, res) => {
  const result = await campaignInvitationsService.acceptInvitation(
    pool, (req.params.invitationId as string), req.user!.id, req.user!.email,
  );
  res.json(result);
});
