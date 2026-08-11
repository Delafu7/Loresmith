# Encounter XP Budgeting

Consulted for: `domain/xpBudget.ts` (pure calculation module — given a party's character levels and a proposed monster list with known `challenge_rating`/`xp_value`, classify encounter difficulty). Edition: **both**, since `campaigns.srd_edition` is per-campaign and the two systems are structurally different, not just re-labeled.

## Source note — read this before trusting the numbers below

**This content is not in `.opencode/skills/dnd5e-srd/`.** I checked: `python3 .opencode/skills/dnd5e-srd/scripts/query.py --categories`, both `references/2014/` and `references/2024/` directories (including `combat.md` and `adventuring.md` in each), and every category the query script exposes for both editions. None of it contains encounter-building/XP-threshold/CR-multiplier data. This is expected, not a bug in the skill: XP-budget-per-encounter guidance is **Dungeon Master's Guide content in both editions**, not Player's-Handbook/SRD-core content, and the skill's own scope note says it's a rules-framework skill, not a stat-block/DM-guidance source.

Because the app needs exact numbers to hardcode, I went to primary sources directly instead of guessing from memory:

- **2014**: Wizards of the Coast's own free **"Dungeon Master's Basic Rules Version 0.2"** PDF (released 2014-10-28, "Building Combat Encounters" section, pp. 55–57). Retrieved via the Wayback Machine's archived copy of the legitimate `media.wizards.com/2014/downloads/dnd/DMBasicRulesv.0.2.pdf` (this exact URL, still resolving as of this session, capture timestamp `20231201043815`). This is WotC's own official free document, distinct from the OGL SRD 5.1 PDF (which is player-facing only and does not contain this chapter) — cited here as `DM Basic Rules v0.2 §Building Combat Encounters`, not as "SRD 5.1 §", since it is not part of the SRD legal text. **Do not cite this in code comments as "SRD 5.1"** — say "D&D 5e (2014) DMG — Building Combat Encounters" or similar, to avoid misattributing the license/source.
- **2024**: D&D Beyond's official **"Basic Rules (2024)" → "DM's Toolbox"** page (`dndbeyond.com/sources/dnd/br-2024/dms-toolbox`, live-fetched this session), which reproduces the 2024 *Dungeon Master's Guide*'s "Combat Encounter Difficulty" section verbatim as WotC's free rules content. Same caveat: this is DMG content republished for free by WotC, not part of the CC-BY SRD 5.2 legal text — cite as `D&D 5e (2024) DMG — Combat Encounter Difficulty`, not "SRD 5.2 §".

Both were fetched and read directly in this session (not recalled from training data), so the numbers below are transcribed from the primary source text, not guessed. Flagging this sourcing explicitly per this project's "never invent a rule" standard, since the numeric tables are exactly the kind of thing a training-data guess could get subtly wrong.

---

## 1. 2014 system (DMG "Building Combat Encounters")

### Official rule

**Terminology**: four difficulty tiers — **Easy, Medium, Hard, Deadly**.

**XP Thresholds by Character Level** (per-character, by level 1–20; exact transcription):

| Level | Easy | Medium | Hard | Deadly |
|---|---|---|---|---|
| 1 | 25 | 50 | 75 | 100 |
| 2 | 50 | 100 | 150 | 200 |
| 3 | 75 | 150 | 225 | 400 |
| 4 | 125 | 250 | 375 | 500 |
| 5 | 250 | 500 | 750 | 1,100 |
| 6 | 300 | 600 | 900 | 1,400 |
| 7 | 350 | 750 | 1,100 | 1,700 |
| 8 | 450 | 900 | 1,400 | 2,100 |
| 9 | 550 | 1,100 | 1,600 | 2,400 |
| 10 | 600 | 1,200 | 1,900 | 2,800 |
| 11 | 800 | 1,600 | 2,400 | 3,600 |
| 12 | 1,000 | 2,000 | 3,000 | 4,500 |
| 13 | 1,100 | 2,200 | 3,400 | 5,100 |
| 14 | 1,250 | 2,500 | 3,800 | 5,700 |
| 15 | 1,400 | 2,800 | 4,300 | 6,400 |
| 16 | 1,600 | 3,200 | 4,800 | 7,200 |
| 17 | 2,000 | 3,900 | 5,900 | 8,800 |
| 18 | 2,100 | 4,200 | 6,300 | 9,500 |
| 19 | 2,400 | 4,900 | 7,300 | 10,900 |
| 20 | 2,800 | 5,700 | 8,500 | 12,700 |

**Procedure** (5 steps, verbatim structure):

1. **Per-character thresholds** — look up each party member's level in the table above (4 numbers per character).
2. **Party's XP threshold** — for each of the 4 difficulty categories, **sum** that category's threshold across every character in the party. Result: 4 totals (Easy/Medium/Hard/Deadly) for the whole party. Worked example from the source (party of three 3rd-level + one 2nd-level): Easy 275, Medium 550, Hard 825, Deadly 1,400.
3. **Total monster XP** — sum `xp_value` across every monster in the proposed encounter (raw, unmultiplied).
4. **Encounter Multiplier** — if there's more than one monster, multiply step 3's raw total by a multiplier keyed to monster **count**:

   | # Monsters | Multiplier | # Monsters | Multiplier |
   |---|---|---|---|
   | 1 | ×1 | 7–10 | ×2.5 |
   | 2 | ×1.5 | 11–14 | ×3 |
   | 3–6 | ×2 | 15+ | ×4 |

   **Party-size adjustment to the multiplier** (not to the monster count itself — the source is explicit the *count* used for the multiplier lookup shifts up/down a column): the table above assumes a 3–5 character party.
   - Party of **< 3** characters: use the **next-highest** multiplier column (e.g., a single monster becomes ×1.5; 15+ monsters becomes ×5, a value that exists only via this shift, since 15+ monsters is already the table's rightmost column at ×4 — the source explicitly gives ×5 for 15+ monsters with a sub-3 party as the extension).
   - Party of **≥ 6** characters: use the **next-lowest** multiplier column (e.g., a single monster becomes ×0.5).
   - Party of 3–5: use the table as printed, no shift.

   Source note on when *not* to count a monster toward step 3/4 at all: "don't count any monsters whose challenge rating is significantly below the average CR of the other monsters in the group, unless you think the weak monsters significantly contribute to the difficulty" — a DM judgment call, not a hard numeric rule (see DM-configurable section below).
5. **Compare** — the adjusted (multiplied) monster XP is compared against the party's 4 thresholds from step 2. The **closest threshold that is ≤ the adjusted XP** determines the encounter's difficulty tier. (If adjusted XP is below the party's Easy threshold, the encounter is trivially easy — the source doesn't give it a 5th "Trivial" label, it's just "below Easy.")

Also present in the source (out of scope for this specific `xpBudget.ts` ask, but worth noting since they use the same inputs): an **Adventuring Day XP** table (per-character XP budget for a full day, levels 1–20, e.g. level 1 = 300, level 20 = 40,000) for "how many encounters can the party handle before a long rest," and a `±1 step` difficulty adjustment for situational party/enemy advantages (surprise, cover, environmental damage, mobility-hindering terrain) — this second one is explicitly DM judgment, not computable from monster/party data alone.

### Data model translation

- Party-level input: `characters.level` (existing column, `CREATE TABLE characters ... level INT NOT NULL CHECK (level BETWEEN 1 AND 20)` per `PLAN.md` §3.2) for each party member the DM includes in the calculation — `domain/xpBudget.ts` takes `levels: number[]`, not a DB dependency, matching the "pure calculation module" ask.
- Monster input: `monsters.challenge_rating` / `monsters.xp_value` (existing columns, `packages/server/src/db/migrations/1784269736666_create-catalog-monsters.ts`) or the planned `cr_xp_table.xp_value` (`PLAN.md` §3.2/§3.5) if a monster's `xp_value` needs deriving from `challenge_rating` alone (e.g. homebrew CR without a hand-set XP) — `xpBudget.ts` should accept `{ challengeRating, xpValue, quantity }[]` and treat `xpValue` as already-resolved, leaving CR→XP lookup to the caller (`services/`), keeping the domain module free of DB access per the existing `domain/hpBanding.ts` precedent (pure, no imports from `db/`).
- The XP-threshold-by-level table (20 rows × 4 tiers = 80 numbers) and the encounter-multiplier table (6 rows) are **static constants** in `domain/xpBudget.ts` itself, not DB rows — they're rules constants (edition-versioned), not campaign or catalog data that's ever filtered/sorted/joined in a query. This differs from `cr_xp_table`, which *is* a DB table because CR→XP is looked up per-monster in query paths (monster search/filter); the difficulty-threshold table is only ever consumed by this one pure function.
- Output shape: `{ tier: 'easy'|'medium'|'hard'|'deadly'|'trivial', partyThresholds: {easy,medium,hard,deadly}, adjustedMonsterXp, rawMonsterXp, multiplier }` — return the intermediate numbers, not just the final tier, since the DM-facing UI (`EncountersPage`/`AddToEncounterOverlay`, per existing conventions in `docs/rules/monster-spawning.md`) will want to show the math, not just a verdict.
- **No server-side validation implications** — unlike movement/attack-legality rules elsewhere in this app, XP budgeting is advisory-only (it never blocks an action, changes stored state, or is something a malicious client could "bypass" to gain an advantage — the DM can build any encounter regardless of its computed difficulty). So this is the one rules module in the project's growing `docs/rules/` set that does **not** need "server-side enforcement" in the movement/attack-economy sense; it only needs to be *correct* wherever it's called (see "What must be tested" below) and consistently computed server-side if a value derived from it (e.g., an `encounter_templates.target_difficulty`) is ever persisted, so two clients don't compute diverging labels for the same encounter.

### Edge cases

- **Mixed-level party**: the 2014 procedure handles this natively — sum each character's own per-level threshold (already reflected in the worked example: 3×3rd-level + 1×2nd-level). No special-casing needed in code beyond summing over the actual `levels: number[]` array.
- **Empty party** (`levels.length === 0`): thresholds sum to 0 for all four tiers, so any nonzero monster XP reads as "above Deadly." Decide explicitly whether `xpBudget.ts` should throw/return an error state for an empty party rather than silently producing a degenerate result — recommend throwing, since "0 characters" is never a real encounter.
- **Empty monster list** (`monsters.length === 0`): raw and adjusted XP are both 0, which is `< ` every nonzero Easy threshold — should resolve to "trivial"/"no encounter," not error (a DM might call this while the encounter is still being built up).
- **Monster count boundary values**: the multiplier table's boundaries (1, 2, 3–6, 7–10, 11–14, 15+) must be tested at every edge (2 vs 3, 6 vs 7, 10 vs 11, 14 vs 15) — off-by-one on any of these silently misclassifies difficulty.
- **Monster count = 0 but `quantity` fields present**: if the caller passes `{quantity: 0}` entries (e.g., a UI row for a monster the DM hasn't set a count for yet), those must not count toward the multiplier-table monster count or the raw XP sum — filter zero-quantity entries before counting, don't let them silently shift the multiplier bracket.
- **Party-size adjustment interacts with the *monster-count* column, not the *raw multiplier value*** — a common implementation bug is to take the base multiplier (e.g. ×2 for 3–6 monsters) and add/subtract a flat amount for small/large parties. The source rule is explicit that it's a column *shift on the monster-count axis*, which is why a party of <3 facing a *single* monster becomes ×1.5 (the "2 monsters" column), not some interpolated value between ×1 and ×2.
- **"Don't count weak monsters" step-3 exception** is explicitly a DM judgment call in the source text ("unless you think the weak monsters significantly contribute") — this is not implementable as a hard rule (see DM-configurable section); `xpBudget.ts` should not attempt to auto-exclude low-CR monsters from the sum. If the DM wants that, it's a UI-level "exclude this monster from budget calc" toggle per monster row, not baked into the pure function's math.
- **Below-Easy and above-Deadly results**: the source's 5-step procedure only names 4 tiers; an adjusted XP below the Easy threshold or above the Deadly threshold needs an explicit sentinel (`'trivial'` below Easy — a label the source doesn't officially use but is the natural complement; there is no "above Deadly" tier name in the source at all, so `'deadly'` should be the ceiling label for anything ≥ the Deadly threshold, not an invented "extreme"/"TPK" tier).

### What must be tested

- `packages/server/src/domain/xpBudget.test.ts` (or wherever this repo's convention places pure-function unit tests, matching `hpBanding.test.ts`'s sibling-file pattern):
  - Exact per-level threshold lookups at levels 1, 20, and a few interior levels against the transcribed table (catches transcription typos directly).
  - Party threshold summation for a mixed-level party matches the worked example in the source (3×L3 + 1×L2 → Easy 275/Medium 550/Hard 825/Deadly 1,400).
  - Multiplier table boundaries: exactly 1, 2, 3, 6, 7, 10, 11, 14, 15, and 16 monsters, each against the documented multiplier.
  - Party-size adjustment: a 2-character party fighting a single monster resolves to ×1.5 (not ×1); a 6-character party fighting a single monster resolves to ×0.5 (not ×1); a party of exactly 3 or exactly 5 uses the unshifted table.
  - Worked example from the source: 1 bugbear + 3 hobgoblins (raw sum → adjusted ×2 → 1,000 XP) against the 3×L3+1×L2 party resolves to `'hard'` (825 ≤ 1,000 < 1,400).
  - Zero-quantity monster rows are excluded from both the XP sum and the multiplier-lookup count.
  - Empty monster list → `'trivial'`; empty party → throws/explicit error (pick one and test it, per the edge case above).

---

## 2. 2024 system (DMG "Combat Encounter Difficulty")

### Official rule

**Terminology**: three difficulty tiers — **Low, Moderate, High** (confirmed exact wording; this is a real change from 2014's four-tier Easy/Medium/Hard/Deadly, not a renaming of the same four).

**XP Budget per Character** (exact transcription from the source's table):

| Party Level | Low | Moderate | High |
|---|---|---|---|
| 1 | 50 | 75 | 100 |
| 2 | 100 | 150 | 200 |
| 3 | 150 | 225 | 400 |
| 4 | 250 | 375 | 500 |
| 5 | 500 | 750 | 1,100 |
| 6 | 600 | 1,000 | 1,400 |
| 7 | 750 | 1,300 | 1,700 |
| 8 | 1,000 | 1,700 | 2,100 |
| 9 | 1,300 | 2,000 | 2,600 |
| 10 | 1,600 | 2,300 | 3,100 |
| 11 | 1,900 | 2,900 | 4,100 |
| 12 | 2,200 | 3,700 | 4,700 |
| 13 | 2,600 | 4,200 | 5,400 |
| 14 | 2,900 | 4,900 | 6,200 |
| 15 | 3,300 | 5,400 | 7,800 |
| 16 | 3,800 | 6,100 | 9,800 |
| 17 | 4,500 | 7,200 | 11,700 |
| 18 | 5,000 | 8,700 | 14,200 |
| 19 | 5,500 | 10,700 | 17,200 |
| 20 | 6,400 | 13,200 | 22,000 |

Note levels 1–4 are **identical numbers** to the 2014 table's Easy/Medium/Hard columns (25/50/75/100 → 2024 shows 50/75/100 at level 1, i.e. shifted — 2014 Easy@L1=25 ≠ 2024 Low@L1=50; they are **not** the same numbers, don't assume a shared table with relabeled headers). Levels 5+ diverge more visibly (e.g. 2014 L10 Hard=1,900 vs 2024 L10 Moderate=2,300).

**Procedure** (3 steps, verbatim structure — materially simpler than 2014's 5 steps):

1. **Choose a difficulty** (Low/Moderate/High) — same DM judgment-call framing as 2014's tier descriptions, reworded (Low: "one or two scary moments, no casualties expected"; Moderate: "could go badly... slim chance of death"; High: "could be lethal... needs smart tactics").
2. **Determine XP budget**: cross-reference **the party's level** (singular — see edge cases) against the chosen difficulty in the table above, then **multiply by the number of characters in the party**. This produces one flat number (the whole-party XP budget), not four totals like 2014's per-tier party thresholds.
3. **Spend the budget**: sum monster `xp_value`s, subtracting from the budget as you add monsters. **No multiplier of any kind is applied to the monster-XP sum for the purposes of the budget itself** — confirmed by direct text search of the full source page: the string "multiplier" does not appear anywhere in the 2024 DM's Toolbox encounter-building section. The monster-count concern from 2014 (more monsters = more attack rolls = harder than raw XP suggests) survives only as **prose guidance**, not a computed adjustment: "If your encounter includes more than two creatures per character, include fragile creatures that can be defeated quickly" (a "Troubleshooting" note, non-numeric, DM-judgment).

**Additional troubleshooting notes** from the source (all non-numeric DM guidance, not computable rules): adjust encounters on the fly for absent players; CR-0 creatures should be used sparingly / prefer swarms; avoid referencing more than 2–3 distinct stat blocks per encounter; a monster with CR above party level can one-shot a low-level character even if XP-budget-legal (explicit ogre/level-1-wizard example, same example as 2014's source); avoid monsters whose features a lower-level party "can't easily overcome."

### Data model translation

- Same `characters.level` / `monsters.challenge_rating`/`xp_value` inputs as the 2014 path.
- **Structural difference the function signature must reflect**: 2024's step 2 keys off "the party's level" (singular) rather than summing per-character thresholds. The source text does not define what "the party's level" means for a **mixed-level party** (see edge cases) — so `xpBudget.ts`'s 2024 branch cannot literally be "look up one row and multiply," it must make an explicit, documented choice for non-uniform parties, since the official text is silent here.
- 2024's XP-budget table (20 rows × 3 tiers = 60 numbers) is a second static-constant table in the same `domain/xpBudget.ts`, edition-gated the same way `characters`/`spells`/etc. are gated elsewhere in this app (an `edition: '2014' | '2024'` parameter selecting which table/algorithm branch runs — matching the existing pattern referenced in `packages/server/src/db/migrations/1784269803666_create-weapon-mastery-properties.ts`'s comment about "the AttackRoller/InventoryPanel's srd_edition gate").
- Output shape for the 2024 branch: `{ tier: 'low'|'moderate'|'high'|'trivial', xpBudget, monsterXpTotal }` — no `multiplier`/`adjustedMonsterXp` fields, since they don't exist in this system; **don't reuse the exact same result type for both editions** with multiplier fields nulled out for 2024, since that would misrepresent "doesn't exist" as "exists but is 1" to any caller not reading the edition tag closely. Prefer a discriminated union (`{edition: '2014', ...fourTierFields} | {edition: '2024', ...threeTierFields}`) over one loose shape with edition-conditional optional fields.
- If `encounter_templates.target_difficulty` (currently only in `PLAN.md`, not yet migrated — confirmed via `ls packages/server/src/db/migrations/` for `*encounter_template*`, no match) is ever actually built, its `CHECK (target_difficulty IN ('easy','medium','hard','deadly'))` constraint from the plan doc is **2014-only vocabulary** and would reject `'low'`/`'moderate'`/`'high'` for a 2024 campaign — flagging this now since it's a live foot-gun in the current plan text, not yet a shipped bug. When that table is built, `target_difficulty` needs either edition-conditional allowed values (a trigger/app-layer check per this project's existing "edition compatibility is app-layer, not declarative" precedent, `PLAN.md` §3.3 item 4) or a single edition-agnostic ordinal (e.g. `difficulty_rank INT` 1–3/1–4) with edition-specific label mapping done in the app layer, not the DB CHECK.

### Edge cases

- **Mixed-level party — genuinely unresolved by the official text.** The source's worked examples are all single-level parties ("four level 1 characters," "five level 3 characters," "six level 15 characters"). There is no stated procedure for a party of, say, levels 3/3/4/5. Options, none of which the SRD/DMG text picks for you:
  - (a) Sum each character's own per-level row across all three tiers (mirrors 2014's method, arguably the most defensible extrapolation since the *underlying* per-character XP values are additive by construction — the "×party size" step is just "same value repeated," so summing distinct per-character values is a natural generalization).
  - (b) Use the party's average level (rounds/truncates somehow) × party size.
  - (c) Use the party's highest level (conservative — treats the whole party as capable of the strongest member).
  Recommend **(a)** for consistency with the 2014 branch's logic and because it degenerates correctly to the documented single-level-party procedure when all levels are equal, but this must be flagged to whoever signs off on `xpBudget.ts` as **an interpretive choice this app is making, not an official rule** — put that caveat directly in the code comment, not just this doc, since it's the one place in this whole ask where "don't invent a rule" is unavoidably in tension with "the function must return something for every valid input."
- **No monster-count multiplier means large monster-count encounters can look budget-legal while being tactically much harder** — this is *by design* in 2024 (the multiplier was deliberately dropped), not a gap to patch around in `xpBudget.ts`. Do not add a 2014-style multiplier to the 2024 branch "to be safe" — that would silently reintroduce a mechanic WotC removed, contradicting the edition split this app exists to preserve. The ">2 creatures per character" guidance is advisory-only (see below).
- **">2 creatures per character" troubleshooting note is not a numeric threshold to gate on** — it's prose guidance ("include fragile creatures"), not a difficulty-tier modifier. If the UI wants to surface it, it should be a separate boolean/warning flag (`monsterCount > partySize * 2`) alongside the tier result, not folded into the tier computation itself.
- **CR-0 / zero-XP monsters**: the 2024 source explicitly calls these out ("should be used sparingly... use swarms instead") but gives no numeric rule — a CR-0 monster with `xp_value = 0` simply contributes 0 to the budget sum, which is correct arithmetic; no special-casing needed in `xpBudget.ts` itself.
- **Empty party / empty monster list**: same as the 2014 branch — recommend throwing on empty `levels`, and resolving to `'trivial'` (or `'low'` undershoot, matching whichever sentinel the 2014 branch uses) for an empty monster list.
- **Boundary comparison direction**: 2024's "spend budget" framing ("deduct XP... it's OK to have a few unspent XP left over... spend as much as you can without going over") implies the tier is determined the same way as 2014 — closest threshold ≤ actual monster XP — even though the 2024 text frames it as "building toward a budget" rather than "classifying an already-built encounter." For `xpBudget.ts`'s classification direction (given a monster list, what tier is this), the comparison logic is the same shape as 2014's step 5: compare `monsterXpTotal` against the Low/Moderate/High budget numbers, take the highest tier whose budget is ≤ the total.

### What must be tested

- Exact per-level/per-tier lookups at levels 1, 20, and interior levels against the transcribed table (again, catches transcription typos — this table is easy to typo against the visually-similar 2014 one, e.g. level 3 Hard=225 (2014) vs level 3 Moderate=225 (2024) are coincidentally identical, a good targeted regression test for "did the code accidentally read the wrong table's column").
- Single-level-party worked examples from the source, verified exactly:
  - 4× level-1 characters, Low difficulty → budget 200 XP (50×4).
  - 5× level-3 characters, Moderate difficulty → budget 1,125 XP (225×5).
  - 6× level-15 characters, High difficulty → budget 46,800 XP (7,800×6).
- Confirm **no multiplier is applied**: an encounter with 15 low-XP monsters totaling exactly a party's budget resolves identically (by total XP) to 1 monster of the same total XP value — i.e., assert the 2024 branch's result is a pure function of `sum(xpValue * quantity)` regardless of monster count, as a regression guard against ever reintroducing a 2014-style multiplier into this branch by mistake.
- Mixed-level party: whichever interpretation choice is implemented (recommend (a) above) gets an explicit test asserting that choice's exact output for a documented mixed-level input, plus a test that a mixed-level party where all levels happen to be equal produces the *same* result as the single-level worked examples above (degeneration check).
- Edition dispatch: the same `{levels, monsters}` input run through `edition: '2014'` vs `edition: '2024'` produces the correctly-shaped discriminated-union result for each (four-tier vs three-tier), and a wrong/missing `edition` value is rejected rather than silently defaulting to one edition's math.

---

## DM-configurable, never hardcoded

- **2014's "ignore significantly-weaker monsters in the XP sum" exception** (step 3) is explicit DM judgment in the source text, not a formula. `xpBudget.ts` should not attempt to auto-detect and exclude low-CR monsters; if a DM wants a monster excluded from the budget calculation, that's a per-monster "exclude from calc" toggle in the encounter-building UI, not app logic.
- **2014's ±1-step situational difficulty adjustment** (surprise, cover, environmental hazards, mobility-hindering terrain, and their inverses) is entirely DM narrative judgment with no monster/party data to compute it from — out of scope for `xpBudget.ts` by the source's own design, not an oversight.
- **2024's "more than two creatures per character" and "CR above party level" troubleshooting notes** are advisory prose, not numeric modifiers — if surfaced in the UI at all, they should be presented as separate warning badges alongside the computed tier, never blended into the tier math itself.
- **Neither edition's target-difficulty choice is itself DM-configurable in a settings sense** — "Low/Moderate/High" or "Easy/Medium/Hard/Deadly" is chosen per-encounter by the DM as an input to the calculation (`target_difficulty` on a draft `encounter_templates` row, per `PLAN.md` §3.2/§3.5), not a campaign-wide default. No new `campaigns` settings JSONB key is needed for this feature specifically — the existing `campaigns.srd_edition` column is the only campaign-level toggle this module reads, exactly as it already does for every other edition-gated rule in this app (`AttackRoller`/`InventoryPanel`'s existing `srd_edition` gate, weapon-mastery-properties migration comment).
