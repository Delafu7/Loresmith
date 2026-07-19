import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import * as dashboardService from '../services/dashboard.js';

// Mounted at /me — the logged-in user's aggregated home view. Nothing here
// takes a campaignId, unlike every other resource in this app: it's scoped
// entirely to req.user!.id.
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/dashboard', async (req, res) => {
  const dashboard = await dashboardService.getUserDashboard(pool, req.user!.id);
  res.json(dashboard);
});
