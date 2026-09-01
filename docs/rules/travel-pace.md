# Travel Pace

Roadmap: P3-2 / gap-analysis ER-07. Covers overland (out-of-combat) travel: pace
selection, distance-per-time, pace effects on checks, difficult terrain, forced
march, mounts/vehicles, and marching order. This is **not** the combat movement
system (`services/movement.ts`, `docs/rules/movement.md`) — that governs
round-by-round movement when "every second counts"; this governs minutes/hours/days.

This app is dual-edition (`campaigns.srd_edition`). The **distance table is
identical** in 2014 and 2024. Everything else — pace effects, difficult terrain,
forced march, mount wording, marching order — **diverges** and must be
edition-branched. Each section below calls the divergence out explicitly.

Sources consulted:
- `.opencode/skills/dnd5e-srd/references/2014/adventuring.md` lines 30–56 (SRD 5.1, "Travel Pace" / "Difficult Terrain")
- `.opencode/skills/dnd5e-srd/references/2024/adventuring.md` lines 43–67 (SRD 5.2 paraphrase, "Travel" / "Marching Order")
- `.claude/skills/dnd-2024-rules/references/exploration-and-rest.md` lines 5–12 ("Travel pace" table, cites PHB-2024 Ch1)
- `docs/players-handbook-2024/Chapter 1- Playing the Game/chapter1-playindTheGame.md` lines 870–903 (PHB 2024 primary text — the SRD 5.2 skill paraphrases this)
- `.opencode/skills/dnd5e-srd/scripts/query.py 2014 conditions exhaustion` / `2024 conditions exhaustion`
- `.opencode/skills/dnd5e-srd/references/2014/combat.md` line 8 and `docs/players-handbook-2024/.../chapter1...md` lines 876–878, 1043 (marching order)

Unit note: the `.opencode` skill text is in meters (5 ft = 1.5 m). All values
below are converted back to **feet/miles** because every distance column in this
app's schema is feet (`characters.speed`, `map_*` grid units, `movement.ts`
`feetPerCell`). Meters are shown only where the schema will actually store metric
(none currently — the app converts for display via `users.unit_system`).

---

## 1. Official rule

### 1a. The pace table (distance per Minute / Hour / Day)

**Identical in both editions.** SRD 5.1 `adventuring.md` lines 44–50; PHB 2024
lines 884–891 (SRD 5.2 `adventuring.md` lines 49–55 agrees).

| Pace   | Per Minute | Per Hour | Per Day  | Metric (skill text, for reference) |
|--------|-----------:|---------:|---------:|------------------------------------|
| Fast   |    400 ft  |  4 miles | 30 miles | 120 m / min                        |
| Normal |    300 ft  |  3 miles | 24 miles |  90 m / min                        |
| Slow   |    200 ft  |  2 miles | 18 miles |  60 m / min                        |

- The Day row assumes **8 hours of travel per day** (SRD 5.1 line 34: "The Travel
  Pace table assumes that characters travel for 8 hours in [a] day"; PHB 2024
  does not restate the 8-hour figure in Ch1 but the Day column is still
  8 × the Hour column — 4×8=32≈30, 3×8=24, 2×8=16≈18; the rounding is the
  book's, do not recompute Day from Hour, use the table value).
- These distances assume a creature Speed of **30 ft** and "relatively simple
  terrain: roads, open plains, or clear dungeon corridors" (SRD 5.1 line 54).
- **SRD is silent** on how the table scales for Speeds other than 30 ft. Neither
  edition's travel section gives a formula. (The 2014 DMG had an optional
  "different speeds" table; it is **not in these sources** — `[not found in
  source]`.) See §8.

### 1b. Pace effects on checks / passive scores

**This is a hard divergence. Edition-branch.**

**2014 (SRD 5.1 `adventuring.md` lines 46–50):**

| Pace   | Effect (verbatim)                                    |
|--------|-----------------------------------------------------|
| Fast   | "−5 penalty to passive Wisdom (Perception) scores"  |
| Normal | "—" (no effect)                                      |
| Slow   | "Able to use stealth"                               |

- Fast: a **flat −5 to passive Perception only**. It does **not** touch active
  Wisdom (Perception) *check* rolls, does not touch Survival, does not touch
  Stealth. Not disadvantage — a numeric modifier.
- Normal: literally no mechanical effect.
- Slow: a **permission**, not a bonus. SRD 5.1 line 32: "a slow pace makes it
  possible to sneak around and to search an area more carefully." The default
  assumption is that a travelling party at Fast/Normal pace **cannot meaningfully
  use Stealth at all**; Slow pace lifts that restriction. It grants **no
  advantage** and no flat bonus. The "search an area more carefully" clause has
  **no attached mechanic** in the SRD (`[not found in source]` — no bonus die,
  no advantage stated).

**2024 (PHB 2024 lines 893–899; SRD 5.2 `adventuring.md` lines 53–55; `.claude` skill `exploration-and-rest.md` line 10):**

| Pace   | Effect (verbatim, PHB)                                                                          |
|--------|-----------------------------------------------------------------------------------------------|
| Fast   | "Disadvantage on a traveler's Wisdom (Perception or Survival) and Dexterity (Stealth) checks" |
| Normal | "Disadvantage on Dexterity (Stealth) checks"                                                  |
| Slow   | "Advantage on Wisdom (Perception or Survival) checks"                                          |

- All three are **advantage/disadvantage on active check rolls** — no flat ±5
  anywhere in 2024.
- Fast: disadvantage on **both** Wis (Perception) **and** Wis (Survival) **and**
  Dex (Stealth). ("Perception or Survival" means the disadvantage applies
  whichever of the two you roll.)
- Normal: disadvantage on Dex (Stealth) **only** — 2024 adds a downside to
  Normal pace that 2014 doesn't have.
- Slow: advantage on Wis (Perception **or** Survival). It does **not** restore or
  grant Stealth (there is no "able to use stealth" clause in 2024); it simply
  isn't Normal, so Normal's Stealth disadvantage doesn't apply.
- **Passive scores:** 2024 has no travel-specific passive-Perception rule. The
  general 2024 rule (Rules Glossary, "Passive Perception") that
  disadvantage on the check lowers the passive score by 5 applies *derivatively*
  — so a 2024 Fast-pace traveller effectively has passive Perception −5 too, but
  as a consequence of the disadvantage, not a separate stated modifier. Do not
  double-apply.

**Divergence summary for the implementer:**
| | 2014 | 2024 |
|---|---|---|
| Fast effect | passive Perception −5 (flat) | disadv. Wis(Perc/Survival) + Dex(Stealth) checks |
| Normal effect | none | disadv. Dex(Stealth) checks |
| Slow effect | unlocks Stealth (permission, no bonus) | advantage Wis(Perc/Survival) checks |
| Modifier type | flat numeric (Fast) / permission (Slow) | advantage/disadvantage only |
| Survival affected? | no | yes (Fast disadv., Slow adv.) |

### 1c. Difficult terrain

**Divergence.**

**2014 (SRD 5.1 `adventuring.md` lines 52–56):** "You move at half speed in
difficult terrain … so you can cover only **half the normal distance** in a
minute, an hour, or a day." Concrete and mechanical: every pace's
Minute/Hour/Day value is **halved** while in difficult terrain.

**2024:** The travel section does **not** contain a difficult-terrain rule. PHB
2024 line 882: "The **Dungeon Master's Guide** has rules that affect which pace
you can choose in certain types of terrain." The DMG-2024 is **not in this
repo's sources**. So for 2024:
- Whether difficult terrain halves overland travel distance: `[not found in
  source]`.
- The 2024 *combat* difficult-terrain rule (`combat.md` line 33: "every foot of
  movement … costs 1 extra foot," i.e. half speed) is scoped to combat movement
  and is **not** stated to apply to travel pace. Applying it to travel would be
  an implementer's extrapolation, not a sourced rule — flag it as such if you do.
- 2024 also frames terrain as affecting **which pace you may choose** (e.g. no
  Fast pace through a swamp), not as a distance multiplier. That mechanic's
  details are `[not found in source]`.

### 1d. Forced March

**Divergence — this is the big one.**

**2014: EXISTS.** SRD 5.1 `adventuring.md` lines 34–36 (verbatim):
> "The Travel Pace table assumes that characters travel for 8 hours in [a] day.
> They can push on beyond that limit, at the risk of exhaustion. For each
> additional hour of travel beyond 8 hours, the characters cover the distance
> shown in the Hour column for their pace, and each character must make a
> Constitution saving throw at the end of the hour. The DC is 10 + 1 for each
> hour past 8 hours. On a failed saving throw, a character suffers one level of
> exhaustion."

- DC formula: **DC = 10 + (hours travelled beyond 8)**. Hour 9 → DC 11; hour 10
  → DC 12; hour 13 → DC 15. (SRD text "10 + 1 for each hour past 8" — hour 9 is
  1 hour past 8, so DC 11.)
- The save is **per character**, rolled **at the end of** each hour past 8.
- Failure = **one level of exhaustion** (2014 exhaustion track — see §7).
- Distance for those extra hours is still the Hour-column value for the pace.

**2024: DOES NOT EXIST.** Checked:
- PHB 2024 Ch1 "Travel" / "Travel Pace" / "Vehicles" (lines 870–903): no
  mention of an 8-hour limit, forced march, pushing on, or any Constitution
  save for travel.
- SRD 5.2 `adventuring.md` "Travel" (lines 43–67): no mention.
- `.claude` skill `exploration-and-rest.md` "Travel pace" (lines 5–12): no
  mention.
- Grep for "forced" / "push on" / "beyond 8" / "8 hour" / "constitution saving"
  across both 2024 source trees: **zero travel-related hits.**

The 2024 rules **removed the forced-march mechanic entirely.** The only 2024
routes to travel-related exhaustion are the **Malnutrition** and **Dehydration**
hazards (`.claude` skill `exploration-and-rest.md` lines 51–53), which are
separate systems (P3-3, not P3-2) and are not triggered by hours walked.

**Implementer consequence:** the forced-march feature (Con save loop, per-hour
DC escalation, exhaustion-on-fail) must be **2014-only**. For a 2024 campaign the
travel feature should either hide the "travel beyond 8 hours" affordance or allow
unlimited hours with **no save and no exhaustion**, and say so in the UI so a DM
doesn't assume the app silently dropped a rule. If a group wants forced-march
rules in a 2024 game, that is a **house rule** (see §8, DM-configurable).

### 1e. Mounts and Vehicles

**Divergence in wording; core "double for 1 hour" idea is in both.**

**2014 (SRD 5.1 `adventuring.md` lines 38–42):**
- "A mounted character can ride at a gallop for about an hour, covering **twice
  the usual distance for a fast pace**." (I.e. 8 miles in that hour, 800 ft/min.)
- "If **fresh mounts are available every 8 to 10 miles**, characters can cover
  larger distances at this pace, but this is very rare."
- After that ~1 hour, the mount cannot repeat it without rest. SRD 5.1 does
  **not** specify the rest length for a 2014 mount (`[not found in source]` —
  it just says "for about an hour" and implies the mount tires).
- "Certain special mounts, such as a **pegasus or griffon**, or special
  vehicles, such as a *carpet of flying*, allow you to travel more swiftly." (No
  numbers — depends on the mount's fly speed; `[not found in source]` for a
  formula.)
- **Land vehicles** (wagons, carriages): "choose a pace as normal."
- **Waterborne vessels:** "limited to the speed of the vessel, and they don't
  suffer penalties for a fast pace or gain benefits from a slow pace. Depending
  on the vessel and the size of the crew, ships might be able to travel for up
  to **24 hours per day**."

**2024 (PHB 2024 lines 882, 901–903; SRD 5.2 `adventuring.md` lines 57–61):**
- "If riding horses or other mounts, **the group** can move **twice that
  distance for 1 hour**, after which **the mounts need a Short or Long Rest**
  before they can move at that increased pace again."
- Note the differences from 2014:
  - It's "twice that distance" for **whatever pace the group chose**, not
    specifically "twice fast pace." (PHB text: "the group can move twice that
    distance" referring to "how far the party can move" at the chosen pace.)
  - The recharge is defined precisely: **a Short Rest or a Long Rest** for the
    mounts (2014 left this vague).
  - No "fresh mounts every 8–10 miles" clause; no pegasus/griffon/carpet clause
    in the 2024 travel section (`[not found in source]` for 2024 — those are
    monster/item stat-block concerns, i.e. this app's catalog, not a rule here).
- **Land vehicles:** "Travelers in wagons, carriages, or other land vehicles
  **choose a pace as normal**." (Same as 2014.)
- **Waterborne vessels:** "limited to the speed of the vessel, and they **don't
  choose a travel pace**. Depending on the vessel and the size of the crew,
  ships might be able to travel for up to **24 hours per day**."
  - 2014 says waterborne travellers *don't get fast penalties / slow benefits*;
    2024 says they *don't choose a pace at all*. **Functionally the same
    outcome:** no pace effects apply on a ship, and distance = the vessel's
    fixed speed, regardless of edition.

**Vessel speed itself** (how many miles/hour a specific ship does) is
**catalog/stat-block data**, not a rule — `[not found in source]` in both rules
trees, by design. If the app models vehicles it needs its own
`vehicles`-catalog speed value.

### 1f. Marching order

**Divergence: 2024 defines it; 2014 SRD only assumes it.**

**2024 (PHB 2024 lines 876–878; SRD 5.2 `adventuring.md` lines 63–67):**
> "The adventurers should establish a marching order while they travel, whether
> indoors or outdoors. A marching order makes it easier to determine which
> characters are affected by traps, which ones can spot hidden enemies, and
> which ones are the closest to those enemies if a fight breaks out. You can
> change your marching order outside combat."

Purpose: an **ordered list of party members** (front-to-back, and often
rank/file for wider corridors) used to adjudicate:
1. Who a trap hits first / who's in its area.
2. Who gets the Perception check to notice a hidden threat ahead.
3. Starting positions when travel transitions into combat (feeds the
   "Establish Positions" combat-setup step).

**2014:** SRD 5.1 has **no dedicated "Marching Order" section**. It is only
referenced in passing in the combat-setup step (`combat.md` line 8: "Given the
adventurers' marching order or their stated positions … the GM figures out where
the adversaries are"). The concept is assumed to exist; its purpose (traps /
spotting / combat start) is **not spelled out** in SRD 5.1 (`[not found in
source]` for the full 2014 description — the 2024 description above is a
reasonable cross-edition fill but is technically a 2024 text).

### 1g. Interaction with the Exhaustion condition

See `docs/rules/conditions.md` for the full Exhaustion writeup. Relevant here:

**2014 exhaustion** (`query.py 2014 conditions exhaustion`) — 6-level track,
each level a *different* effect:
1. Disadvantage on ability checks
2. Speed halved
3. Disadvantage on attack rolls and saving throws
4. HP maximum halved
5. Speed reduced to 0
6. Death

Effects are cumulative (level 2 also has level 1). Recovery: "Finishing a long
rest reduces a creature's exhaustion level by 1, **provided that the creature has
also ingested some food and drink**."

Travel-relevant feedback loops in 2014:
- Forced march failure → +1 exhaustion. At **level 1**, the traveller now has
  disadvantage on ability checks — which **includes the next hour's forced-march
  Constitution saving throw**? **No** — level 1 is "ability checks," and a
  saving throw is not an ability check. But **level 3** exhaustion *does* impose
  disadvantage on saving throws, making every subsequent forced-march save
  markedly harder (disadvantage **and** rising DC). Implement the save with the
  correct roll category so this falls out naturally.
- **Level 2** exhaustion halves Speed → halves all three travel-pace distance
  values for that character going forward (Speed 30→15). The SRD pace table
  assumes Speed 30 and is **silent** on recomputing it for reduced Speed
  (`[not found in source]`), but "Speed halved" is unambiguous that the
  character is now slower; see §8.
- **Level 5** = Speed 0 → that character cannot travel at all.

**2024 exhaustion** (`query.py 2024 conditions exhaustion`) — single cumulative
track, **die at level 6**, and each level simultaneously applies:
- **−2 to every D20 Test** per level (a "D20 Test" = any d20 roll: attack roll,
  saving throw, **or ability check**), and
- **−5 ft Speed** per level. (The skill's query output says "meters equal to 5
  times your Exhaustion level" — that is a metric-conversion artifact of the
  skill text; the real value is **5 feet per level**.)

Travel-relevant in 2024:
- There is **no forced march**, so travel does not *cause* exhaustion in 2024
  (only Malnutrition/Dehydration/other hazards do).
- Exhaustion from other sources still **degrades travel**: −5 ft Speed per level
  (relevant if pace distance is Speed-scaled — see §8) and −2 per level on the
  Wis (Perception/Survival) and Dex (Stealth) checks that pace already modifies,
  stacking with pace advantage/disadvantage.

**Recovery is already implemented** (`services/rests.ts`): a Long Rest sets
`characters.exhaustion_level = max(0, level - 1)`. Any travel-pace exhaustion
gain must go through the **same column** (`characters.exhaustion_level`,
`INT NOT NULL DEFAULT 0 CHECK BETWEEN 0 AND 6`) so rest recovery, the
`/characters/:id/exhaustion` endpoint, and `rest_events.exhaustionBefore/After`
all stay consistent. Do not introduce a parallel "march fatigue" counter.

---

## 2. Data model translation

Nothing for overland travel exists yet. `grep travelPace / travel_pace` across
`packages/server/src` = 0 hits (gap-analysis ER-07 confirms). Below is a
precise proposal consistent with this repo's conventions (real columns for
anything filtered/joined/validated; JSONB only for unqueried variable structure;
DM-configurable rule variants as `campaigns.<name> TEXT CHECK IN (...)` with a
default — the exact precedent set by `campaigns.diagonal_movement_rule` in
migration `1784269766666_add-movement-cost-schema.ts` and
`campaigns.allow_ability_reroll` in `1784269760666`).

### 2a. Catalog vs instance (per rpg-data-model-architect)

Travel pace has **no catalog layer** — Fast/Normal/Slow and the distance table
are constants, not reference rows. Encode the table as a server-side constant
(e.g. `services/travel.ts`, pure-function module, mirroring `services/movement.ts`'s
"pure-function-first" structure):

```
TRAVEL_PACE = {
  fast:   { ftPerMinute: 400, milesPerHour: 4, milesPerDay: 30 },
  normal: { ftPerMinute: 300, milesPerHour: 3, milesPerDay: 24 },
  slow:   { ftPerMinute: 200, milesPerHour: 2, milesPerDay: 18 },
}
```

Identical for both editions, so **not** edition-keyed. Pace *effects* and
forced-march *are* edition-branched in code (see §2d/§2e).

### 2b. New table: `travel_journeys` (campaign-instance data)

A journey is a discrete overland trip within one campaign. Frequently mutated
(hours accrue, exhaustion applied), campaign-scoped → instance data, own table.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | matches `1784269770666_uuid-primary-keys` convention |
| `campaign_id` | uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE | scoping/authz join |
| `session_id` | uuid NULL REFERENCES sessions(id) | optional link to the live session it happened in |
| `title` | text NOT NULL | DM label ("Road to Phandalin") |
| `pace` | text NOT NULL DEFAULT 'normal' CHECK (pace IN ('fast','normal','slow')) | **real column** — filtered/validated |
| `mode` | text NOT NULL DEFAULT 'foot' CHECK (mode IN ('foot','mounted','land_vehicle','waterborne')) | selects which distance/effect rules apply (§2c) |
| `vessel_speed_ft_per_hour` | integer NULL | required when `mode = 'waterborne'`; fixed speed, ignores pace |
| `hours_traveled_today` | numeric(5,2) NOT NULL DEFAULT 0 | drives the forced-march DC (2014). numeric, not int — see §3 partial-hour |
| `total_hours` | numeric(6,2) NOT NULL DEFAULT 0 | cumulative across days |
| `total_distance_ft` | bigint NOT NULL DEFAULT 0 | accrued; feet to avoid float miles |
| `terrain` | text NOT NULL DEFAULT 'normal' CHECK (terrain IN ('normal','difficult')) | 2014: halves distance. 2024: see §2f |
| `mount_dash_used` | boolean NOT NULL DEFAULT false | 2024: the "double distance for 1 hour" has been spent, mounts need a rest before it resets |
| `status` | text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')) | |
| `created_at` / `updated_at` | timestamptz NOT NULL DEFAULT now() | matches repo convention |

Index: `(campaign_id, status)`.

### 2c. New table: `travel_journey_legs` (append-only audit of each advance)

Every "advance the journey by N hours/minutes" action writes one row. Gives the
DM an undo/history trail and makes forced-march saves auditable (same spirit as
`rest_events`, `combat_actions`, `dice_rolls`).

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `journey_id` | uuid NOT NULL REFERENCES travel_journeys(id) ON DELETE CASCADE | |
| `duration_hours` | numeric(5,2) NOT NULL CHECK (duration_hours > 0) | the increment |
| `pace` | text NOT NULL CHECK (pace IN ('fast','normal','slow')) | snapshot (pace can change between legs) |
| `terrain` | text NOT NULL CHECK (terrain IN ('normal','difficult')) | snapshot |
| `distance_ft` | bigint NOT NULL | computed server-side, stored for audit |
| `was_forced_march` | boolean NOT NULL DEFAULT false | true when this leg included hours past 8 (2014 only) |
| `hours_into_day_at_start` | numeric(5,2) NOT NULL | so the per-hour DC is reconstructible |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### 2d. New table: `travel_forced_march_saves` (2014 only)

One row per character per forced-march hour, per the SRD "each character must
make a Constitution saving throw at the end of the hour."

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `journey_leg_id` | uuid NOT NULL REFERENCES travel_journey_legs(id) ON DELETE CASCADE | |
| `character_id` | uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE | |
| `hour_index` | integer NOT NULL CHECK (hour_index >= 9) | which hour-of-day (9 = first forced hour) |
| `dc` | integer NOT NULL | = 10 + (hour_index - 8) |
| `saving_throw_roll_id` | uuid NULL REFERENCES dice_rolls(id) | reuse the existing save-roll plumbing |
| `succeeded` | boolean NOT NULL | **re-derived server-side** from the roll + dc, never client-asserted — same invariant as `deriveSaveOutcomeSucceeded` used by the Fall check (P3-1) |
| `exhaustion_applied` | boolean NOT NULL DEFAULT false | true iff `succeeded = false` and the +1 was written to `characters.exhaustion_level` |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Monster instances / NPC travellers: the SRD says "each character." Whether NPC
companions roll is `[not found in source]`; model `character_id` only for now and
flag NPC forced-march as a gap (§3).

### 2e. DM-configurable rule toggles (new `campaigns` columns)

Follow the `diagonal_movement_rule` precedent exactly — a `TEXT ... CHECK IN`
column with a safe default, **not** a JSONB blob, because these are queried on
every travel-advance validation.

| column | type / default | governs |
|---|---|---|
| `campaigns.forced_march_rule` | `TEXT NOT NULL DEFAULT 'srd' CHECK (forced_march_rule IN ('srd','disabled'))` | `'srd'` = the 2014 Con-save loop; `'disabled'` = unlimited hours, no save. **Default must be edition-aware at creation time:** `'srd'` for a 2014 campaign, `'disabled'` for a 2024 campaign (2024 has no such rule). If a single DEFAULT is required, use `'disabled'` and have the 2014 campaign-creation path set `'srd'`. |
| `campaigns.difficult_terrain_travel_rule` | `TEXT NOT NULL DEFAULT 'half_distance' CHECK (... IN ('half_distance','none','pace_restriction'))` | 2014 default `'half_distance'` (SRD-accurate). 2024: SRD is silent (§1c) — default `'none'` for 2024 campaigns, and expose `'half_distance'` / `'pace_restriction'` as opt-ins with a UI note that these are DMG/house rules, not SRD 5.2. |
| `campaigns.travel_hours_per_day` | `INT NOT NULL DEFAULT 8 CHECK (BETWEEN 1 AND 24)` | the "assumes 8 hours/day" baseline; DM may lower for a hard march or raise it. The forced-march DC and the Day-column both key off this, not a hardcoded 8. |

`group_vs_individual_pace` (§8) — recommend a 4th toggle
`campaigns.travel_pace_scope TEXT DEFAULT 'group' CHECK (IN ('group','individual'))`
only if per-character pace is actually built; otherwise leave it and note the
gap.

### 2f. 2024 difficult-terrain handling

Because SRD 5.2 is silent, `difficult_terrain_travel_rule = 'none'` for 2024
means `travel_journeys.terrain = 'difficult'` is **recorded but does not alter
`distance_ft`** — it's a DM note. If the DM opts into `'half_distance'`, apply
the same ×0.5 the 2014 path uses. If `'pace_restriction'`, the server should
reject `pace = 'fast'` (and possibly `'normal'`) while `terrain = 'difficult'` —
exact allowed paces `[not found in source]`, so make it DM-configurable or
simply block Fast.

### 2g. Server-side validation (must NOT be client-only)

Per this repo's "critical validation server-side" standard and the
multiplayer-sync-engineer "clients send intentions, never raw state" rule:

- **Distance computation** (pace × hours × terrain multiplier, mount doubling,
  vessel fixed speed) — server only. Client sends "advance journey J by 2 hours
  at Fast pace"; server computes and stores `distance_ft`.
- **Forced-march trigger** — server decides an hour is "past 8" from
  `hours_traveled_today` + `campaigns.travel_hours_per_day`, computes the DC,
  and requires a save resolution. A client must not be able to advance 12 hours
  and self-report "no saves needed" or "all saved."
- **Save outcome** — `succeeded` re-derived from the linked `dice_rolls` row and
  the server-computed `dc`. Never trust a client `succeeded` boolean (identical
  to the Fall / P1-12 save invariant).
- **Exhaustion application** — server does the
  `UPDATE characters SET exhaustion_level = LEAST(6, exhaustion_level + 1)` (or
  the atomic guarded update pattern), broadcasts the change, and writes the
  `rest_events`-style audit. Client never sends the new exhaustion value.
- **Edition gate** — the forced-march endpoints must 400/409 for a campaign
  whose `srd_edition = '2024'` unless `forced_march_rule = 'srd'` was explicitly
  opted into.
- **Mount "double for 1 hour" one-shot** (2024) — server enforces that
  `mount_dash_used` can't be re-triggered until a rest is recorded for the
  journey; client can't just keep requesting double distance.

### 2h. Realtime

Travel advances mutate campaign state visible to all members → broadcast. There
is no existing travel event shape, so follow the "small board attribute → resync
the snapshot" precedent (Cover, elevation): emit a `broadcastFullStateResync`
(or a new `TRAVEL_JOURNEY_UPDATED` event carrying the journey row + any
exhaustion changes) rather than a fine-grained diff.

---

## 3. Edge cases

**Pace / distance:**
1. **Speed ≠ 30 ft.** SRD gives the table only for Speed 30 and no scaling
   formula (`[not found in source]`, both editions). Decide: (a) table is
   flat regardless of Speed (simplest, RAW-literal), or (b) scale linearly
   (`ftPerMinute × Speed/30`). This is a **judgment call** — flag in §8. A
   party's slowest member's Speed is the usual limiter if you do scale.
2. **Mixed-Speed party.** One PC has Speed 25 (e.g. dwarf, 2014) or an
   exhaustion penalty. Does the group move at the slowest member's rate? SRD
   frames pace as a **group** choice and is silent on mixed speeds
   (`[not found in source]`). Common ruling: group = slowest. Judgment call.
3. **Fractional day.** Party travels 5 hours then makes camp. Distance = 5 ×
   Hour-column, not a fraction of the Day-column (Day is just 8× Hour with
   book rounding; using the Day row for partial days would misreport). Store
   feet, derive miles for display.
4. **Pace changed mid-journey.** Handled by per-leg `pace` snapshot (§2c). The
   *effects* (§1b) apply per-leg to any check made during that leg.
5. **Zero-Speed traveller.** 2014 exhaustion level 5, or a restrained/grappled
   PC. Cannot contribute to travel; group either waits or carries them
   (`[not found in source]` — carrying rules are Strength/encumbrance, a
   different system).

**Difficult terrain:**
6. **Terrain changes partway through an hour.** Half the hour normal, half
   difficult. Simplest: DM logs two legs, or the leg carries a single terrain
   value chosen by the DM. Sub-hour terrain granularity is out of scope unless
   built.
7. **Does difficult terrain stack (double-halve)?** 2014 says "half speed in
   difficult terrain" — the same "does not stack" principle as the 2024 combat
   rule (`combat.md` line 33, multiple difficult features in one space still
   only cost ×2). Travel difficult terrain is a **single ×0.5**, never ×0.25,
   regardless of how many terrain types overlap. (2014 travel text doesn't
   explicitly say "doesn't stack" — `[not found in source]` — but there's no
   stacking mechanism offered either; treat as single-application.)
8. **2024 + terrain = difficult + `difficult_terrain_travel_rule = 'none'`.**
   Distance is unchanged; make sure the UI doesn't imply a penalty was applied.
9. **Forced march *through* difficult terrain (2014).** Extra hours past 8
   still cover the Hour-column distance — but is that the *halved* Hour-column
   because of terrain? SRD says forced-march hours "cover the distance shown in
   the Hour column" (line 36) with no terrain caveat, but the difficult-terrain
   rule (line 56) halves "a minute, an hour, or a day" universally. Reading
   them together: **halved**. Not 100% explicit — note it (§8).

**Forced march (2014):**
10. **Partial hour past 8.** Party travels 8h30m. Is there a save for the
    half hour? SRD: "For each additional **hour**… make a Con save **at the end
    of the hour**." A partial hour arguably triggers no save (no full hour
    elapsed) — but then a party could travel 8h59m forever, save-free. Judgment
    call (§8). Recommend: save only on completing each full hour past 8; carry
    the remainder in `hours_traveled_today`.
11. **DC after a rest.** Party marches 11 hours (saves at DC 11, 12, 13), takes
    a Long Rest, marches again next "day." Does the DC reset to 11 at hour 9, or
    is it still keyed to lifetime hours? SRD ties the DC to "each hour past 8
    hours" within the day the table "assumes… 8 hours in [a] day" — so a new
    day resets `hours_traveled_today = 0` and the DC restarts at 11. A **Short
    Rest** mid-day: SRD is silent on whether that resets the hour count
    (`[not found in source]`). Recommend Short Rest does **not** reset
    `hours_traveled_today` (it's an hour of not travelling, not a day boundary),
    but flag it (§8).
12. **Marching exactly 8 hours.** No saves. Hour 8 is not "past 8."
13. **Exhaustion already at 5 before a failed save.** `LEAST(6, …)` → level 6 →
    **death** (2014 and 2024 both die at 6; 2014 level 6 = "Death"). The travel
    feature must handle a PC dying from a forced-march save and broadcast it
    like any other death. Do not silently cap at 5.
14. **Failed save at exhaustion level ≥ 3 (2014).** Level 3 gives disadvantage
    on saving throws → the *next* forced-march save is rolled with disadvantage
    AND a higher DC. Ensure the save goes through the normal
    disadvantage-aware roll path.
15. **Character is immune to exhaustion** (e.g. 2024 Monk "no Exhaustion from
    forgoing food/drink" is narrower; some effects grant broader immunity).
    `[not found in source]` whether such a character still rolls the save. If
    the roll path already checks exhaustion immunity for other sources, reuse
    it; a failed save simply applies nothing.
16. **NPC / monster-instance travellers.** SRD says "each character." Whether a
    hired guide or animal companion rolls is `[not found in source]`. Current
    model: `character_id` only. Gap.
17. **A PC joins the march late** (caught up at hour 10). Their personal
    hours-past-8 differ from the group's. Per-character hour tracking vs.
    group-level is a judgment call; the group-level `hours_traveled_today` on
    the journey is the simple model and probably fine, but note it.

**Mounts / vehicles:**
18. **2024 "double for 1 hour" then which rest?** Short **or** Long Rest for the
    mounts resets it. `mount_dash_used` flips false when a rest is logged for
    the journey. A Long Rest for the party is also a rest for the mounts.
19. **2024: double distance applies to the chosen pace** — a group at Slow pace
    on horseback covers 2 × Slow (4 miles) that hour, not 2 × Fast. 2014's text
    specifically says "twice the usual distance for a **fast** pace" — so a
    2014 mounted gallop hour = 8 miles regardless of the party's walking pace.
    **Edition-branch this.**
20. **Mount's own Speed > 30 / special mounts (2014).** "Pegasus or griffon…
    travel more swiftly" with no formula (`[not found in source]`). If mounts
    are catalog entities with a Speed, decide whether mounted travel scales off
    the mount's Speed (see edge case 1). Judgment call.
21. **Waterborne: pace selection is inert.** `pace` column still exists on the
    journey but the server ignores it for `mode = 'waterborne'` — distance =
    `vessel_speed_ft_per_hour × hours`, no §1b effects applied, up to 24 h/day.
    Validate that a client can't get a Slow-pace Perception advantage on a ship.
22. **Waterborne + no `vessel_speed_ft_per_hour` set.** Reject the journey
    advance (NOT NULL-equivalent check at the service layer since the column is
    nullable for other modes).
23. **Land vehicle + forced march (2014).** A wagon party "chooses a pace as
    normal" — do the passengers make forced-march Con saves past 8 hours?
    Riding in a wagon is less strenuous than walking. SRD is silent
    (`[not found in source]`). Judgment call — recommend land-vehicle
    passengers still save (RAW gives no exemption) but flag it.
24. **Flying mount / fly-speed travel.** No overland rule beyond "travel more
    swiftly" (2014) / nothing (2024). `[not found in source]`. Gap if the app
    ever models aerial journeys.

**Exhaustion interaction:**
25. **Long Rest during a journey.** Must decrement `exhaustion_level` by 1
    (already implemented in `rests.ts`) AND reset `hours_traveled_today = 0`.
    The travel feature must call/coordinate with the existing rest service, not
    duplicate exhaustion math.
26. **2014 Long Rest without food/drink.** 2014 exhaustion recovery requires
    "ingested some food and drink." If the app models rations (P3-3), a Long
    Rest on an empty larder does **not** reduce exhaustion. `rests.ts` may not
    check this yet — cross-check, don't assume.
27. **2024 exhaustion −5 ft/level + Speed-scaled pace (if you scale).** A
    2-level-exhausted 2024 PC has Speed 20 → pace distances scale down if you
    chose Speed-scaling in edge case 1. Consistent by construction if pace reads
    live Speed.

---

## 4. What must be tested

Server-side integration tests (`*.integration.test.ts`, live DB) unless noted.
The bar: a crafted API call cannot route around the rule.

**Pace table (pure unit — `services/travel.test.ts`):**
- Fast/Normal/Slow → 400/300/200 ft per minute, 4/3/2 mi/hr, 30/24/18 mi/day, for
  BOTH editions (same numbers — assert no edition branch changes them).
- N hours at a pace → `N × milesPerHour` (feet stored), including fractional N
  (2.5 h Normal = 3960 ft), and that partial days never read the Day column.
- Difficult terrain ×0.5 (2014): 3 h Normal difficult = 1.5 mi, not 3.
- Difficult terrain stacking: two overlapping difficult sources = ×0.5, never
  ×0.25.

**Pace effects (`services/travel.effects.test.ts` or wherever check modifiers are assembled):**
- 2014 Fast → passive Perception −5, and **no** modifier to active Wis
  (Perception) rolls, Survival, or Stealth.
- 2014 Normal → no modifier anywhere.
- 2014 Slow → Stealth permitted (whatever "permitted" means in the app's model)
  and **no** advantage granted.
- 2024 Fast → disadvantage on Wis (Perception), Wis (Survival), Dex (Stealth);
  assert Survival is included.
- 2024 Normal → disadvantage on Dex (Stealth) only; Perception/Survival
  unaffected.
- 2024 Slow → advantage on Wis (Perception) and Wis (Survival); Stealth **not**
  advantaged and **not** disadvantaged.
- Regression: a 2024 campaign never applies the 2014 "−5 passive" path and vice
  versa (parametrize by `srd_edition`).

**Forced march — 2014 (`services/travel.forcedMarch.integration.test.ts`):**
- Advancing a journey to exactly 8 hours creates **zero** `travel_forced_march_saves`.
- Advancing to 11 hours creates saves at hour 9 (DC 11), 10 (DC 12), 11 (DC 13)
  — assert the DC formula `10 + (hour - 8)`.
- A failed save → `characters.exhaustion_level` incremented by exactly 1, a
  `travel_forced_march_saves` row with `succeeded = false`,
  `exhaustion_applied = true`, and a broadcast fired.
- A passed save → no exhaustion change, `succeeded = true`,
  `exhaustion_applied = false`.
- **Client cannot bypass:** an API call that advances 12 hours with a body
  asserting `saves: []` or `allSucceeded: true` is rejected / ignored — the
  server generates the required save slots itself and leaves them unresolved
  until real rolls come in.
- **Client cannot forge an outcome:** posting a save resolution with
  `succeeded: true` but a linked `dice_rolls` total below the DC → server
  re-derives `succeeded = false` (mirror the Fall / P1-12 `deriveSaveOutcome`
  test).
- Exhaustion at 5 + failed save → level 6 → character death path triggered and
  broadcast (not capped at 5, not a silent no-op).
- Exhaustion at 3+ → the next forced-march save is rolled with disadvantage
  (2014 level-3 effect) AND the higher DC.
- New day / Long Rest resets `hours_traveled_today` to 0 and the next march's
  first save is back at DC 11.
- `travel_hours_per_day` set to 6 by the DM → saves start at hour 7 (DC 11 at
  hour 7 = `10 + (7 - 6)`), proving the "8" isn't hardcoded.

**Forced march — 2024 (edition gate):**
- A 2024 campaign: advancing a journey past 8 (or 20) hours creates **zero**
  saves, changes **zero** exhaustion, and the forced-march endpoints return
  4xx (feature disabled) — unless `forced_march_rule = 'srd'` was explicitly
  set, in which case it behaves like 2014.
- A 2024 campaign's default `forced_march_rule` is `'disabled'`; a 2014
  campaign's default is `'srd'` (assert at campaign creation).

**Difficult terrain — 2024:**
- 2024 campaign, `difficult_terrain_travel_rule = 'none'` (default): a leg with
  `terrain = 'difficult'` stores the **full** distance (no halving) — terrain is
  advisory only.
- 2024 campaign, DM opts into `'half_distance'`: halving now applies, same as
  2014.

**Mounts / vehicles:**
- 2014 mounted gallop hour → 8 miles (2 × Fast) regardless of the party's
  walking pace column.
- 2024 mounted hour at Slow pace → 4 miles (2 × Slow), NOT 8.
- 2024: after the one doubled hour, a second doubled-hour request is rejected
  until a Short or Long Rest is logged for the journey; then it's allowed again.
- Waterborne: `pace` is ignored — distance = `vessel_speed_ft_per_hour × hours`;
  a Slow-pace flag on a waterborne journey grants **no** Perception advantage
  (assert the effects assembler skips pace effects when `mode = 'waterborne'`).
- Waterborne journey advance with `vessel_speed_ft_per_hour` NULL → rejected.
- Waterborne can log up to 24 h in a day without a day-boundary error;
  foot/mounted still key off `travel_hours_per_day`.

**Exhaustion integration:**
- A Long Rest logged mid-journey decrements `exhaustion_level` by 1 (via the
  existing `rests.ts` path) AND zeroes `hours_traveled_today`; a
  `rest_events` row shows `exhaustionBefore/After`.
- Travel-applied exhaustion uses the same `characters.exhaustion_level` column
  (assert `/characters/:id/exhaustion` GET reflects a forced-march loss, and a
  subsequent Long Rest removes it).
- 2014: a Long Rest without rations (if P3-3 rations exist) does **not** reduce
  exhaustion — or, if unimplemented, an explicit `it.todo` marking the gap.

**Authorization (per rpg-api-endpoint-engineer layering):**
- A player (non-DM) member cannot create/advance/delete a `travel_journey`
  (DM-only, like encounters) — or, if players may propose, it routes through the
  pending-action-request flow, not a direct write.
- A non-member gets 403 on every travel endpoint for that campaign.
- Forced-march save *rolls* for a player's own character: allowed by that player
  (mirror `requireOwnParticipantOrDm` on Fall/Hide); the DM may roll for anyone;
  a player cannot roll another PC's save.

---

## Open gaps flagged to the SRD (`[not found in source]`) — summary for §8 of the task

1. **Speed-scaling of the pace table.** No formula for Speed ≠ 30 in either
   edition. Judgment call: flat table vs. linear scale. Recommend flat +
   "slowest member" group rule for simplicity; make it explicit in the UI.
2. **Group vs. individual pace / mixed Speeds.** SRD frames pace as a group
   choice, silent on mixed Speeds. `campaigns.travel_pace_scope` toggle if
   per-character pace is built; otherwise group = slowest, noted.
3. **Partial hour past 8 (2014 forced march).** "At the end of the hour" implies
   full hours only. Recommend: save on each completed full hour past 8, carry
   the remainder. Without this a party marches 8h59m indefinitely save-free.
4. **DC reset after a Short Rest (2014).** New *day* clearly resets
   `hours_traveled_today`. A Short Rest mid-day: silent. Recommend it does NOT
   reset the hour count.
5. **Difficult terrain during forced-march hours (2014).** Forced-march text
   says "Hour column distance," terrain text says halve "an hour" universally.
   Recommend: halved (apply both). Not explicit.
6. **Difficult terrain and travel in 2024.** SRD 5.2 punts to the DMG (not in
   repo). Default `'none'`; `'half_distance'` / `'pace_restriction'` as
   labelled house/DMG opt-ins.
7. **NPC / animal-companion / monster-instance travellers and forced march.**
   SRD says "each character." Modelled `character_id`-only; NPC saves are a gap.
8. **Land-vehicle passengers and forced march (2014).** No RAW exemption for
   riding vs. walking. Recommend passengers still save; flag it.
9. **2014 mount rest duration.** "For about an hour" then the mount tires; no
   stated recovery period (2024 fixed this as "Short or Long Rest").
10. **Special/flying mounts & vehicles' actual speeds.** Catalog/stat-block
    data, deliberately not in the rules sources. Needs a `vehicles`/`mounts`
    catalog Speed field if modelled.
11. **"Search an area more carefully" (2014 Slow) and marching-order trap/spot
    adjudication.** Named in the text with no attached dice mechanic — DM
    narration, nothing for the server to compute.
12. **Full 2014 "Marching Order" description.** SRD 5.1 only references the
    concept in combat setup; the purpose list (traps / spotting / combat start)
    is 2024 text used as a cross-edition fill.
