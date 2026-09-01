// docs/roadmap/dnd-2024-gap-analysis.md P2-6 (ER-09) — Lightly/Heavily
// Obscured modeled distinctly, plus Blindsight/Tremorsense/Truesight as
// senses. Explicitly advisory-only, confirmed with the user first: pure
// functions, no DB, and — critically — this module is NOT wired into
// domain/vision.ts's computeVisibleParticipantIds, which that file's own
// header comment calls "the actual security boundary" deciding what a
// player's SOCKET receives. Touching that reveal-engine gate to account for
// 3 more senses was assessed as real information-leak/broken-fog-of-war
// risk for a security-sensitive path, disproportionate to this roadmap
// item's own scope; this module is a separate, informational "what would a
// viewer with these senses perceive" report a route can expose for a
// player/DM to read, same "compute-and-suggest, never enforce the core
// pipeline" precedent as P2-2's conditionEffects.ts.
//
// Every constant/branch below is sourced directly from its own
// rulesGlossary.md entry — see the citation on each one.

export type LightLevel = 'bright' | 'dim' | 'dark'; // matches maps.lighting_state exactly
export type ObscurementLevel = 'none' | 'lightly' | 'heavily';

// rulesGlossary.md: Bright Light (line 425-427, "normal illumination", no
// obscurement), Dim Light -> Lightly Obscured (line 780-782), Darkness ->
// Heavily Obscured (line 700-702).
export function obscurementFromLightLevel(lightLevel: LightLevel): ObscurementLevel {
  if (lightLevel === 'dark') return 'heavily';
  if (lightLevel === 'dim') return 'lightly';
  return 'none';
}

export interface PerceptionConsequence {
  /** Lightly Obscured — rulesGlossary.md line 1105: "Disadvantage on Wisdom
   * (Perception) checks to see something in a Lightly Obscured space." */
  perceptionCheckDisadvantage: boolean;
  /** Heavily Obscured — rulesGlossary.md line 932: "You have the Blinded
   * condition while trying to see something in a Heavily Obscured space."
   * Scoped to THIS target specifically (per that line's own "while trying to
   * see something" framing), not a blanket Blinded condition affecting every
   * other roll the viewer makes — mirrors Blinded's own "automatically fail
   * any ability check that requires sight" text (rulesGlossary.md line 364)
   * for sight-based checks aimed at this target. */
  effectivelyBlindedForThisTarget: boolean;
}

export function perceptionConsequenceOf(obscurement: ObscurementLevel): PerceptionConsequence {
  return {
    perceptionCheckDisadvantage: obscurement === 'lightly',
    effectivelyBlindedForThisTarget: obscurement === 'heavily',
  };
}

export interface ViewerSenses {
  darkvisionRadiusFt: number;
  blindsightRadiusFt: number;
  truesightRadiusFt: number;
}

export type SightSource = 'normal' | 'darkvision' | 'blindsight' | 'truesight';

export interface SightResult {
  obscurement: ObscurementLevel;
  perceivesInvisible: boolean;
  /** Which sense produced this (best-available) result — 'normal' means none
   * of the viewer's special senses changed anything (either none are in
   * range, or the base obscurement was already 'none'). */
  source: SightSource;
}

// rulesGlossary.md: Darkvision (line 708) — "you can see in Dim Light within
// a specified range as if it were Bright Light, and in Darkness within that
// range as if it were Dim Light" — a ONE-STEP downgrade (heavily->lightly,
// lightly->none), not a full negation; grants no Invisible-piercing.
function downgradeOneStep(obscurement: ObscurementLevel): ObscurementLevel {
  if (obscurement === 'heavily') return 'lightly';
  if (obscurement === 'lightly') return 'none';
  return 'none';
}

/**
 * Best-available sight result for `distanceFt` between a viewer and a
 * target, given the base obscurement from the map's current light level and
 * the viewer's darkvision/blindsight/truesight radii.
 *
 * rulesGlossary.md: Blindsight (line 372) — "you can see... anything that
 * isn't behind Total Cover even if you have the Blinded condition or are in
 * Darkness... you can see something [Invisible]" — a FULL negation to 'none'
 * obscurement within range (this app already tracks per-participant Total
 * Cover — P1-10 — so `targetHasTotalCover` blocks blindsight the same way
 * the rule names it explicitly, unlike the other senses which have no such
 * exception). Truesight (line 1617) — "your vision pierces... Darkness...
 * Invisibility..." within range — the same full-negation-plus-invisible
 * result as blindsight, via ordinary sight rather than "without relying on
 * physical sight," so it has no Total Cover exception of its own.
 *
 * Deliberately does NOT check line-of-sight/walls itself — that's
 * domain/vision.ts's job (the untouched security boundary); this function
 * only answers the light-level/special-sense question, assuming the caller
 * has already established the viewer can trace a line to the target at all.
 */
export function computeSightResult(
  baseObscurement: ObscurementLevel,
  distanceFt: number,
  senses: ViewerSenses,
  targetHasTotalCover: boolean,
): SightResult {
  if (!targetHasTotalCover && senses.blindsightRadiusFt > 0 && distanceFt <= senses.blindsightRadiusFt) {
    return { obscurement: 'none', perceivesInvisible: true, source: 'blindsight' };
  }
  if (senses.truesightRadiusFt > 0 && distanceFt <= senses.truesightRadiusFt) {
    return { obscurement: 'none', perceivesInvisible: true, source: 'truesight' };
  }
  if (senses.darkvisionRadiusFt > 0 && distanceFt <= senses.darkvisionRadiusFt) {
    const downgraded = downgradeOneStep(baseObscurement);
    return { obscurement: downgraded, perceivesInvisible: false, source: downgraded === baseObscurement ? 'normal' : 'darkvision' };
  }
  return { obscurement: baseObscurement, perceivesInvisible: false, source: 'normal' };
}

// rulesGlossary.md Tremorsense (line 1609) — NOT a form of sight: ignores
// light/line-of-sight entirely, but only within range, only while both the
// viewer and the target are in contact with the same surface, and never for
// an airborne target. This app tracks no surface-contact/flying state (no
// z-axis), so `viewerAndTargetShareSurfaceContact`/`targetIsAirborne` are
// caller-supplied — the DM's own judgment call, same "this function can't
// resolve context it has no state for" treatment P2-2's Frightened/Grappled
// caveats already established.
export function tremorsenseDetects(
  tremorsenseRadiusFt: number,
  distanceFt: number,
  viewerAndTargetShareSurfaceContact: boolean,
  targetIsAirborne: boolean,
): boolean {
  if (tremorsenseRadiusFt <= 0 || targetIsAirborne) return false;
  return distanceFt <= tremorsenseRadiusFt && viewerAndTargetShareSurfaceContact;
}
