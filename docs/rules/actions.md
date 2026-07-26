# Actions

## Climb, Swim, Search, Disengage, Ready — five actions requested for `REFACTOR-PLAN.md` §5, plus Object Interaction

Consulted for: `REFACTOR-PLAN.md` §5 "Action economy" (extending `ACTION_REGISTRY` in `packages/web/src/encounters/actionEconomy.ts` with climb, swim, search, disengage, ready; object interaction as a fourth tracked resource; DM undo). Edition: **both** — this app is dual-edition (`campaigns.srd_edition` = `'2014'` or `'2024'`); differences are called out explicitly below, not assumed away.

Grounded against: `.opencode/skills/dnd5e-srd/references/2014/combat.md`, `.../2014/ability-checks.md`, `.../2024/combat.md`, `.../2024/ability-checks.md`, `.../2024/adventuring.md`. Cross-referenced against `docs/rules/movement.md` §1.4 (alternate speeds) and §1.6 (crawling/prone) for Climb/Swim rather than re-deriving those findings.

### 1. Official rule

#### 1.1 Climb — not a distinct action in either edition

**2014**, `combat.md` line 74 (Movement and Position): "Your movement can include jumping, climbing, and swimming. These different modes of movement can be combined with walking, or they can constitute your entire move." **2024**, `combat.md` lines 28–30: "You can move up to your Speed..., including climbing, crawling, jumping, and swimming, combined however you like, until the Speed is used up." Neither edition's "Actions in Combat" list (2014 `combat.md` lines 175–233) or "Actions" summary table (2024 `ability-checks.md` lines 130–145) contains a "Climb" entry. Climbing is explicitly a **mode of movement**, not an action that consumes the action/bonus-action/reaction economy.

Cost mechanic (already established in `docs/rules/movement.md` §1.4, cross-referenced not re-derived): 2014 `adventuring.md` lines 62–64 — "While climbing or swimming, each foot of movement costs 1 extra foot (2 extra feet in difficult terrain), unless a creature has a climbing or swimming speed." 2024's grounding text is silent on the without-the-matching-speed multiplier (confirmed gap, see `movement.md` §1.4). Both editions note, as **GM's option** (2014 `adventuring.md`, explicitly named optional text) rather than a hard rule, that climbing a slippery/vertical surface may require a Strength (Athletics) check.

**Verdict: Climb is not an SRD action.** A "Climb" button that consumes an action-economy slot would be inventing a mechanic neither edition has. It is movement into a climbable cell, at the cost-per-foot `movement.md` already establishes.

#### 1.2 Swim — not a distinct action in either edition

Same textual basis as 1.1 — both editions list swimming alongside climbing/jumping/crawling as a *mode of movement combined into your move*, not a named action in either edition's action list. Cost mechanic is the same 2014 `adventuring.md` citation above (double cost without a swim speed, silent in 2024's grounding text per `movement.md` §1.4).

**Verdict: Swim is not an SRD action**, for the same reason as Climb.

#### 1.3 Search — action, roll is GM/edition-dependent

**2014**, `combat.md` lines 227–229: "When you take the Search action, you devote your attention to finding something. Depending on the nature of your search, the GM might have you make a Wisdom (Perception) check or an Intelligence (Investigation) check." Costs the **action** slot. Roll is explicitly GM-adjudicated per the nature of the search — the SRD does not fix one skill; it names exactly two candidates (Perception or Investigation), selected situationally by the GM.

**2024**, `ability-checks.md` line 143 (Actions summary table): "Search — Wisdom (Insight, Medicine, Perception, or Survival) check." Costs the **action** slot (it's in the same "Actions (main options on your turn)" table as Attack/Dash/Dodge, all confirmed action-slot options). **2024 both broadens and re-anchors the skill list**: all four candidate skills share the Wisdom ability (Insight, Medicine, Perception, Survival), dropping Investigation (an Intelligence skill) from Search entirely — 2024 instead gives Investigation its own dedicated action, **Study** (`ability-checks.md` line 144: "Study — Intelligence (Arcana, History, Investigation, Nature, or Religion) check"), which has no 2014 equivalent as a named action.

**Confirmed edition difference:** 2014 Search → Perception *or* Investigation (GM's choice, one action, one roll, two possible skills spanning two abilities). 2024 Search → one of four *Wisdom*-only skills (GM's choice among Insight/Medicine/Perception/Survival); Investigation moves to a separate 2024-only action (Study) not requested by this task but worth naming so it isn't confused with Search.

#### 1.4 Disengage — avoiding opportunity attacks, action slot, rest-of-turn duration

**2014**, `combat.md` lines 199–201: "If you take the Disengage action, your movement doesn't provoke opportunity attacks for the rest of the turn." Confirmed elsewhere in the same file (line 308, Opportunity Attacks section): "You can avoid provoking an opportunity attack by taking the Disengage action."

**2024**, `ability-checks.md` line 136 (Actions table): "Disengage — Your movement doesn't provoke Opportunity Attacks this turn." `combat.md` line 102 (Opportunity Attacks section) lists Disengaging as one of the ways a creature avoids triggering an opportunity attack when leaving another creature's reach.

**Verdict: identical mechanic and duration in both editions.** Costs the **action** slot. No roll. Duration is the remainder of the *current* turn only — it does not carry the protection into the creature's next turn or apply retroactively to movement already taken before the action was used earlier in the same turn (the movement affected is whatever happens after Disengage is taken, for the rest of that turn).

#### 1.5 Ready — action slot to prepare, reaction slot to execute; interaction and unused-readied-action fate

**2014**, `combat.md` lines 217–225, the fullest description of the mechanic in either edition's grounding text: "you can take the Ready action on your turn, which lets you act using your reaction before the start of your next turn. First, you decide what perceivable circumstance will trigger your reaction. Then, you choose the action you will take in response to that trigger, or you choose to move up to your speed in response to it... When the trigger occurs, you can either take your reaction right after the trigger finishes or ignore the trigger. Remember that you can take only one reaction per round." Readying a spell requires the spell to have a 1-action casting time and requires concentration to hold; if concentration breaks before the trigger fires, the spell "dissipates without taking effect" (i.e., is lost, not merely delayed).

**2024**, `ability-checks.md` line 142 (Actions table): "Ready — Prepare to act in response to a trigger you define." No dedicated prose subsection exists in this app's 2024 grounding set beyond that one summary-table line — checked `combat.md` in full and grepped `ready`/`trigger` across every 2024 reference file; nothing further. **The trigger-definition/execute-via-reaction mechanic and the "ignore the trigger, lose the readied action" consequence are not restated in 2024's grounding text**, but nothing there contradicts 2014's fuller description either.

**Verdict:**
- **Costs the action slot** to ready (both editions, confirmed).
- **Executing the readied response costs the reaction slot** (2014 explicit: "act using your reaction"; 2024's one-line summary doesn't spell out which slot fires the response, but "Reactions: instant response to a trigger... only one before the start of your next turn" from the same table's footer, `ability-checks.md` line 148, is consistent with Ready's response being an ordinary reaction — inferred by consistency with 2014's explicit text and 2024's own reaction-slot framing, not a direct 2024 citation for this specific point, flagged as such).
- **Interaction with the reaction slot**: readying does not itself consume the reaction — it consumes the action to *set up* the trigger. The reaction slot is only spent when (and if) the trigger actually fires and the readied response is executed. A readied action therefore still competes with any other reaction the creature might need that round (e.g. an opportunity attack) — only one reaction is available regardless of source (2014 explicit: "you can take only one reaction per round"; 2024 explicit, same table footer: "only one before the start of your next turn").
- **Unused readied action**: if the trigger never occurs, or occurs and the creature chooses to ignore it (2014, explicit: "you can either take your reaction right after the trigger finishes or ignore the trigger"), the readied action/reaction is simply lost at the start of the creature's next turn — no roll-over, no banking. A readied **spell** has an extra failure mode beyond simply expiring: if concentration is broken before the trigger fires, the spell is lost immediately (not just at end of turn) and its slot is expended for no effect (2014, explicit). 2024's grounding text does not restate the spell-specific concentration/loss detail — flagged as 2014-confirmed, 2024-silent (not contradicted).

#### 1.6 Object interaction — one free interaction per turn

**2014**, `combat.md` lines 53–57: "You can also interact with one object or feature of the environment for free, during either your move or your action. For example, you could open a door during your move as you stride toward a foe, or you could draw your weapon as part of the same action you use to attack. If you want to interact with a second object, you need to use your action. Some magic items and other special objects always require an action to use, as stated in their descriptions." Line 231–233 names the fallback action explicitly: "**Use an Object** — ... When an object requires your action for its use, you take the Use an Object action. This action is also useful when you want to interact with more than one object on your turn."

**2024**, `combat.md` lines 18–21: "...interact with **one** object/feature for free during your move or action (a second interaction requires the Utilize action)." `adventuring.md` lines 21–26 (dedicated "Interacting with Objects" section, more detail than 2014's grounding text carries): "An object is a discrete, inanimate item... In combat/time-pressured situations, you get **one free object interaction per turn** during your move or action; further interactions require the Utilize action." `ability-checks.md` line 145 names the action: "Utilize — Use a nonmagical object."

**Verdict: mechanically identical between editions** — one free object interaction per turn (during move or action, not a separate economy slot), a second (or further) interaction requires spending the action slot on a dedicated action. **The only difference is the fallback action's name**: 2014 calls it "**Use an Object**"; 2024 renamed it "**Utilize**" and 2024's `ability-checks.md` line 145 narrows its description to "a *nonmagical* object" specifically (2014's "Use an Object" text doesn't include that qualifier — magic items "always requiring an action... as stated in their descriptions" is 2014's separate carve-out for magic items specifically needing their own action per-item, not a restriction on what Use an Object itself can target). Not a mechanical difference in the free-interaction budget, only a naming/scope-wording difference in the paid fallback action — flagging so the registry label can be edition-aware if desired, though the free-interaction-per-turn counter itself behaves identically either way.

### 2. Data model translation

#### 2.1 Climb / Swim — do NOT add to `ACTION_REGISTRY`

Per §1.1/§1.2, these are not SRD actions — they cost movement, not an action-economy slot. Adding them as registry entries would misrepresent the rule (a DM/player clicking "Climb" and having it consume their action would be a rules bug, not a UI convenience). **Recommendation: leave them out of `ACTION_REGISTRY` entirely**, matching exactly how `jumpDistanceFt`/`standUpCostFt` are already modeled outside the registry as movement-cost helper functions in the same file.

If the app wants a UI affordance for "moving through a climbable/water cell" (e.g. so a player understands why their movement budget is draining faster), the correct shape — consistent with `docs/rules/movement.md`'s `map_cell_overrides.medium` design (`'ground' | 'water' | 'air' | 'underground'`) and the pathfinding cost function already specified there (§2.3, step 3: alt-speed medium check) — is **not** a new function in `actionEconomy.ts` at all. It's the movement/pathfinding layer (`packages/server/src/services/movement.ts`, per `movement.md` §2.3) correctly reading `mover.altSpeedsFt.climb`/`.swim` and doubling cost-per-foot when absent, exactly like the swim case already specified there. Nothing new needs to be built in `actionEconomy.ts` for Climb/Swim beyond what `movement.md` already designed; §5's brief listing "climb, swim" alongside "search, disengage, ready" as things to "extend `ACTION_REGISTRY`" with should be read as **partially incorrect against the SRD** — implement the terrain/alt-speed-cost side (already specified in `movement.md`), not a registry entry.

One caveat worth surfacing explicitly: **if a table wants the GM's-option Athletics check for climbing a slippery/vertical surface** (2014 `adventuring.md`, explicitly GM's-option text), that's a per-DM-adjudicated roll, not a mechanical gate the app should hardcode as blocking movement on failure — consistent with `movement.md`'s own "DM-configurable" section precedent (display-only, DM adjudicates manually) rather than adding an auto-rolled Athletics check nobody can turn off. **Do not build this into the registry as an auto-triggered roll.**

#### 2.2 Search, Disengage, Ready — genuine new `ActionDefinition` entries

All three cost the **action** slot in both editions (confirmed, §1.3–1.5) — matching this file's existing `ActionSlot = 'action' | 'bonus_action' | 'reaction'` shape, no new slot type needed.

```ts
{
  key: 'disengage',
  label: 'Disengage',
  slot: 'action',
  description:
    "Your movement doesn't provoke opportunity attacks for the rest of this turn.",
},
{
  key: 'search',
  label: 'Search',
  slot: 'action',
  // 2014: GM picks Perception or Investigation. 2024: GM picks among
  // Insight/Medicine/Perception/Survival (all Wisdom; Investigation moved
  // to 2024's separate "Study" action, not requested here). This file has
  // no per-skill proficiency data (see ActionRollTrigger's own comment) and
  // no campaign-edition context available inside a static array, so, same
  // as Grab/Shove/Hide above, model a single representative roll rather
  // than a picker — recommend keeping the existing file's simplification
  // pattern and defaulting to Perception (the one skill common to both
  // editions' candidate lists) with the description naming the GM's
  // situational discretion, rather than modeling a 4-way/2-way skill choice
  // this component has no UI for elsewhere in the file.
  rollTrigger: { rollContext: 'Search (Perception)', ability: 'wis' },
  description:
    'GM-adjudicated check to find something — Wisdom (Perception) or Intelligence (Investigation) in 2014; Wisdom (Insight, Medicine, Perception, or Survival) in 2024.',
},
{
  key: 'ready',
  label: 'Ready',
  slot: 'action',
  description:
    'Prepare a triggered response (an action or up to your speed of movement) to use with your reaction before the start of your next turn. Executing the readied response spends your reaction, not a second use of this action; if the trigger never fires (or you ignore it), the readied action is lost at the start of your next turn.',
},
```

Notes specific to `Ready`, because it's the one entry that isn't a single self-contained slot spend like the rest of the registry:
- **Taking Ready consumes the action slot immediately** (`applyActionEconomy({ spend: 'action' })`, existing endpoint, no schema change) — this part fits the existing architecture exactly.
- **Executing the readied response later consumes the reaction slot** (`applyActionEconomy({ spend: 'reaction' })`) — this is a *second*, separate spend, at a *later* point in the round (potentially on another participant's turn, since a reaction can fire off-turn). The existing `applyActionEconomy`/`combat_participants` model already supports this with **zero schema change**: `action_used` and `reaction_used` are already independent booleans, and nothing in the current endpoint assumes a spend must happen during the spending participant's own turn (confirmed by reading `applyActionEconomy`, `services/encounters.ts` lines 657–690 — it authorizes and updates by `participant_id`, not by "is it currently this participant's turn"). **No new column or endpoint is required for Ready's two-part spend** — it's just two ordinary `applyActionEconomy` calls, separated in time, using the existing `action`/`reaction` slot values already in the registry's `ActionSlot` union.
- **What this app does not yet model, and the SRD leaves to the table anyway**: there's no structured "trigger condition" or "readied response type" field anywhere in `combat_participants` — per 2014's text, the trigger and response are freeform, narrated conditions ("if the cultist steps on the trapdoor..."), not a mechanically-checkable predicate. This is consistent with the SRD's own framing (GM adjudicates whether the trigger occurred) — **not a gap to fill with a new schema field**, just noting it so the implementing session doesn't try to over-model a freeform mechanic.

#### 2.3 Object interaction — new fourth tracked resource, not an `ACTION_REGISTRY` entry

Per §1.6, this is explicitly **not** part of the action/bonus-action/reaction economy — it's a separate, fourth per-turn resource (matching REFACTOR-PLAN.md §5's own framing: "a fourth tracked resource alongside action/bonus/reaction/movement"). It should **not** be added to `ACTION_REGISTRY` (which is exclusively for things that cost one of the three named slots) — it needs its own tracked counter, parallel to `movement_used_ft`.

- **Schema**: `combat_participants` gains `object_interaction_used BOOLEAN NOT NULL DEFAULT false` (one free interaction per turn, boolean is sufficient — the SRD doesn't grant multiple free interactions from any base rule in either edition's grounding text). Reset alongside the other four columns in `advanceTurn`'s existing per-turn reset (`services/encounters.ts` line 1158 already resets `dash_used = false, movement_used_ft = 0` and the three `*_used` slot booleans in the same statement — add `object_interaction_used = false` to that same reset).
- **Server**: extend `applyActionEconomySchema` (`schemas/encounters.ts`) with a new optional `useObjectInteraction: z.boolean().optional()` (or a `spend` union member `'object_interaction'`, matching the existing `spend: z.enum(['action','bonus_action','reaction'])` shape more closely — recommend widening the existing enum to `z.enum(['action','bonus_action','reaction','object_interaction'])` rather than adding a parallel boolean flag, since it's conceptually the same "spend one of my per-turn resources" operation as the other three and the existing endpoint's conflict-checking logic can treat it uniformly).
- **Fallback ("Use an Object" / "Utilize")**: a *second* object interaction in the same turn is not free — it costs the action slot. This is already expressible with a plain `ACTION_REGISTRY` entry, no new mechanism:
```ts
{
  key: 'use_object',
  label: 'Use an Object', // 2024 renames this "Utilize" — edition-aware label if desired, same mechanic
  slot: 'action',
  description:
    'Spend your action to interact with an object beyond your one free interaction this turn (2024: "Utilize", nonmagical objects; magic items may require their own action per their own description).',
},
```

#### 2.4 DM undo — what state a correct undo must restore

Not a rules question (confirmed by the task: SRD doesn't mandate undo tooling), but `REFACTOR-PLAN.md` §5 asks for a "track what has been consumed; allow the DM to undo" mechanism, and this app currently has **zero** undo capability anywhere in the action-economy path (confirmed: no "undo" reference in `services/encounters.ts` or any action-economy route). A correct single-step "undo last consumption" (the smallest-mechanism version §5 itself recommends) must be able to restore **every column any single `applyActionEconomy`-style call can mutate**, which — after §2.2/§2.3 above — is five, not four:

1. `action_used` (boolean) — including the case where the last spend was specifically **Ready**, which only sets `action_used`, not `reaction_used`, at spend-time (§2.2) — undoing "Ready" must not accidentally also clear a `reaction_used` that hasn't been set yet.
2. `bonus_action_used` (boolean)
3. `reaction_used` (boolean) — including the case where the reaction being undone was the *execution* of a previously-readied action, which may have been readied on a **different, earlier turn** than the one currently active. A "per participant per turn" undo scope (§5's own stated scope) needs to be precise about *which* turn's action-economy row a reaction-undo affects, since Ready's reaction can fire on someone else's turn, i.e. outside the window when that participant's own `action_used`/etc. were last reset. Recommend explicitly scoping undo to "the last mutation this endpoint made to this participant's action-economy columns," not "the last mutation made during this participant's current turn," since those are provably not the same thing for Ready.
4. `dash_used` (boolean) — undoing a Dash must also correctly restore the movement budget calculation (`remainingFt = speed_ft + (dash_used ? speed_ft : 0) − movement_used_ft`, `services/encounters.ts` line 460) back to its pre-Dash shape, not just flip the boolean while leaving a stale `movement_used_ft` that assumed the doubled budget.
5. `movement_used_ft` (int) — must be restored to its exact prior value, not just decremented by a guessed amount; the existing `addMovementFt` spend is additive (`services/encounters.ts` line ~688), so undo needs to store (or recompute) the exact delta of the last spend, not just "subtract the participant's speed."

Plus the new column from §2.3: **`object_interaction_used`** (boolean) — a sixth restore target the implementing session should not miss, since it's being added in the same phase as the undo mechanism and it's easy to wire undo against only the pre-existing five migration-`1784269759666` columns and forget the newly-added sixth.

**Concrete recommendation for the "last mutation" record**, matching this app's existing smallest-mechanism precedent (a single boolean/counter per concern, not a JSONB blob, per `PLAN.md` §3.3's own convention already cited in `docs/rules/movement.md`): store the **previous values** of whichever columns a given `applyActionEconomy` call is about to change, in a small `last_action_economy_snapshot JSONB` column (or six nullable shadow columns, either is defensible) on `combat_participants`, overwritten on every spend and nulled out (or left stale-but-unusable, gated by a `last_action_economy_snapshot_id`/turn-number check) once consumed by undo or once the turn resets — a full undo *stack* is explicitly out of scope per §5's own "smallest mechanism" framing, so a single-slot "last mutation" snapshot, not a log table, is the right shape.

### 3. Edge cases

- **Climb/Swim aren't registry entries at all** (§1.1/§1.2/§2.1) — the one edge case here is making sure nobody on the implementing side reflexively follows REFACTOR-PLAN.md §5's literal wording ("Extend `ACTION_REGISTRY`... with: climb, swim, search, disengage, ready") without checking against the SRD first; this doc is the correction.
- **Search's roll target is GM-discretionary, not fixed** (§1.3) — the registry's existing `ActionRollTrigger` shape (one `rollContext` + one `ability`) can't represent "GM picks from 2–4 skills, all deferring to the same `wis`/`int` ability split the file already simplifies away for proficiency" — recommend the single-Perception default named in §2.2, but flag in the UI copy (already drafted above) that it's GM's call, not a hard roll.
- **2024's Search drops Investigation, which moves to a 2024-only action ("Study") not requested by this task** (§1.3) — not building Study now, but noting it so a future session doesn't assume Search covers Investigation in a 2024 campaign the way it does in 2014.
- **Disengage's duration is "rest of this turn," not "until your next turn"** (§1.4) — a common misreading (confusing it with Dodge's "until the start of your next turn" duration, which *is* the longer window) — worth a code comment on the registry entry so nobody "fixes" the wording to match Dodge's duration by mistake.
- **Ready is a two-part spend across two different `applyActionEconomy` calls, potentially on two different turns** (§1.5/§2.2) — the sharpest edge case in this whole doc. The action slot is spent when Ready is taken; the reaction slot is spent later, possibly during a *different* participant's turn, when the trigger fires. Both the UI and the undo mechanism (§2.4) need to treat these as two independent events, not one atomic "Ready" spend.
- **Readying competes with all other reaction uses for the same single reaction slot** (§1.5) — a participant who readies an action and then also needs an opportunity attack before the trigger fires can only take one; the existing `reaction_used` boolean already models "only one reaction available," so this needs no new mechanism, just confirming the existing conflict-check in `applyActionEconomy` (which already rejects a second slot spend once `reaction_used = true`, per the file's existing conflict-check pattern referenced in `movement.md` §2.4) correctly blocks a second reaction regardless of *why* it's being requested.
- **A readied spell can be lost before the trigger fires** (2014-confirmed, §1.5) — out of scope for the action-economy registry itself (spellcasting/concentration isn't modeled in `combat_participants` today, confirmed absent from the migration), but flagging so a future concentration-tracking feature knows Ready has a spell-specific interaction the SRD names explicitly.
- **Object interaction's fallback action is named differently per edition** ("Use an Object" 2014 / "Utilize" 2024, §1.6/§2.3) — mechanically identical, but if the UI wants edition-correct labeling, `campaigns.srd_edition` is already available to key the label off of; not doing so isn't a rules bug, just a wording mismatch a stickler DM might notice.
- **Undo must not restore stale `movement_used_ft` when undoing Dash** (§2.4 item 4) — undoing `dash_used` without correctly recomputing/restoring `movement_used_ft` would leave the two columns internally inconsistent (a participant showing `dash_used = false` but a `movement_used_ft` value that's only sensible under the doubled budget) — this is the single most likely undo bug, called out explicitly so it isn't missed.
- **Undo scope for Ready's reaction spans turn boundaries** (§2.4 item 3) — a naive "undo affects only the currently-active participant's turn" implementation would silently fail (or worse, corrupt a different turn's state) for a readied reaction executed on someone else's turn.

### 4. What must be tested

Server-side `*.integration.test.ts`, matching this repo's convention (e.g. alongside `packages/server/src/services/encounters.actionEconomyAuthz.integration.test.ts`):

- **Disengage spends the action slot and nothing else**: `applyActionEconomy({ spend: 'action' })` for Disengage leaves `bonus_action_used`/`reaction_used`/`dash_used`/`movement_used_ft`/`object_interaction_used` all unchanged from their pre-call values.
- **Search spends the action slot, no roll-target enforcement server-side** (rolls are client/registry-only per this file's existing architecture, confirmed by the header comment — the server has no concept of "Search" at all, only the action slot) — assert the endpoint accepts a plain `{ spend: 'action' }` call regardless of which named action the client UI attributed it to, matching every other registry entry's existing test pattern.
- **Ready: two independent spends, correctly sequenced**: (1) `applyActionEconomy({ spend: 'action' })` succeeds and sets `action_used = true`, `reaction_used` unchanged; (2) a later `applyActionEconomy({ spend: 'reaction' })` — potentially after `advanceTurn` has moved play to a different participant and back — succeeds independently and sets `reaction_used = true` without requiring `action_used` to still be `true` at that point (it may have been reset by an intervening turn).
- **Reaction slot conflict blocks a second reaction regardless of source**: a participant who has already spent their reaction (from any cause) gets `409 CONFLICT` attempting a second `{ spend: 'reaction' }` call, whether the first spend was attributed to "Ready" or an ordinary opportunity attack — proves the slot-conflict check doesn't special-case Ready.
- **Object interaction: free first use, paid second use**: first `{ useObjectInteraction: true }` (or equivalent) call in a turn succeeds and sets `object_interaction_used = true` without touching the action slot; a second such call in the same turn is rejected (`409 CONFLICT`) unless accompanied by/preceded by an `{ spend: 'action' }` call representing "Use an Object"/"Utilize."
- **Object interaction resets on turn advance**: `advanceTurn` clears `object_interaction_used` back to `false` for the participant whose turn is starting, in the same transaction as the other four resets (extending the existing test coverage of `services/encounters.ts` line 1158's reset statement).
- **Undo restores dash + movement together, not just the boolean**: spend `{ spend: 'action', dash: true }` then `{ addMovementFt: X }`, then invoke undo once — assert both `dash_used` and `movement_used_ft` return to their exact pre-Dash values (`false` / prior int), not just `dash_used` flipped back while `movement_used_ft` retains the post-Dash-budget spend.
- **Undo is scoped to "last mutation," not "this turn's mutations"**: readying an action on turn N (spending the action slot), letting several other participants take turns N+1..N+k, then executing the readied reaction on turn N+k (spending the reaction slot) — undo immediately after that reaction spend must revert only the reaction, not reach back and also revert the action slot spent turns earlier.
- **Undo of a stale/already-superseded snapshot is a no-op or clear error, not silent corruption**: two consecutive spends followed by only one undo call must not be able to double-undo or undo the wrong spend — assert the "last mutation" record is single-slot (overwritten each spend, per §2.4's recommended shape) and a second undo call either errors cleanly or is idempotent, never applies a second rollback.
- **A player-role session cannot call the undo endpoint against another player's participant, only a DM can undo any participant's spend**: extends the existing DM/player authorization test pattern (`encounters.actionEconomyAuthz.integration.test.ts`) to the new undo endpoint specifically, per `REFACTOR-PLAN.md` §7's own explicit ask to extend authz coverage to "action-economy-undo endpoints."

## DM-configurable, never hardcoded

- **Search's exact skill** (Perception vs. Investigation in 2014; which of four Wisdom skills in 2024) is explicitly GM-adjudicated per the SRD's own text in both editions — the registry's single default (`Search (Perception)`, §2.2) is a UI simplification, not a hardcoded rule; the description text should make the GM's discretion visible rather than presenting the default as the only legal roll.
- **Climbing a slippery/vertical surface requiring a Strength (Athletics) check** (2014 `adventuring.md`, explicitly "At the GM's option") — already the pattern `docs/rules/movement.md`'s own "DM-configurable" section names for the same citation; not re-litigated here, just confirmed to also apply to this doc's Climb finding (§2.1) — this app has no mechanism to auto-require an ad hoc mid-move check, and none should be added; DM narrates/adjudicates manually, consistent with this app's existing "display-only, DM adjudicates" precedent.
- **Whether the "Use an Object"/"Utilize" fallback action label is edition-aware** (§1.6/§3) is a cosmetic choice, not a rule — flagging as optional polish, not a required DM toggle.
