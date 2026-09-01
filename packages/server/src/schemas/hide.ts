import { z } from 'zod';

// Hide Action (docs/roadmap/dnd-2024-gap-analysis.md P1-13, rulesGlossary.md
// "Hide [Action]", line 954-960) — see services/hide.ts for the full
// implementation. No body fields needed: the DC is fixed (15, per the SRD
// text, not DM/build-editable like character_attacks.saveDc), there's no
// opposed side to override (unlike shove.ts/grapple.ts's defenderRollOverride
// — the only roll here is the actor's OWN Stealth check, which the "RNG
// lives here and only here" invariant never lets a client override), and the
// preconditions (Heavily Obscured / Cover / out of every enemy's line of
// sight) are the DM's own call per the rule text itself ("The Dungeon Master
// decides when circumstances are appropriate for hiding") — not something
// this endpoint gates on, matching Cover's (P1-10) own "track state, don't
// enforce" precedent.
export const performHideSchema = z.object({});
export type PerformHideInput = z.infer<typeof performHideSchema>;
