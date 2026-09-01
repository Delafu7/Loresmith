import { z } from 'zod';

// Falling (docs/roadmap/dnd-2024-gap-analysis.md P3-1, ER-06;
// rulesGlossary.md "Falling [Hazard]", line 858-862) — see
// services/fallDamage.ts for the full implementation. distanceFt is the
// DM/player-supplied feet fallen (either read off the pitTriggered.depthFt a
// move just reported, or entered directly for any other fall source this
// app doesn't auto-detect — a shove off a ledge, a failed climb check) —
// this app has no physics simulation to derive it from automatically, same
// "DM supplies the number, the server does the math" precedent as
// character_attacks.saveDc. savingThrowRollId/saveDc/halfOnSave mirror
// applyDamageSchema's own P1-12 fields exactly: the optional "fall into
// water" reaction check (rulesGlossary.md line 862) that halves damage on a
// success, re-derived from the actual stored dice_rolls row, never a
// client-asserted boolean.
export const performFallSchema = z
  .object({
    distanceFt: z.number().int().min(0).max(1000),
    saveDc: z.number().int().min(1).max(30).optional(),
    savingThrowRollId: z.string().uuid().optional(),
    halfOnSave: z.boolean().optional(),
  })
  .refine((data) => !data.savingThrowRollId || data.saveDc !== undefined, {
    message: 'saveDc is required when savingThrowRollId is provided',
    path: ['saveDc'],
  });
export type PerformFallInput = z.infer<typeof performFallSchema>;
