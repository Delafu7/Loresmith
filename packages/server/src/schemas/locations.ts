import { z } from 'zod';

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(20000).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

// DM-only hide/reveal toggle — a role_split boolean (services/visibility.ts),
// same shape as campaign_assets.visible_to_players, not part of
// createLocationSchema since a new location is always created hidden
// regardless of what's in the create request (see services/locations.ts).
export const updateLocationSchema = createLocationSchema.partial().extend({
  visibleToPlayers: z.boolean().optional(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
