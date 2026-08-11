import { z } from 'zod';

export const createBastionSchema = z.object({
  ownerCharacterId: z.string().min(1),
  name: z.string().max(200).optional().nullable(),
});
export type CreateBastionInput = z.infer<typeof createBastionSchema>;

export const updateBastionSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  // DM-adjustable Bastion turn cadence (docs/rules/bastions.md §5) — not a
  // player-editable field, enforced in the service (requireDm), not here.
  turnIntervalDays: z.number().int().positive().optional(),
  // "Bastion Defenders are a plain headcount... all a player needs to track
  // is the number" (§6) — DM-only direct adjustment, for cases this app
  // doesn't mechanically resolve on its own (Barracks' Recruit order,
  // Menagerie creatures, War Room Soldiers — none of those specific
  // per-facility order outcomes are modeled, see services/bastions.ts's
  // header comment). Enforced as requireDm in the service, not here.
  bastionDefenders: z.number().int().min(0).optional(),
});
export type UpdateBastionInput = z.infer<typeof updateBastionSchema>;

export const spendBastionPointsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('magic_item'), rarity: z.enum(['common', 'uncommon', 'rare', 'very_rare', 'legendary']) }),
  z.object({ kind: z.literal('charisma_boost') }),
  z.object({ kind: z.literal('resurrection') }),
]);
export type SpendBastionPointsInput = z.infer<typeof spendBastionPointsSchema>;

export const resolveRequestForAidSchema = z.object({
  defendersSent: z.number().int().min(0),
});
export type ResolveRequestForAidInput = z.infer<typeof resolveRequestForAidSchema>;

export const addBastionFacilitySchema = z.object({
  catalogId: z.string().min(1),
  // Only meaningful for basic facilities (player picks any size); a special
  // facility's space always comes from the catalog's own default_space —
  // rejected server-side if supplied for a special facility instead of
  // silently ignored, since a client passing it for a special facility
  // signals a real misunderstanding of the rule worth surfacing as an error.
  space: z.enum(['cramped', 'roomy', 'vast']).optional(),
});
export type AddBastionFacilityInput = z.infer<typeof addBastionFacilitySchema>;
