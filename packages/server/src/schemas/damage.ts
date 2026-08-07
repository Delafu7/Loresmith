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
  // Security major M3 fix: this field is no longer trusted. It used to
  // drive dice-count doubling directly (docs/rules/attacks-and-damage.md
  // §1.2/§2.2), which let any authorized caller request double damage dice
  // regardless of what was actually rolled — undermining the "RNG lives
  // here and only here" invariant. Left in the schema (default false,
  // silently ignored) only so an old client payload that still sends it
  // doesn't fail validation; services/characters.ts's applyDamage and
  // services/monsters.ts's applyMonsterInstanceDamage now derive
  // criticality themselves from attackRollId below.
  isCritical: z.boolean().default(false),
  // The dice_rolls row id of the attack roll (POST .../dice-rolls) this
  // damage application follows from, if any — the server looks up that
  // row's actual d20_rolls/keep and re-derives whether it was a critical
  // hit (kept die === 20), rather than trusting a client-asserted boolean.
  // Omitted entirely for damage with no backing attack roll (a DM's manual
  // correction, an environmental/save-based effect) — those can never be
  // critical, matching docs/rules/attacks-and-damage.md §1.6 ("save-based
  // effects never crit").
  attackRollId: z.string().uuid().optional(),
  rollContext: z.string().min(1).max(200).optional().nullable(),
  encounterId: z.string().uuid().optional(),
});
export type ApplyDamageInput = z.infer<typeof applyDamageSchema>;
