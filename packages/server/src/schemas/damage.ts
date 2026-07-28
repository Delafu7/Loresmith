import { z } from 'zod';
import { diceSidesEnum } from './diceRolls.js';

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.3. Structured
// dice fields (diceSides/diceCount/modifier), not a free-form expression
// string — mirrors createDiceRollSchema's existing convention exactly
// (client-side parsing of "NdM+K" already happens for the quick-roll UI;
// the server never parses expression strings).
export const applyDamageSchema = z.object({
  diceSides: diceSidesEnum,
  diceCount: z.number().int().min(1).max(20),
  modifier: z.number().int().default(0),
  // null/omitted = untyped damage, never resisted/vulnerable/immune.
  damageType: z.string().max(50).optional().nullable(),
  // Doubles diceCount server-side before rolling (docs/rules/
  // attacks-and-damage.md §1.2/§2.2 — dice doubling is a rolling-time
  // concern, not a post-roll multiplier).
  isCritical: z.boolean().default(false),
  rollContext: z.string().min(1).max(200).optional().nullable(),
  encounterId: z.string().uuid().optional(),
});
export type ApplyDamageInput = z.infer<typeof applyDamageSchema>;
