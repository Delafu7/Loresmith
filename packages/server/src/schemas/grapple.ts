import { z } from 'zod';

// Grapple Check Against a Specific NPC — mirrors schemas/shove.ts exactly
// (see services/grapple.ts for the contested-roll implementation and
// docs/rules/actions.md's Grapple section for the 2014-confirmed mechanic
// this encodes). Deliberately scoped to PC-attacker/NPC-defender only, same
// framing as Shove — no desiredEffect field, since a successful Grapple has
// exactly one outcome (the target becomes Grappled), not a DM-chosen push/
// prone branch.
export const performGrappleSchema = z.object({
  targetParticipantId: z.string().uuid(),
  defenderSkill: z.enum(['athletics', 'acrobatics']),
  defenderRollOverride: z.number().int().optional(),
});
export type PerformGrappleInput = z.infer<typeof performGrappleSchema>;
