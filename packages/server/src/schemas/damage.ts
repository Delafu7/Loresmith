import { z } from 'zod';
import { diceSidesEnum } from './diceRolls.js';

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.3. Structured
// dice fields (diceSides/diceCount/modifier), not a free-form expression
// string — mirrors createDiceRollSchema's existing convention exactly
// (client-side parsing of "NdM+K" already happens for the quick-roll UI;
// the server never parses expression strings).
export const applyDamageSchema = z.object({
  diceSides: diceSidesEnum,
  // min(0), not min(1): docs/roadmap/dnd-2024-gap-analysis.md P1-6's Graze
  // mastery property deals flat ability-modifier damage on a MISS, no dice
  // at all — computeAppliedDamage (services/damage.ts) already handles a
  // 0-length rolled-dice array correctly (rawTotal falls through to just
  // `modifier`), so this endpoint doubles as Graze's damage-application
  // path with diceCount: 0 rather than needing a second damage function.
  diceCount: z.number().int().min(0).max(20),
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
  // Phase 1 "players attack from their own UI" — the attacking combat_participants
  // id, required for a non-DM caller so the server can verify they control that
  // participant and that it's currently their turn (services/monsters.ts's
  // applyMonsterInstanceDamage). Omitted for DM-applied damage, which keeps its
  // original unconditional path.
  attackerParticipantId: z.string().uuid().optional(),
  // docs/roadmap/dnd-2024-gap-analysis.md P1-12 — wiring up
  // character_attacks.half_on_save. saveDc mirrors that column's existing
  // convention (services/diceEngine.ts's computeSaveDc comment: always a
  // manually-entered flat integer, trusted the same way diceType/damageType
  // already are). savingThrowRollId is the TARGET's saving_throw dice_rolls
  // row id — the server re-derives success/failure from that row's own
  // stored result_total (never a client-asserted succeeded/failed boolean),
  // mirroring attackRollId/isCritical's existing "never trust the client's
  // interpretation of a roll it didn't make" pattern (docs/rules/
  // attacks-and-damage.md §3 edge case 6). Omitted entirely for damage with
  // no backing save (a plain attack-roll hit, a DM's manual correction).
  saveDc: z.number().int().min(1).max(30).optional(),
  savingThrowRollId: z.string().uuid().optional(),
  // Mirrors character_attacks.half_on_save's own default (true) — kept
  // optional rather than defaulted here so existing callers that never send
  // a save at all don't need to start sending it; computeAppliedDamage
  // (services/damage.ts) already treats undefined the same as true. Only
  // meaningful alongside saveDc/savingThrowRollId.
  halfOnSave: z.boolean().optional(),
})
  .refine((data) => !data.attackerParticipantId || data.encounterId, {
    message: 'encounterId is required when attackerParticipantId is provided',
    path: ['encounterId'],
  })
  .refine((data) => !data.savingThrowRollId || data.saveDc !== undefined, {
    message: 'saveDc is required when savingThrowRollId is provided',
    path: ['saveDc'],
  });
export type ApplyDamageInput = z.infer<typeof applyDamageSchema>;
