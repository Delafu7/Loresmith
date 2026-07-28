// Middleware for routes nested directly under /campaigns/:id/... — resolves
// :id, verifies campaign membership (layer 2), and stashes {campaignId,
// campaignRole} on the request for the role check (layer 3) and downstream
// handlers. Resource-id-keyed routes (e.g. /characters/:id) can't use this
// directly since the campaign_id has to be derived from the row first — see
// src/services/authz.ts, used inline by those services instead.

import type { NextFunction, Request, Response } from 'express';
import { pool } from '../db/pool.js';
import { AppError } from './errors.js';
import { isUuid } from '../domain/ids.js';
import { requireMembership, requireDm, type CampaignRole } from '../services/authz.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      campaignId?: string;
      campaignRole?: CampaignRole;
    }
  }
}

export function requireCampaignMember(paramName = 'id') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const campaignId = req.params[paramName]!;
    if (!isUuid(campaignId)) {
      throw new AppError('VALIDATION_ERROR', `Invalid campaign id`);
    }
    // req.user is guaranteed by requireAuth running first in the route chain.
    const role = await requireMembership(pool, campaignId, req.user!.id);
    req.campaignId = campaignId;
    req.campaignRole = role;
    next();
  };
}

export function requireRole(role: 'dm') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (role === 'dm') requireDm(req.campaignRole!);
    next();
  };
}
