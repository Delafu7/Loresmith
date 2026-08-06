# Monster Spawning: HP-on-Spawn and Group Initiative

Consulted for: `services/spawn.ts`'s batched "spawn N monster instances into a live encounter" endpoint (Iteration 2, "Fast add/spawn UX"). Edition: both requested — coverage is asymmetric, see each section.

## 1. HP on spawn

### Official rule

Neither `references/2014/` nor `references/2024/` in this app's `dnd5e-srd` skill states "monster stat blocks use their average HP by default" — that convention lives in the Monster Manual's stat-block format, which this skill deliberately excludes as catalog content (per `.opencode/skills/dnd5e-srd/`'s own scope note: it's a rules framework, not a stat-block source). The skill's hit-point text (`references/2014/character-creation.md` §5, `references/2024/character-creation.md` lines 90–119) only covers **player characters** rolling-or-taking-average at level-up — a different mechanic (the *player's* choice at level-up), not a DM's choice when spawning a monster instance mid-session.

This app's own catalog already encodes both numbers per creature (`monsters.hit_point_average INT`, `monsters.hit_dice TEXT`, e.g. `"2d8+2"`), which is the standard Monster Manual convention this skill doesn't restate. There is no rules basis to prefer one over the other — it's a DM-facing convenience choice, not a legality question.

### Data model translation

`services/spawn.ts` offers three strategies, all DM-selectable per spawn (`schemas/encounters.ts`'s `hpStrategyEnum`):
- `'average'` (default, matches every existing HP-on-spawn code path in this app — `MonstersPage.tsx`'s importer and single-spawn button both already send `hit_point_average` verbatim): every instance gets `monsters.hit_point_average`.
- `'rolled'`: each instance independently rolls `monsters.hit_dice` via `services/diceRolls.ts`'s new `rollHitDice()` (parses `"NdM+K"`, rolls N dice of M sides server-side, adds K, floors at 1 — a spawned instance can never resolve to 0 HP).
- `'same'`: `hit_dice` is rolled once for the whole batch and that single result is reused for every instance in it — distinct from `'rolled'` (independent per instance) and from `'average'` (no RNG at all).

All rolling happens server-side (`rollDie`/`rollHitDice`), never client-supplied, matching this app's existing "RNG lives in `diceRolls.ts` and only there" invariant (see that file's own header comment).

### Edge cases

- A creature's rolled HP is floored at 1 — a hit-dice roll with a large negative modifier could otherwise resolve to ≤0 for a freshly-spawned, undamaged instance, which isn't a real state (0 HP means dead/dying, not "just spawned").
- `monster.hit_dice` is free text on the catalog row (author-entered when creating homebrew) — a malformed value (e.g. missing the `NdM` pattern) throws a clear `VALIDATION_ERROR` from `parseHitDice` rather than silently defaulting, since this is the app's own data, not untrusted player input.
- `is_unique` monsters are restricted to `quantity=1` by `services/spawn.ts` regardless of `hpStrategy` — the existing system-wide "one living instance" invariant (`createMonsterInstance`) is unaffected by which HP strategy is chosen.

### What must be tested

- `'average'`: N spawned instances all have identical `hp_current === monster.hit_point_average`.
- `'rolled'`: N spawned instances' `hp_current` values are drawn independently (not asserting exact values, since it's random — assert the parse/roll math via a unit test on `parseHitDice`/`rollHitDice` directly, and assert in the integration test that the batch's HP values are computed from `hit_dice`, not `hit_point_average`).
- `'same'`: every instance in one spawn batch shares the exact same `hp_current`, and that value is consistent with a single `hit_dice` roll (not the catalog average).

## 2. Group initiative

### Official rule

**Confirmed, identical in both editions, and core procedure — not a DMG-only variant.** SRD 5.1 `references/2014/combat.md`'s "Initiative" section and SRD 5.2 `references/2024/combat.md`'s "Roll Initiative" section both state: when a group of identical creatures/monsters acts together, the GM rolls initiative **once** for the whole group, and every creature in it acts on that shared count. This sits in the base rules text (not under a "Variant:" heading), unlike the neighboring optional individual-tiebreak-reroll rule in the 2014 text, which the skill's own reference explicitly marks optional by contrast.

### Data model translation

`schemas/encounters.ts`'s `spawnParticipantsSchema.groupInitiative` defaults to `true`. When true, `services/spawn.ts` rolls one `d20 + dexModifier(monster.dex)` (reusing `services/encounters.ts`'s existing `dexModifier` helper) and writes that same `initiative_roll`/`initiative_tiebreak` pair to every `combat_participants` row created in the batch. When false (DM override, for a group of nominally-identical creatures the table wants to track individually), each instance rolls independently, matching `rollAndReorderInitiative`'s existing per-participant convention. Either way, `services/encounters.ts`'s newly-exported `reorderTurnOrderByInitiative` re-sequences `turn_order` for the whole encounter afterward (only when the encounter is actively in combat — see that function's own comment), so the batch interleaves correctly with any participants already seated rather than always landing at the tail.

### Edge cases

- A shared group roll only makes sense for genuinely identical creatures — this app doesn't attempt to detect "is this monster template actually identical to another currently-selected group," it's simply "every instance created by *this one spawn call* shares one roll," which matches the SRD's framing (one call = one summoned group) without needing a broader same-template-across-calls merge.
- Mixing `groupInitiative: false` doesn't change HP-strategy behavior — the two settings are independent axes (an example test worth calling out explicitly, since it's easy to conflate "shared HP" with "shared initiative").

### What must be tested

- `groupInitiative: true`: every participant in the batch has the exact same `initiative_roll`/`initiative_tiebreak`.
- `groupInitiative: false`: participants' `initiative_roll` values vary (not all identical) across a batch of quantity ≥ 3 (small enough quantities could coincidentally tie on a d20 roll, so assert independence via the roll inputs/mocked RNG in a unit test rather than asserting inequality on live random rolls in the integration test).

## DM-configurable, never hardcoded

Both `hpStrategy` and `groupInitiative` are per-spawn-call DM choices, not campaign-wide settings — the SRD's own "or" phrasing for HP-on-spawn (no rule at all, purely a house convention) and its "group rolls once" default treat these as decisions made fresh at the table each time creatures are added, so a persistent per-campaign default would misrepresent the rule as more rigid than it is. The frontend may *remember* the DM's last choice locally (a UX convenience, `AddToEncounterOverlay.tsx`) without that becoming a server-enforced default.
