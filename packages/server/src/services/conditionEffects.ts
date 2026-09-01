// docs/roadmap/dnd-2024-gap-analysis.md P2-2 (CB-07) — "compute-and-suggest"
// only, confirmed with the user before writing this (this app has no
// server-side attack hit/miss resolution pipeline at all — attack rolls are
// plain d20s with no target reference, and P1-10/Cover already hit this
// exact wall and chose the same "track state, suggest a value, never
// enforce the core roll pipeline" precedent this file follows). Pure
// functions only, no DB dependency — same "pure-function-first" precedent as
// services/damage.ts/diceEngine.ts/movement.ts: the caller (services/
// effects.ts) is responsible for looking up which conditions are actually
// active and passing them in as plain lowercase strings; this module never
// queries active_effects itself.
//
// Every list below is sourced directly from a specific rulesGlossary.md
// condition entry (2024 SRD, this project's sole rules authority per
// .claude/skills/dnd-2024-rules) — see the citation on each constant. Only
// conditions with a DIRECTLY-QUOTED attack-roll/ability-check/saving-throw
// advantage-disadvantage-or-auto-fail effect are included; conditions with
// no such effect (Charmed's "can't attack the charmer" targeting
// restriction, Deafened's hearing-only auto-fail with no roll-modifier,
// Grappled's speed-0/movability text) are deliberately excluded from the
// relevant category below and, where they DO have a roll effect that's
// conditional on context this module can't resolve (WHO the target is,
// whether a fear source is in line of sight, whether the other creature
// "can somehow see" an Invisible creature), surfaced only as a caveat
// string, never folded into the unconditional source lists.

export type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface RollModifiers {
  /** Condition names (lowercase) unconditionally granting Advantage. */
  advantageSources: string[];
  /** Condition names (lowercase) unconditionally granting Disadvantage. */
  disadvantageSources: string[];
  /** True when at least one active condition forces an automatic failure
   * regardless of the roll (e.g. Paralyzed's auto-fail on Dex saves) —
   * takes priority over advantage/disadvantage in play, but both are still
   * reported so the UI can show "would have had Advantage, but auto-fails
   * anyway." */
  autoFail: boolean;
  autoFailSources: string[];
  /** Human-readable notes for an active condition whose effect is real but
   * conditional on something this function can't resolve on its own (range,
   * line of sight, target identity, "unless the other creature can somehow
   * see you") — the DM/player judges these, never auto-applied. */
  caveats: string[];
}

function emptyModifiers(): RollModifiers {
  return { advantageSources: [], disadvantageSources: [], autoFail: false, autoFailSources: [], caveats: [] };
}

function collect(conditions: string[], names: string[]): string[] {
  const set = new Set(names);
  return conditions.filter((c) => set.has(c));
}

// ---- Attack rolls MADE BY a creature with these conditions ----
// rulesGlossary.md: Blinded line 366, Poisoned line 1279, Restrained line
// 1341, Prone line 1301 (all Disadvantage, unconditional); Invisible line
// 1082 (Advantage, "unless the other creature can somehow see you" — caveat).
const OWN_ATTACK_DISADVANTAGE = ['blinded', 'poisoned', 'restrained', 'prone'];
const OWN_ATTACK_ADVANTAGE = ['invisible'];

export function computeOwnAttackRollModifiers(conditions: string[]): RollModifiers {
  const m = emptyModifiers();
  m.disadvantageSources = collect(conditions, OWN_ATTACK_DISADVANTAGE);
  m.advantageSources = collect(conditions, OWN_ATTACK_ADVANTAGE);
  if (m.advantageSources.includes('invisible')) {
    m.caveats.push('Invisible: your attack roll has Advantage UNLESS the target can somehow see you, in which case neither applies.');
  }
  if (conditions.includes('frightened')) {
    m.caveats.push('Frightened: Disadvantage on this attack roll while the source of your fear is within line of sight.');
  }
  if (conditions.includes('grappled')) {
    m.caveats.push('Grappled: Disadvantage on this attack roll UNLESS the target is the creature grappling you.');
  }
  return m;
}

// ---- Attack rolls made AGAINST a creature with these conditions ----
// rulesGlossary.md: Blinded 366, Restrained 1341, Paralyzed 1229, Stunned
// 1547, Unconscious 1657, Petrified 1259 (all Advantage, unconditional);
// Invisible 1082 (Disadvantage, "unless the attacker can somehow see you" —
// caveat). Prone (line 1301) is the one condition whose effect flips on
// range — split into its own melee/ranged variants below rather than folded
// into these unconditional lists.
const AGAINST_THEM_ADVANTAGE = ['blinded', 'restrained', 'paralyzed', 'stunned', 'unconscious', 'petrified'];
const AGAINST_THEM_DISADVANTAGE = ['invisible'];
// rulesGlossary.md Paralyzed line 1231, Unconscious line 1661 — "any attack
// roll that hits you is a Critical Hit if the attacker is within 5 feet."
const CRITICAL_IF_WITHIN_5FT = ['paralyzed', 'unconscious'];

function baseAgainstThemModifiers(conditions: string[]): RollModifiers {
  const m = emptyModifiers();
  m.advantageSources = collect(conditions, AGAINST_THEM_ADVANTAGE);
  m.disadvantageSources = collect(conditions, AGAINST_THEM_DISADVANTAGE);
  if (m.disadvantageSources.includes('invisible')) {
    m.caveats.push('Invisible: attack rolls against this target have Disadvantage UNLESS the attacker can somehow see them.');
  }
  return m;
}

/** Attack rolls against this target from within 5 feet (melee range). */
export function computeAttacksAgainstMelee(conditions: string[]): RollModifiers {
  const m = baseAgainstThemModifiers(conditions);
  if (conditions.includes('prone')) m.advantageSources.push('prone');
  return m;
}

/** Attack rolls against this target from beyond 5 feet (ranged/reach). */
export function computeAttacksAgainstRanged(conditions: string[]): RollModifiers {
  const m = baseAgainstThemModifiers(conditions);
  if (conditions.includes('prone')) m.disadvantageSources.push('prone');
  return m;
}

export function criticalHitSourcesWithin5ft(conditions: string[]): string[] {
  return collect(conditions, CRITICAL_IF_WITHIN_5FT);
}

// ---- Ability checks ----
// rulesGlossary.md: Poisoned line 1279 (Disadvantage, unconditional);
// Blinded line 364 / Deafened line 732 (auto-fail, but only for a check
// that specifically requires sight/hearing — this function can't know which
// ability check is being made, so these are caveats, not unconditional
// auto-fails); Frightened line 888 (Disadvantage, conditional on the fear
// source's line of sight — caveat).
const ABILITY_CHECK_DISADVANTAGE = ['poisoned'];

export function computeAbilityCheckModifiers(conditions: string[]): RollModifiers {
  const m = emptyModifiers();
  m.disadvantageSources = collect(conditions, ABILITY_CHECK_DISADVANTAGE);
  if (conditions.includes('frightened')) {
    m.caveats.push('Frightened: Disadvantage on this ability check while the source of your fear is within line of sight.');
  }
  if (conditions.includes('blinded')) {
    m.caveats.push('Blinded: automatic failure on any ability check that requires sight.');
  }
  if (conditions.includes('deafened')) {
    m.caveats.push('Deafened: automatic failure on any ability check that requires hearing.');
  }
  return m;
}

// ---- Saving throws (per ability score) ----
// rulesGlossary.md: Paralyzed line 1227, Stunned line 1545, Unconscious line
// 1659, Petrified line 1261 — "automatically fail Strength and Dexterity
// saving throws." Restrained line 1343 — "Disadvantage on Dexterity saving
// throws" only (not auto-fail).
const SAVE_AUTO_FAIL_STR_DEX = ['paralyzed', 'stunned', 'unconscious', 'petrified'];
const SAVE_DEX_DISADVANTAGE = ['restrained'];

export function computeSavingThrowModifiers(conditions: string[], ability: AbilityKey): RollModifiers {
  const m = emptyModifiers();
  if (ability === 'str' || ability === 'dex') {
    m.autoFailSources = collect(conditions, SAVE_AUTO_FAIL_STR_DEX);
    m.autoFail = m.autoFailSources.length > 0;
  }
  if (ability === 'dex') {
    m.disadvantageSources = collect(conditions, SAVE_DEX_DISADVANTAGE);
  }
  return m;
}

// ---- Exhaustion (2024 only — rulesGlossary.md line 834: "the roll is
// reduced by 2 times your Exhaustion level," applied to every D20 Test:
// attack rolls, ability checks, AND saving throws alike). 2014's Exhaustion
// is a structurally different per-level effects table (disadvantage on
// specific roll types by level, not a flat numeric penalty) and is
// deliberately NOT modeled here — see this file's own "what's excluded"
// note in the P2-2 progress.md writeup rather than guessing 2014 numbers. ----
export function computeExhaustionPenalty(edition: '2014' | '2024', exhaustionLevel: number): number {
  if (edition !== '2024') return 0;
  return -2 * Math.max(0, exhaustionLevel) || 0; // normalize -0 to 0
}
