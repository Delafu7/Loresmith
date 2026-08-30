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
