# D&D 2024 Remediation — Progress Log

Tracks phase completion against `docs/roadmap/dnd-2024-gap-analysis.md`. One entry per completed phase.

## Phase 1 — P0 rule bugs (done)

**P0-1: Long Rest hit-dice recovery formula.**
- `computeHitDiceRestore()` (`packages/server/src/services/rests.ts`) now takes an `edition: '2014' | '2024'` parameter. 2024 restores all spent hit dice; 2014 keeps the prior `floor(total/2)` (min 1) formula.
- `performRest()` now fetches the campaign's `srd_edition` and passes it through, following the existing edition-branching pattern already used in `services/encounters.ts` (`assessEncounterXp`, movement).
- Rule source: `docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:1135`, "Long Rest" § Benefits of the Rest — "You regain all lost Hit Points and all spent Hit Point Dice."
- Open Question 2 (gap analysis) resolved by following the codebase's existing precedent: edition-branch rather than pick one formula for both editions.
- Tests: `services/rests.test.ts` (unit, both editions), `services/rests.performRest.integration.test.ts` (live DB, 2024 campaign — updated to assert full restoration, which fails against the old half-formula).

**P0-2: Concentration DC cap.**
- `computeConcentrationDc()` (`packages/server/src/services/concentration.ts`) now applies `Math.min(30, ...)`.
- Rule source: `docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:515`, "Concentration" — "up to a maximum DC of 30."
- Tests: `services/concentration.test.ts` gains a boundary case (60→30, 62→30 regression, 100→30).

**Verification:**
- `npx tsc -b --force` in `packages/server`: clean.
- `npm test` in `packages/server` (live DB): 647/648 pass. The one failure (`campaignClasses.integration.test.ts`, "a local override in one campaign never affects the same class imported into a different campaign") is a pre-existing, unrelated test-data collision — confirmed present on `main` before this phase's changes (verified via `git stash` + re-run against a freshly re-seeded DB). Not touched this phase.
- `git status`: only files listed above modified, no scope violations.

**Not done / stopped for:** nothing — no dependency/schema/migration/deletion needed for this phase.

## Phase 2 — P1 core play loop (in progress)

**P1-1: Death saving throw state machine.**
- Rules grounded in `docs/rules/death-saving-throws.md` (full citation chain into `.opencode/skills/dnd5e-srd/references/2014|2024/combat.md` and `conditions.md`) before writing any code, per this project's own "consult the rules agent first" convention. The mechanic is confirmed identical between 2014 and 2024; only "knocking a creature out" differs by edition, and that mechanic is explicitly deferred (below).
- Schema: `db/migrations/1784269831666_add-death-save-columns.ts` adds `characters.death_save_successes`/`death_save_failures` (`SMALLINT 0-3`) and `characters.is_stable` (`BOOLEAN`). `is_alive` (pre-existing, previously never written after INSERT) becomes the real terminal "dead" state. "Stable" is a column, not an `active_effects` row — confirmed via the skill's own condition catalog query that it isn't one of the 15 SRD conditions in either edition.
- `services/characters.ts`:
  - `applyDamage` — inside the existing locked transaction, now computes the massive-damage/overkill formula (`overkill = damage-that-reached-hp_current − pre-hit hp_current`; `overkill >= hp_max` ⇒ instant death, independent of the failure counter), the falling-unconscious transition (applies a real `Unconscious` `active_effects` row via a new `applyOrRemoveUnconsciousEffect` helper), damage-at-0-HP failures (1, or 2 on a critical hit, reusing the same `isCritical` the damage pipeline already derives server-side), and stability breaking on any damage.
  - `applyHpDelta` (the plain heal/manual-correction path) — rejects a positive delta against an `is_alive = false` character ("can't regain hit points until magic such as revivify"), and resets the death-save counters/`is_stable`/Unconscious on any heal that brings a 0-HP character above 0 — a second, easy-to-miss code path implementing the same §1.4 reset as a nat-20 death save.
  - New `rollDeathSave(pool, actorId, characterId)` — `POST /characters/:id/death-save`, no request body, server-rolls the d20 (finally giving `dice_rolls.roll_type = 'death_save'` a real writer). Rejects (409) unless `hp_current === 0 && is_alive && !is_stable`. Implements nat-1 (2 failures), nat-20 (regain 1 HP, full state clear), 3-success stabilization (wipes both counters), 3-failure death.
  - New `stabilizeCharacter(pool, actorId, targetCharacterId, input)` — `POST /characters/:id/stabilize` (`:id` = target, `helperCharacterId` + `modifier` in the body), the Help-action DC 10 Wisdom (Medicine) check. Authorized by control of the **helper**, not the target. `modifier` is client-supplied, matching this app's existing trust model for every other skill check (`services/diceRolls.ts`'s `rollDice` never re-derives ability-score/proficiency math server-side either) — only the d20 itself is rolled server-side.
- `services/encounters.ts`'s `advanceTurn` gains a `deathSaveDue: boolean` on `AdvanceTurnResult` — true when the participant whose turn just started is a character at 0 HP, alive, and not Stable. Prompt only, matching the existing `CONCENTRATION_CHECK_PROMPTED` pattern — the roll itself stays a separate call.
- Explicit resolution of the one SRD silence flagged by the rules doc: a hit that breaks Stable status does **not** itself count as the new sequence's first failure (§1.6's silence on the interaction; documented in code comments pointing back to the rules doc).
- Tests: `services/characters.deathSaves.integration.test.ts` (new, 20 cases, live DB) — falling unconscious, massive damage at/under the exact threshold (boundary-tested via retry-on-actual-die-value, no RNG mocking, matching this codebase's existing "real RNG" testing convention), damage-at-0-HP failures (including critical doubling), massive damage overriding the failure counter, breaking Stable, all four `rollDeathSave` rejection/outcome branches (illegal states, nat 1, nat 20, ordinary success/failure), `stabilizeCharacter` success/failure/rejection, and the `applyHpDelta` heal-reset/dead-reject paths.

**Verification:**
- `npx tsc -b --force` in `packages/server`: clean.
- `npm test` in `packages/server` (live DB): 667/668 pass (648 pre-Phase-2 + 20 new, minus the 1 pre-existing unrelated failure carried over from Phase 1's note; `campaignClasses.integration.test.ts` still not touched this phase). Ran the new file 4x in a row with no flakes.
- `npm run migrate` applied cleanly against the live dev DB; confirmed the new columns and their `CHECK` constraints via `\d characters`.

**Not done / stopped for — scoped out with the user before starting, each a separate follow-up item:**
- **`monster_instances` death-save opt-in** (`uses_death_saves`, per the rules doc's §1.9/§2.2 "mighty villain" exception) — monsters keep today's unconditional instant-death-at-0-HP default, unchanged.
- **"Knocking a creature out"** — a genuine 2014-vs-2024 mechanical difference (2014: 0 HP + Stable; 2024: 1 HP, never touches 0-HP/Stable at all) documented in `docs/rules/death-saving-throws.md` §1.8, not implemented.
- **1d4-hour natural stabilized recovery** — no time-advancement mechanism exists anywhere in this app to hang the roll off of; a Stable character currently has no path back to 1 HP without an explicit heal.
- **`undoLastDamage` does not rewind death-save state** — it still only restores `hp_current`/`hp_temp` from `last_hp_snapshot`; a DM undoing damage that killed or downed a character must currently also manually fix `is_alive`/the counters. Flagged in a code comment at the snapshot site rather than silently left undocumented.
- **Advantage/bonus-granting features on a death save** (§1.2 — a spell/feature that grants advantage or a flat bonus "on saving throws") — no such catalog data or hook exists yet; the base roll stays flat DC 10 with no modifier.

**P1-2: Auto-apply species/background mechanical grants at character creation (scoped).**
- Consulted the `dnd-rules` agent first, which also surveyed the current catalog/character-creation code before any design decision (per this project's own convention). That survey surfaced two catalog gaps not previously itemized in `dnd-2024-gap-analysis.md`: **tool proficiencies have no schema anywhere** (no catalog table, no character join table), and **background starting gear/gold is dropped at seed time**, not merely unwired. It also found only **4 of the 16 official 2024 backgrounds are seeded at all** (Acolyte, Criminal, Sage, Soldier).
- Given that, and the gap analysis's own Open Question 3 (whether full automation is even the intended design direction), scope was confirmed with the user before writing any code. Chosen scope: pre-fill only what the catalog can fully answer without an unmodeled player choice or missing schema, and never reject a client-supplied value that contradicts the catalog (a client can always override).
- **In scope, implemented:**
  - Ability-score bonus — **2014 race/subrace only** (fixed, no player choice: e.g. Dwarf CON+2, Hill Dwarf +1 WIS, confirmed against the live seed). Always added on top of the client's submitted base score when a `raceId`/`subraceId` is set — not offered as a skippable default, since there's no legitimate "apply this race but not its bonus" case.
  - Speed — pre-filled from `races.speed` when the client omits it. Required dropping `speed`'s create-time schema default (`schemas/characters.ts`) from `.default(30)` to `.optional()` so "the client sent nothing" becomes observable to the service instead of always arriving as 30; the wizard already never sends `speed` today, so this is a pure behavior improvement with no frontend change needed.
  - Darkvision → `senses` — parsed from the race's `traits` JSONB (`services/characters.ts`'s new `darkvisionFeetFromTraits`). The seed encodes this two different ways per edition, confirmed against live data rather than assumed: 2014 uses a bare `'darkvision'` index (that edition's one uniform 60 ft radius); 2024 suffixes the actual feet value (`'darkvision-60'`, `'darkvision-120'` for Dwarf/Orc's non-standard range). Only fills `senses` when the client didn't already send one.
  - Background skill proficiencies and granted feat — auto-inserted into `character_skill_proficiencies`/`character_feats` in the same transaction as character creation, from `backgrounds.skill_proficiency_ids`/`granted_feat_id`. `ON CONFLICT DO NOTHING` on both, an explicit **app-design choice, not an SRD rule** — the agent's rules lookup confirmed the SRD corpus is silent on what happens when a background-granted skill overlaps one a class also grants.
- **Deliberately out of scope this pass (each a real, separate follow-up, not silently dropped):**
  - **2024 background ability-score bonus** — genuinely requires a player CHOICE (+2/+1 vs. +1/+1/+1, and which of the background's 3 listed abilities gets which) that no part of this app collects today (the wizard's `AbilityScoresStep` has zero `backgroundId` linkage). Guessing a distribution would be worse than not automating it; needs a wizard UI change first.
  - **Tool proficiencies** — no schema at any level (catalog or character-side); a background's granted tool (e.g. Acolyte's Calligrapher's Supplies) currently can't be persisted at all.
  - **Starting gear/gold** — background equipment/gold data is dropped at seed time, before it ever reaches a `backgrounds` column; needs its own seed + schema change.
  - **Race-granted damage resistances** — several are themselves a player choice (Dragonborn's draconic-ancestry ties its resistance type; Tiefling's Fiendish Legacy is a chosen legacy), not worth doing only for the fixed-resistance minority (Dwarf's poison resistance, 2014 Tiefling's fixed fire resistance).
  - **Catalog completeness** (FT-01/SB-01/SB-02, and the newly-found 4/16-backgrounds gap) — unchanged this phase; the automation above is real but will only ever fire for whatever fraction of species/backgrounds are actually seeded.
- Tests: `services/characters.speciesBackgroundGrants.integration.test.ts` (new, 10 cases, live DB) — race+subrace bonus stacking, speed/senses pre-fill vs. explicit-override, the no-`raceId` no-regression case, background skill+feat auto-grant, the explicit "2024 gets no ability bonus yet" regression guard, and the no-`backgroundId` no-op case. Catalog row ids are looked up by `index_key` in the test setup, not hardcoded, so this survives a reseed.

**Verification:**
- `npx tsc -b --force` in both `packages/server` and `packages/web`: clean (the `speed` schema type change is shared, so both were checked).
- `npm test` in `packages/server` (live DB): 677/678 pass (668 prior + 10 new; the 1 failure is the same pre-existing, unrelated `campaignClasses.integration.test.ts` collision noted in Phase 1/P1-1, still untouched).
- No new migration — everything reads from and writes to columns/tables that already existed.

