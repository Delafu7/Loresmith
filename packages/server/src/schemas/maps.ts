import { z } from 'zod';

// Campaign-scoped map library (1784269788666_create-campaign-maps-library.ts).
// Grid/background bounds mirror upsertEncounterMapSchema in schemas/encounters.ts
// (the pre-existing inline "reconfigure this encounter's map" form) so both
// paths accept the same values for the same fields.
export const createMapSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  backgroundAssetId: z.string().uuid().nullable().optional(),
  gridColumns: z.number().int().min(5).max(50).optional(),
  gridRows: z.number().int().min(5).max(50).optional(),
  cellSizePx: z.number().int().min(10).max(200).optional(),
  feetPerCell: z.number().int().min(1).max(50).optional(),
  notes: z.string().max(5000).nullable().optional(),
  // Per-map lighting state (nav point 4) — library-level default, distinct
  // from the live encounter's PATCH .../map/lighting toggle (schemas/
  // encounters.ts's setMapLightingSchema); editing it here doesn't
  // broadcast (this route never has, for any field — an existing,
  // unrelated gap, not something this task needs to fix).
  lightingState: z.enum(['bright', 'dim', 'dark']).optional(),
});
export type CreateMapInput = z.infer<typeof createMapSchema>;

export const updateMapSchema = createMapSchema.partial();
export type UpdateMapInput = z.infer<typeof updateMapSchema>;

export const setActiveMapSchema = z.object({
  mapId: z.string().uuid(),
});
export type SetActiveMapInput = z.infer<typeof setActiveMapSchema>;
