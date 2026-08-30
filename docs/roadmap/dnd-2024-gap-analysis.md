# D&D 2024 Rules Gap Analysis

Audited against `.claude/skills/dnd-2024-rules/` (sourced exclusively from `docs/players-handbook-2024/`) as the sole rules authority. Every rule claim below carries a `file § section (line)` pointer resolved through that skill; claims that couldn't be resolved are marked `[unverified]` and excluded from P0.

## Executive Summary

Loresmith's combat/campaign core (movement, encounters, action economy, spell slots, bastions) is mature and mostly correct. The 2024 ruleset audit found two live rule contradictions (Long Rest hit-dice formula, Concentration DC cap — both trivial fixes), and a large surface of *tracked-but-not-mechanically-enforced* state: species/background grants, weapon mastery, conditions, and prepared-spell caps all have data models but no auto-application. The single biggest risk isn't a rule bug — it's that the game-data catalog (races/classes/feats/equipment) is seeded from a third-party community dataset that is a **different corpus** than this project's own rules-authority skill, so for 6 of 12 classes (Paladin/Ranger/Rogue/Sorcerer/Warlock/Wizard) the seeded content is literally unverifiable against `docs/players-handbook-2024/` (see Open Question 1). Feat and subclass catalogs are also numerically incomplete (17/69 feats, 12/48 subclasses) even where verifiable. Death saving throws have no state machine at all — a gap in the single most common combat event. Recommend: fix the two P0 bugs immediately, then decide the catalog-provenance question before investing further in catalog completeness.

## Findings

Status legend: **Impl**=Implemented, **Part**=Partial, **Miss**=Missing, **Contra**=Contradicts 2024 rules. Impact: B=Blocking, C=Core, N=Nice-to-have.

| ID | Domain | Status | Summary | Evidence | Rule source | Impact | Effort |
|---|---|---|---|---|---|---|---|
| CB-06 | Combat | Miss | Death saving throws have no state machine (success/fail counters, stabilization, 0-HP damage rules) — only a dice-roll label exists | `dice_rolls` kind check-constraint has `'death_save'` as a label only (`db/migrations/1784269755666_create-dice-rolls.ts`); searched `services/characters.ts`, `services/damage.ts` — no counters/fields found | `combat.md` (routing table: death saves) | B | M |
| ER-01 | Exploration & Rest | Contra | Long Rest restores only `floor(total_hit_dice/2)` (2014 rule) instead of 2024's "all lost HP and all spent Hit Point Dice"; no per-campaign edition branching | `services/rests.ts:5-7,38` | `exploration-and-rest.md` "Long Rest" § Benefits (Glossary 1133-1141) | C | M |
| SP-02 | Spellcasting | Contra | `computeConcentrationDc()` has no upper bound; rule caps the DC at 30 | `services/concentration.ts:13-15` (`Math.max(10, Math.floor(damage/2))`, no `Math.min(30, …)`) | `rules-glossary.md` line 37 ("DC = 10 or half damage, whichever is higher, **max 30**") | N | S |
| CC-02 | Character Creation | Miss | Background-granted ability score bonus (+2/+1 or +1/+1/+1, cap 20) never applied or validated — scores are raw client input | `schemas/characters.ts`, `services/characters.ts:191-202`; searched `wizard/AbilityScoresStep.tsx`, `wizard/IdentityStep.tsx` — no `backgroundId` linkage | `character-creation.md` Step 3 "Adjust Ability Scores" (lines 310-322) | C | M |
| CC-03 | Character Creation / Species & Backgrounds | Miss | Species traits (speed, darkvision, resistances) and background grants (Origin feat, 2 skills, 1 tool, gear) never auto-applied — `raceId`/`backgroundId` stored only as FK references | Searched `wizard/FeatsStep.tsx`, `SkillsStep.tsx`, `EquipmentStep.tsx`, `services/characterFeats.ts` — zero `backgroundId`/`raceId` mechanical hits | `character-creation.md` Step 2 (lines 22-24); `species-and-backgrounds.md` | C | L |
| SB-01 | Species & Backgrounds | Miss | Species catalog missing Aasimar (9/10 seeded: dragonborn, dwarf, elf, gnome, goliath, halfling, human, orc, tiefling) | `.opencode/skills/dnd5e-srd/data/2024/5e-SRD-Species.json` (9 entries, verified via `python3 -c` count) | `species-and-backgrounds.md` lines 36-51 (10 species) | C | S |
| FT-01 | Feats & Epic Boons | Miss | Feat catalog has 17/69 total feats (10 Origin + 37 General + 10 Fighting Style + 12 Epic Boon). Only 4/10 Origin feats present (Alert, Magic Initiate, Savage Attacker, Skilled); missing Crafter, Musician, Tough, Healer, Lucky, Tavern Brawler — needed by 7/16 backgrounds. Only 4/10 Fighting Style, 7/12 Epic Boon feats seeded | `.opencode/skills/dnd5e-srd/data/2024/5e-SRD-Feats.json` (17 entries) vs `species-and-backgrounds.md` background table | `feats-and-epic-boons.md` lines 11, 28, 78, 95 | C | L |
| CS-01 | Classes & Subclasses | Miss | Subclass catalog has exactly 1 subclass per class (12 total) vs the PHB's stated 4 per class (48 total) | `.opencode/skills/dnd5e-srd/data/2024/5e-SRD-Subclasses.json` (12 entries, one per class) | `classes-and-subclasses.md` line 7, citing Ch3 line 300 ("twelve classes, each... four subclasses") | C | L |
| EQ-02 | Equipment & Weapon Mastery | Miss | Weapon Mastery properties are cataloged but mechanically inert — "mastery" appears only in the read-only catalog endpoint, never in attack/damage resolution; no character-level "known masteries" tracking exists | `services/catalog.ts:74-83` (only hit); searched `combatActions.ts`, `damage.ts`, `characterAttacks.ts`, `schemas/*.ts` for masteries — no hits | `equipment-and-weapon-mastery.md` | C | L |
| SP-03 | Spellcasting | Miss | Prepared-spell count cap (class level + spellcasting ability mod, min 1) not enforced — `is_prepared` is a free toggle | `services/characterSpells.ts` (`toggleCharacterSpellPrepared`, no count check) | `spellcasting.md` (prepared spells) | C | M |
| ER-02 | Exploration & Rest | Miss | Short Rest hit-die spending (roll die + CON mod, min 1 HP, spent one at a time) is entirely unimplemented as a player action; deliberately scoped out per the code's own comment | `services/rests.ts:8-12`; no `spendHitDie`-type function found anywhere | `exploration-and-rest.md` "Short Rest" § Spending Hit Point Dice (Glossary 1401) | C | M |
| CB-04 | Combat | Miss | Surprise mechanic entirely unimplemented | Zero matches for "surprise" anywhere in `packages/server/src` | `combat.md` (routing table: surprise) | C | M |
| CB-05 | Combat | Miss | Cover (Half/Three-Quarters/Total — AC/Dex-save bonus, Total Cover blocks targeting) not implemented in AC computation | `services/armorClass.ts` — no cover-related logic found | `combat.md` (routing table: cover) | C | M |
| CB-02 | Combat | Miss | Rage-style *temporary* damage resistance not implemented — should read live off `active_effects`, not be written into permanent resistance columns; today a DM must manually add/remove it | `OPEN_QUESTIONS.md` item 7; `docs/rules/attacks-and-damage.md` §2.4 | `docs/rules/attacks-and-damage.md` §2.4 (project's own prior rules doc, corroborated) | C | M |
| CB-03 | Combat | Miss | `character_attacks.half_on_save` column exists but is never read — no automatic half-damage-on-successful-save | `OPEN_QUESTIONS.md` item 7 | `docs/rules/attacks-and-damage.md` (project's own prior rules doc) | C | S–M |
| ER-05 | Exploration & Rest | Miss | Hide action (DC 15 Dex(Stealth), grants Invisible-while-hidden, specific break conditions) entirely unimplemented | Searched `services/*` for "hide"/"DC 15"/"Hide action" — only unrelated DM-visibility-toggle terminology and one demo monster-trait description found | `exploration-and-rest.md` "Hiding" (Glossary 954-961); also named in this project's own `dnd-rules` subagent scope definition (vs-project-goals) | C | M |
| CS-02 | Classes & Subclasses (cross-cutting) | Unknown | Catalog seed (races/classes/subclasses/feats/backgrounds/equipment) is sourced from a third-party community SRD dataset (`.opencode/skills/dnd5e-srd/data/2024/`), a **different corpus** than this project's rules authority (`docs/players-handbook-2024/`). For the 6 classes absent from the skill's source (Paladin/Ranger/Rogue/Sorcerer/Warlock/Wizard — confirmed present in the seed's `5e-SRD-Classes.json`), seeded content is unverifiable against this project's own rules authority | `db/seeds/catalog.ts` (loads from `.opencode/skills/dnd5e-srd/data/`); `.claude/skills/dnd-2024-rules/SKILL.md` lines 14 (class-coverage gap) | n/a — architecture risk, see Open Question 1 | B | n/a |
| SB-02 | Species & Backgrounds | Miss | Seeded species traits are sparse vs. full 2024 text — e.g. Dragonborn's seeded traits list has 2 entries (Darkvision, Draconic Flight) vs. 5 distinct mechanics in the source (Ancestry choice, Breath Weapon, Damage Resistance, Darkvision, Draconic Flight) | `5e-SRD-Species.json` dragonborn entry (`traits: [darkvision-60, draconic-flight]`) | `species-and-backgrounds.md` line 43 | C | L |
| CC-04 | Character Creation | Part | Trinkets — catalog data seeded but never surfaced in the character creation wizard | `db/seeds/catalog.ts` has trinket data; zero references anywhere under `packages/web/src` | `character-creation.md` line 23 ("one free trinket") | N | S |
| CB-01 | Combat | Part | 2024 occupancy passability exception for Incapacitated creatures not implemented (project's own documented gap) | `OPEN_QUESTIONS.md` item 6; `docs/rules/movement.md`; `services/movement.ts` code comments | `docs/rules/movement.md` (project's own prior rules doc, corroborated) | N | M |
| CB-07 | Combat | Part | Conditions are tracked as applied `active_effects` rows (seeded, edition-scoped catalog) but their mechanical consequences (Prone→melee advantage, Restrained→attack/save disadvantage, etc.) are never auto-applied in attack/damage resolution | Searched `services/damage.ts`, `services/characterAttacks.ts` for condition-name references — zero hits | `rules-glossary.md` (per-condition entries); `combat.md` | N | L |
| CB-08 | Combat | Part | Opportunity attacks — reaction-spend economy exists, but no automatic trigger detection (leaving a threatened square without Disengaging doesn't auto-prompt a reaction) | `services/encounters.ts:1214-1218` (reactions carve-out exists; no trigger logic found) | `combat.md` (opportunity attacks) | N | M |
| ER-03 | Exploration & Rest | Part | Long Rest doesn't auto-reduce Exhaustion by 1; a DM can do it manually via a separate endpoint but `performRest` never does | `services/rests.ts` (no exhaustion references); `services/characters.ts:973-990` (`updateExhaustion`, separate manual endpoint) | `exploration-and-rest.md` "Exhaustion recovery" (Glossary 838) | N | S |
| ER-04 | Exploration & Rest | Miss | Rest interruption tracking (initiative/damage/non-cantrip spell/1hr exertion) and Long Rest's partial-credit-as-Short-Rest rule unimplemented — `performRest` is an instant, unconditional bulk action | `services/rests.ts` (no eligibility/interruption checks) | `exploration-and-rest.md` Long/Short Rest "Interruption" rows | N | L |
| ER-09 | Exploration & Rest | Part | Vision model (range + line-of-sight + single darkvision radius) supports the project's own fog-of-war "reveal engine" goal, but doesn't model Lightly/Heavily Obscured distinctly (Perception disadvantage vs. Blinded) or separate Blindsight/Tremorsense/Truesight senses | `domain/vision.ts:73-129` — single `darkvisionRadiusFt` field, no blindsight/tremorsense/truesight or light-category fields found | `exploration-and-rest.md` "Vision, light, and obscurement" | N | L |
| ER-06 | Exploration & Rest | Miss | Fall damage (1d6 bludgeoning/10ft, capped 20d6, Prone on landing, DC15 save halving damage into liquid) unimplemented; blocked on elevation/pit-trigger support not existing in the map/movement model | Searched `services/movement.ts` for "fall"/elevation — no z-axis or fall-trigger logic found | `exploration-and-rest.md` "Hazards" § Falling (Glossary 858-862) | N | M (dep: elevation tracking, not a current feature) |
| ER-07 | Exploration & Rest | Miss | Travel pace (Fast/Normal/Slow speed + skill-check (dis)advantage) unimplemented; no evidence of intended overland-travel simulation | Zero matches for "travel pace"/"travelPace" anywhere in `packages/server/src`; not mentioned in README/BACKLOG | `exploration-and-rest.md` "Travel pace" (Ch1 884-903) — vs-rules only | N | L |
| ER-08 | Exploration & Rest | Miss | Environmental hazards beyond falling (Burning, Dehydration, Malnutrition, Suffocation) unimplemented; no evidence of survival-mechanic scope in project docs | Zero matches for these terms anywhere in `packages/server/src` | `exploration-and-rest.md` "Hazards" — vs-rules only | N | L |
| CC-01 | Character Creation | Impl | Ability score generation implements all 3 official 2024 methods (Standard Array, 4d6-drop-lowest, Point Buy) plus manual entry, server-authoritative rolling | `wizard/AbilityScoresStep.tsx:1-6` ("all four modes"); `services/abilityScoreRoll.ts` | `character-creation.md` Step 3 (lines 27-33) | — | — |
| CC-05 | Character Creation | Impl | Languages implemented as a structured array of catalog language IDs (not free text), tied to a seeded, edition-scoped languages catalog | `schemas/characters.ts:35` | `character-creation.md` Step 2 (lines 221-257) | — | — |
| CC-06 | Character Creation | Impl | Multiclass prerequisites correctly implement the Fighter Str-13-OR-Dex-13 exception via a `requirement_group` column (fixing an earlier AND-only bug) | `db/migrations/1784269751666_add-multiclass-prereq-requirement-group.ts` | corroborated directly by the migration's own SRD-sourced comment | — | — |
| EQ-01 | Equipment & Weapon Mastery | Impl | Weapon Mastery property catalog complete — all 8 properties seeded (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) | `5e-SRD-Weapon-Mastery-Properties.json` (8 entries) | `equipment-and-weapon-mastery.md` | — | — |
| SP-01 | Spellcasting | Impl | Multiclass spell-slot computation (full/half/third/pact caster types) correctly computed server-side as a synced cache | `services/spellSlots.ts` | `spellcasting.md`; `classes-and-subclasses.md` (per-class spellcasting tables) | — | — |

## Roadmap

### P0 Correctness — rules the project gets wrong today

**P0-1: Fix Long Rest hit-dice recovery formula.**
- What: `performRest`'s long-rest branch restores `floor(total_hit_dice/2)` instead of all hit dice.
- Why it matters: this runs on every long rest in every campaign; currently wrong for all 2024-mode campaigns.
- Rule source: `exploration-and-rest.md` "Long Rest" § Benefits (Glossary 1133-1141).
- Acceptance criteria: a long rest in a `srd_edition='2024'` campaign restores 100% of spent hit dice (not 50%); a `2014` campaign's behavior is an explicit decision (see Open Question 2), not silently identical.
- Dependencies: Open Question 2 (should 2014-mode keep the half-dice rule, requiring edition branching, or should this project only ever run one formula?).
- Effort: M.

**P0-2: Cap Concentration DC at 30.**
- What: `computeConcentrationDc()` in `services/concentration.ts` needs `Math.min(30, Math.max(10, Math.floor(damage / 2)))`.
- Why it matters: currently wrong for any single damage instance ≥ 41.
- Rule source: `rules-glossary.md` line 37.
- Acceptance criteria: `computeConcentrationDc(100)` returns 30, not 50; existing unit test suite gains a case at the boundary (40→20, 41→30, 60→30).
- Dependencies: none.
- Effort: S.

### P1 Core play loop — foundational to running a session

**P1-1: Death saving throw state machine.**
- What: track success/failure counts on `characters`, apply the natural-20/natural-1/damage-at-0-HP rules, and stabilization.
- Why: dropping to 0 HP is one of the most common combat events; currently has zero mechanical support beyond a dice-roll label.
- Rule source: `combat.md` (routing table: death saves).
- Acceptance criteria: a character at 0 HP can log a death save that increments the correct counter; 3 successes stabilizes them; 3 failures (or a nat-1 counting double, or damage taken at 0 HP) marks them dead; a nat-20 restores 1 HP.
- Dependencies: none.
- Effort: M.

**P1-2: Auto-apply species/background mechanical grants at character creation.**
- What: derive ability-score bonus, speed, darkvision, resistances, granted feat, skill/tool proficiencies, and gear from `raceId`/`backgroundId` instead of accepting them as raw client input.
- Why: this is the foundation of build correctness — currently a client can submit any values regardless of chosen species/background.
- Rule source: `character-creation.md` Step 2-3; `species-and-backgrounds.md`.
- Acceptance criteria: selecting a species/background in the wizard populates (and the server validates) speed, darkvision, ability bonuses, granted feat, skills, and tools without manual re-entry; submitting a mismatched value is rejected.
- Dependencies: FT-01 (feat catalog must contain a background's granted feat before it can be auto-granted); SB-01/SB-02 (species catalog must be complete).
- Effort: L.

**P1-3: Complete species catalog (add Aasimar; fill sparse traits).**
- Acceptance criteria: 10/10 species present; each species' traits array covers every named mechanic in `species-and-backgrounds.md`'s table for that species.
- Dependencies: none.
- Effort: S (Aasimar) + L (trait depth).

**P1-4: Complete feat catalog (69 total; all 16 backgrounds' granted feats present).**
- Acceptance criteria: every background in the catalog can resolve its granted feat by index key; Origin/General/Fighting Style/Epic Boon counts match `feats-and-epic-boons.md`.
- Dependencies: none.
- Effort: L.

**P1-5: Complete subclass catalog (4 per class, 48 total).**
- Acceptance criteria: every seeded class has exactly 4 subclasses; for the 6 skill-verified classes, subclass content is cross-checked against `classes-and-subclasses.md`.
- Dependencies: Open Question 1 (data provenance) should be resolved first — no point completing a catalog sourced from an unverifiable corpus.
- Effort: L.

**P1-6: Implement Weapon Mastery mechanical effects.**
- What: apply each of the 8 mastery properties' effects during attack resolution, gated by a new "known masteries" count derived from class.
- Acceptance criteria: an attack with a mastery-flagged weapon applies that property's effect (e.g., Vex grants advantage on the wielder's next attack against the same target) when the wielder knows that mastery.
- Dependencies: EQ-01 (catalog, done).
- Effort: L.

**P1-7: Enforce prepared-spell cap.**
- Acceptance criteria: `toggleCharacterSpellPrepared` rejects preparing beyond `class level + spellcasting ability modifier (min 1)`.
- Dependencies: none.
- Effort: M.

**P1-8: Implement Short Rest hit-die spending.**
- Acceptance criteria: a player-facing endpoint lets a character spend N hit dice one at a time during a short rest, rolling die + CON mod (min 1 HP each), decrementing `hit_dice_remaining`.
- Dependencies: none.
- Effort: M.

**P1-9: Implement Surprise.**
- Acceptance criteria: an encounter can mark specific participants Surprised at combat start per the source rule; Surprised participants can't move/act/react on their first turn.
- Dependencies: none.
- Effort: M.

**P1-10: Implement Cover in AC computation.**
- Acceptance criteria: an attack roll against a target with a specified cover level applies the correct AC/Dex-save bonus (+2 Half, +5 Three-Quarters); Total Cover blocks targeting entirely.
- Dependencies: none.
- Effort: M.

**P1-11: Implement Rage-style temporary resistance.**
- Acceptance criteria: damage resistance sourced from an active, non-permanent effect (e.g. Rage) applies automatically while that effect is present and stops automatically when it ends, without touching the permanent resistance columns.
- Dependencies: none.
- Effort: M.

**P1-12: Wire up `half_on_save`.**
- Acceptance criteria: a save-based attack marked `half_on_save` automatically halves damage when the target's save succeeds, rather than requiring manual DM computation.
- Dependencies: none.
- Effort: S–M.

**P1-13: Implement the Hide action.**
- Acceptance criteria: a character meeting the hiding preconditions (Heavily Obscured, or behind Three-Quarters/Total Cover, out of every enemy's line of sight) can take a Hide action resolving a DC 15 Dex(Stealth) check; success applies an Invisible-while-hidden state that ends on the documented break conditions.
- Dependencies: CB-05 (Cover) for the cover-based hiding precondition.
- Effort: M.

### P2 Completeness — refine already-tracked state

- **P2-1** Implement the Incapacitated occupancy-passability exception (CB-01). Effort M.
- **P2-2** Auto-apply mechanical consequences of tracked conditions in attack/damage resolution (CB-07). Effort L.
- **P2-3** Auto-detect opportunity-attack triggers (CB-08). Effort M.
- **P2-4** Auto-reduce Exhaustion by 1 on Long Rest completion (ER-03). Effort S.
- **P2-5** Rest interruption tracking + Long Rest partial credit (ER-04). Effort L.
- **P2-6** Model Lightly/Heavily Obscured distinctly, and add Blindsight/Tremorsense/Truesight as senses (ER-09). Effort L.
- **P2-7** Surface trinkets in the character creation wizard (CC-04). Effort S.

Each is independently shippable; none blocks another.

### P3 Optional — low evidence of project intent, large effort

- **P3-1** Fall damage — blocked on elevation/pit-trigger support not existing in the map model (ER-06). Effort M + dependency.
- **P3-2** Travel pace (ER-07). Effort L.
- **P3-3** Environmental hazards: Burning, Dehydration, Malnutrition, Suffocation (ER-08). Effort L.

## Open Questions

1. **Catalog data provenance.** The project's races/classes/subclasses/feats/backgrounds/equipment catalog is seeded entirely from a third-party community SRD dataset (`.opencode/skills/dnd5e-srd/data/2024/`), not from `docs/players-handbook-2024/`. For 6 of 12 classes, the skill has no source text to verify that data against at all. Should the project re-source catalog content for the 6 skill-verified classes (Barbarian/Bard/Cleric/Druid/Fighter/Monk) from `docs/players-handbook-2024/` directly, accept the community dataset's provenance as sufficient, or treat the two as intentionally separate ("skill = adjudication reference," "seed data = gameplay content, sourced elsewhere")? This blocks P1-5 and affects how much confidence to place in every "Implemented" catalog-backed verdict above.
2. **Long Rest formula and edition support.** Is `srd_edition='2014'` support for hit-dice recovery still a live requirement (in which case P0-1 needs edition branching), or is the half-dice formula simply a bug with no edition intended to keep it?
3. **Mechanical automation vs. manual DM adjudication as a design philosophy.** Several existing code comments (`movement.ts`, `rests.ts`) explicitly favor "track state, let the DM adjudicate" over full automation. Findings like CC-02/CC-03, CB-07, and EQ-02 assume automation is desired. Confirm this is the direction before investing in P1-2/P1-6/P2-2.
4. **Scope of exploration/travel mechanics.** Is hexcrawl/overland travel simulation (travel pace, environmental hazards) ever intended for this project, or is it purely encounter/combat-focused? Determines whether P3-1/2/3 are worth scheduling at all.
5. **HTTP-level test harness.** Carried over from `OPEN_QUESTIONS.md` item 8: no `supertest`-equivalent exists, so DM-only-middleware routes have no automated test coverage. Any P0/P1 fix above that touches an authorization-gated route inherits this gap — worth resolving before or alongside this roadmap's implementation phase.

## Not doing / out of scope

- Full mechanical automation of every 2024 rule (e.g. automatic cover detection from wall/token geometry) beyond what's listed in P1/P2 — anything not explicitly itemized above stays out of scope until scheduled.
- Independently verifying or re-sourcing 2014-edition rules text — the skill is 2024-only by design; 2014 claims in `2014-vs-2024-differences.md` are not re-verified here.
- Any UI/visual/theme work (`REVISION-PLAN.md` territory) — not a rules gap.
- Homebrew catalog content (`catalogHomebrew.ts`) — a separate, intentionally-unverifiable-against-SRD system by design.
- Implementing P3 items without first resolving Open Question 4.
