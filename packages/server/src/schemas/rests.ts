import { z } from 'zod';

export const restSchema = z.object({
  restType: z.enum(['short', 'long']),
  characterIds: z.array(z.string().uuid()).min(1),
});
export type RestInput = z.infer<typeof restSchema>;

// docs/roadmap/dnd-2024-gap-analysis.md P2-5 (ER-04) — rulesGlossary.md's own
// 4 interruption sources (Long Rest line 1143, Short Rest line 1405), kept
// in sync with the migration's identical CHECK constraint on
// rest_event_characters.interruption_reason. 'initiative'/'damage' are
// auto-detected (services/encounters.ts/services/characters.ts); 'spell'/
// 'exertion' can only ever be reported by the DM via interruptRestSchema
// below — see services/rests.ts's own header comment on why (no in-game
// clock, no "was this spell a cantrip" signal threaded through casting).
export const restInterruptionReasonEnum = z.enum(['initiative', 'damage', 'spell', 'exertion']);
export type RestInterruptionReason = z.infer<typeof restInterruptionReasonEnum>;

export const interruptRestSchema = z.object({
  characterId: z.string().uuid(),
  reason: restInterruptionReasonEnum,
});
export type InterruptRestInput = z.infer<typeof interruptRestSchema>;

// elapsedMinutes: how long the rest had been going before the interruption
// — DM-supplied since this app has no in-game clock to derive it from (see
// services/rests.ts's header comment on the interruptible-rest flow).
// rulesGlossary.md line 1150's threshold is exactly 1 hour = 60 minutes.
export const completeRestSchema = z.object({
  elapsedMinutes: z.number().int().min(0),
});
export type CompleteRestInput = z.infer<typeof completeRestSchema>;
