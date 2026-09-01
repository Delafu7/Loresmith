# Environmental Hazards

Roadmap: P3-3 / gap-analysis ER-08. Covers the four non-falling environmental
hazards — **Burning, Dehydration, Malnutrition, Suffocation** — that all
resolve to Fire damage or Exhaustion. Falling (ER-06) is a separate hazard with
its own doc (`docs/rules/fall-damage.md` — see `services/fallDamage.ts`).

This app is dual-edition (`campaigns.srd_edition`). **Every one of these four
hazards diverges between 2014 and 2024** — Suffocation the most (2024 is
Exhaustion-per-turn; 2014 drops you to 0 HP and dying). So every function in
`domain/hazards.ts` is edition-branched, matching P0-1 / P1-9 / P3-2's
precedent for rules the two rulesets genuinely disagree on.

## Scope (confirmed with the user before any code)

P3 items are gated on the gap analysis's Open Question 4 ("is
exploration/travel simulation ever in scope"). As with P3-1 and P3-2, that
was resolved **narrowly for this item only**, not as a blanket "P3 is in".
Chosen shape:

- **Stateless calculators** (`domain/hazards.ts`, pure, no DB) + thin advisory
  service (`services/hazards.ts`) + endpoints. Same shape as P3-2's travel
  pace.
- The end-of-day (Dehydration/Malnutrition) and Suffocation resolutions
  **auto-write** the computed Exhaustion delta to `characters.exhaustion_level`
  in the same transaction (matching P2-4's Long Rest auto-reduction and
  `fallDamage`'s auto-applied damage), rather than P3-2's "report the schedule
  only".
- Nothing rolls a d20. The DM rolls the Constitution saves via the existing
  dice endpoint; the service only **re-derives** the pass/fail from the stored
  `dice_rolls` row (`roll_type = 'saving_throw'`, `result_total` vs the DC),
  never a client-asserted boolean — P1-12's invariant.
- **No in-game clock, no per-day food/water log persisted.** The DM supplies
  the day's consumption and the running "consecutive days without food" tally.
- **No migration.** Reuses `characters.exhaustion_level`, the apply-damage
  pipeline, and `active_effects.stack_count` (the mechanism P2-6 already uses
  for a monster's Exhaustion level). Two new seed-only `effect_definitions`
  templates: `Burning`, `Suffocating`.

Sources consulted:

- 2024: `docs/players-handbook-2024/Rules Glossary/rulesGlossary.md`
  - `Burning [Hazard]` — line 431
  - `Dehydration [Hazard]` + Water Needs per Day table — line 742
  - `Exhaustion [Condition]` (cap at level 6 = death) — line 828
  - `Malnutrition [Hazard]` + Food Needs per Day table — line 1170
  - `Suffocation [Hazard]` — line 1551
- 2014: `.opencode/skills/dnd5e-srd/references/2014/`
  - `adventuring.md` line 91 (Suffocating), line 131 (Food and Water)
  - `conditions.md` line 107 (Exhaustion — "You die if your exhaustion level … is 6")
- `.claude/skills/dnd-2024-rules/references/exploration-and-rest.md` "Hazards" table

Units: 2024's tables are US gallons / pounds. This app has no ration
weight/volume model, so the DM enters consumption directly in those units; the
frontend converts for display via `users.unit_system` exactly as for
feet/miles elsewhere.

---

## 1. Burning

`POST /encounters/:id/participants/:pid/burning-tick` — no body. Requires an
active `Burning` effect on the participant (the DM applies it via the normal
effects endpoint; removes it when the fire is out). Applies **1d4 Fire** through
the existing `applyDamage` / `applyMonsterInstanceDamage` pipeline, so Fire
Resistance/Vulnerability/Immunity, temp-HP absorption, and the
death-save/massive-damage/unconscious transitions all apply exactly as for any
other hit. Structurally a near-clone of `services/fallDamage.ts` (fixed dice, no
distance, no save).

| Edition | Damage | How it ends |
|---|---|---|
| **2024** (`rulesGlossary.md:431`) | 1d4 Fire at the start of each of its turns | As an action: give yourself Prone and roll on the ground. Or the fire is doused, submerged, or suffocated. |
| **2014** | 1d4 Fire/turn (the common pattern) | Per the triggering source's own text — most 2014 sources use a DC 10 Dexterity check as an action. SRD 5.1 has **no single generic "Burning" hazard entry**; this project does not independently re-verify 2014 rules text (gap-analysis "Not doing" §), so the figure is carried over but the DM is pointed back to the source. |

---

## 2. Dehydration

Resolved by `POST /campaigns/:id/hazards/resolve-daily` (DM-only), together with
Malnutrition. The `water` block per character carries `gallonsConsumed`,
optional `hotWeather` (2014), and optional `saveRollId` (2014 DC 15 Con save).

### Water Needs per Day (2024, `rulesGlossary.md:748`)

| Size | Water |
|---|---|
| Tiny | 1/4 gallon |
| Small / Medium | 1 gallon |
| Large | 4 gallons |
| Huge | 16 gallons |
| Gargantuan | 64 gallons |

**2024:** drink **less than half** the day's requirement → 1 Exhaustion level at
day's end. **No saving throw.** Removal: can't be removed until the creature
drinks a full day's water.

**2014** (`adventuring.md:143-147`, not size-scaled): 1 gallon/day, **2 if the
weather is hot**.
- Full requirement → no effect.
- At least half but not full → **DC 15 Constitution save** or 1 level.
- Less than half → automatic 1 level, no save.
- **If the creature already had ≥1 Exhaustion level, a failed/automatic result
  costs 2 levels, not 1** (`adventuring.md:147`). A *successful* save is still 0.

---

## 3. Malnutrition

Same endpoint. The `food` block carries `poundsConsumed`, optional
`consecutiveDaysWithoutFood`, and optional `saveRollId` (2024 DC 10 Con save).
The server reads the character's own CON modifier for the 2014 grace period.

### Food Needs per Day (2024, `rulesGlossary.md:1176`)

| Size | Food |
|---|---|
| Tiny | 1/4 pound |
| Small / Medium | 1 pound |
| Large | 4 pounds |
| Huge | 16 pounds |
| Gargantuan | 64 pounds |

**2024** — the glossary has **two separate clauses**, read strictly:
- **Ate something but less than half** → **DC 10 Constitution save** or 1 level,
  every such day.
- **Ate nothing** → no mechanical effect until the **end of the 5th consecutive
  day** without food, then +1 level, and **+1 more per subsequent day**. The
  DC 10 save does *not* also apply on a zero-food day (that clause presupposes
  eating *something*).

> **Flagged asymmetry:** a strict reading punishes *partial* eating from day 1
> but *total* starvation only from day 5. That is what the two separate clauses
> say; `domain/hazards.ts`'s `malnutritionOutcome` encodes it verbatim rather
> than "correcting" it. A DM who dislikes it can just apply the level manually.

**2014** (`adventuring.md:137-141`, not size-scaled): 1 lb/day; half rations
(0.5 lb) count as **half a day without food**.
- A creature can go **3 + CON modifier days** (minimum 1) without food.
- At the end of **each day past that grace period** → automatic 1 level, no save.
- A normal day of eating resets the counter (the DM supplies the running tally).

---

## 4. Suffocation

`POST /encounters/:id/participants/:pid/suffocation-tick`, body
`{ canBreatheAgain: boolean }`. **Character participants only** — a monster
instance has no `exhaustion_level` column; a suffocating monster is tracked via
a manual `Exhaustion` effect, same as every other monster-Exhaustion case (P2-6).

**Breath-holding (both editions, `rulesGlossary.md:1551` / `adventuring.md:93`):**
`1 + CON modifier` minutes, **minimum 30 seconds** (so CON mod 0 → 1 min,
CON mod −1 or worse → 30 s).

| Edition | After breath runs out |
|---|---|
| **2024** | Gains **1 Exhaustion level at the end of each of its turns**. When it can breathe again, it **removes all Exhaustion it gained from suffocating** (not from other sources). |
| **2014** | Survives `max(1, CON modifier)` rounds, then at the start of its next turn **drops to 0 HP and is dying** — can't regain HP or be stabilised until it can breathe. **2014 suffocation causes no Exhaustion.** |

**2024 implementation.** The `Suffocating` effect row is this episode's
Exhaustion-accrual ledger: its `stack_count` is how many levels *this*
suffocation caused. Each `canBreatheAgain: false` tick: `exhaustion_level += 1`
(clamped), `stack_count += 1` (creating the effect on the first tick).
`canBreatheAgain: true`: `exhaustion_level -= stack_count` (clamped at 0),
remove the effect. This honours "removes all levels it gained from suffocating"
without a per-source Exhaustion model on the character.

**2014 is report-only** — the endpoint returns the breath-hold minutes and the
"drops to 0 HP after N rounds" schedule but writes nothing. Auto-applying the
0-HP/dying transition would reach into the P1-1 death state machine, which is
out of scope for this "compute-and-suggest" pass.

---

## 5. Exhaustion — the one interaction to respect

`rulesGlossary.md:832` / `conditions.md:109`: the condition is cumulative, and
**"you die if your Exhaustion level is 6"** in both editions.

`domain/hazards.ts`'s `applyExhaustionDelta` clamps every write to `[0, 6]` and
reports `reachedLethalLevel` when the result is 6. **The service does not flip
`characters.is_alive`** even then — it matches the existing manual
`updateExhaustion` endpoint (`services/characters.ts`), which also stops at the
column write. Wiring "Exhaustion 6 ⇒ dead" into the death state machine is a
real, separate follow-up (see the progress-log "Not done" note), not something
this phase does silently.

Also **not** modelled: the "Exhaustion from dehydration/malnutrition can't be
removed until you drink/eat a full day" precondition. `characters.exhaustion_level`
is a single integer with no per-source tracking, so P2-4's Long Rest
auto-reduction can't tell a hazard level from any other. Flagged, not fixed.

---

## What is deliberately NOT built

- **2014 Suffocation's 0-HP/dying transition** — report-only (death-machine
  interaction, out of scope).
- **Exhaustion 6 ⇒ `is_alive = false`** — clamped and flagged; the DM applies
  death via the existing death-save/HP flow.
- **The dehydration/malnutrition Exhaustion "locked until you eat/drink"
  precondition** — no per-source Exhaustion model exists.
- **Per-day food/water persistence / an in-game clock** — the DM supplies the
  day's numbers each call, same "no clock" wall as P2-5 and P3-2's forced march.
- **Monster suffocation via this endpoint** — character participants only.
- **Frontend wiring** — server-only, same boundary as every phase this cycle.
