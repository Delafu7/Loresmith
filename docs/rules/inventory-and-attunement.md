# Inventory: Encumbrance and Attunement

Consulted for: deriving `computeCarryingCapacity`/carrying-weight validation and an attunement-slot check. Edition: **both** requested, but grounding coverage is asymmetric — see each section's "Official rule" for exactly what's confirmed vs. genuinely absent from this app's `dnd5e-srd` skill for 2024.

## Encumbrance (standard lifting/carrying rules, not the "encumbrance by degree" variant unless noted)

### 1. Official rule

**2014 — `references/2014/ability-checks.md` lines 194–210 ("Lifting and Carrying"):**

| Quantity | Formula | Notes |
|---|---|---|
| Carrying capacity | `STR score × 15` lb | "high enough that most characters don't usually have to worry about it" |
| Push / drag / lift | `STR score × 30` lb (= 2× carrying capacity) | While pushing/dragging weight *in excess of carrying capacity*, speed drops to 5 ft (source text says "1.5 meters," a feet→meters conversion artifact at this skill's own 5 ft = 1.5 m ratio — same pattern already documented in `docs/rules/movement.md` and `docs/rules/creature-sizes.md`, not a different number) |
| Size modifier | Each size category **above** Medium: **double** capacity and push/drag/lift. **Tiny**: **halve** both. Small/Medium: ×1 | Also: 2024's `species.md` line 97, "Powerful Build" trait — "count as one size larger when determining your carrying capacity" (this is a 2024-confirmed *trait* modifier, independent of the base formula) |

**Variant: Encumbrance** (same file, lines 204–210 — explicitly headed "Variant," i.e. **DM-configurable**, not the default):

| Threshold | Effect |
|---|---|
| Carried weight > `STR × 5` | **Encumbered**: speed −10 ft (source: "−3 meters") |
| Carried weight > `STR × 10` (up to max capacity) | **Heavily encumbered**: speed −20 ft (source: "−6 meters"), disadvantage on Strength/Dexterity/Constitution ability checks, attack rolls, and saving throws |

When this variant is used, ignore `items.str_requirement`-driven armor speed penalties (the text says "ignore the Strength column of the Armor table") — that column is a *different*, armor-specific mechanic (minimum Str to avoid an armor speed penalty), not part of the carrying-capacity computation itself.

**2024 — genuinely a gap, not an assumption.** `references/2024/adventuring.md` line 30–32 only says "you generally don't need to track weight unless hauling something unusually heavy/bulky (carrying-capacity rules apply then)" — it references the rule but the actual `× 15` / `× 30` / encumbrance-threshold numbers are **not present anywhere in this skill's 2024 reference set** (checked `adventuring.md`, `ability-checks.md`, `character-creation.md`, `combat.md`, `conditions.md`, `species.md` for "Strength score," "carrying," "encumb" — no formula text). There is no `equipment-items.md` under `references/2024/` at all, unlike 2014. **I am not asserting the 2014 formula carries over unchanged** even though that's plausible — this is a confirmed hole in the local grounding data, not a confirmed-identical rule. Verify directly against the official SRD 5.2 (CC-BY) text before hardcoding `× 15` for 2024 campaigns; if you do proceed with the 2014 numbers as a working default, log that choice visibly in code as an unconfirmed extension (same convention `docs/rules/movement.md` §1.4/§3 uses for its own 2024 climb/swim gap), not as equally-SRD-sourced.

### 2. Data model translation

**Capacity is a pure function of `characters.str` (+ size), not a stored column** — matches this app's existing "computed, not persisted" precedent (`computeArmorClass`, per `PLAN.md` §3.5). New pure function, `packages/server/src/services/encumbrance.ts`:

```ts
export function carryingCapacityLb(strScore: number, sizeCategory: SizeCategory): number {
  const base = strScore * 15; // 2014-confirmed; 2024 unconfirmed by this skill, see §1 above
  if (sizeCategory === 'Tiny') return base / 2;
  const stepsAboveMedium = SIZE_ORDER.indexOf(sizeCategory) - SIZE_ORDER.indexOf('Medium'); // Large=1, Huge=2, Gargantuan=3
  return stepsAboveMedium > 0 ? base * 2 ** stepsAboveMedium : base;
}
export function pushDragLiftLb(strScore: number, sizeCategory: SizeCategory): number {
  return carryingCapacityLb(strScore, sizeCategory) * 2; // = STR * 30 at Medium
}
```

Note `docs/rules/creature-sizes.md`'s existing finding: **`characters` has no size column today** (PC size is implicitly Medium everywhere) — `sizeCategory` for a PC should read from `races.size`/`subraces.size` via `character.race_id`/`subrace_id` (both exist as FKs per `PLAN.md` line 478–479) with a `'Medium'` fallback if unset, not hardcode Medium unconditionally, so a Small-race PC (e.g. Halfling, Gnome) gets correct capacity. For `monster_instances`, read `monsters.size` directly.

**Total carried weight — confirmed answer to the user's specific question: equipped/worn items DO count.** Nothing in the 2014 text (the only edition with a confirmed formula) excludes worn armor or wielded weapons from "carrying." "Carrying capacity... is the weight you can carry" is stated with no worn/carried distinction, and the only place a Strength-vs-armor interaction is separately named is `items.str_requirement` (a *different* mechanic — minimum Str to avoid an armor-specific speed penalty, already modeled per `PLAN.md` §3.5's `computeArmorClass` work), not an exemption from the carrying total. So:

```sql
-- total_carried_weight_lb, computed at read time (not stored):
SELECT COALESCE(SUM(i.weight_lb * ci.quantity), 0)
FROM character_items ci JOIN items i ON i.id = ci.item_id
WHERE ci.character_id = $1;
-- is_equipped is NOT part of the WHERE clause — equipped items still count.
```

**Schema gap, flagged rather than silently assumed:** `character_items` (per `PLAN.md` lines 563–578) has no "stowed elsewhere" / container / location field — every row is implicitly "on this character's person." There's no way today to model "left the extra rope back at camp" as distinct from "carrying it." If that distinction matters to a future feature, it needs a new column (e.g. `character_items.location TEXT DEFAULT 'carried' CHECK (location IN ('carried','stowed'))`); until then, the carried-weight sum above is necessarily "all owned items," which may overcount vs. the strict SRD intent for a character who canonically stows gear elsewhere. Not proposing that column now — naming the gap so it isn't silently baked in as "correct forever."

**Where validation must live:** encumbrance affects **speed**, which is read by the movement engine (`docs/rules/movement.md` §2.3's `MoverProfile.walkFt`). If the encumbrance variant is enabled for a campaign, `walkFt` passed into `computePathCost`/`computeReachableSet` must be reduced (−10/−20 ft) **server-side**, inside the same `setParticipantPosition` service function that already loads the mover's stats (`docs/rules/movement.md` §2.4) — computing it only in a UI display component and not re-deriving it server-side before the movement-budget check would let a crafted `PATCH .../position` call move at full, unencumbered speed. Carrying-capacity itself isn't an action a player "does" (there's no discrete "pick up an item" transaction requiring a legality check today — `character_items` rows are just created/updated via `POST/PATCH /characters/:id/items`), so the enforcement point is: (a) surface `total_carried_weight_lb` / `carrying_capacity_lb` on the character read endpoint for display, and (b) **compute the effective encumbrance tier server-side inside the movement-budget check**, not just display a warning badge client-side and trust the client to self-report reduced speed.

### 3. Edge cases

- **Standard rule vs. variant are different defaults.** Plain "Carrying Capacity" (`STR×15`) is the SRD *default* — most characters never hit it. "Encumbrance" (the `STR×5`/`STR×10` tiers) is an explicitly-labeled variant. **DM-configurable**, see below — don't silently enable the stricter variant for every campaign.
- **Size category changes mid-game** (polymorph, *enlarge/reduce*, growth effects) — capacity must be recomputed from *current* effective size, not the character's base race size; this app's `active_effects` table would need to expose a queryable "current size override" for that to work automatically. Not confirmed as already wired anywhere; flagging as a real interaction, not asserting it's handled.
- **Powerful Build (2024 trait)** — counts as one size larger *for carrying capacity only* (confirmed text, `species.md` line 97), not for footprint/space (`docs/rules/creature-sizes.md`). This is a targeted, single-purpose modifier, not a general size-category change — implementation must apply it only inside `carryingCapacityLb`, not to `SIZE_FOOTPRINT_CELLS`.
- **Currency/coin weight** is a classic SRD wrinkle (coins have weight in the full rulebook's equipment tables) — no coin-weight rule appears anywhere in this skill's grounding text for either edition, and this app's schema doesn't model a coins-as-weighted-items concept (`cost_cp` on `items` is price, not carried coin inventory) — out of scope unless a currency-tracking feature is added later.
- **Zero or negative Strength-derived capacity** can't occur (`str` is a positive ability score, capacity formula is always ≥0), but a `str_score` of 1 (minimum by most ability-score rules) still yields a nonzero capacity (15 lb) — no special-case needed.
- **2024 formula assumed-vs-confirmed** — restated as an edge case because it's the biggest risk here: shipping `× 15` for a 2024 campaign is currently an *inference*, not a citation. If the real SRD 5.2 numbers differ even slightly, every 2024-campaign character's displayed capacity would be silently wrong.

### 4. What must be tested

- **Capacity formula unit tests** (pure function, no DB): `carryingCapacityLb(10, 'Medium') === 150`; `carryingCapacityLb(10, 'Small') === 150`; `carryingCapacityLb(10, 'Tiny') === 75`; `carryingCapacityLb(10, 'Large') === 300`; `carryingCapacityLb(10, 'Huge') === 600`; `carryingCapacityLb(10, 'Gargantuan') === 1200`; `pushDragLiftLb(10, 'Medium') === 300`.
- **Equipped items count toward the total** (`*.integration.test.ts`): create a character, add an item with `weight_lb=50` and `is_equipped=true`, assert `total_carried_weight_lb` includes it — regression-guards against a future "equipped items are free" bug being introduced by someone assuming worn = exempt.
- **Encumbrance variant gating**: with the variant toggle off (default), a character carrying `STR×7` weight still moves at full, unreduced speed; with it explicitly on for the campaign, the same character is capped at reduced speed inside a `PATCH .../position` call (not just flagged in a GET response) — proving server-side enforcement, not just a UI badge.
- **Crafted-bypass test**: a client submits a `PATCH .../position` move that would only be legal at unencumbered speed while the character's carried weight is in the heavily-encumbered tier and the campaign has the variant enabled → rejected, matching `docs/rules/movement.md`'s existing `409 CONFLICT` shape.

## DM-configurable, never hardcoded

- **Standard capacity vs. Encumbrance variant vs. no tracking at all** — three real table postures (SRD "usually don't track it," SRD's own stricter variant, or a DM who wants zero weight-tracking friction). This app has no per-campaign settings mechanism for this today (per `PLAN.md`'s `campaigns` table, no such column exists) — needs one, e.g. `campaigns.encumbrance_mode TEXT NOT NULL DEFAULT 'standard' CHECK (encumbrance_mode IN ('off','standard','variant'))`, following the same one-column-per-toggle precedent `docs/rules/movement.md` uses for `diagonal_movement_rule` rather than a JSONB settings blob.

---

## Attunement

### 1. Official rule

**2014 — `references/2014/equipment-items.md` lines 123–133 ("Attunement"), fully confirmed:**

- **Limit: 3 items at a time**, confirmed exact number ("a creature can be attuned to no more than three magic items at a time"). A 4th attunement attempt fails outright — the creature must voluntarily end an existing attunement first; there is no partial/queued state.
- **Time to attune**: a **short rest spent focused on only that item**, while in physical contact with it (can't be the same short rest used to *identify* the item's properties). If the short rest is interrupted, the attempt fails (no partial credit / resume — must restart the full short rest).
- **One item can only be attuned to one creature at a time**; a creature can't hold simultaneous attunement to more than one copy of the same item (e.g. two *rings of protection*).
- **Prerequisites**: some items require a class or "must be a spellcaster" prerequisite. Class prerequisite = creature must be a member of that class (a monster with matching spell slots + that class's spell list also qualifies). Spellcaster prerequisite = creature can cast ≥1 spell via its own traits/features (not via another magic item).
- **Attunement ends when**: (a) the creature no longer meets the item's prerequisites, (b) the item has been >30 m / ~100 ft away from the creature continuously for ≥24 hours, (c) the creature dies, (d) another creature attunes to the item, or (e) the creature **voluntarily** ends it by spending another short rest focused on the item (not permitted if the item is cursed and the curse prevents it).
- **Freeing a slot ≠ instant by default**: voluntary un-attunement itself **requires spending a short rest** focused on the item (same cost as attuning) — it is not a free, instantaneous "drop it and the slot opens" action. Only the *forced* end conditions (death, 24h+30m separation, prerequisite loss, another creature attuning) are immediate/automatic, no rest required.
- **Un-attuning does not require an additional rest afterward** to make the freed slot usable — the moment the un-attuning short rest completes, the slot is free and a new short-rest attunement to a different item could begin immediately after (or even be attempted as a separate short rest right after, per RAW text there's no cooldown named beyond the rest itself).
- **Without attunement**, a creature still gets an attunement-requiring item's stated *nonmagical* benefits (e.g. a magic shield still functions as a mundane shield) unless the item's own description says otherwise — it just gets none of the magical properties.

**2024 — unconfirmed in this skill's grounding set.** No `equipment-items.md` exists under `references/2024/`, and grepping every 2024 reference file for "attune" returns zero hits describing the mechanic (only unrelated "magic item" mentions in `ability-checks.md`/`character-creation.md`). **I cannot confirm from this app's grounding data whether 2024 changed anything** about the 3-item limit, the short-rest requirement, or the break conditions. This is a complete gap for 2024, not a partial one — verify against the actual SRD 5.2 text before shipping identical logic for both editions.

### 2. Data model translation

`character_items.is_attuned BOOLEAN` already exists (`PLAN.md` line 570) but is a bare flag with **no state for "in progress," no timestamp, and no way to enforce the 3-item cap or the short-rest requirement server-side** — a client could `PATCH` `is_attuned=true` on a 4th item today with zero validation.

**Server-side validation required** (per this project's "critical validation server-side" standard) — the attunement toggle must not be a raw boolean flip. Recommend the existing `character_items` route (`PATCH /characters/:id/items/:itemId`) gain an explicit attunement-transition check inside its service function, not just accept `is_attuned` as an arbitrary field:

```sql
-- No new table required for the count itself — derivable:
SELECT COUNT(*) FROM character_items
WHERE character_id = $1 AND is_attuned = true;
-- Enforce: reject a transition to is_attuned=true if this count is already >= 3
-- for that character (or the equivalent monster_instance_id owner).
```

For the **short-rest-gated transition** and the **prerequisite check**, the schema needs more than a boolean if these are to be enforced (not just tracked) server-side:

```sql
ALTER TABLE character_items ADD COLUMN attunement_started_at TIMESTAMPTZ;
-- Set when a short-rest-focused attunement attempt begins; cleared/nulled on
-- completion or interruption. Pairs with this app's existing rest-event
-- flow (PLAN.md's rest_events / rest_event_characters) — attunement
-- completion should be driven by the same short-rest-completion event,
-- not a client-supplied "I finished resting" boolean.
```

**Whether to enforce class/spellcaster prerequisites, or just track the count:** recommend **track the count and item-level `requires_attunement` (already on `items`, `PLAN.md` line 407), but do not hard-block on class/spellcaster prerequisites in v1** — matching this project's own stated posture elsewhere (`feats.prerequisite` is free text, not yet structurally validated, per `PLAN.md` line 709's explicit "deferred, not blocking" precedent). `items` has no structured `attunement_prerequisite_class_id` / `attunement_requires_spellcasting` column today, and adding one is a real, separate data-model change (a new nullable FK to `classes` + a boolean) — flag it as a clean follow-up rather than silently skipping validation with no note: if the calling session wants it enforced, the column needs to exist first, and the check belongs in the same service function as the 3-item-cap check.

**Where it must live**: the `character_items` PATCH service function (equivalent to `setParticipantPosition`'s pattern in `docs/rules/movement.md` §2.4) — count check and (if implemented) prerequisite check must happen **inside the transaction that flips `is_attuned`**, with a row lock on the character's `character_items` set to prevent a race where two concurrent requests each pass a "currently 2 attuned" count check and both succeed, landing at 4.

### 3. Edge cases

- **4th attunement attempt while already at 3**: must reject with a clear reason, not silently no-op or silently un-attune an arbitrary existing item.
- **Un-attuning is not instant** (2014-confirmed): a client toggling `is_attuned: false → true` on a different item in the same request/turn, expecting the freed slot to be usable immediately, is **not** RAW-correct — un-attuning itself costs a short rest. If this app's rest system doesn't gate the transition, a crafted API call could bypass the rest requirement entirely (flip `false` instantly, no rest performed) — this is the sharpest regression risk here.
- **Cursed items block voluntary un-attunement** — the 2014 text names this exception explicitly ("unless the item is cursed"). `items` has no `is_cursed` / "attunement cannot be voluntarily ended" flag today — a real gap if curse mechanics matter to this app.
- **Same-item double attunement** — a creature can't attune to two copies of one item template (e.g. two *ring of protection* rows). Requires checking `item_id` uniqueness among a character's `is_attuned=true` rows, not just the count of 3.
- **Item attuned to one creature, then transferred/looted by another** — attunement should be forcibly ended for the original creature the moment a second creature successfully attunes (2014-confirmed automatic break condition), which implies the "start new attunement" flow must actively clear the previous owner's `is_attuned`/`attunement_started_at`, not leave two `character_items` rows simultaneously marked attuned to the same `item_id` template if it's meant to be a singleton magic item instance vs. a stackable mundane template — worth flagging that `items` is a shared catalog template (per `PLAN.md`'s catalog/instance split), so "this specific magic sword" as a unique attuned instance vs. "a generic +1 sword template" needs the calling session to confirm whether `character_items` rows are meant to represent unique instances (recommended for anything attunement-gated) rather than a stackable `quantity`.
- **Monster instances can attune too** — `character_items.monster_instance_id` exists as an alternative owner (dual-nullable-FK pattern, `PLAN.md` line 566/575); the count-of-3 and same-item-uniqueness checks must run against whichever owner column is populated, not assume `character_id` always.
- **2024 rule differences entirely unknown** — flagging again as its own edge case: shipping 2014's exact mechanics for 2024 campaigns is an unconfirmed extension across the *entire* attunement feature, not just the numeric limit.

### 4. What must be tested

- **3-item cap enforced server-side** (`*.integration.test.ts`): a character with 3 already-attuned items attempts to attune a 4th via a crafted `PATCH` → rejected (`409 CONFLICT` or equivalent), and the DB state shows exactly 3 `is_attuned=true` rows afterward, not 4.
- **Concurrent attunement race**: two near-simultaneous `PATCH` requests each attempting to attune a different 3rd/4th item when the character currently has 2 attuned → exactly one succeeds, proving the row lock closes the race (mirrors `docs/rules/movement.md`'s "Row locking / concurrent-move race" test).
- **Same-item-template double attunement rejected**: character already attuned to `item_id=X` attempts to attune a second `character_items` row referencing the same `item_id=X` → rejected.
- **Un-attunement requires the rest-completion event, not a bare flag flip**: a crafted `PATCH is_attuned:false→...→true` cycle without a corresponding completed short-rest event in `rest_events` must not free/refill a slot instantly — asserts the short-rest gate actually blocks a bypass attempt, not just displays a UI warning.
- **Monster-instance-owned attunement counted separately from character-owned**: a monster instance and a character in the same encounter can each independently hold up to 3 attuned items — proves the cap query is scoped correctly per-owner, not globally or cross-owner.
- **Item without `requires_attunement=true` never consumes a slot**: equipping/using a non-attunement item never flips or requires `is_attuned`, confirming the count query only ever reflects genuinely attunement-gated items.

## DM-configurable, never hardcoded

- Nothing in the confirmed 2014 attunement rule is named as an SRD-optional/variant mechanic (unlike encumbrance's explicit "Variant" heading) — the 3-item cap and short-rest requirement are core rules, not something to expose as a per-campaign toggle, **unless** a calling session specifically wants a homebrew "house-ruled attunement cap" (e.g. some tables raise it) — if so, that would need a new `campaigns.attunement_slot_limit INT NOT NULL DEFAULT 3` column rather than a hardcoded `3` in the query above; not proposing it preemptively since the SRD itself doesn't mark this as a variant, but naming the extension point since the count-check query above hardcodes `3` today.
