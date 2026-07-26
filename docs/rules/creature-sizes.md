# Creature Sizes

## Size category → grid footprint (cell count)

Consulted for: `REFACTOR-PLAN.md` §3 "Board positions readable at a glance" (Token.tsx / BattleMap.tsx). Edition: **both** — this app is dual-edition (`campaigns.srd_edition` = `'2014'` or `'2024'`), and the rule is identical between them (see "Official rule" below for the one place the source text needed cross-checking).

### 1. Official rule

**2024 — `references/2024/combat.md`, "Creature Size and Space" (lines 45–58):**

| Size | Space (meters) | Space (squares) |
|---|---|---|
| Tiny | 0.75 × 0.75 m | 4 per square |
| Small | 1.5 × 1.5 m | 1 square |
| Medium | 1.5 × 1.5 m | 1 square |
| Large | 3 × 3 m | 4 squares (2×2) |
| Huge | 4.5 × 4.5 m | 9 squares (3×3) |
| Gargantuan | 6 × 6 m | 16 squares (4×4) |

"A creature's space is the area it effectively controls/needs to fight, not literally its body size."

**2014 — `references/2014/combat.md`, "Size Categories" (lines 124–133):**

| Size | Space (as given in the source file) |
|---|---|
| Tiny | `2.5 by 2.1.5 m.` |
| Small | `5 by 1.5 m.` |
| Medium | `5 by 1.5 m.` |
| Large | `10 by 3 m.` |
| Huge | `15 by 4.5 m.` |
| Gargantuan | `20 by 6 m. or larger` |

**Data-quality note, stated explicitly rather than silently corrected:** the 2014 file's feet→meters conversion is garbled for the Tiny/Small/Medium rows (mixed feet/meter fragments — `2.5 by 2.1.5 m.`, `5 by 1.5 m.` where "5" is still in feet). I have **not** invented replacement numbers. Instead I cross-checked against the parallel, non-garbled 2024 table in the same grounding data: 0.75 m = 2.46 ft ≈ **2.5 ft** (Tiny), 1.5 m ≈ **5 ft** (Small/Medium), 3 m ≈ **10 ft** (Large), 4.5 m ≈ **15 ft** (Huge), 6 m ≈ **20 ft** (Gargantuan). These are exactly the foot-values legible in the 2014 row (`10 by 3 m.` = 10 ft one side already in feet, 3 m ≈ the same 10 ft on the other side; `15 by 4.5 m.` = 15 ft / 4.5 m ≈ 15 ft; `20 by 6 m.` = 20 ft / 6 m ≈ 20 ft). So the underlying space-per-side in feet is legible and self-consistent for Large/Huge/Gargantuan, and matches 2024 exactly; only the Tiny/Small/Medium meter-side conversion is corrupted text, not a different rule. **Conclusion: 2014 and 2024 use the identical size→space table** (in feet: Tiny 2.5 ft, Small 5 ft, Medium 5 ft, Large 10 ft, Huge 15 ft, Gargantuan 20 ft+, per side of a square footprint) — this is not a case of the editions actually differing, it's a transcription defect in one source file that a cross-edition sanity check resolves without guessing.

Converting each side to this app's grid (1 cell = 5 ft, the app's own default per `REFACTOR-PLAN.md` §3 — "default 5 ft = 1 cell"):

| Size | Space (side, ft) | Grid footprint |
|---|---|---|
| Tiny | 2.5 ft | shares a cell (4 Tiny creatures per cell — see 2024's "4 per square") |
| Small | 5 ft | 1×1 |
| Medium | 5 ft | 1×1 |
| Large | 10 ft | 2×2 |
| Huge | 15 ft | 3×3 |
| Gargantuan | 20 ft (or larger) | 4×4 (Gargantuan can be *larger* than 20 ft per the SRD's "or larger" — see Edge cases) |

**Reach is a separate stat, not derived from size.** Both editions state reach defaults to 5 ft (1.5 m) regardless of size, and is only *larger* than 5 ft when a creature's own stat block says so:
- 2014, `references/2014/combat.md` line 298: "Most creatures have a 1.5-meter reach... Certain creatures (typically those larger than Medium) have melee attacks with a greater reach than 1.5 meters, as noted in their descriptions."
- 2024, `references/2024/combat.md` lines 96–98: "Default reach is 1.5 meters (some creatures have more, noted in their description)."

Both editions phrase this identically in substance: size category sets *footprint*; reach is *independent, per-stat-block* data and only correlates loosely with size ("typically larger than Medium").

### 2. Data model translation

**New lookup, not a schema change, for the footprint table itself.** The size→cell-count mapping is a fixed rules constant (identical in both editions, per above), so it belongs as a static lookup in web code, not a DB table or per-campaign setting:

```ts
// packages/web/src/encounters/ (or a shared lib) — keys MUST match monsters.size casing exactly, see below
const SIZE_FOOTPRINT_CELLS: Record<string, number> = {
  Tiny: 1,       // shares a cell — see Edge cases; render sub-cell, don't treat as 0
  Small: 1,
  Medium: 1,
  Large: 2,
  Huge: 3,
  Gargantuan: 4,
};
```
(N below means an N×N span starting at the token's anchor cell — `Record<string, number>` gives the side length, not total cell count, since `Token.tsx`/`BattleMap.tsx` will want `gridColumn: span N` / `gridRow: span N` directly.)

**Confirmed source-of-truth for the size string, and exact casing (checked directly, not assumed):**
- `packages/server/src/schemas/monsterCatalog.ts` line 32: `size: z.string().min(1).max(50)` — **free-text, no enum, no case normalization.** Any casing a DM types for a homebrew monster is stored as-is.
- `packages/server/src/db/migrations/1784269736666_create-catalog-monsters.ts` line 15: `size TEXT NOT NULL` — same, DB-level free text.
- `packages/server/src/db/seeds/demo.ts` lines 60/75/92/107 — the seeded starter bestiary: `size: 'Small'` (goblin), `size: 'Medium'` (wolf, skeleton, orc). **Title Case, singular, English size-category words — `'Small'`, `'Medium'`, not `'small'`/`'SMALL'`/`'Small (Swarm)'`.**
- `packages/server/src/db/seeds/catalog.ts` `sizeOf()` (lines 66–74) pulls size directly from the upstream 5e-bits dataset's `entry.size` field for races/species, same free-text convention, also Title Case in that dataset's convention.

**Because `monsters.size` is unconstrained free text (not a DB enum, not a Zod enum), the lookup keyed by exact Title Case string (`Tiny`/`Small`/`Medium`/`Large`/`Huge`/`Gargantuan`) is a latent bug source**: a homebrew monster saved with `size: 'small'` or `size: 'Large (Swarm)'` won't match the lookup and needs a defined fallback (recommend: case-insensitive match with `.trim()`, defaulting to `Medium`/1×1 on no match, and surfacing that as a visible "unrecognized size" affordance to the DM rather than silently rendering wrong — silent 1×1 fallback for an unmatched Gargantuan dragon would look like a rendering bug). This validation gap is pre-existing (not introduced by §3) but §3 is the first place an unrecognized value has a *visible* consequence (wrong token footprint), so it should get a client-side normalization helper (e.g. `normalizeSizeKey(raw: string): keyof typeof SIZE_FOOTPRINT_CELLS`) rather than relying on exact-match luck.

**Schema gap: `characters` has no size column at all.** Confirmed by reading `packages/server/src/schemas/characters.ts` and the `characters` table migrations — no `size`/`race_id`/`species_id` column exists on `characters`, and `packages/web/src/lib/types.ts`'s `SnapshotParticipant` (line 297) has no `size` field either. Every PC-controlled token is implicitly Medium today. This is fine for the common case (most 2014 races / 2024 species are Medium or Small) but is a real, silent gap for any Small-race PC that a DM might expect to render smaller, and a hard blocker if this app ever adds Large-footprint PC races. **Not proposing a schema change here** (out of scope for §3, which only asks about monster/NPC footprint per the brief) — flagging it so the calling session doesn't assume PC size is "just not a thing that varies," and so `SIZE_FOOTPRINT_CELLS` lookups on character participants should hardcode `Medium` with a `// TODO` comment pointing at this gap rather than silently omitting the case.

**Where the size value must flow through for rendering (grounded in actual current shapes):**
- `MonsterCatalogEntry.size` (`packages/web/src/lib/types.ts` line 161) already carries the raw string for monster catalog entries.
- `SnapshotParticipant` (same file, line 297) does **not** currently carry `size` — it's not in `CombatSnapshotParticipant` (`packages/server/src/services/encounters.ts` lines 388–431) or the `SELECT` that builds it (lines 440–453). To make `Token.tsx` render a footprint, `size` must be added: joined server-side as `COALESCE(m.size, 'Medium') AS size` (characters have no size column, hence the hardcoded fallback per the gap above) in `getEncounterCombatSnapshot`'s query, added to both `CombatSnapshotParticipant` and `SnapshotParticipant`, and threaded into the socket `FULL_STATE_SYNC` payload the same way `speed_ft`/`armor_class` already are.
- No server-side validation is required for the footprint rendering itself (§3 is purely a display concern — how many cells a token *visually spans*, not a movement-cost or collision rule). Server-side validation *would* be required if footprint starts affecting anything enforced (e.g. large-token collision blocking a move, or reach-based attack legality) — that's out of scope for §3 and belongs with `REFACTOR-PLAN.md` §4 (movement) instead; noting the boundary so it isn't silently conflated.

### 3. Edge cases

- **Tiny creatures sharing a cell.** 2024 explicitly says 4 Tiny creatures fit "per square" (i.e., per cell); the 2014 table (once cross-checked, see §1) implies the same 2.5 ft side. This app's `combat_participants.pos_x/pos_y` model is **one participant per (x,y) pair with no stacking concept** — confirmed by reading the position columns' migration (`1784269754666_create-encounter-maps.ts`) and `BattleMap.tsx`'s drag/drop handling, neither of which has any multi-occupant-per-cell logic. Today, two Tiny participants dropped on the same cell will simply render on top of each other (last-write overwrites the previous token's screen position, no visual offset) rather than being deliberately laid out as "4 per cell." **This is a real gap for §3 to close**, not just a rules footnote: the footprint renderer should offset same-cell Tiny tokens into sub-cell quadrants (a UI-only layout change, no schema change) rather than leaving them fully overlapping.
- **Large+ token overlapping another token's space.** The SRD space rule ("you can't willingly end your move in another creature's space," both editions — 2014 line 112, 2024 lines 62–64) governs *movement legality*, not rendering. For §3 specifically (readable board positions, not movement enforcement — that's §4), a Large+ token's 2×2/3×3/4×4 footprint can still visually overlap an already-placed token's cells if the DM manually drags either one there, since there is currently **no placement-collision check anywhere in this app** (confirmed: `BattleMap.tsx`'s position mutation has no adjacency/occupancy validation, matching the REFACTOR-PLAN.md §4 finding that movement itself has zero server-side cost/legality enforcement today). Recommend §3 render this state visibly (e.g., overlapping token boundaries drawn with enough contrast/z-order to be obviously wrong) rather than silently clipping, since actually *preventing* it is a movement-legality rule that belongs in §4's server-side validation work, not §3's rendering pass.
- **Squeezing into a smaller space** (2014 `references/2014/combat.md` lines 143–145): a creature can squeeze through/into a space one size smaller than its own, at double movement cost and with attack/Dex-save disadvantage while squeezed (attackers get advantage against it). The 2024 file in this grounding set does not carry an equivalent explicit "Squeezing" subsection (checked — not present in `references/2024/combat.md`; grep for "squeez" in that file returned nothing). **Flagging as genuinely SRD-silent in the 2024 grounding data**, not assuming the rule dropped — the 2024 PHB is known to keep a squeezing rule, but since it isn't in this skill's reference text, I'm not filling that gap with unconfirmed specifics. Either way, this app has **no squeeze/footprint-reduction mechanic at all** today (Token footprint would be a flat N×N with no "squeezed" variant) — out of scope for §3's readable-positions goal, but worth naming as a gap if a later movement-through-narrow-corridor feature gets built.
- **Reach ≠ footprint.** As established in §1, a creature's *reach* (how far it can make a melee attack) is independent of its *space* (footprint). A Large creature's default reach is still typically 5 ft beyond its own space edge unless its stat block says otherwise (e.g., many Large monsters have 10 ft reach, but that's a per-monster stat, not automatic from size). This app currently has **no structured `reach` field anywhere** — confirmed by grepping `monsterCatalog.ts`'s schema and the migration for `create-catalog-monsters`: reach only ever appears as free text embedded inside an attack's `description` string (e.g. `db/seeds/demo.ts` line 70: `"reach 5 ft., one target"`). §3 (footprint rendering) doesn't need reach at all — it's purely a display concern for token size — but if a later feature (e.g. highlighting melee-attack range) reads reach off a monster, it'll need a new structured column; not proposing that here since it's out of §3's scope.
- **Gargantuan "or larger."** The SRD table caps its named categories at Gargantuan = 20 ft (2024: 6 m/4×4) but both editions phrase Gargantuan as "or larger" — a stat block can specify an even bigger footprint (e.g. some published Gargantuan dragons/kaiju exceed the default 4×4). `SIZE_FOOTPRINT_CELLS['Gargantuan'] = 4` is therefore a **default, not a hard ceiling** — this app has no per-monster footprint override column today (`monsters` has only the free-text `size` string, no numeric width/height), so any monster genuinely larger than default-Gargantuan will under-render until such an override is added. Flagging as a gap rather than silently capping at 4×4 forever.
- **Non-square Gargantuan footprints.** The SRD table (both editions) states Gargantuan space as a single side length ("20 m or larger" / "6 m") implying square by default, but real published Gargantuan stat blocks are sometimes rectangular (e.g. very long serpentine creatures). Neither reference file in this grounding set gives a non-square example or general rule for it — SRD-silent on the specific mechanic, not assumed away.

### 4. What must be tested

Footprint rendering is a client-only display concern for §3 (per the scope boundary drawn above — no movement/collision enforcement is being added here), so the test bar is different from a typical `*.integration.test.ts` server-authorization case, but there are still concrete, checkable behaviors:

- **Size-key normalization unit test** (client, pure function): `normalizeSizeKey('small')`, `normalizeSizeKey('SMALL')`, `normalizeSizeKey(' Small ')`, `normalizeSizeKey('Large (Swarm)')`, `normalizeSizeKey('')`, `normalizeSizeKey(undefined)` — each must resolve to a defined footprint (or an explicit "unrecognized" sentinel that the UI visibly flags), never `undefined`/`NaN`/silent 0-cell rendering.
- **Footprint span test**: given each of the six canonical Title Case size strings from the seeded bestiary (`Tiny`, `Small`, `Medium`, `Large`, `Huge`, `Gargantuan` — confirm against `db/seeds/demo.ts` and `db/seeds/catalog.ts` actual values, not assumed), `SIZE_FOOTPRINT_CELLS` returns exactly `{1,1,1,2,3,4}` respectively.
- **Server-side snapshot test** (`*.integration.test.ts`, matching this repo's convention — e.g. alongside `packages/server/src/services/entityFieldReveal.integration.test.ts`): once `size` is added to `getEncounterCombatSnapshot`'s query (per §2), assert a monster-instance participant's snapshot row carries the joined `monsters.size` value unchanged, and a character participant's snapshot row carries the hardcoded `'Medium'` fallback (proving the characters-have-no-size gap is handled deliberately, not accidentally `NULL`).
- **Tiny-stacking layout test**: two Tiny participants placed at the same `(pos_x, pos_y)` render as two visually distinct sub-cell tokens, not one token overwriting the other's screen position.
- **Large+ overlap is visible, not silently clipped**: place a Large token such that its 2×2 span overlaps an already-placed Medium token's cell; assert both tokens remain individually visible/hit-testable in the DOM (not that overlap is *prevented* — that's explicitly §4's job, not §3's).
- **Reveal-engine interaction**: `entityFieldReveal`'s existing default allowlist already includes `"size"` for `monster_instance` (`1784269762666_create-entity-field-reveals.ts` line 40) — confirm a player-role socket that hasn't had `size` revealed for a given monster instance does **not** receive a real size string in the footprint-relevant snapshot field (should the reveal gate apply here — flagging as a question for the implementing session: does hiding "size" from a player also mean rendering their token at a generic default footprint client-side, or does the DM-authoritative map always show true footprint to everyone since board geometry arguably isn't the kind of "fact" the reveal engine was built to hide? Not a rules question — a product decision this doc can't settle, but the interaction is real and untested today).

## DM-configurable, never hardcoded

None of the footprint mechanics above are DM-configurable options in the SRD sense (unlike, say, the diagonal-movement variant or flanking) — size→space is a fixed rule in both editions. The one adjacent DM-configurable item, noted for completeness since it touches the same grid: `encounter_maps.cell_size_px`/the feet-per-cell ratio itself is already configurable per `REFACTOR-PLAN.md` §3 ("extend `cell_size_px` to accept a free numeric value... default 5 ft = 1 cell") — the `SIZE_FOOTPRINT_CELLS` table above assumes the standard 5-ft-per-cell convention baked into that default; if a campaign's map is ever reconfigured to a non-5-ft cell size, footprint-in-cells would need to be computed from `space_ft / (feet per cell)` rather than the fixed `{1,1,1,2,3,4}` table, since a Large creature's fixed 10 ft space would then span a different number of cells. Flagging so the implementation doesn't silently assume 5 ft/cell is invariant.
