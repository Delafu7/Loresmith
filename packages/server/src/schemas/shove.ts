import { z } from 'zod';

// Shove Check Against a Specific NPC — see services/shove.ts for the full
// contested-roll implementation. Deliberately scoped to PC-attacker/
// NPC-defender only (matches the feature's own framing); the request never
// carries a modifier for either side because both are computed server-side
// from the same catalog/campaign-instance data services/shove.ts already
// has to load anyway for the size check.
export const performShoveSchema = z.object({
  targetParticipantId: z.number().int().positive(),
  desiredEffect: z.enum(['push_5ft', 'knock_prone']),
  defenderSkill: z.enum(['athletics', 'acrobatics']),
  // DM adjudication escape hatch (PLAN.md's hp_max_override/
  // armor_class_override precedent) — overrides the DEFENDER'S FINAL TOTAL
  // directly, skipping the server roll for that side entirely. Not a d20
  // override: a DM saying "the goblin rolled a 14" is simpler to reason
  // about than reconstructing a die+modifier that produces the same total.
  defenderRollOverride: z.number().int().optional(),
});
export type PerformShoveInput = z.infer<typeof performShoveSchema>;
