// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — thin service layer for
// the stateless Travel Pace calculator. Its only job is to resolve the
// campaign's SRD edition and hand it to the pure calculator in
// domain/travelPace.ts; every rule branch lives there. Nothing is written.
// Any campaign member may call it (read-only, informational — same "any
// member may read" convention as listLocations / the condition-effects
// reports).

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { computeTravelPlan, type TravelPlan } from '../domain/travelPace.js';
import type { TravelPaceQuery } from '../schemas/travelPace.js';

export async function computeCampaignTravelPlan(pool: Pool, campaignId: string, query: TravelPaceQuery): Promise<TravelPlan> {
  const result = await pool.query<{ srd_edition: '2014' | '2024' }>(`SELECT srd_edition FROM campaigns WHERE id = $1`, [campaignId]);
  const edition = result.rows[0]?.srd_edition;
  if (!edition) throw notFound('Campaign');

  return computeTravelPlan({
    edition,
    pace: query.pace,
    hours: query.hours,
    terrain: query.terrain,
    mode: query.mode,
    vesselSpeedMilesPerHour: query.vesselSpeedMilesPerHour,
    hoursPerDay: query.hoursPerDay,
  });
}
