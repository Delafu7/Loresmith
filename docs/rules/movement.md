# Movement

## Movement with real cost: terrain, diagonals, alternate speeds, dash, splitting, stacking, prone, occupied spaces

Consulted for: `REFACTOR-PLAN.md` §4 "Movement with real cost" (server-side validation for `PATCH /encounters/:id/participants/:pid/position`, and the pathfinding function it needs). Edition: **both** — this app is dual-edition (`campaigns.srd_edition` = `'2014'` or `'2024'`), and movement is one of the areas where the two editions' grounding text genuinely differs, not just in wording — see each subsection below, differences are called out explicitly rather than assumed away.

Grounded against: `.opencode/skills/dnd5e-srd/references/2014/combat.md`, `.../2014/adventuring.md`, `.../2014/conditions.md`, `.../2024/combat.md`, `.../2024/conditions.md`, `.../2024/ability-checks.md`. No other reference file in either edition folder mentions movement/diagonal/terrain/climb/swim (checked via grep across every `.md` in both `references/2014/` and `references/2024/`).

### 1. Official rule

#### 1.1 Base movement, splitting around an action (edge case 5)

Identical in both editions. **2014** `combat.md` lines 72–82: "On your turn, you can move a distance up to your speed. You can use as much or as little of your speed as you like on your turn... You can break up your movement on your turn, using some of your speed before and after your action. For example, if you have a speed of 9 meters [30 ft], you can move 3 meters [10 ft], take your action, and then move 6 meters [20 ft]." It further allows splitting movement *between individual attacks* within a multi-attack action: "a fighter who can make two attacks with the Extra Attack feature... could move 3 meters, make an attack, move 4.5 meters, and then attack again."

**2024** `combat.md` lines 18–21, 37–40: "You can move up to your Speed and take one action, in either order... You can split your move around an action/Bonus Action/Reaction on the same turn." Same mechanic, condensed wording; 2024's text doesn't repeat the between-individual-attacks example but the general "split around an action" rule covers it — no narrower restriction is stated in either edition.

**Verdict: splitting movement (including between individual attacks of a multi-attack action) is unrestricted in both editions** — no cap on how many times you can interrupt movement, as long as total movement doesn't exceed the budget and the action/bonus action/reaction slot rules are otherwise respected.

#### 1.2 Difficult terrain — per-cell cost (edge case 1) and stacking (edge case 6)

Identical in both editions, and both state the stacking rule explicitly rather than leaving it to inference:

- **2014** `combat.md` lines 94–96: "Every foot of movement in difficult terrain costs 1 extra foot. **This rule is true even if multiple things in a space count as difficult terrain.**"
- **2024** `combat.md` lines 32–35: "Every meter of movement in Difficult Terrain costs 1 extra meter, **even if multiple things in the space count as difficult terrain**."

**Verdict: two (or more) sources of difficult terrain in the same cell cap at double cost — they do not stack to 4×.** This is explicit SRD text in both editions, not an inference.

**Impassable terrain is not an SRD-named category in either edition's grounding text.** Difficult terrain (cost ×2) is the only terrain-cost tier either reference file names. "Impassable" (walls, chasms, lava, a locked door) is handled in the fiction by the DM simply saying "you can't go that way," not by a named rule — grid-based digital play needs a third explicit tier to enforce the same thing mechanically, but that's an app-modeling necessity, not an SRD term. Flagging this so `cost_type = 'impassable'` in the data model below is understood as **this app's own addition**, not a direct SRD citation.

#### 1.3 Diagonal movement (edge case 2) — confirmed to differ between editions, and confirmed DM-configurable in 2024

**2014: the grounding text is silent.** Grepped `diagonal`, `grid`, `square` across every file in `references/2014/` — no hits describing diagonal movement cost at all (the two "square" hits in `world-hazards.md` are unrelated trap-area descriptions, not grid rules). SRD 5.1 (OGL) apparently didn't carry the PHB's "Playing on a Grid" sidebar into this grounding set. **I am not asserting the commonly-known "5/10/5 alternating" variant as the 2014 default** — per the persona's grounding rule, if it's not in the reference text and not marked DM-configurable by the SRD itself, I say I couldn't confirm it rather than guess plausibly. What I checked: `combat.md`, `adventuring.md`, `world-hazards.md`, `conditions.md`, `ability-checks.md`, `character-creation.md`, `races.md`, `classes.md`, `skills.md`, `spellcasting-rules.md`, `equipment-items.md` — none contain a diagonal-movement rule.

**2024: explicit, and explicitly optional.** `combat.md` lines 66–70, "Playing on a Grid (optional)": "Each square = 1.5 meters [5 ft]. Translate Speed into squares by dividing by 1.5... Entering an adjacent unoccupied square costs 1 square; a Difficult Terrain square costs 2. Diagonal movement can't cross a wall/tree corner that fills its space." Note what this sentence does and doesn't say: it gives **one flat cost for "an adjacent unoccupied square"** without carving out a separate, higher cost for diagonal entries — diagonal squares are "adjacent" like any other, so they cost the same 1 square (or 2 in difficult terrain) as an orthogonal step. It does **not** describe an alternating 5/10/5 cost anywhere in this grounding text. The only diagonal-specific rule stated is a *geometry* constraint (can't cut through a corner that's fully blocked by a wall/tree), not a cost rule.

**Verdict:**
- **2024's confirmed default (the only variant its grounding text describes) is "flat cost, including diagonal"** — every entered square costs 1 (2 if difficult terrain), diagonal or not.
- **The whole grid system in 2024 is itself headed "(optional)"** — the SRD's base assumption is theater-of-mind, and grid play (with its flat-cost diagonal rule) is the documented variant for tables that want a grid. Since this app *is* a grid, it is implementing that optional variant by definition.
- **2014 is SRD-silent on diagonal movement entirely in this grounding set.** The widely-known "alternating 5/10/5" rule from the printed 2014 PHB is **not confirmed by this app's grounding source** and must not be asserted as an SRD default here.
- **The alternating 5/10/5 variant, if a table wants it, is DM-configurable** in both editions — confirmed-by-name only for 2024 (where it's the *unstated* alternative to the confirmed flat default), and entirely unconfirmed either way for 2014. See "DM-configurable" section below — this must be a per-campaign toggle, not a hardcoded assumption in either direction.
- **Open gap, not filled with invented specificity:** how the alternating variant interacts with a difficult-terrain square (does an alternating "10 ft" diagonal step become "20 ft" in difficult terrain, i.e. does the general ×2 difficult-terrain rule from §1.2 apply on top of the alternating base cost per step?) is not spelled out anywhere in either edition's grounding text. The natural extension of §1.2's general rule ("every foot costs 1 extra foot, no matter the source") is that it would, but this is **inference from the general rule, not a direct citation** — flagging so nobody cites this doc as SRD-confirmed on that specific interaction.

#### 1.4 Alternate speeds: fly / swim / climb / burrow (edge case 3)

**2014**, `combat.md` "Using Different Speeds" lines 84–88: "If you have more than one speed, such as your walking speed and a flying speed, you can switch back and forth between your speeds during your move. Whenever you switch, subtract the distance you've already moved from the new speed. The result determines how much farther you can move. If the result is 0 or less, you can't use the new speed during the current move." Example given: speed 30 + fly speed 60 (from a spell) → fly 20 ft, walk 10 ft, fly 30 ft more — i.e. **all your speeds share one pool of "distance moved so far," each speed just caps how much further you personally can still go once that shared distance is subtracted from it.** This is not "add the speeds together"; it's "each speed is an independent ceiling checked against the same running total."

**2014**, `adventuring.md` lines 62–64, "Climbing, Swimming, and Crawling": **"While climbing or swimming, each foot of movement costs 1 extra foot (2 extra feet in difficult terrain), unless a creature has a climbing or swimming speed."** This directly answers "can a non-swimmer move through water, at what cost": **yes, a creature without a swim speed can still swim — at double cost normally, triple cost if the water is also difficult terrain** (this is the crawl-and-difficult-terrain stacking pattern confirmed again in §1.6 below — a *different kind* of movement penalty stacks additively with difficult terrain rather than being capped by the "difficult terrain doesn't stack with itself" rule in §1.2, because it isn't a second source of difficult terrain, it's a different mechanic). A creature *with* the matching speed (climb/swim) moves through that terrain at that speed's normal rate, no extra cost from the medium itself (difficult terrain from other sources still applies normally). "At the GM's option, climbing a slippery vertical surface... requires a successful Strength (Athletics) check" — **explicitly GM's option**, i.e. DM-configurable per this app's own convention, not a hard rule.

**2024: this grounding set is silent on the without-the-matching-speed cost.** Checked `combat.md`, `adventuring.md`, `conditions.md`, `species.md`, `ability-checks.md`, `character-creation.md` for "climb", "swim", "crawl" — the only hits are `combat.md` line 28–30 ("You can move up to your Speed..., including climbing, crawling, jumping, and swimming, combined however you like, until the Speed is used up" — no cost multiplier stated) and line 120 ("A creature without a Swim Speed has Disadvantage on melee attacks underwater unless the weapon deals Piercing damage" — an attack-roll penalty, not a movement-cost rule). **I am not assuming 2024 kept the 2014 double-cost rule for climbing/swimming without the matching speed** — it isn't in this grounding text, so it's a confirmed gap, not a confirmed-identical rule. Same for "Using Different Speeds" — the mid-move speed-switching mechanic isn't restated anywhere in the 2024 grounding files either, though nothing there contradicts it.

**Burrow speed**: neither edition's grounding text has a dedicated burrow-speed rule beyond it being one more named speed a creature can have (same "Using Different Speeds" mechanic would apply by the 2014 text's own general framing — "if you have more than one speed" doesn't enumerate which ones). No SRD text in either edition's grounding set states whether a creature *without* a burrow speed can move through solid ground at all (unlike swim/climb, where "can, but it costs extra" is explicit for 2014) — reasonably read as **impassable without a burrow (or magical) capability**, but that specific negative statement ("cannot burrow without a burrow speed") is not written anywhere in this grounding text either; flagging as inferred from the absence of an "at extra cost" statement (contrast with the explicit "costs extra" statement that *does* exist for climb/swim), not confirmed by direct citation.

#### 1.5 Dash (edge case 4) — exact mechanic and terrain interaction

**2014**, `combat.md` lines 193–197: "When you take the Dash action, you gain extra movement for the current turn. **The increase equals your speed**, after applying any modifiers. With a speed of 9 meters [30 ft], for example, you can move up to 18 meters [60 ft] on your turn if you dash." **2024**, `ability-checks.md` line 135 (Actions summary table): "Dash — Extra movement equal to your Speed for the rest of the turn." Identical mechanic in both editions, worded almost the same.

**This settles the exact question asked: Dash adds a flat amount of extra movement *budget* (in feet) equal to base speed — it does not touch the cost-per-foot multiplier that difficult terrain applies.** The two operate at different layers:
- **Budget layer** (how many feet you have to spend this turn): `budget = speed_ft [+ speed_ft again if dash_used]`. Dash only ever affects this layer, additively.
- **Cost layer** (how many budget-feet each foot of actual ground costs): normal terrain = 1:1, difficult terrain = 2:1 (§1.2), crawling/no-matching-alt-speed = additional stacking per §1.4/§1.6. Dash never multiplies this layer.

Worked example, speed 30 ft, entire path through difficult terrain, dashed: budget = 30 + 30 = 60. Every foot of actual ground costs 2 budget-feet (difficult terrain). Actual distance coverable = 60 ÷ 2 = **30 ft of real ground**, i.e. exactly what you'd cover in normal terrain *without* dashing. **Dashing does not "double an already-doubled difficult-terrain cost" — it doubles the budget, and the terrain multiplier is then applied once, to that (now larger) budget, exactly as it would be applied to the non-dashed budget.** There is no scenario under either edition's confirmed text where the two multiply together (i.e., no "4× difficult terrain when dashing").

#### 1.6 Standing up from prone (edge case 7) and its terrain interaction

**2014**, `combat.md` lines 100–106: "You can **drop prone** without using any of your speed. **Standing up** takes more effort; doing so costs an amount of movement equal to half your speed. For example, if your speed is 9 meters [30 ft], you must spend 4.5 meters [15 ft] of movement to stand up. You can't stand up if you don't have enough movement left or if your speed is 0." This text does **not** include the words "rounded down" for the 2014 example — 30/2 = 15 happens to be a clean integer, so the example doesn't surface whether an odd speed rounds.

**2024**, `conditions.md` line 87, "Prone" → "Restricted Movement": "Your only movement options are to crawl or to spend an amount of movement equal to half your Speed (**round down**) to right yourself and thereby end the condition. If your Speed is 0, you can't right yourself." **2024 explicitly states "round down."**

**Verdict: this app's existing `standUpCostFt` (`packages/web/src/encounters/actionEconomy.ts`: `Math.floor(speedFt / 2)`) is correct for both editions** — 2024's text confirms rounding down explicitly; 2014's text doesn't contradict it and the universal 5e convention (used identically for jump distances, ability modifiers, etc., all already `Math.floor` in this same file) is round-down. No change needed here — this is a confirm, not a new finding.

**Terrain interaction, and a genuinely new finding from a close read of the 2014 crawling text:** `adventuring.md`/`combat.md` don't say standing-up cost changes in difficult terrain — it's a flat half-speed regardless of the terrain of the cell you're standing up in (you don't move cells to stand up, so "cost per foot of difficult terrain" doesn't apply to an action that covers zero feet of ground). Where terrain **does** interact with prone is *crawling* (moving while still prone), covered in 2014 `combat.md` line 106: "To move while prone, you must **crawl**... Every foot of movement while crawling costs 1 extra foot. Crawling 1 foot in difficult terrain, therefore, **costs 3 feet of movement**." *(Data-quality note, same pattern as `docs/rules/creature-sizes.md`'s size-table finding: this grounding file's text reads "Crawling 1 **meter** in difficult terrain... costs **0.9 meters**" — a metric-conversion artifact, not a different rule. `0.9 m` is an exact conversion of `3 ft` at this skill's own `5 ft = 1.5 m` ratio (3 × 0.3048 ≈ 0.9), which cross-checks perfectly against the unconverted "costs 3 feet of movement" phrasing implied by the preceding sentence's plain "1 extra foot" wording; the leading "1 meter" in that same sentence should read "1 foot" (≈0.3 m) — the antecedent's unit didn't get converted along with the consequent's. I did not invent the "3 feet" figure — it's derived by cross-checking the file's own stated conversion ratio against its own numbers, the same technique used for the creature-sizes.md space-table fix, not guessed.)* **This means crawling in difficult terrain is a concrete, confirmed example of stacking beyond the ×2 cap described in §1.2: that cap only applies to multiple sources of the *same* difficult-terrain mechanic. A structurally different movement penalty (crawling, or — by the same "unless you have the matching speed" logic in §1.4 — swimming/climbing without the right speed) stacks additively on top of a difficult-terrain cell instead of being capped by it: 1 (base) + 1 (crawl-penalty) + 1 (terrain-penalty) = 3 total feet per foot moved.** 2024's grounding text has no equivalent crawl-cost statement at all (see §1.4) — this precise 3:1 figure is **2014-only, confirmed; 2024-silent.**

#### 1.7 Moving through allies' / enemies' / hostile creatures' spaces (edge case 8)

**2014**, `combat.md` lines 108–114: "You can move through a **nonhostile** creature's space. In contrast, you can move through a **hostile** creature's space only if the creature is **at least two sizes larger or smaller** than you. Remember that another creature's space is difficult terrain for you... Whether a creature is a friend or an enemy, you can't willingly end your move in its space." And earlier, line 96: "The space of another creature, **whether hostile or not**, also counts as difficult terrain." So in 2014: any creature's occupied cell you're *permitted* to enter (nonhostile always; hostile only at ≥2 size-categories difference) costs double (it's difficult terrain, same §1.2 cap logic — doesn't stack further with itself, but does stack with a genuinely separate terrain penalty per §1.6's logic). A hostile creature within one size category of you: **that cell is not enterable by movement at all** — not "expensive," fully blocked.

**2024**, `combat.md` lines 59–64: "You can pass through an **ally's** space, an **Incapacitated** creature's space, a **Tiny** creature's space, or a creature **two sizes larger/smaller** than you. Another creature's space **otherwise** counts as Difficult Terrain. You can't willingly end your move in another creature's space; if you somehow do, you gain the **Prone** condition (unless you're Tiny or larger than it)."

**Confirmed edition difference #2** (the first being diagonal movement, §1.3): 2024's permitted-passthrough list is **narrower and differently shaped** than 2014's — it's not simply "nonhostile," it specifically enumerates ally / Incapacitated / Tiny / 2-sizes-different, which means a **neutral, non-hostile-but-not-allied creature** (e.g. a bystander NPC not on your `faction`) is *not* explicitly covered by 2024's list the way 2014's blanket "nonhostile" covered it. This app's `combat_participants.faction` enum is `player | ally | enemy | neutral` — under a strict reading of 2024's text, a `neutral` participant's space would need the 2-sizes-different exception to be passable at all, whereas 2014 would just require it to be nonhostile. **Flagging as a real edition-sensitive branch the pathfinding function must implement per-campaign, not resolve one way for both.**

**Genuinely ambiguous in the 2024 grounding text, resolved here by cross-edition consistency (not invention):** does passing through one of 2024's *permitted* spaces (ally/Incapacitated/Tiny/2-sizes-diff) still cost double as difficult terrain, or is it free? The sentence "Another creature's space **otherwise** counts as Difficult Terrain" is the only cost statement, and "otherwise" is not airtight about which creatures it's excluding. **Resolved by treating 2024 as consistent with 2014's unambiguous parallel rule** (§1.2's "whether hostile or not" line) rather than guessing a new mechanic: any creature's space you're allowed to enter is difficult terrain for you, full stop, in both editions. New — and 2024-specific, confirmed by direct text not inference — is the **consequence if you somehow end your move in an occupied space**: you gain the Prone condition (unless Tiny, or larger than the occupant). **2014's grounding text doesn't state this specific consequence** (it only says you can't *willingly* end there — silent on what happens if some other effect forces it).

### 2. Data model translation

#### 2.1 New schema

**`map_cell_overrides`** — sparse per-cell terrain table, one row per non-default cell, missing `(x,y)` = normal/ground/cost-1. This refines `REFACTOR-PLAN.md` §4's own sketch (`cost_type` enum `normal|difficult|impassable|special`) by adding a `medium` column, which the sketch didn't have but §1.4's alternate-speed rule requires: the pathfinder needs to know *which* alternate speed (if any) a cell calls for, not just what it costs a creature with no matching speed.

```sql
CREATE TABLE map_cell_overrides (
  id                BIGSERIAL PRIMARY KEY,
  encounter_map_id  BIGINT NOT NULL REFERENCES encounter_maps(id) ON DELETE CASCADE,
  x                 INT NOT NULL,
  y                 INT NOT NULL,
  cost_type         TEXT NOT NULL DEFAULT 'difficult'
                       CHECK (cost_type IN ('difficult','impassable','special')),
  -- 'normal' is deliberately NOT a valid row value — a normal cell is
  -- represented by the absence of a row (sparse table), per REFACTOR-PLAN's
  -- own "missing = normal cost 1" design; storing cost_type='normal' rows
  -- would be dead weight with no behavioral meaning.
  medium            TEXT NOT NULL DEFAULT 'ground'
                       CHECK (medium IN ('ground','water','air','underground')),
  -- Which alternate speed applies preferentially in this cell (swim/fly/
  -- burrow respectively; 'ground' = walk, the only medium climb doesn't
  -- get its own row for since 2014's text treats climbing as a *terrain
  -- feature of a ground/vertical-surface cell*, not a separate medium the
  -- way swim/fly/burrow are - a DM would mark a cliff face cost_type =
  -- 'difficult' + medium = 'ground' and rely on the mover's alt-speed
  -- lookup finding 'climb' specifically; see 2.2).
  special_cost_ft   INT,      -- only meaningful when cost_type='special'; a
                               -- DM-authored exact per-cell foot cost that
                               -- isn't the flat double (e.g. a scree slope
                               -- the DM wants at 15 ft/cell, not 10 ft/cell)
  note              TEXT,     -- DM-facing label ("shallow bog", "chasm"),
                               -- surfaced in the reachable-cell tooltip
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (encounter_map_id, x, y)
);
CREATE INDEX ON map_cell_overrides (encounter_map_id);
```

**`encounter_maps.feet_per_cell`** — a genuine schema gap this feature exposes: **there is currently no stored feet-per-cell ratio anywhere.** `encounter_maps.cell_size_px` (confirmed, `packages/server/src/db/migrations/1784269754666_create-encounter-maps.ts`) is a **pixel** rendering dimension for the frontend grid, and "5 ft = 1 cell" today is only a UI label string (`BattleMap.tsx` line 469: `"Cell size (px, 5 ft = 1 cell by default)"`) — never persisted, never read by any cost calculation because no cost calculation exists yet. `REFACTOR-PLAN.md` §3's plan to "extend `cell_size_px` to accept a free numeric value" is about pixel rendering size for zoom, and **must not be conflated with feet-per-cell** — a DM changing display zoom should never silently change movement math. Add a distinct column:

```sql
ALTER TABLE encounter_maps ADD COLUMN feet_per_cell INT NOT NULL DEFAULT 5;
```

**`campaigns.diagonal_movement_rule`** — DM-configurable per §1.3, same "one boolean/enum column per DM toggle" precedent already used in this schema (`campaigns.allow_ability_reroll BOOLEAN`, migration `1784269760666`) rather than a JSONB settings blob:

```sql
ALTER TABLE campaigns ADD COLUMN diagonal_movement_rule TEXT NOT NULL DEFAULT 'flat'
  CHECK (diagonal_movement_rule IN ('flat','alternating_5_10_5'));
```
Default `'flat'` is chosen because it's the only variant actually confirmed in either edition's grounding text (2024's "Playing on a Grid," §1.3) — **not** because 2014 is confirmed to default there (it's confirmed nowhere for 2014). Every campaign, in both editions, gets this as a visible, DM-facing setting rather than a silent default baked into the pathfinder.

**Alternate speeds for characters** — `monsters.speed` (catalog) is already JSONB (`schemas/monsterCatalog.ts` line 39: `z.object({ walk: ... }).catchall(z.number())`) and homebrew/seeded monsters can and do carry `fly`/`swim`/`climb`/`burrow` keys today, but **`characters` has no equivalent at all** — only the flat `speed INT` column (`schemas/characters.ts` line 28/41). Add a matching JSONB column so PCs with a racial or class-granted alternate speed aren't silently treated as walk-only:
```sql
ALTER TABLE characters ADD COLUMN alt_speeds JSONB NOT NULL DEFAULT '{}'::jsonb;
-- shape: { fly?: number, swim?: number, climb?: number, burrow?: number } — same
-- key set as monsters.speed minus 'walk' (characters already have a real walk column).
```

#### 2.2 Threading alternate speeds into the combat snapshot (confirmed missing today)

Confirmed by reading `getEncounterCombatSnapshot` (`packages/server/src/services/encounters.ts` lines 484–507): the query's `speed_ft` column only ever extracts `m.speed->>'walk'` (with a regex digit-strip for the legacy `"30 ft."` string shape) — **`fly`/`swim`/`climb`/`burrow` keys already present in `monsters.speed` JSONB are read nowhere in this codebase today.** For movement validation to honor §1.4 at all, the snapshot (and the socket `FULL_STATE_SYNC`/`MOVED` payloads that carry it, `sockets/broadcast.ts`) needs a new field carrying the full alt-speed set, not just `speed_ft`:
```ts
// CombatSnapshotParticipant (services/encounters.ts) and SnapshotParticipant
// (web/src/lib/types.ts) both gain:
altSpeedsFt: { fly?: number; swim?: number; climb?: number; burrow?: number };
// Query addition: COALESCE(c.alt_speeds, m.speed - 'walk', '{}'::jsonb) AS alt_speeds
// (monsters.speed minus the 'walk' key it already reports separately; characters.alt_speeds
// per §2.1). Same COALESCE(character-column, monster-JSONB, fallback) shape this query
// already uses for hp_current/hp_max/armor_class immediately above it.
```

#### 2.3 Pathfinding function

New pure function, `packages/server/src/services/movement.ts`, no DB/DOM dependency (matches this file's existing `computeNextTurn`-style precedent — pure, unit-testable):

```ts
export interface MovementGrid {
  columns: number; rows: number; feetPerCell: number;
  overrides: Map<string, { costType: 'difficult'|'impassable'|'special'; medium: 'ground'|'water'|'air'|'underground'; specialCostFt: number | null }>; // key `${x},${y}`
  // Occupancy is NOT baked into overrides — it's dynamic per mover (depends
  // on the mover's own faction/size relative to the occupant, §1.7), so it's
  // passed separately:
  occupants: Map<string, { faction: string; sizeCells: number }>; // other participants' current cells
}
export interface MoverProfile {
  faction: string; sizeCells: number;
  walkFt: number; altSpeedsFt: { fly?: number; swim?: number; climb?: number; burrow?: number };
  diagonalRule: 'flat' | 'alternating_5_10_5';
}
export function computePathCost(
  grid: MovementGrid, from: {x:number;y:number}, to: {x:number;y:number}, mover: MoverProfile
): { costFt: number; path: {x:number;y:number}[] } | null; // null = no legal path (fully blocked)

export function computeReachableSet(
  grid: MovementGrid, from: {x:number;y:number}, mover: MoverProfile, budgetFt: number
): Set<string>; // same weighted expansion, capped at budgetFt, for the "highlight reachable cells" feature
```
Weighted Dijkstra/BFS (grid capped at 50×50 per `GRID_MIN`/`GRID_MAX` in `BattleMap.tsx` and the `min(5).max(50)` bounds already enforced in `schemas/encounters.ts`'s `upsertEncounterMapSchema` — REFACTOR-PLAN's own sizing note that plain weighted BFS suffices at this scale, no A* needed, is correct). Per-edge cost resolution order the function must implement, precisely, from §1:

1. **Occupancy check first** (§1.7): if the destination cell of this step is occupied, determine passability from `(mover.faction, occupant.faction, mover.sizeCells, occupant.sizeCells)` per the edition's rule (2014: nonhostile always passable / hostile only ≥2 size categories different; 2024: ally/Incapacitated/Tiny/≥2-sizes-different — **this app doesn't track "Incapacitated" as a queryable per-participant flag today**, confirmed by grepping `active_effects`/`conditions` usage in `encounters.ts` — it exists only as a freeform applied-effect name, not a structured boolean the movement engine can branch on; **flagging as a real gap**: 2024's occupancy rule can't be fully implemented until "is this participant Incapacitated right now" is a queryable predicate, not just an effect name string match). If not passable at all: this edge doesn't exist (dead end for pathing purposes, not merely expensive).
2. **Terrain cost lookup** (§1.2/§1.3): `overrides.get('${x},${y}')` — missing = cost 1 (or the diagonal-rule-appropriate base cost for a diagonal step under `alternating_5_10_5`); `difficult` = ×2; `special` = `specialCostFt / feetPerCell` cells-equivalent; if occupied-but-passable, treat as `difficult` too per §1.7's "another creature's space is difficult terrain" rule regardless of what `map_cell_overrides` says for that cell otherwise (the two stack per §1.6's additive-not-capped logic only when they're genuinely different mechanisms — occupancy-as-difficult-terrain plus an already-difficult cell is arguably the SAME mechanism (both "difficult terrain") and should cap at ×2 together, not stack to ×3 — this is an inference from §1.2's self-non-stacking rule, not a separately-confirmed citation, and should be implemented as `max` of the two difficult-terrain sources capping together, distinctly from the crawl/no-alt-speed case which does stack per §1.6).
3. **Alt-speed medium check** (§1.4): if `overrides.medium` for this cell is `water`/`air`/`underground` and `mover.altSpeedsFt` has the matching key (`swim`/`fly`/`burrow`), that speed's own pool is checked/decremented instead of `walkFt` (§1.4's "Using Different Speeds" — independent ceiling against a shared distance-moved total, not simple addition); if no matching alt speed, apply 2014's confirmed ×2 (§1.4) — **and 2024's silence here is a real product decision the implementing session must make explicitly** (recommend: keep the 2014 ×2 as the practical default for 2024 campaigns too, since 2024's grounding text doesn't contradict it and total silence is not evidence of a rule change, but this must be visibly logged as "2014 rule applied by extension, not confirmed 2024 SRD text" in code comments, not silently presented as equally authoritative).
4. **Crawl check**: if `mover` has the Prone condition (see §2.4's gap below on querying this) and isn't standing up this step, add the crawl penalty additively (§1.6) — `costFt(step) = feetPerCell + (isDifficult ? feetPerCell : 0) + (isCrawling ? feetPerCell : 0)`, i.e. every applicable penalty adds one more `feetPerCell`, confirmed-additive per §1.6, not multiplicative.

#### 2.4 Server-side validation — precisely where, and what it must check

**Today**: `setParticipantPosition` (`services/encounters.ts` lines 247–277) does an unconditional `UPDATE combat_participants SET pos_x = $1, pos_y = $2 ...` — no distance, no budget, no occupancy, no terrain check at all, and critically **it never touches `movement_used_ft`** either (that column is only ever incremented by the separate `applyActionEconomy` endpoint via a client-supplied `addMovementFt`, itself unvalidated against anything). This is the exact gap the task and `REFACTOR-PLAN.md` §4 name. Both halves of the bug need fixing in the same change, not just the distance check:

1. `setParticipantPositionSchema` (`schemas/encounters.ts`) shape stays `{x, y}` — the validation isn't a shape problem, it's a business-rule problem that belongs in the service function, per this file's own existing convention (compare `applyActionEconomy`'s slot-conflict check, which also isn't expressible in the Zod schema).
2. `setParticipantPosition` must, inside its existing transaction (after the `FOR UPDATE`-equivalent lock — today's function doesn't even lock the row, another latent race matching the pattern `applyActionEconomy` already guards against; this needs the same `SELECT ... FOR UPDATE` treatment):
   - Load the mover's current `pos_x/pos_y` (source cell), `speed_ft` + `alt_speeds`, `movement_used_ft`, `dash_used`, `faction`, size (per `docs/rules/creature-sizes.md`'s existing normalization).
   - Load `encounter_maps` (grid bounds, `feet_per_cell`) + all `map_cell_overrides` for it + `campaigns.diagonal_movement_rule` (via `encounters.campaign_id`).
   - Load every other participant's current position + faction + size on the same encounter (occupancy set).
   - Call `computePathCost`. If `null` (no legal path — e.g. destination is impassable or fully walled off by non-passable occupied cells): reject.
   - If a path exists, compare `costFt` against remaining budget = `speed_ft + (dash_used ? speed_ft : 0) − movement_used_ft`. If `costFt` exceeds remaining budget: reject.
   - On success: `UPDATE combat_participants SET pos_x=$, pos_y=$, movement_used_ft = movement_used_ft + $costFt ...` in the same statement/transaction — closing the second half of the bug (today's endpoint never spends the budget it displays).
3. **Error shape**: reuse the existing `AppError` code union (`middleware/errors.ts`) rather than growing it — it's a small, closed, status-code-mapped enum today (`VALIDATION_ERROR | UNAUTHENTICATED | NOT_CAMPAIGN_MEMBER | FORBIDDEN_ROLE | FORBIDDEN_NOT_OWNER | NOT_FOUND | CONFLICT | INTERNAL`), and `applyActionEconomy` already uses `CONFLICT` (409) for "you can't do that against the participant's current state" (double-spending a slot) — an over-budget or blocked move is the same shape of failure (current state forbids the requested transition), so:
   - Over budget: `throw new AppError('CONFLICT', 'Move exceeds remaining movement', { reason: 'INSUFFICIENT_MOVEMENT', requiredFt: costFt, remainingFt })` → `409`.
   - No legal path: `throw new AppError('CONFLICT', 'No legal path to that cell', { reason: 'BLOCKED_PATH' })` → `409`.
   This matches the task's expected `409 INSUFFICIENT_MOVEMENT` shape functionally (via `details.reason`) without adding a new top-level `ErrorCode`, which **would** be an application-code change beyond this doc's read-only remit if done differently — flagging that extending the `ErrorCode` union (e.g. adding a literal `'INSUFFICIENT_MOVEMENT'` code) is the alternative the implementing session could choose instead, and either is defensible, but the `details.reason` route needs zero changes to the closed-union error middleware.
4. **Real open question this doc can't settle (product decision, not a rules question):** does this validation apply to *every* `PATCH .../position` call, including a DM's pre-combat token placement before initiative/turns even start? Enforcing movement budget against a participant with `turn_order` not yet current, or against an encounter not yet `status = 'active'`, would wrongly block ordinary DM setup drag-and-drop. Recommend gating the new validation to only fire when `encounter.status === 'active'` **and** it's that participant's own current turn (mirroring `authorizeParticipantAction`'s existing DM-or-owner-during-combat framing) — outside that window, `setParticipantPosition` should keep today's unconditional-move behavior for DM placement/rearrangement. This is a real fork in the implementation the task's brief doesn't resolve, so it's named here rather than picked silently.
5. **Reachable-cell endpoint** (referenced by `REFACTOR-PLAN.md` §4's client bullet, "server computes and returns it"): a new `GET /encounters/:id/participants/:pid/reachable` calling `computeReachableSet` with the same grid/mover/occupancy loading as above, returning the cell set for client-side highlighting — not asked for in the task's numbered list, but it's the read-side counterpart to the write-side validation above and uses the exact same pure function, so noting it here rather than letting it get built as a second, drifted cost-calculation.

**"Incapacitated" gap** (surfaced in §2.3 step 1 and worth restating structurally): this app's `active_effects` table (per `PLAN.md` §3.1's catalog/instance split) stores applied conditions as an instance row referencing an `effect_definitions` catalog entry by name/id, not as a set of queryable boolean predicates like "is this participant currently Incapacitated." 2024's occupancy exception for Incapacitated creatures (§1.7) needs "is this participant Incapacitated" answerable in a single query/join, which today means matching applied-effect names against a hardcoded list of conditions-that-imply-Incapacitated (Incapacitated itself, plus conditions that include it, e.g. Unconscious, Stunned, Paralyzed per the conditions catalog) — doable, but worth flagging as extra logic the movement engine needs, not a trivial column read.

### 3. Edge cases

Restating the eight requested, each cross-referenced to where it's answered above, plus items surfaced along the way:

1. **Per-cell cost model (normal/difficult/impassable)** — §1.2. Difficult terrain (×2) is SRD-named in both editions; "impassable" is this app's own modeling addition, not an SRD term — §2.1's `cost_type` schema reflects that split.
2. **Diagonal movement** — §1.3. **Confirmed to differ between editions**: 2024 has an explicit, named-optional flat-cost rule (diagonal = same cost as orthogonal); 2014's grounding text has no diagonal rule at all. Neither edition confirms the "alternating 5/10/5" variant as an SRD default in this grounding set — it must ship as `campaigns.diagonal_movement_rule`, DM-configurable, defaulting to `'flat'` for both editions (confirmed-official only for 2024; a pragmatic, clearly-labeled default for 2014).
3. **Alternate speeds** — §1.4. A non-swimmer/non-climber *can* move through water/vertical surfaces in 2014, at double cost (triple if also difficult terrain, §1.6) — confirmed text, not inference. 2024 is silent on the without-the-speed cost; recommend applying 2014's rule by extension but log that choice visibly in code, don't present it as equally SRD-confirmed. Burrow-without-a-burrow-speed is inferred impassable from the *absence* of an explicit "costs extra" statement (unlike climb/swim, which do get one) — flagged as inference, not citation.
4. **Dash + difficult terrain** — §1.5. Dash adds flat budget (= base speed) additively; it never multiplies the terrain cost-per-foot layer. No "4× difficult terrain when dashing" scenario exists under either edition's confirmed text.
5. **Splitting movement around an action** — §1.1. Unrestricted in both editions, including between individual attacks of a multi-attack action (explicit 2014 example; 2024's general rule doesn't narrow it).
6. **Difficult terrain stacking** — §1.2/§1.6. Multiple *sources of the same* difficult-terrain mechanic cap at ×2 (explicit, both editions). A *structurally different* movement penalty (crawling; swimming/climbing without the matching speed) stacks **additively** on top of a difficult-terrain cell instead of being capped by it — confirmed via the 2014 crawling arithmetic (3 ft cost per 1 ft crawled in difficult terrain), a genuinely new, precise finding from this pass, not previously in `docs/rules/creature-sizes.md`. 2024 has no equivalent confirmed figure.
7. **Standing up from prone** — §1.6. This app's existing `standUpCostFt = Math.floor(speed/2)` is confirmed correct for both editions (2024 explicitly says "round down"; 2014 doesn't contradict it). No change needed; flat cost, doesn't vary with the terrain of the cell you're standing up in (you don't cover ground standing up).
8. **Moving through ally/enemy/hostile space** — §1.7. **Confirmed second edition difference**: 2014's permitted-passthrough test is "nonhostile, or ≥2 sizes different if hostile"; 2024's is a narrower enumerated list (ally/Incapacitated/Tiny/≥2-sizes-different) that doesn't obviously cover a merely-`neutral` (not-allied, not-hostile) participant the way 2014's blanket "nonhostile" did — this app's `faction` enum includes `neutral` as a first-class value, so this is a real branch, not a corner case. Both editions: any permitted-to-enter occupied cell counts as difficult terrain; you can never *end* your move there. 2024 adds an explicit consequence (gain Prone) if you're somehow forced to end there anyway; 2014's grounding text is silent on that specific consequence.

**Additional edge cases surfaced by reading this app's actual code, not in the requested list but real:**
- **`feet_per_cell` doesn't exist anywhere today** (§2.1) — `cell_size_px` is pixels, not feet; conflating them would make a DM's zoom-level change silently break movement math. Must ship as a new, separate column.
- **Alt speeds already exist in `monsters.speed` JSONB but are never read past `walk`** (§2.2) — the gap is in the snapshot query, not the catalog schema, for monsters. For characters, the gap is in the schema itself (no alt-speed storage at all yet).
- **"Incapacitated" isn't a queryable predicate** (§2.4) — needed for 2024's occupancy rule, currently only derivable by matching applied-effect names against a hardcoded conditions list.
- **Today's endpoint never locks the participant row** (`setParticipantPosition` has no `FOR UPDATE`, unlike `applyActionEconomy`) — a second latent race this change should close alongside the cost check, not a rules question but a correctness gap in the exact function being modified.
- **Today's endpoint never spends `movement_used_ft` at all** — confirmed: `setParticipantPosition`'s `UPDATE` only ever writes `pos_x`/`pos_y`; the budget column is only touched by the separate, client-driven `applyActionEconomy(addMovementFt)` call. Fixing only the "reject over-budget moves" half without also making a successful move *spend* the budget in the same statement would leave the two enforcement paths inconsistent (a client could still call `PATCH .../position` with a cheap move that passes validation, and separately never call `addMovementFt`, leaving `movement_used_ft` permanently understating true spend for future moves this turn).

### 4. What must be tested

Server-side `*.integration.test.ts`, matching this repo's convention (e.g. alongside `packages/server/src/services/encounters.actionEconomyAuthz.integration.test.ts`), targeting crafted-API-call bypass attempts, not just UI affordances:

- **Straight-line budget rejection**: participant with `speed_ft=30`, no dash, attempts a position update whose Chebyshev/path distance (flat-cost grid) exceeds 30 ft of actual path cost → `409 CONFLICT` with `details.reason === 'INSUFFICIENT_MOVEMENT'`, and `pos_x/pos_y` unchanged in the DB afterward (reject must not partially apply).
- **Difficult terrain halves effective range**: same participant, a `map_cell_overrides` row marking every cell on the only path `cost_type='difficult'`, requesting a destination 20 ft away by cell count → rejected (costs 40 budget-ft), while a destination 15 ft away by cell count → accepted and `movement_used_ft` increments by exactly 30.
- **Difficult terrain doesn't stack past ×2**: two independent difficult-terrain-causing conditions on the same cell (e.g. an override row plus an occupied ally cell) → path cost through that cell is exactly 2× base, not 4×.
- **Dash doubles budget, not the terrain multiplier**: speed 30, `dash_used=true`, entire path difficult terrain → exactly 30 ft of real ground is reachable (not 15, not 60) — this is the single most error-prone case per the task's own framing, deserves its own dedicated test asserting the boundary cell (30 ft real distance accepted, 30 ft + 1 cell rejected).
- **Splitting movement around an action doesn't reset or double the budget**: two sequential position updates in the same turn, each within remaining budget after the first — second update's remaining-budget check must account for the first update's already-spent `movement_used_ft`, not treat each `PATCH` as a fresh 0-used turn.
- **Hostile-occupied cell within one size category blocks the path outright**: destination reachable only by routing through a same-size hostile participant's cell → `409 CONFLICT`, `details.reason === 'BLOCKED_PATH'`, even if the straight-line distance is well within budget.
- **Two-sizes-different hostile cell is passable-but-costly, not free**: Large mover routing through a Tiny hostile's cell (2014: allowed since ≥2 sizes different) → accepted, but at difficult-terrain (×2) cost for that cell, not ×1.
- **Ally space is passable and still costs double**: routing through an ally's occupied cell costs the same ×2 as an override-flagged difficult cell, confirming §1.7's "occupied-but-permitted = difficult terrain" rule is actually wired into the cost function, not just the passability check.
- **Non-swimmer in water costs double, swimmer doesn't**: same water-medium cell, one participant with `alt_speeds.swim` set and one without — the swimmer's path cost for that cell is ×1 against their swim pool, the non-swimmer's is ×2 against their walk pool (2014 campaign; note in the test that this is 2014-confirmed behavior being asserted for a 2024 campaign too only if the implementing session chose to extend it per §2.3/§3 item 3 — the test suite should make that choice traceable, e.g. a comment citing this doc section, not silently assume it).
- **Crawling in difficult terrain costs 3 feet per foot moved, not 2 or 4** (§1.6): a Prone participant moving through a difficult-terrain cell without standing up first → cost is exactly 3× the base per-foot rate, distinctly higher than a non-prone participant's 2× through the same cell — this is the sharpest regression risk named in this doc, since "difficult terrain doesn't stack with itself" (§1.2) is easy to over-apply here and wrongly cap this at 2× instead of the confirmed-additive 3×.
- **Standing up from prone spends exactly `floor(speed/2)` and is unaffected by the terrain of the cell stood up in**: assert no terrain multiplier is applied to the stand-up cost itself, distinguishing it from a movement-cost call.
- **Row locking / concurrent-move race**: two rapid `PATCH .../position` calls for the same participant (simulating a double-click or replayed request) must not both succeed if their combined cost exceeds budget — proves the `FOR UPDATE` fix (§2.4) actually closes the race, not just that a single call's math is right.
- **DM pre-combat placement bypass is intentional, not a bug**: a `PATCH .../position` call against a participant in an encounter with `status !== 'active'` (or before turn order starts) succeeds regardless of distance — proving the §2.4 item 4 gating decision is actually implemented, not accidentally enforcing budget everywhere.
- **`feet_per_cell` default doesn't silently assume `cell_size_px`**: an `encounter_maps` row with a non-5 `feet_per_cell` (e.g. 10, a DM using a larger-scale map) changes the accepted movement range for the same nominal `speed_ft`, proving the two columns are genuinely decoupled and the cost function reads the right one.

## DM-configurable, never hardcoded

Named explicitly, per this repo's persona convention, rather than buried in prose above:

- **Diagonal movement variant** (`campaigns.diagonal_movement_rule`, §2.1): `'flat'` (confirmed 2024 default) vs `'alternating_5_10_5'` (unconfirmed-by-SRD-text-in-this-grounding-set variant some tables use). Must be a per-campaign toggle, not a hardcoded assumption for either edition.
- **Climbing/swimming skill checks** (2014 `adventuring.md`: "At the GM's option, climbing a slippery vertical surface... requires a successful Strength (Athletics) check") — explicitly named GM's-option text, not a hard rule; this app has no mechanism today to require an ad hoc check mid-move, and none is proposed here (out of scope for the movement-cost data model specifically — a DM narrating "roll Athletics" and adjudicating the result manually is consistent with this app's existing "display-only, DM adjudicates" precedent already used for stealth-disadvantage/STR-requirement flags elsewhere in this codebase).
- **Whether 2024 campaigns inherit 2014's confirmed climb/swim-without-matching-speed ×2 cost** (§1.4, §2.3 step 3): genuinely SRD-silent for 2024 in this grounding set — recommended as a practical default but must be visibly logged as an extension, not presented as equally SRD-confirmed, and ideally itself surfaced as a per-campaign toggle if a DM's table plays 2024 without that penalty.
