import { z } from 'zod';

// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — the query for the
// stateless Travel Pace calculator (GET /campaigns/:id/travel-pace). Every
// value is a query-string param, so the numeric/enum fields are coerced.
// The campaign supplies `srd_edition`; nothing here is persisted. See
// domain/travelPace.ts and docs/rules/travel-pace.md.
export const travelPaceQuerySchema = z
  .object({
    pace: z.enum(['fast', 'normal', 'slow']),
    hours: z.coerce.number().positive().max(240),
    terrain: z.enum(['normal', 'difficult']).optional(),
    mode: z.enum(['foot', 'mounted', 'land_vehicle', 'waterborne']).optional(),
    // Required when mode is 'waterborne' (a vessel moves at its own fixed
    // speed, not a chosen pace — SRD adventuring.md). Meaningless otherwise.
    vesselSpeedMilesPerHour: z.coerce.number().positive().max(1000).optional(),
    // The "assumes 8 hours in a day" baseline (SRD 5.1 adventuring.md L34) —
    // overridable so the forced-march threshold/DC isn't hardcoded to 8.
    hoursPerDay: z.coerce.number().int().min(1).max(24).optional(),
  })
  .refine((data) => data.mode !== 'waterborne' || data.vesselSpeedMilesPerHour !== undefined, {
    message: 'vesselSpeedMilesPerHour is required when mode is "waterborne"',
    path: ['vesselSpeedMilesPerHour'],
  });
export type TravelPaceQuery = z.infer<typeof travelPaceQuerySchema>;
