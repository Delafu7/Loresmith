import { z } from 'zod';

// Player-facing door interaction (services/doorActions.ts) — deliberately a
// separate, narrower schema from schemas/mapElements.ts's general-purpose
// updateMapElementSchema: a player may only ever request one of these three
// verbs, never an arbitrary props patch (that stays requireEncounterDm-only,
// routes/encounters.ts's PATCH /map/elements/:elementId).
export const performDoorActionSchema = z.object({
  action: z.enum(['open', 'close', 'force']),
});
export type PerformDoorActionInput = z.infer<typeof performDoorActionSchema>;
