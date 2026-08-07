import { z } from 'zod';
import { diceRollTypeEnum } from './diceRolls.js';

// GM-initiated "please roll X" fan-out (Iteration 3 §2.3) — one/several/
// whole-party, resolved server-side by inserting one dice_roll_request_targets
// row per targetUserId. DM-only (services/diceRollRequests.ts).
export const createDiceRollRequestSchema = z.object({
  targetUserIds: z.array(z.string().uuid()).min(1).max(50),
  rollType: diceRollTypeEnum,
  rollContext: z.string().min(1).max(200).optional().nullable(),
  dc: z.number().int().min(1).max(40).optional(),
  encounterId: z.string().uuid().optional(),
});
export type CreateDiceRollRequestInput = z.infer<typeof createDiceRollRequestSchema>;

// A targeted player (or the DM on their behalf) explicitly declining to
// roll — the target row never silently disappears, matching the brief's
// "results collect in one place showing who's rolled/passed/failed."
export const passDiceRollRequestTargetSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type PassDiceRollRequestTargetInput = z.infer<typeof passDiceRollRequestTargetSchema>;
