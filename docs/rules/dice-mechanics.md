# Dice Mechanics — Core Rolling Engine Primitives

## Scope, edition, and grounding

Consulted for: the dice-rolling engine rebuild (single, unit-tested subsystem replacing the currently-scattered roll math in `packages/server/src/services/diceRolls.ts`, `services/characters.ts`'s `applyDamage`, `services/monsters.ts`'s `applyDamage`, `services/abilityScoreRoll.ts`, and `packages/web/src/lib/dnd-math.ts`). Edition: **both** — every formula below is checked against both `.opencode/skills/dnd5e-srd/references/2014/` and `.../2024/`, differences called out explicitly, not assumed away.

Grounded against: `references/2014/ability-checks.md` (Advantage and Disadvantage, Proficiency Bonus, Saving Throws, Passive Perception), `references/2014/combat.md` (Critical Hits), `references/2014/character-creation.md` (ability score generation methods), `references/2024/ability-checks.md` (D20 Tests, Advantage/Disadvantage, Proficiency Bonus), `references/2024/combat.md` (Critical Hits), `references/2024/character-creation.md` (Save DC formula, ability score generation), plus structured data `data/2014/5e-SRD-Levels.json`, `data/2024/5e-SRD-Levels.json` (proficiency-bonus-by-level table), `data/2014/5e-SRD-Traits.json` / `data/2024/5e-SRD-Feats.json` (Lucky/Luck, Fighting Style: Great Weapon Fighting). Codebase grounding: `packages/server/src/schemas/diceRolls.ts`, `services/diceRolls.ts`, `services/damage.ts`, `services/abilityScoreRoll.ts`, `services/characters.ts` (`applyDamage`), `services/monsters.ts` (`applyDamage`), `db/migrations/1784269755666_create-dice-rolls.ts`, `.../1784269758666_add-dice-expression-support.ts`, `.../1784269760666_add-campaign-ability-reroll-setting.ts`, `db/migrations/1784269737666_create-characters.ts`, `.../1784269738666_create-character-classes-and-proficiencies.ts`, `packages/web/src/lib/dnd-math.ts`.

**Critical hit dice-doubling and its interaction with resistance/vulnerability is already the canonical subject of `docs/rules/attacks-and-damage.md` §1.2–1.5** — this doc does not re-litigate that citation chain, it cross-references it and adds the concrete numeric fixtures the dice engine's unit tests need, plus the data-model gap that citation chain didn't cover (crit-doubling is implemented twice, independently, in `characters.ts` and `monsters.ts`, and the generic `dice_rolls` roll-logging table has no `is_critical` column at all — see §1.2 below).

---

## 1. Critical hit damage doubling

### 1. Official rule

Already fully cited in `docs/rules/attacks-and-damage.md` §1.2–1.5. Restated in formula form for this engine spec:

```
normal_damage_total  = sum(roll(dice_count, dice_sides)) + flat_modifier
critical_damage_total = sum(roll(dice_count * 2, dice_sides)) + flat_modifier
```

**Only the dice portion doubles. The flat modifier (ability-score modifier, a magic weapon's static `+N`, any other flat bonus) is added exactly once, whether or not the hit was critical.** Both editions state this identically in substance — 2014 `combat.md` lines 375–379 ("Roll all of the attack's damage dice twice and add them together. Then add any relevant modifiers as normal"), 2024 `combat.md` line 133 ("roll all the attack's damage dice twice, add modifiers once"). Extra damage-dice sources stacked onto the same attack (Sneak Attack, a Smite, a bonus damage die from a feature) double along with the base weapon/spell dice — 2014 says so explicitly ("If the attack involves other damage dice, such as from the rogue's Sneak Attack feature, you roll those dice twice as well").

**Edge-case racial modifier, flagged not required for this task but worth knowing**: 2014's Half-Orc **Savage Attacks** trait (`data/2014/5e-SRD-Traits.json`) reads "When you score a critical hit with a melee weapon attack, you can roll **one** of the weapon's damage dice **one additional time** and add it to the extra damage of the critical hit" — i.e. it adds a *third* copy of exactly one weapon damage die on top of the normal doubling, not a global re-multiplier. This grounding set's 2024 Orc species entry does not carry an equivalent trait by this name (checked `references/2024/species.md`'s Orc section) — **flagged as an unconfirmed absence, not an assertion that 2024 dropped it**, since this skill has no spell/monster/item/species-trait catalog guarantee of completeness beyond what's in the grounding files. Not part of the required six items; noted only so the engine's per-die-source doubling primitive (§1.2 below) is shaped to accommodate a homebrew/racial "add N extra copies of die X only" rule if a later session needs it.

### 2. Data model translation

**Existing, correct logic** (do not change the formula, only where it lives): `services/characters.ts` line 575 and `services/monsters.ts` line 394 both independently compute:
```ts
const diceCount = input.isCritical ? input.diceCount * 2 : input.diceCount;
```
This is the right formula, duplicated in two places — **exactly the "scattered per-component roll math" this rebuild is meant to eliminate.** Extract to one pure, exported primitive, e.g. in a new `services/diceEngine.ts` (or added to `services/diceRolls.ts`, which already owns `rollDie`):
```ts
export function criticalDiceCount(diceCount: number, isCritical: boolean): number {
  return isCritical ? diceCount * 2 : diceCount;
}
```
and have both `applyDamage` call sites (and any future one) call it instead of re-deriving the ternary. `services/damage.ts`'s `computeAppliedDamage` already correctly treats `rolledDiceTotal` as a pre-doubled opaque input (its own header comment says so) — no change needed there, it's the doubling call site that's duplicated, not the downstream resistance math.

**Confirmed real schema gap**: `dice_rolls` (the shared roll-history table used by `POST /campaigns/:id/dice-rolls`) has **no `is_critical` column**. `services/characters.ts`'s `applyDamage` *does* insert a row into `dice_rolls` for its damage roll (line 602), with `dice_count` already silently doubled — but nothing in the row records that a doubling happened; a viewer of roll history can't distinguish "this was a critical hit" from "the player manually rolled 2d8 for some other reason." Recommendation for the rebuild: add `is_critical BOOLEAN NOT NULL DEFAULT false` to `dice_rolls` (new migration), have the engine set it whenever a `damage`-type roll passes `isCritical: true`, and surface it in the roll-history UI (`DiceRollHistoryPage.tsx`) as a badge — this is a display/audit fix, not a rules-legality fix (nothing currently *lets* a client lie about `isCritical` to get free extra dice server-side, since the doubling happens server-side off the trigger, not client-submitted — that part is already safe).

Also note the **existing inconsistency, not to be silently carried into the rebuild**: `characters.ts`'s `applyDamage` only inserts into `dice_rolls` `if (input.encounterId !== undefined)` (line 600) — a damage roll made outside encounter context updates HP but leaves zero roll-history trail. Flag this to whoever owns the rebuild's scope: either this is intentional (damage rolls are only "loggable" in combat) or it's a second, independent gap from the crit-flag one above; this doc doesn't have grounding to say which is intended, only that it exists.

### 3. Edge cases

- **Static `+1` weapon bonus vs. a bonus damage die**: a `+1` longsword's static bonus is a flat modifier — never doubled. A spell/feature that grants an *extra damage die* (Divine Favor's `+1d4 radiant`, Sneak Attack's `NdN`, a Smite's `NdN`) is a **die**, and doubles like any other weapon/spell damage die (§1 above, "you roll those dice twice as well"). The engine's input contract must distinguish these as two different fields (dice vs. flat modifier) exactly as `applyDamageSchema` already does (`diceSides`/`diceCount` vs. `modifier`) — never let a caller fold a bonus die into the flat `modifier` number or it will silently fail to double on a crit.
- **Multiple independent damage-dice sources on one attack** (weapon dice + Sneak Attack dice + a Smite's dice) all double together, per the same trigger, in the same roll event — not evaluated as separate "is this critical" checks per source.
- **Crit doesn't double flat resistance/vulnerability multipliers** — already covered by `attacks-and-damage.md` §1.3 (doubling happens first, resistance/vulnerability apply to the already-doubled total, never the reverse).
- **Untyped damage on a crit**: doubling is unaffected by damage type — the type only matters downstream for resistance/vulnerability/immunity (`services/damage.ts`), never for whether/how much doubling occurs.
- **Interaction with Great Weapon Fighting reroll (2014) / floor (2024)** — see §3 below; ordering matters: doubling happens first (dice_count *2), then the reroll/floor rule applies to *each* resulting die individually, not to the pre-doubled pool.

### 4. What must be tested

- `criticalDiceCount(1, false) === 1`, `criticalDiceCount(1, true) === 2`, `criticalDiceCount(3, true) === 6` (Sneak-Attack-sized pools too, not just 1-die weapons).
- Integration: `1d8+3` longsword, non-crit, mocked die roll `[6]` → `resultTotal === 9`. Same weapon, crit, mocked rolls `[5,7]` → `resultTotal === 15` (dice doubled to 2d8, `+3` added **once**: `5+7+3`, not `2*(5+3)` or `2*9`).
- Rogue-shaped stack: `1d6` (rapier) `+2d6` (Sneak Attack) `+4` (DEX mod), non-crit, mocked `[4]` (rapier) `+ [3,5]` (sneak) → `4+3+5+4 = 16`. Crit: dice doubled to `2d6` rapier `+4d6` sneak, mocked `[4,2]+[3,5,6,1]` → `4+2+3+5+6+1+4 = 25` — this is the regression test that would catch a bug that only doubles the *weapon* dice and forgets bonus-feature dice.
- `+1` weapon crit: dice `1d8` doubled to `2d8`, flat modifier `= STR mod (3) + magic bonus (1) = 4` (never doubled), mocked `[8,2]` → `8+2+4 = 14`. A regression test must assert this is **not** `2 * (8+4)` or any formula that doubles the `+1`.
- A server-side integration test posting `POST /campaigns/:id/characters/:id/damage` with a crafted `isCritical: true` and asserting the resulting `dice_rolls`/HP-delta reflects exactly double the *dice*, never double the modifier — this closes the "client claims critical, server must independently decide how much extra damage that means" trust boundary (the client can *say* `isCritical: true`, but cannot supply a pre-computed total; the server always rolls and always applies this exact doubling rule, per the existing "RNG lives here and only here" invariant in `services/diceRolls.ts`'s header comment).
- If the `is_critical` column recommendation above is implemented: an integration test asserting a critical damage roll's `dice_rolls` row has `is_critical = true` and a non-critical one has `false`, and that a client cannot set `is_critical` directly on the roll-history endpoint (it must be derived server-side from the same `isCritical` flag that drove the doubling, never accepted as an independent, unchecked boolean on the log-write path).

---

## 2. Advantage and disadvantage

### 1. Official rule

**2014** `ability-checks.md` lines 29–37 (`## Advantage and Disadvantage`): "When [you have advantage or disadvantage], you roll a second d20 when you make the roll. **Use the higher of the two rolls if you have advantage, and use the lower roll if you have disadvantage.**" — "**If multiple situations affect a roll and each one grants advantage or imposes disadvantage on it, you don't roll more than one additional d20.**" — "**If circumstances cause a roll to have both advantage and disadvantage, you are considered to have neither of them, and you roll one d20. This is true even if multiple circumstances impose disadvantage and only one grants advantage or vice versa.**"

**2024** `ability-checks.md` lines 80–85 (`## Advantage / Disadvantage`): "Roll two d20s: use the **higher** with Advantage, the **lower** with Disadvantage. **Multiple sources of Advantage (or of Disadvantage) don't stack** — you still roll only two dice. **If a roll has both Advantage and Disadvantage, they cancel out** and you roll one d20 normally."

**Identical mechanic in both editions, worded near-identically.** Formula:
```
sources_of_advantage    : count ≥ 0 (irrelevant beyond > 0)
sources_of_disadvantage : count ≥ 0 (irrelevant beyond > 0)

has_advantage    = sources_of_advantage > 0
has_disadvantage = sources_of_disadvantage > 0

keep =
  has_advantage && has_disadvantage  -> 'normal'      // cancel, roll 1 die
  has_advantage && !has_disadvantage -> 'advantage'    // roll 2, keep higher
  !has_advantage && has_disadvantage -> 'disadvantage' // roll 2, keep lower
  !has_advantage && !has_disadvantage -> 'normal'      // roll 1 die
```

**Confirmed worked example (RAW, both editions)**: 3 independent sources of advantage + 1 source of disadvantage → `has_advantage = true`, `has_disadvantage = true` → **they cancel, roll a single flat d20** — **not** "advantage wins because it has more sources" and **not** "roll extra dice for the extra sources." Both editions' text is explicit that source *counts* never matter past the first of each type (2014: "This is true even if multiple circumstances impose disadvantage and only one grants advantage **or vice versa**" — i.e. 3-vs-1 is covered by the same sentence as 1-vs-1). 2 sources of advantage + 0 disadvantage → still `keep = 'advantage'`, still only 2 dice rolled total, never 3.

**"Advantage" vs. a hypothetical "cannot have disadvantage" rule**: **no SRD text in this grounding set uses the phrase "cannot have disadvantage" or an equivalent** — checked `references/2014/` and `references/2024/` in full (`combat.md`, `ability-checks.md`, `conditions.md`) plus both editions' structured feature/trait/feat data for this exact phrasing; zero hits. This is **not confirmed as an SRD mechanic** and must not be hardcoded as one. If a homebrew/DM-authored effect grants "immune to disadvantage on X" (a real, named pattern in non-SRD published content, just not present in this app's grounding data), the correct generic implementation is a **pre-filter step**, not a new keep-state: the immunity effect removes/ignores disadvantage sources *before* the boolean collapse above runs, so if the character *also* has an advantage source, they resolve to advantage (not to a cancel-to-normal) — because after the filter, `has_disadvantage` is forced `false`. This is a mechanically consistent extension of the existing two-boolean model, not a new algorithm, but it is **DM-configurable homebrew content, not an SRD-confirmed rule** — flagged explicitly, do not ship it as a default behavior for any named SRD trait unless a specific trait's text is found to require it.

**Reroll effects interacting with advantage/disadvantage** (relevant to §3 below): 2014 `ability-checks.md` line 37: "When you have advantage or disadvantage and something in the game... lets you reroll the d20, **you can reroll only one of the [two] dice. You choose which one.**" No 2024-specific restatement was found in this grounding set's `ability-checks.md`, but nothing contradicts it and the 2024 Halfling's Luck trait (§3 below) is the direct successor of the same 2014 Lucky trait this sentence exists to clarify — treated as unchanged, flagged as inferred-by-continuity rather than independently re-quoted for 2024.

### 2. Data model translation

**Already correctly modeled — do not change the core mechanic, only consolidate it.** `schemas/diceRolls.ts`'s `diceRollKeepEnum = z.enum(['normal', 'advantage', 'disadvantage'])` structurally *cannot* represent a source count — it's already the single collapsed boolean-pair result from the formula above, which is the right shape. `services/diceRolls.ts`'s `rollDice`:
```ts
const rollCount = input.keep === 'normal' ? input.diceCount : 2;
```
already guarantees exactly 2 dice for advantage/disadvantage regardless of how many named sources a player cites verbally — correct, and this is the concrete regression the "stacking" tests below must lock in.

**Real, confirmed gap, not a rules bug**: this app has **no automatic advantage/disadvantage source aggregation anywhere server-side** (confirmed absent by grep across `services/effects.ts`/`services/encounters.ts`, restated from `docs/rules/actions.md` §3's own finding). The `keep` value a client submits is chosen by a human (player or DM) who has *already* mentally applied the boolean-collapse formula above — e.g. `active_effects` rows for Dodge/Hidden/etc. are **display-only state** the human reads and reasons about, not inputs to a `resolveKeep()` call anywhere in this codebase. **This is consistent with this app's existing "display-only, DM/player adjudicates the roll modifier" precedent** (cited repeatedly in `docs/rules/actions.md`) — the dice engine's job is to correctly execute a *given* `keep` value (§ formula above, already correct), not to compute `keep` from a set of active-effect rows. If the rebuild's scope is meant to include automatic aggregation (e.g. reading `active_effects` to pre-select `keep` in the roll UI), that is a **new feature**, not a bug fix, and should be scoped and named explicitly rather than silently added as "part of the dice engine."

Recommended shared pure primitive for the engine (usable client-side for a "would this cancel?" UI helper, and testable in isolation):
```ts
export function resolveAdvantage(
  advantageSourceCount: number,
  disadvantageSourceCount: number,
): 'normal' | 'advantage' | 'disadvantage' {
  const hasAdv = advantageSourceCount > 0;
  const hasDis = disadvantageSourceCount > 0;
  if (hasAdv && hasDis) return 'normal';
  if (hasAdv) return 'advantage';
  if (hasDis) return 'disadvantage';
  return 'normal';
}
```

### 3. Edge cases

- **Crit determination under advantage/disadvantage** — already fully resolved in `attacks-and-damage.md` §1.5: only the **kept** die's natural-20 status triggers a crit; a discarded die (even a natural 20 discarded under disadvantage) has zero mechanical effect. The dice engine must expose which die was *kept*, not just the numeric result, so callers (attack-roll code) can check `kept === 20` rather than `rolls.includes(20)`.
- **Advantage/disadvantage is a d20-only concept** — already enforced by `createDiceRollSchema`'s `.refine()` (`keep === 'normal' || diceSides === 20`). Damage rolls, ability-score-generation rolls, and any non-d20 roll never have a "kept" die in this sense; a `2d6` damage roll always sums all dice, it never "keeps the higher d6." This is a real, confirmed distinct mechanic (advantage/disadvantage vs. "roll twice, keep higher/higher-total" effects like the 2024 Savage Attacker feat — §3 below) that must not be conflated in the engine's type model.
- **0 sources of either → `normal`**, not an error state — the formula above returns `'normal'` for the "nothing applies" case identically to the "cancelled" case; these are the same enum value but distinguishable in application logs (advantage sources present + disadvantage sources present, vs. neither present) if the caller wants to record *why* — worth keeping that distinction in whatever calls `resolveAdvantage`, even though the roll mechanics that follow are identical either way.
- **Reroll-one-of-two-dice under advantage/disadvantage** (2014 line 37, §2 above): the engine's reroll primitive (§3 below) must operate on an *individual die within the pre-keep pool*, chosen by the player, not on "the roll" as a single scalar — this only matters when `keep !== 'normal'`, since a normal roll has only one die to begin with.

### 4. What must be tested

- `resolveAdvantage(0, 0) === 'normal'`, `resolveAdvantage(1, 0) === 'advantage'`, `resolveAdvantage(3, 0) === 'advantage'` (3 sources ≠ extra dice), `resolveAdvantage(0, 1) === 'disadvantage'`, `resolveAdvantage(3, 1) === 'normal'` (the exact "3 advantage + 1 disadvantage" case from the task brief), `resolveAdvantage(1, 1) === 'normal'`.
- Integration: `POST /campaigns/:id/dice-rolls` with `keep: 'advantage'` always rolls exactly 2 dice (assert `d20_rolls.length === 2`) regardless of any `diceCount` the client also supplied — and `diceCount` must be **ignored/rejected** for advantage/disadvantage requests (already enforced by the schema's `.refine`; a regression test should assert a crafted request with `keep: 'advantage', diceSides: 6` is rejected with `VALIDATION_ERROR`, not silently coerced).
- Mocked-RNG test: `keep: 'advantage'`, mocked rolls `[5, 17]` → `result_total` reflects `17 + modifier`, and the response/row exposes which die (index 1) was kept. Same rolls under `keep: 'disadvantage'` → `result_total` reflects `5 + modifier`.
- Crit-with-disadvantage regression (the one most likely to silently regress): `keep: 'disadvantage'`, mocked rolls `[20, 15]` → kept die is `15` (the lower) → **this is not a critical hit**, even though a `20` appears in `d20_rolls`. An attack-resolution integration test must assert no crit-damage path fires here.
- A test asserting a client cannot submit a `keep` value outside the three-enum set (e.g. `'super-advantage'` or a numeric "3") — the schema `z.enum([...])` already guarantees this at the boundary; a regression test locks in that the enum can't silently grow a fourth value that would imply stacking.

---

## 3. Keep-highest/keep-lowest and reroll mechanics

### 1. Official rule

**Ability score generation — 4d6, drop lowest** (equivalent to "4d6, keep highest 3"). **2014** `character-creation.md` line 31: "**Roll:** 4d6, drop the lowest, six times, assign as desired." **2024** `character-creation.md` line 59: "**Random Generation:** roll 4d6 drop lowest, six times." **Identical mechanic both editions.** Formula: roll 4 independent d6, discard the single lowest-valued die (if there's a tie for lowest, discard exactly one of the tied dice — the SRD text doesn't need to disambiguate this since summing "the other three" is unaffected by *which* tied die is nominally "the" dropped one), sum the remaining 3. Repeat 6 times, once per ability score, assigned by the player afterward (not fixed to a specific ability at roll time).

**Fighting Style: Great Weapon Fighting — 2014 is a true reroll, 2024 is a floor/clamp, NOT a reroll.** This is a confirmed, load-bearing edition difference:

- **2014** (`data/2014/5e-SRD-Traits.json`, "Fighting Style: Great Weapon Fighting"): "When you roll a **1 or 2** on a damage die for an attack you make with a melee weapon that you are wielding with two hands, **you can reroll the die and must use the new roll, even if the new roll is a 1 or a 2.** The weapon must have the two-handed or versatile property for you to gain this benefit." — a genuine reroll: the die is physically re-rolled once, and whatever comes up (even another 1 or 2) is final. No re-reroll chain.
- **2024** (`data/2024/5e-SRD-Feats.json`, "Great Weapon Fighting" — 2024 restructured Fighting Styles into feats, see §2 below): "When you roll damage for an attack you make with a Melee weapon that you are holding with two hands, **you can treat any 1 or 2 on a damage die as a 3.** The weapon must have the Two-Handed or Versatile property to gain this benefit." — **this is not a reroll at all.** It is a deterministic value-replacement/floor: any die showing 1 or 2 is simply read as a 3, no additional die is rolled, and the result is never worse than a straight roll (2014's version *can* reroll a 1 or 2 into a worse value than... no, it can't go below 1, but it *can* reroll into another 1 or 2, i.e. 2014 has downside variance 2024 does not).

**Halfling racial trait: Lucky (2014) / Luck (2024) — reroll a natural 1 on any d20 test, once, must keep the new roll.** **2014** (`data/2014/5e-SRD-Traits.json`, "Lucky"): "When you roll a 1 on the d20 for an attack roll, an ability check, or a saving throw, you can reroll the die and must use the new roll." **2024** (`references/2024/species.md` line 109, Halfling's "Luck" trait): "When you roll a 1 on the d20 of a D20 Test, you can reroll the die, and you must use the new roll." **Identical mechanic, renamed** ("Lucky" → "Luck"), and 2024's phrasing ("D20 Test") is exactly the umbrella term 2024 uses for ability checks/saving throws/attack rolls collectively (`ability-checks.md` line 5) — same scope as 2014's explicit three-item list.

**Reroll-once semantics, precisely**: neither Lucky/Luck's text carries GWF-2014's explicit "even if the new roll is also a 1" clause. **This grounding set does not contain a sentence that says "Lucky cannot trigger again off its own reroll"** — the "reroll happens exactly once per trigger, and the new value is final regardless of what it is" reading is the standard, universally-applied 5e convention (the same convention GWF-2014 states explicitly, apparently for extra clarity on a trait whose base-die pool is much larger and re-triggering would be a bigger deal). **Flagged as an inferred-by-convention generalization, not an independently SRD-quoted universal statement for Lucky specifically** — but it is the only sane implementation (a reroll effect that could trigger itself indefinitely on a bad-luck streak has no textual basis anywhere in this grounding set and would need its own explicit "and this can trigger again" sentence, which doesn't exist for either trait).

**A distinct, third primitive found but not in this task's list, flagged because it's easy to conflate with the above**: 2024's **Savage Attacker** feat (`data/2024/5e-SRD-Feats.json`): "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice **twice** and use **either roll** against the target." This is **whole-pool-reroll-keep-better**, not per-die (unlike GWF) and not a d20 keep-highest (unlike advantage) — it rolls the *entire damage dice pool* a second time and the player picks whichever *total* is better. This grounding set found no 2014 SRD-text equivalent (checked `data/2014/5e-SRD-Feats.json` in full — Savage Attacker is absent from the free 2014 SRD's feat list, unlike 2024's SRD 5.2 which includes more feats).

### 2. Data model translation

**None of these three primitives exist in this codebase today** (confirmed absent by grep for "lucky"/"reroll" across `packages/server/src` and `packages/web/src` outside the unrelated `allow_ability_reroll` campaign setting, which is a different concept — see below). This is real, net-new engine surface, not a bug fix. Recommended primitives, all pure functions taking already-rolled dice (never re-deriving RNG themselves outside `rollDie`):

```ts
/** 2014 Great Weapon Fighting / Halfling Lucky / Luck shape: reroll a die
 *  exactly once if it matches `triggerPredicate`, unconditionally keep the
 *  new value (even if it also matches the predicate). */
export function rerollOnceIfMatches(
  originalRoll: number,
  triggerPredicate: (roll: number) => boolean,
  sides: number,
): { finalValue: number; wasRerolled: boolean } {
  if (!triggerPredicate(originalRoll)) return { finalValue: originalRoll, wasRerolled: false };
  return { finalValue: rollDie(sides), wasRerolled: true };
}

/** 2024 Great Weapon Fighting shape: deterministic floor, no extra roll. */
export function clampDieMinimum(roll: number, floor: number): number {
  return Math.max(roll, floor);
}
```
Applied per-die across a damage pool (a `map` over the already-doubled-if-critical dice array, per §1's ordering note), never across the summed total.

`campaigns.allow_ability_reroll` (existing) is a **different concept entirely** — it governs whether a *player* is allowed to re-invoke the whole ability-score-generation endpoint again (getting six brand-new 4d6-drop-lowest sets), a DM-table-policy toggle, not an SRD rule at all (nothing in either edition's grounding text restricts how many times a player may regenerate scores before choosing — that's implicitly a DM/table decision, correctly modeled as a `campaigns` boolean already). Do not conflate this with the Lucky/GWF reroll primitives above, which are SRD-defined, always-available, per-die mechanics tied to a specific race/fighting-style choice, not a campaign-wide toggle.

**Where does "does this character have GWF/Lucky" live?** Checked: this app has **no character-feature-choice table** (no `character_features`/`character_fighting_style` found by grep) — `character_classes` stores `class_id`/`subclass_id`/`level` only, no selected-Fighting-Style column, and there's no Halfling-specific trait-tracking beyond `characters.race_id`/`subrace_id` foreign keys (which, if populated correctly from the `races`/`subraces` catalog, would let a "is this character a Halfling" check be a join, but there's no code anywhere that currently reads race/subrace to gate a reroll). **This is a genuine, larger gap than the dice math itself**: the reroll/floor primitives above are ready to use once a caller knows "this die roll is eligible for GWF" or "this character has Lucky," but nothing in the current schema flags that eligibility. Recommendation: don't invent a new generic "character has trait X" table as part of *this* dice-engine task — that's `rpg-data-model-architect` territory (character build/feature selection) — but the dice-engine's reroll primitives should accept eligibility as an explicit boolean/predicate parameter supplied by the caller (as sketched above), not attempt to look up "does this character have GWF" internally. This keeps the engine itself trait-agnostic and testable without needing the full feature-selection schema to exist first.

### 3. Edge cases

- **"Reroll once" vs. "keep rerolling"**: confirmed above — both GWF-2014 and Lucky/Luck are single-trigger, the new value is final no matter what it is (even if it re-matches the trigger). The engine must never implement a `while (matches(roll)) roll = reroll()` loop for either — that would be a fabricated rule with no SRD basis.
- **2024 GWF applies to *every* qualifying die, unconditionally, no "choice" involved** — it's a floor, not an optional reroll a player can decline. 2014 GWF's reroll, by contrast, is phrased as "**you can** reroll" (2014 wording) — a player-optional trigger, in principle decline-able (though there's no SRD-stated reason a rational player ever would, since the worst case of rerolling equals the current worst case). The engine's reroll primitive should be invoked per-die at the caller's discretion for 2014 (it's an option), while the 2024 clamp primitive is unconditional (no "declined" state makes sense to model).
- **Interaction with critical-hit doubling** (§1 above): doubling happens first (dice_count × 2), then GWF's reroll/floor applies to **each of the doubled dice individually** — a crit with GWF doesn't get some special combined treatment, it's just "more dice, same per-die rule applied to each."
- **Interaction with advantage/disadvantage's own reroll-one-die rule** (§2 above): Lucky/Luck triggering under advantage/disadvantage rerolls only the *one* die (of the two rolled) that showed a 1, chosen by the player if both happen to show a 1 (2014 line 37's "you choose which one" governs *any* reroll-the-d20 effect under advantage/disadvantage, not just Lucky specifically, but Lucky is the only SRD example of such an effect in this grounding set).
- **4d6-drop-lowest tie-breaking**: if two or more of the 4 dice tie for lowest, only **one** die is dropped (never two) — the SRD text says "drop the lowest" (singular), and mathematically dropping any one of several tied-lowest dice produces the identical sum for "the other three," so there's no real ambiguity to resolve, just a possible implementation footgun (a naive `dice.filter(d => d !== min)` would incorrectly drop *all* dice matching the minimum value if there are duplicates — `services/abilityScoreRoll.ts`'s existing `dropLowestOfFour` already avoids this correctly, using a single tracked `droppedIndex`, not a value filter — confirmed by reading the function, this is already right and should not be "fixed" into a bug during the rebuild).
- **Savage Attacker's "either roll" is a whole-pool comparison, not per-die** — do not implement it by reusing the per-die `clampDieMinimum`/`rerollOnceIfMatches` primitives; it needs its own "roll the whole dice+modifier pool twice, return the caller's chosen better total" shape, structurally closer to advantage's roll-2-keep-1 pattern than to GWF's per-die pattern, but operating on damage dice (never d20s) and pool totals (not paired individual dice). Not required by this task's six items; flagged only so it isn't accidentally implemented as a per-die effect if it comes up later.

### 4. What must be tested

- `rerollOnceIfMatches`: given a mocked `rollDie` returning `2` then `1` (i.e. the reroll also lands on a trigger value), `rerollOnceIfMatches(1, isOneOrTwo, 8)` returns `{ finalValue: 2, wasRerolled: true }` — asserting the engine does **not** loop and reroll again despite the new value also matching the predicate.
- `rerollOnceIfMatches(5, isOneOrTwo, 8)` (non-matching original) returns `{ finalValue: 5, wasRerolled: false }` and must **not** call `rollDie` at all (assert the RNG mock's call count is 0) — a regression test that would catch an accidental unconditional-reroll bug.
- `clampDieMinimum(1, 3) === 3`, `clampDieMinimum(2, 3) === 3`, `clampDieMinimum(3, 3) === 3`, `clampDieMinimum(6, 3) === 6` (never *lowers* a die that's already above the floor).
- Integration: a 2024-campaign character's two-handed-weapon crit with mocked dice `[1, 2]` on a `2d10` (already crit-doubled from `1d10`) → after `clampDieMinimum(_, 3)` per die → `3 + 3 = 6` dice total, **no additional `rollDie` calls beyond the original 2** (asserting the 2024 path never rerolls, only clamps).
- Integration: the same scenario under a 2014-edition campaign with mocked original rolls `[1, 2]` and mocked reroll results `[4, 9]` → dice total `4 + 9 = 13`, and the RNG mock's call count reflects exactly 2 initial + 2 reroll calls (4 total) — asserting the 2014 path *does* reroll (unlike 2024) and applies to each qualifying die independently.
- `dropLowestOfFour` (already implemented, existing test should already cover this, but confirm/extend): dice `[3, 3, 3, 6]` (three-way tie for lowest) → `droppedIndex` is *some* valid index among the three 3s, and `total === 12` (`3+3+6`) — never `9` (which would happen if a value-filter implementation accidentally dropped all three tied 3s).
- A server-side integration test on the ability-score-generation endpoint (`POST /campaigns/:id/roll-ability-scores`) asserting `allow_ability_reroll: false` blocks a second call with a `403`/policy error, while the underlying 4d6-drop-lowest math itself is unaffected by that toggle (i.e. the toggle gates *endpoint call count*, not the dice formula) — this is the existing `allow_ability_reroll` feature, included here only to confirm the rebuild doesn't conflate it with the SRD reroll primitives above.

---

## 4. Minimum die value (floor) effects

### 1. Official rule

**No general-purpose "set a floor on an individual die" primitive exists as a base/universal 5e mechanic in either edition's grounding text** — checked `references/2014/` and `references/2024/` `combat.md`/`ability-checks.md` end to end for any core rule (not tied to a specific class/race/feat choice) that floors a die value; none found. **This is stated explicitly, not filled with invented specificity, per this task's own instruction.**

**However — and this is the one confirmed exception, already surfaced in §3 above** — **2024's Great Weapon Fighting feat *is* exactly this primitive as a named, SRD-legal effect**: "you can treat any 1 or 2 on a damage die as a 3" (`data/2024/5e-SRD-Feats.json`) is a deterministic per-die floor of 3 for dice that land at 1 or 2, with no reroll involved. **2014 has no equivalent floor-shaped rule anywhere in this grounding set** — 2014's version of the same-named Fighting Style is the reroll described in §3, a structurally different primitive (variance-preserving vs. 2024's variance-reducing floor). This is a genuine, confirmed 2014-vs-2024 mechanical difference for the *same-named* character option, not just a wording change.

**Since the engine should support the primitive generically for homebrew/DM-defined effects (per this task's explicit instruction)**: the generic shape is `clampDieMinimum(roll, floor)` (already specified in §3.2 above) — a pure `max(roll, floor)` function, parameterized so a DM can define an arbitrary homebrew "your damage dice never roll below N" effect using the same primitive 2024's GWF uses, without the engine needing a hardcoded "GWF" special case. **This DM-authored generic use is homebrew, not SRD-confirmed for any trigger beyond 2024's GWF specifically** — flag any such config as DM-configurable (see the DM-configurable section at the end of this doc), never as a default.

### 2. Data model translation

Same primitive and same "no eligibility-tracking schema exists yet" gap as §3.2 — `clampDieMinimum` is the function; nothing in this codebase currently flags which characters/weapons/rolls it should apply to. If the rebuild wants to expose this as a DM-configurable *campaign-wide* homebrew toggle (distinct from the character-specific 2024-GWF-feat case, which needs the not-yet-built feature-selection schema described in §3.2), that's a `campaigns` settings JSONB key (matching this app's existing precedent, `allow_ability_reroll`, though that one got a dedicated column rather than JSONB since it's a single well-defined boolean — a generic "minimum die value" homebrew rule would need at minimum a floor value and a scope, which is closer to the "genuinely variable, unqueried structure" case `PLAN.md` §3.3 reserves JSONB for).

### 3. Edge cases

- **Floor vs. reroll produce different variance, not just different code paths** — do not let the engine's public API make these look interchangeable (e.g. two functions with near-identical names/signatures that quietly do different things). `clampDieMinimum` never rolls additional dice; `rerollOnceIfMatches` always does when triggered. A caller picking the wrong one for a given edition's GWF would silently under- or over-compute expected damage.
- **A floor above the die's max is a modeling error, not a rules case** — e.g. `clampDieMinimum(roll, 10)` on a d6 would force every roll to 10, which no SRD text ever describes; this is purely an input-validation concern for any DM-configurable floor value (the engine should probably reject/warn on `floor > sides`, though no SRD text mandates this — it's sane defensive coding, not a cited rule).
- **Floor of 0 or negative** is a no-op (`Math.max(roll, 0)` never changes a already-≥1 die) — not an error, just meaningless input; no need for special-case rejection beyond normal validation.

### 4. What must be tested

- Already covered by §3.4's `clampDieMinimum` unit tests (this section intentionally reuses that primitive rather than defining a second one) — the specific addition here: a test asserting `clampDieMinimum` and `rerollOnceIfMatches` are never both applied to the same die in the same resolution path for a single character/edition combination (i.e. a 2024 character never also gets the 2014 reroll behavior layered on top) — an integration test parameterized by `campaign.srd_edition` asserting exactly one of the two code paths is invoked for a Great-Weapon-Fighting-flagged damage roll, never both, never neither.
- A test confirming the engine has **no hardcoded default floor** applied to any roll absent explicit configuration — i.e. rolling a plain, un-flagged damage die never gets clamped to anything, closing off the failure mode where a homebrew DM setting accidentally becomes a silent global default.

---

## 5. Saving throw DC calculation

### 1. Official rule

**2014** `references/2014/spellcasting-rules.md` line 185: "The DC to resist one of your spells equals **8 + your spellcasting ability modifier + your proficiency bonus + any special modifiers.**"

**2024** `references/2024/character-creation.md` lines 105–106: "**Spellcasting** (if applicable): Save DC = **8 + spellcasting ability mod + Prof. Bonus.**"

**Identical formula both editions** (2014's grounding text additionally names an open-ended "+ any special modifiers" term for item/feature bonuses that 2024's summary line doesn't restate verbatim, but nothing in 2024's text forbids or contradicts such bonuses existing — treated as the same formula with an optional extra term, not a genuine edition difference):

```
save_dc = 8 + proficiency_bonus + spellcasting_ability_modifier + special_modifiers  // special_modifiers defaults to 0
```

**Proficiency bonus by (total character) level — identical table both editions** (`data/2014/5e-SRD-Levels.json`, `data/2024/5e-SRD-Levels.json`, cross-checked against `references/2024/ability-checks.md` lines 92–101):

| Level    | Bonus |
|----------|-------|
| 1–4      | +2    |
| 5–8      | +3    |
| 9–12     | +4    |
| 13–16    | +5    |
| 17–20    | +6    |

Formula: `proficiencyBonus(level) = 2 + floor((max(1, level) - 1) / 4)` — this is exactly `packages/web/src/lib/dnd-math.ts`'s existing `proficiencyBonusForLevel`, confirmed correct against the table above (spot-checked levels 1/5/9/13/17 against both editions' `Levels.json` data directly, not just the summary table).

**Worked examples**:
- Level 1 cleric, WIS 16 (modifier `+3`), proficiency bonus `+2`: `DC = 8 + 2 + 3 = 13`.
- Level 9 cleric, WIS 18 (modifier `+4`, e.g. after an Ability Score Improvement), proficiency bonus `+4` (levels 9–12 row): `DC = 8 + 4 + 4 = 16`.
- Level 17 cleric, WIS 20 (modifier `+5`, max without epic-boon-type features), proficiency bonus `+6` (levels 17–20 row): `DC = 8 + 6 + 5 = 19`.

### 2. Data model translation

**This app deliberately does not auto-compute `save_dc`** — confirmed by reading `schemas/characterAttacks.ts`, `schemas/monsterCatalog.ts`, `schemas/effects.ts`, `schemas/casting.ts`: every one of these stores `saveDc` as a **manually-entered flat integer** (`z.number().int().positive().optional().nullable()`), not derived from ability scores + proficiency bonus at write time. This matches this app's existing "player/DM enters their own pre-computed stat block values" convention (the same pattern `character_attacks`' `attackBonus` already uses, per `docs/rules/attacks-and-damage.md` §2.1).

**Recommendation, not a required change**: add a **pure helper function** the frontend can call to *suggest* a value while the player fills in a spell/attack's `saveDc` field (never server-enforced, matching the existing pattern where the server accepts whatever positive integer it's given):
```ts
export function computeSaveDc(
  proficiencyBonus: number,
  spellcastingAbilityModifier: number,
  specialModifiers = 0,
): number {
  return 8 + proficiencyBonus + spellcastingAbilityModifier + specialModifiers;
}
```
**Confirmed gap**: `proficiencyBonusForLevel` exists **only client-side** (`packages/web/src/lib/dnd-math.ts`) — there is no server-side equivalent anywhere (confirmed by grep across `packages/server/src` for "proficiencyBonus"/"2 + Math.floor"). If the dice engine (or any future server-side DC/attack-bonus validation) needs this formula, it must be added server-side too — right now it would need to be duplicated by hand into any server module that needs it, which is exactly the kind of drift this rebuild should prevent. Recommendation: put `proficiencyBonusForLevel` and `computeSaveDc` in a package both `packages/server` and `packages/web` can import from (or, at minimum, keep them byte-for-byte identical pure functions in both, with a shared unit-test fixture asserting they agree), rather than letting the server remain formula-blind.

**Total character level for multiclass characters**: `proficiencyBonusForLevel` takes *total* level, summed across all of a character's classes — confirmed by the existing client convention (`CharacterSheetPage.tsx` line 226: `classesQuery.data?.classes.reduce((sum, r) => sum + r.level, 0)`), which matches core 5e multiclassing rules (proficiency bonus is always based on total character level, never per-class level) — not independently re-derived from this grounding skill's spellcasting-rules text (multiclassing mechanics are out of this skill's explicit no-catalog scope for exact numbers, but the "proficiency bonus = f(total level)" framing is confirmed by the Levels table itself, which is keyed by single-class progression per class — the total-across-classes summation is this app's own correct existing convention, worth stating explicitly here since it's exactly the kind of thing a dice-engine rebuild could accidentally regress if someone re-derives `proficiencyBonus` from a single class's level column instead of the summed total).

### 3. Edge cases

- **Multiclass total level, not per-class level** — see above; a common implementation bug is reading a single `character_classes.level` row instead of summing across all the character's class rows.
- **"Any special modifiers" (2014) / unnamed in 2024's summary line but not contradicted**: a magic item or feature that adds a flat bonus to a specific spell/ability's save DC (rare, but SRD-legal) — the formula's `special_modifiers` term exists for this, defaulting to 0. This grounding set has no example of such an item/feature with exact numbers (out of this skill's scope, catalog data), so the engine must accept an optional bonus parameter, never assume it's always 0.
- **A character with no spellcasting ability at all** (e.g. a pure Fighter with no spellcasting feature) has no meaningful `save_dc` for spells — the formula is meaningless without a `spellcasting_ability_modifier` input; the engine should not silently compute a nonsensical DC using, say, STR by default. This app's existing schema already sidesteps this by making `saveDc` an optional, manually-entered field per attack/effect rather than a computed-from-character-class value, which avoids this failure mode entirely (no auto-computation means no "which ability" ambiguity to get wrong) — worth preserving in the rebuild, not "fixing" into auto-computation without deliberately deciding how a caster's spellcasting ability is determined and validated first.
- **Non-spell saving-throw DCs** (a monster's poison/breath-weapon DC, a trap's DC) use the identical `8 + prof + ability mod (+ special)` formula per both editions' general framing (2014's `ability-checks.md` line 380: "the DC for a saving throw allowed by a spell is determined by..." — stated for spells specifically, but the same monster stat-block convention this app's own `monsters` catalog already uses (`statBlockEntrySchema`'s `saveDc`) follows the identical shape) — the helper function above is not spell-specific despite the SRD's spell-focused wording, and should be named/scoped generically (`computeSaveDc`, not `computeSpellSaveDc`) so it's reusable for monster actions too.

### 4. What must be tested

- `computeSaveDc(2, 3) === 13` (level-1 example above), `computeSaveDc(4, 4) === 16` (level-9), `computeSaveDc(6, 5) === 19` (level-17), `computeSaveDc(2, 3, 1) === 14` (with an explicit `+1` special modifier).
- `proficiencyBonusForLevel(1) === 2`, `(4) === 2`, `(5) === 3`, `(8) === 3`, `(9) === 4`, `(12) === 4`, `(13) === 5`, `(16) === 5`, `(17) === 6`, `(20) === 6` — full boundary coverage of the table, both editions (a single shared test fixture run against both a server-side and web-side copy of the function, once the server-side gap above is closed, to guarantee they never drift apart).
- A test on the multiclass total-level path specifically: a character with `character_classes` rows `[{level: 3}, {level: 2}]` → total level `5` → proficiency bonus `+3`, **not** `+2` (which a per-class-level bug would incorrectly produce by reading only the first/primary class row).
- Since `save_dc` is currently a manually-entered field, not server-computed: a test asserting the server-side schema still accepts any positive integer for `saveDc` (no regression toward silently overwriting a DM's manually-entered value with an auto-computed one) — if/when the suggest-a-value helper ships in the frontend, it must remain non-authoritative, and a test should assert the server never rejects a `saveDc` that doesn't match what `computeSaveDc` would have produced from the character's stats (DMs are allowed to houserule a different DC).

---

## 6. Passive score calculation

### 1. Official rule

**2014** `references/2014/ability-checks.md` lines 140–144 and 258 (near-identical wording in two places — the general "Passive Checks" framing and the Perception-specific worked example): "`10 + all modifiers that normally apply to the check` ... If the character has advantage on the check, **add 5**. For disadvantage, **subtract 5**. ... if a 1st-level character has a Wisdom of 15 and proficiency in Perception, he or she has a passive Wisdom (Perception) score of 14."

**2024**: this grounding set's `ability-checks.md` does not carry an independently-quoted passive-score general-rule sentence in the excerpts checked (the skill's 2024 `ability-checks.md` file was read in full for "passive" — **flagged: no 2024-specific quoted passive-score formula was found in this grounding pass**, distinct from every other item in this doc which had explicit 2024 text). **Do not assume 2024 silently kept the exact `10 + mods ± 5` formula without re-verifying against the actual 2024 SRD 5.2 text** — the mechanic is extremely unlikely to have changed given (a) it's foundational to the entire d20-test framework 2024 explicitly restates elsewhere in near-identical terms to 2014, and (b) no 2024 source anywhere in this grounding set describes a *different* passive-score mechanic — but this doc is flagging the citation gap explicitly rather than presenting 2014's text as independently confirmed for 2024. Formula (confirmed for 2014, treated as unchanged for 2024 pending direct verification):

```
passive_score = 10
              + ability_modifier
              + (proficient ? proficiency_bonus : 0) * (expertise ? 2 : 1)
              + (has_advantage_on_this_check ? 5 : 0)
              - (has_disadvantage_on_this_check ? 5 : 0)
```

(Advantage and disadvantage on the *same* passive score cancel per the same boolean-collapse rule as §2 above — nothing in either edition's grounding text suggests passive scores get a special exception to that cancellation rule; treated as identical by extension, not independently re-quoted for the passive case specifically.)

**Worked example** (directly from 2014's own quoted text, both citations agree): 1st-level character, WIS 15 (modifier `+2`), proficient in Perception, proficiency bonus `+2` (level 1): `passive Perception = 10 + 2 + 2 = 14`. With advantage on Perception checks (e.g. a feature granting it): `14 + 5 = 19`. With disadvantage: `14 - 5 = 9`. A non-proficient character, INT 8 (modifier `-1`), passive Investigation: `10 - 1 = 9` (no proficiency bonus term at all, not proficiency bonus of 0 explicitly added — same numeric result either way, but the *proficient* flag, not a zero-valued bonus, is what should gate whether the term is included, for clarity in the engine's inputs).

### 2. Data model translation

**Confirmed deliberate non-storage, matching this app's existing convention**: `db/migrations/1784269737666_create-characters.ts` line 43's own comment: "Passive perception is NOT a stored column: computed at the query/app layer from `character_skill_proficiencies` + WIS." — i.e. this is already correctly treated as a **derived value**, not persisted state, consistent with the general 5e framing that a passive score is just "10 + what the check's modifier would be" rather than its own independent stat.

**Confirmed real gap**: `packages/web/src/lib/dnd-math.ts`'s existing `passivePerception` function:
```ts
export function passivePerception(wisModifier: number, perceptionSkillMod: number | null): number {
  return 10 + (perceptionSkillMod ?? wisModifier);
}
```
**has no advantage/disadvantage parameter at all** — it cannot produce the `±5` adjustment the SRD formula requires. This is a genuine, confirmed missing piece (not a hypothetical edge case) — the current implementation can only ever compute the "no advantage or disadvantage" case. Recommended fix, generalized beyond Perception specifically (since the identical formula applies to any skill's passive score — passive Investigation, passive Insight, etc. — not just Perception, per the general "Passive Checks" framing quoted above, not merely the Perception-specific worked example):
```ts
export function computePassiveScore(
  abilityModifier: number,
  proficiencyBonus: number,
  proficiencyLevel: 'none' | 'proficient' | 'expertise',
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): number {
  const profTerm =
    proficiencyLevel === 'expertise' ? proficiencyBonus * 2
    : proficiencyLevel === 'proficient' ? proficiencyBonus
    : 0;
  const advTerm = hasAdvantage && !hasDisadvantage ? 5 : !hasAdvantage && hasDisadvantage ? -5 : 0;
  return 10 + abilityModifier + profTerm + advTerm;
}
```
This should replace (or be layered under) the existing `passivePerception`/`skillModifier` functions in `dnd-math.ts`, and — same "who tracks advantage sources" gap flagged in §2.2 above — the `hasAdvantage`/`hasDisadvantage` inputs are **caller-supplied booleans**, not something this function derives from `active_effects` itself (no such aggregation exists in this codebase today, per §2.2's finding).

### 3. Edge cases

- **Passive score is a display/reference value, never itself "rolled"** — no RNG involvement, no server-authoritative concern in the sense that dice rolls have (a client can't "cheat" a passive score the way it could fake a die result, since there's no random component at all) — but it **can** still be wrong if computed with stale/incorrect proficiency or ability data, which is a data-integrity concern, not an RNG-trust concern. No server-side enforcement is needed for this reason specifically; client-side computation (as it already is, in `dnd-math.ts`) is appropriate here, unlike dice rolls.
- **Expertise doubles the *proficiency bonus term*, not the whole passive score** — `10 + mod + (prof × 2)`, never `(10 + mod + prof) × 2`. This mirrors the same "which term doubles" precision already required for critical hits (§1) — a plausible, easy implementation bug is doubling the final sum instead of just the proficiency term.
2014's own general Proficiency Bonus text (`ability-checks.md` line 52, already cited in `attacks-and-damage.md`'s grounding) confirms expertise-doubling is proficiency-bonus-specific, not a whole-roll multiplier.
- **A skill with no proficiency and no expertise**: the `profTerm` is simply `0` — passive score is `10 + ability modifier` only, exactly as 2014's own Investigation-adjacent framing implies (no proficiency bonus term appears at all, not a zero explicitly summed in, though the numeric result is identical either way).
- **Advantage AND disadvantage on the same passive check simultaneously**: cancels to `±0`, by the same extension-by-consistency reasoning as §2's general advantage/disadvantage cancellation rule — not independently re-quoted for the passive case in either edition's grounding text, flagged as an inferred-by-consistency application of the general rule rather than a directly-quoted passive-specific sentence.
- **2024 citation gap** (already flagged in §1 above): this doc's 2024 formula is carried over from 2014 by strong inference, not independent 2024 grounding-text confirmation. Whoever implements this should re-verify against the actual 2024 SRD 5.2 text (or wait for the skill's maintainers to add an explicit 2024 passive-score section) before treating this as equally sourced to every other item in this doc.

### 4. What must be tested

- `computePassiveScore(2, 2, 'proficient', false, false) === 14` (the exact 2014-quoted worked example: WIS 15 → mod +2, level-1 prof bonus +2, proficient).
- `computePassiveScore(2, 2, 'proficient', true, false) === 19` (same character, advantage) and `computePassiveScore(2, 2, 'proficient', false, true) === 9` (same character, disadvantage).
- `computePassiveScore(2, 2, 'proficient', true, true) === 14` (advantage and disadvantage cancel — regression test for the "don't just always add if hasAdvantage is true" bug).
- `computePassiveScore(-1, 2, 'none', false, false) === 9` (non-proficient, negative ability modifier — the Investigation example above).
- `computePassiveScore(2, 2, 'expertise', false, false) === 16` (`10 + 2 + (2*2)`, not `10 + 2 + 2` and not `(10+2+2)*2 = 28` — both plausible doubling-location bugs this test must distinguish between).
- A unit test comparing `computePassiveScore`'s output against `skillModifier(...) + 10` for the non-advantage/disadvantage case, asserting the two existing/new `dnd-math.ts` functions never silently diverge in their shared proficiency-bonus-term logic (both should derive from one shared internal helper, not two independently-maintained copies of the "which proficiency term" ternary).

---

## DM-configurable, never hardcoded

Named explicitly, per this repo's persona convention:

- **`campaigns.allow_ability_reroll`** (existing, §3.2) — whether a player may re-invoke ability-score generation more than once. Already correctly modeled as a per-campaign boolean column, not a hardcoded always-allowed/always-blocked default.
- **A generic "minimum die value" homebrew rule beyond 2024's confirmed Great Weapon Fighting case** (§4) — if the rebuild wants to let a DM define an arbitrary "this campaign's Barbarians never roll below 4 on rage damage dice" house rule using the generic `clampDieMinimum` primitive, that configuration must be explicit, campaign- or character-scoped DM-authored data (a `campaigns` settings JSONB key or a per-character/per-weapon flag, per this doc's §4.2 recommendation), never a silently-applied default — the engine having the *capability* is not the same as the SRD endorsing its use outside 2024's one confirmed named case.
- **A hypothetical "immune to disadvantage on X" effect** (§2.1) — not found anywhere in this grounding set's SRD text; if ever implemented, it is homebrew content requiring explicit DM authorship (an `active_effects` row or similar), never a default behavior attached to any SRD-named trait without independently re-verifying that trait's exact text first.
- **Whether the engine auto-aggregates advantage/disadvantage from tracked effects, or stays purely "DM/player selects the enum value"** (§2.2) — this app's existing convention is the latter (display-only state, human-adjudicated selection), consistent with the "no auto-computed advantage/disadvantage" precedent already established in `docs/rules/actions.md`. If the rebuild changes this, that's a deliberate architecture decision to make and name explicitly, not something to slide into "just how the dice engine works" without a conscious call.
- **Any flat "special modifiers" term on a saving throw DC** (§5) — always DM/build-authored per-effect content (a specific magic item's or feature's bonus), never a global campaign-wide default; the formula's optional parameter exists precisely so this stays per-call data, not baked into the base 8 + prof + mod formula.

---

## Implementation notes (Iteration 3, Increment 5)

Shipped: `packages/server/src/services/diceEngine.ts` (`criticalDiceCount`,
`resolveAdvantage`, `rerollOnceIfMatches`, `clampDieMinimum`,
`computeSaveDc`, `proficiencyBonusForLevel` — closing the confirmed
server-side gap §5.2 flagged), full unit-test coverage of every worked
example in §1.4/§2.4/§3.4/§5.4 (`diceEngine.test.ts`), `computeSaveDc`/
`computePassiveScore` added to `packages/web/src/lib/dnd-math.ts` (§5.4/§6.4
worked examples covered in `dnd-math.test.ts`, including the
expertise-doubles-the-term-not-the-sum and advantage/disadvantage-cancel
regression tests §6 calls out), `characters.ts`'s/`monsters.ts`'s duplicated
crit-doubling ternary now calls `criticalDiceCount`, and the `dice_rolls.
is_critical` column (§1.2's recommendation) shipped with a migration and a
badge in `DiceRollHistoryPage.tsx`.

**Deliberately deferred, not silently dropped**: unifying `services/
diceRolls.ts`'s `parseHitDice` and `components/QuickDiceRoller.tsx`'s
`parseDiceExpression` into one shared grammar module. Both parse the same
"NdM+K" shape, but literally sharing one module between the two would need
a new `packages/shared`-style workspace package (project references, build
ordering, tsconfig wiring) — real monorepo infrastructure, not a dice-rules
change, and neither parser has an active bug (server's only ever parses
trusted catalog hit-dice strings, client's only ever parses free-text user
input for the quick-roll UI — the two were never a security boundary, just
duplicated code). Left as two independently-maintained, structurally
near-identical implementations; worth a dedicated infra pass if it becomes
a real pain point (e.g. the grammars visibly drift), not bundled into this
increment.

**Bug found live while verifying the `is_critical` badge, not part of the
original defect inventory**: `DiceRollHistoryPage.tsx`'s paginated roll
history query was gated on `enabled: Number.isInteger(campaignId)` —
`campaignId` has been a UUID string since the uuid-primary-keys migration,
so `Number.isInteger` on a string is always `false` and the query never ran
for any campaign, ever. Live rolls still arrived via the `DICE_ROLLED`
socket event (separate state, not gated by this flag), which is exactly
why the page looked partially functional rather than obviously broken.
Fixed in the same pass (`enabled: isUuid(campaignId)`, matching every other
page's convention) and live-verified: before the fix, a campaign with real
`dice_rolls` rows showed "No dice rolls yet"; after, the same rows render,
including the new critical badge.
