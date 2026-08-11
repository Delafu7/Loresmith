# Loresmith Backlog — from Audit (2026-08-08)

Generated from a checklist audit of the existing codebase (see conversation for the
full Step 1 map and Step 2 classification). Ordered by **cost of delay**, per these
rules: data-model/permission-layer items first regardless of size; then whatever
hurts most at the table right now; prep/continuity features last since they're
additive. Work estimates are relative to this codebase's existing patterns, not
absolute.

---

## Tier 1 — Data model & permission layer

Do these first because every week of new feature work on top of the current shape
makes them more expensive to fix, independent of how small the user-facing payoff
looks today.

### 1.1 Centralise visibility filtering into one serialisation layer
**What:** Today there are five independent, hand-written filters: `redactGmNotes()`,
`redactEntityFields()`, the dice-roll visibility SQL predicate, the campaign-assets
`visible_to_players` clause, and `filterParticipantsForViewer()`. Each is internally
correct and tested, but a sixth entity that needs visibility (which Tier 3 items will
create — locations, factions, plot threads, rulings) means a sixth hand-rolled filter,
and the failure mode for forgetting one is a real data leak, not a bug.
**Why it's first:** Every new visibility-bearing entity you add before this exists
is another bespoke filter to maintain and another chance to miss one. Fixing it after
5 more entities exist means retrofitting 5 call sites instead of designing 1 pattern.
**Work:** Medium. Design one serializer/decorator convention (e.g. a
`withVisibility(row, viewerRole, viewerId)` helper keyed by a declared visibility
spec per table) and migrate the 5 existing filters onto it. Doesn't require a big-bang
migration — can be introduced and adopted table-by-table.
**Depends on:** Nothing. Blocks 1.3 and most of Tier 3's F/G items cleanly.

### 1.2 Make reveal state an append-only event log, not an upsert
**What:** `entity_field_reveals` overwrites `revealed_at` on every toggle
(`ON CONFLICT ... DO UPDATE`). There's no way to answer "when did the party first
learn the wraith is resistant to non-magical weapons" once it's been hidden and
re-revealed.
**Why it's here:** Same category as 1.1 — an audit-trail decision that gets more
expensive to retrofit the more reveal-driven features (Tier 3 plot threads, rulings)
get built on top of it.
**Work:** Small. Add an insert-only `reveal_events` table alongside the existing
current-state table (which can stay as the fast-lookup materialized state); write to
both on every reveal/hide.
**Depends on:** Nothing.

### 1.3 Decide on a per-character (per-player) visibility primitive
**What:** Right now only dice rolls support "visible to player X, not player Y."
Everything else is all-players-or-DM-only. Your checklist explicitly wants
per-character visibility as a first-class state (item A.2).
**Why it's here:** This is a genuine architecture decision, not just a missing
column — flagging it per your ground rules before I'd build it. The two shapes are
(a) a `visible_to_user_ids UUID[]` array column per entity, or (b) a generic
`entity_visibility(entity_type, entity_id, user_id)` join table usable across all
entities. (b) fits your existing generic-table pattern (`entity_field_reveals`,
`entity_categories`) but is a new table; (a) is cheaper per-table but doesn't
compose with 1.1's unified serializer as cleanly. **Worth a short conversation
before starting** — this shape decision affects every Tier 3 compendium/continuity
feature that wants per-player secrets (a note only one player has seen, a plot
thread only revealed to one PC's backstory).
**Work:** Medium (schema) + design conversation.
**Depends on:** Best done alongside or right after 1.1.

### 1.4 Give sessions/recap a visibility split
**What:** `sessions.recap` has no visibility column at all — you can't write a
DM-facing recap draft separate from what players see when the next session opens.
**Why it's here:** Small, contained, data-model-touching, and directly blocks G.5.
**Work:** Small. One boolean or a `player_recap`/`dm_recap` column pair, surfaced in
`SessionLogPage.tsx`.
**Depends on:** Nothing, but do after 1.1 exists so it uses the new pattern instead
of yet another bespoke flag.

### 1.5 Add a currency/money field
**What:** No `characters`, `character_items`, or item-stash table has any
gold/currency column. Party wealth doesn't persist anywhere.
**Why it's here:** Data-model gap that affects G.6 directly and will be annoying to
retrofit once inventory/shop-adjacent features exist.
**Work:** Small. Column(s) on `characters` (or a `character_currency` table if you
want per-denomination tracking — cp/sp/gp/pp), a rest/transaction touchpoint isn't
needed since D&D doesn't auto-change currency on rest.
**Depends on:** Nothing.

### 1.6 SRD attribution + seed citation fix
**What:** The app's seed pipeline genuinely pulls from `.opencode/skills/dnd5e-srd/`
data at build time, but the CC-BY-4.0 attribution that's already drafted in that
skill's `ATTRIBUTION.md` never surfaces anywhere a distributed build would carry it.
Separately, `db/seeds/demo.ts:208` cites "Monster Manual" alongside SRD 5.1 for the
starter bestiary.
**Why it's here, despite not being schema/permission work:** this is the one item
where your own checklist explicitly calls out that delay is expensive — content
sourcing gets harder to audit the more of it there is. Fixing it while there are 4
seeded monsters and one attribution string to add is trivial; fixing it after a
larger bestiary and spell/item library have grown is a real cleanup project.
**Work:** Small. Add a root `LICENSE`/`ATTRIBUTION.md` with the CC-BY-4.0 string,
surface it somewhere in the app (footer or about page), correct the demo seed's
source citation to drop "Monster Manual."
**Depends on:** Nothing. Do any time, but do it now while it's cheap.

---

## Tier 2 — Table pain (hurts every session until fixed)

Ordered by how often each one bites during actual play.

### 2.1 Concentration-broken Con save prompt on damage
**What:** Damage to a concentrating creature computes nothing — no DC surfaced, no
prompt. This is the rule DMs forget most because nothing reminds them.
**Work:** Medium. In `applyDamage`/`applyMonsterInstanceDamage`, when the target has
an active `concentration=true` effect, compute `DC = max(10, floor(damage/2))` and
return/broadcast an actionable prompt (not just a log line) that the DM (and ideally
the concentrating player) can act on.
**Depends on:** Nothing structurally new — `active_effects.concentration` already
has what's needed.

### 2.2 Condition/effect expiry notification
**What:** `EFFECT_EXPIRED` is emitted but silently swallowed client-side — nothing
tells the DM a condition just wore off.
**Work:** Small. Wire the existing event into `CombatLogPanel` and/or a toast.
**Depends on:** Nothing.

### 2.3 HP/damage undo
**What:** Action-economy has undo; HP doesn't. A fat-fingered damage entry mid-combat
has no fix short of manually re-entering the delta.
**Work:** Medium. `combat_actions` already logs the data needed; add an undo endpoint
that reverses the last HP-affecting action for a target, mirroring the existing
action-economy undo pattern.
**Depends on:** Nothing.

### 2.4 Weapon mastery properties (2024)
**What:** Entirely absent — no mastery property on any weapon, no seed data, no UI.
Called out by name in your checklist as the most-forgotten-in-play rule.
**Work:** Medium-large. Schema: extend `items.properties` or add a `mastery_property`
enum column + description; seed data for all weapons; surface it in the attack
roller UI so it's visible at the moment of the attack, not buried in an item sheet.
**Depends on:** Nothing structurally, but touches the same items table Tier 3's
compendium work will also want — fine to sequence either way.

### 2.5 Legendary actions with per-round counters
**What:** `legendary_actions` is flavor-text JSONB only; no usage counter, no
reset-on-round logic, no UI reminder.
**Work:** Medium-large. Needs a real structured schema (name/cost/description per
action) replacing the flavor-text blob, a per-encounter usage-counter row, reset
logic in `advanceTurn`, and a UI panel prompting the DM when it's a legendary
creature's non-turn window.
**Depends on:** Nothing blocking, but this is real schema work on `monsters`, not a
quick add — flagging as disproportionately larger than it looks from the checklist
line item.

### 2.6 Lair actions with initiative-20 reminder
**What:** Zero implementation. Needs a `lair_actions` field on monsters/encounters
and an initiative-count-20 trigger in the turn-advance flow.
**Work:** Medium. Smaller than legendary actions since it's one reminder, not a
per-round budget, but still needs the initiative-count-20 hook added to
`advanceTurn`.
**Depends on:** Can share schema/UI patterns with 2.5 if built together.

### 2.7 Fix manual initiative reorder
**What:** The `PATCH .../initiative` endpoint updates the roll but never touches
`turn_order`, and no UI calls it at all — reordering initiative is currently a
dead-end.
**Work:** Small-medium. Fix the service to call the existing
`reorderTurnOrderByInitiative`, add a drag-or-arrow reorder control to
`InitiativeStrip.tsx`.
**Depends on:** Nothing.

### 2.8 Hidden rolls: record occurrence without exposing result
**What:** `gm_only` rolls are currently invisible to non-recipients, not masked —
players can't tell a hidden roll even happened.
**Work:** Medium. Emit a stub `DICE_ROLLED` event to non-recipients with the result
field omitted/masked, render it as a "hidden roll" placeholder row in
`DiceRollHistoryPage.tsx`.
**Depends on:** Nothing.

### 2.9 Hidden-roll option in contextual rollers
**What:** Only the standalone `QuickDiceRoller` widget has a visibility toggle. The
rollers actually used for skill checks/saves/attacks mid-combat default silently to
public with no hidden option.
**Work:** Small-medium. Thread a `visibility` prop through `DiceRoller.tsx` and its
callers (`SkillsPanel`, `SavingThrowsPanel`, `AttackRoller`).
**Depends on:** Ideally lands alongside 2.8 so hidden rolls behave consistently
everywhere they're triggered.

---

## Tier 3 — Prep and continuity (additive, doesn't block anything)

### 3.1 Terrain/complications field on encounters
**Work:** Small. Add the column, expose it in the encounter create/edit form. Cheap
enough to do early in this tier even though it's low-drama.

### 3.2 NPC "what they want" field
**Work:** Small. One column + one UI field on the character sheet, distinct from
`notes`/`gm_notes`.

### 3.3 Compendium note↔character linking UI
**What:** The FK already exists (`notes.character_id`); the UI never exposes a
picker.
**Work:** Small — this is UI-only, the data model is already there.

### 3.4 Full-text search across notes/compendium
**Work:** Medium. Postgres `tsvector` + GIN index on `notes` (and whatever Tier 3
entities exist by the time this is built), a search endpoint, a search box in the
notes UI.

### 3.5 Rulings log
**What:** Could piggyback on `notes` with a `type: 'ruling'` discriminator rather
than a wholly new table, if you're fine with rulings living alongside general notes.
**Work:** Medium. Needs 3.4 (search) to actually be useful as a "log."
**Depends on:** 3.4 for search; ideally 1.3 if you want rulings to support
per-player visibility (e.g., a ruling that reveals a spoiler).

### 3.6 Plot threads (status + origin session + staleness)
**What:** A genuinely new entity — status field (open/resolved), origin-session FK,
and a staleness computation (days since last touched).
**Work:** Medium-large. New table, new UI section, staleness is a simple
`now() - last_touched_at` computation but needs a "touch" event wired into whatever
updates a thread.
**Depends on:** 1.1 (visibility) and 1.3 (per-player) if threads should support
DM-only or per-player-revealed variants, which is likely given how you described
this as the area with the most room to be better than existing tools.

### 3.7 Campaign compendium: locations and factions
**What:** Entirely new entity types — was scaffolded for "Phase 3" in an old
migration comment and never built.
**Work:** Large. Two new catalog-ish tables (probably campaign-instance, not
catalog, since locations/factions are campaign-specific), CRUD routes, UI pages,
and cross-linking to NPCs/notes/items to satisfy F.5.
**Depends on:** Reuse the `campaign_categories` tagging pattern already built for
the bestiary rather than inventing a new one.

### 3.8 Encounter builder XP budgeting
**What:** Compute a target XP budget from actual party level/size and show progress
against it while building an encounter.
**Work:** Medium. Pure calculation feature on top of existing monster CR data and
existing character level data — no schema changes needed, mostly a UI + a budget
formula (2014 or 2024 DMG encounter-building tables, whichever edition the campaign
uses — you already track `srd_edition` per campaign, so this can be edition-aware).

### 3.9 Campaign calendar with scheduled events
**Work:** Large. New table, new UI, and a design decision on what "in-game date"
even means for your campaign (does downtime/travel advance it automatically, or is
it DM-entered?) — worth a short conversation before starting, not just a build.

### 3.10 Bastion tracking (2024 downtime system)
**Status:** Flagging for a decision, not backlogged yet — **confirm whether this is
actually in scope**. It's a substantial, optional 2024-ruleset subsystem (turns,
facilities, orders, random events) with zero precedent in your schema. If you're not
running 2024-rules downtime in your campaign, this is N/A, not Missing, and I'd
rather not build a large speculative feature you don't need.

---

## Operational (sequence independently — not a hard dependency chain)

### 4.1 Document / script DB backup
**What:** Postgres has crash durability via the Docker volume but no dump/restore
tooling or documented procedure — currently entirely on you if something goes wrong.
**Work:** Small. A `pg_dump`/`pg_restore` script plus a paragraph in the README.
Cheap insurance, worth doing soon despite being "just ops."

### 4.2 Complete campaign export
**What:** Export silently omits `campaign_bestiary_entries`, `campaign_reference_notes`,
the maps library, categories, and encounters — none of it is ephemeral, all of it is
DM-authored content that should round-trip.
**Work:** Medium. Extend `campaignExport.ts`'s payload builder and the corresponding
import path; document the format (`formatVersion` already exists as a hook for this).

### 4.3 Offline rules/stat-block lookup
**What:** No caching layer of any kind exists — the app is 100% live-network today.
**Work:** Large, and the scope needs narrowing before estimating further: full
offline for a live-Postgres-and-Socket.io app isn't realistic. Worth deciding
whether this means "read-only catalog browsing (monsters/conditions/spells) cached
via a service worker" vs. something broader, before committing to it. Flagging as
architecturally the biggest lift on this list relative to its checklist weight.

---

## Not backlogged — working as designed, confirm before touching

- **Deliberately removed reveal engine scope** (A.1, B.3, D.2): the migration
history shows `hp_visibility` and general note/effect visibility were consciously
removed, not missed. Tier 1.3's per-character visibility work and any HP-hiding
work should be a single conversation, not two separate backlog items, since they'd
likely share the same underlying primitive.
- **Mobile usability (H.4):** Done — no work needed.
