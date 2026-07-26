# REFACTOR-PLAN.md — Loresmith v3 ("Full Refactor")

> Sibling to `PLAN.md` (v1, original design) and `REVISION-PLAN.md` (v2, reveal engine + battle-mode redesign, shipped in commit `486cab3`). Same convention as v2: this file reconciles a new brief against what's actually in the codebase, rather than silently rewriting `PLAN.md`'s history. Read `REVISION-PLAN.md` first if you haven't — several of its "deferred" sections (§2 bestiary polish, §4 campaign-level Konva maps, §6 table display) are explicitly **not** being picked up here; this plan says exactly which parts of the new brief overlap with that deferred work and why they're being solved differently (smaller) this round.

---

## 0. Reality check — brief vs. actual code

Audited against real source (not just `PLAN.md`'s claims) before writing this. Per-section brief assumption vs. reality:

| Brief assumes | Actually true |
|---|---|
| Generic/unspecified framework, "adapt to conventions" | Postgres + Express + Socket.io server, React+Vite+TS web, npm workspaces monorepo. All new work follows these existing conventions — no new framework introduced. |
| A functional app with wrong architecture/UI that needs full replacement | Substantial, already-correct architecture exists: catalog/instance split (`monsters`/`monster_instances`), per-campaign roles (`campaign_members.role`, resolved per-request server-side, **zero global role flags** — confirmed by grep), a reveal engine for DM/player visibility, action-economy tracking, a real visual identity (ember theme, `TurnTorch`) shipped in the previous session. This plan builds the genuinely missing pieces on top of that, not a rewrite. |
| Routes are wrong/missing entirely | Routes exist but are all nested under `/campaigns/:campaignId/...` (monsters, maps, turns, notes) — no standalone `/bestiary`, `/creature/:id`, `/maps/:mapId`, top-level `/notes`. §1 below adds the missing top-level routes; it does not restructure what already works. |
| "Bug: same monster can exist multiple times unless NPC/unique" | Partially true. `is_unique` enforcement exists (`services/monsters.ts`) but is **scoped per-campaign, not system-wide**, and counts *any* instance status (including dead ones) rather than only living ones — so a dead unique NPC currently still blocks a legitimate respawn, while the same named boss could still exist simultaneously in two different campaigns. §2 fixes both. |
| Board is unreadable, movement/action-economy nonexistent | Action economy (action/bonus/reaction/movement pips) and roughly half the physical-action roster (dash, grapple, shove, throw, dodge, help, hide, jump, stand-from-prone) already exist and are server-persisted. What's missing: climb/swim/search/disengage/ready/object-interaction, DM undo, and — the actually-broken part — **movement has no server-side cost enforcement at all** (confirmed: `services/encounters.ts` comment states speed is display-only; token drag-drop in `BattleMap.tsx` has zero distance/cost validation). §4/§5 close these gaps; they don't rebuild the parts that work. |
| No selectable attacks/damage system | Weapon attack+damage roll pairing exists (`InventoryPanel.tsx`) and dice rolls already model advantage/disadvantage server-side. What's missing: damage resolution doesn't apply resistances/vulnerabilities/immunities (the data exists on `monsters` catalog rows, nothing reads it), and monster/character "attacks" aren't a structured, selectable list — just an ad hoc equipped-weapon shortcut. §6 fixes this without discarding the existing roll infrastructure. |
| New interface needs full mockup-first rebuild | The previous session already shipped a real, reviewed visual redesign (`REVISION-PLAN.md` §10: ember palette, `TurnTorch`, nav split, battle-mode layout). Redoing that from mockups now would be regressive churn, not progress. **§8 below is scoped down**: mockups are produced only for the screens that are genuinely new (landing transition, bestiary basic/campaign split, full-screen map route) — not a second pass over already-shipped, tested UI. Flagged explicitly in `OPEN_QUESTIONS.md` per the brief's own instruction for resolving spec/reality conflicts. |

---

## 1. Route/domain separation

Target, adapted to this app's actual data model (campaign-scoped resources keep a campaign context where the data genuinely requires it — `/bestiary/campaign/:id` was already in the brief's own route table for exactly this reason):

```
/                          landing + intro transition (skippable, prefers-reduced-motion)
/login
/register
/home                      hub after auth (renamed from DashboardPage's current "/")
/bestiary                  global index — basic (catalog) + campaign-specific, tabbed
/bestiary/basic            catalog creatures, reusable across campaigns
/bestiary/campaign/:id     campaign-specific (homebrew) creatures
/creature/:id              individual creature sheet — own route, works for both basic and campaign-scoped
/maps                      cross-campaign map index (which of your campaigns/encounters have a configured map)
/maps/:encounterMapId      full-screen map view
/campaigns
/campaigns/:id             campaign dashboard
/campaigns/:id/session     live session (renamed from "turns"; battle-mode when an encounter is active)
/notes                     cross-campaign DM notes index
```

Decisions:
- **Maps stay keyed to `encounter_maps` (existing schema), not a new campaign-level `maps` table.** `REVISION-PLAN.md` §4 already scoped a campaign-level Konva-based map system as its own large deferred milestone (calibration, undo, canvas library) — nothing in the new brief asks for those specifically; it asks for coordinate labels, configurable cell size, faction borders, size-based footprint, a synced side panel, zoom/pan/center. All of that is buildable on the existing per-encounter `encounter_maps` + `combat_participants.pos_x/pos_y` model. `/maps/:encounterMapId` is a real standalone route (not embedded in a panel) — opening a map from a campaign redirects here.
- **`/bestiary`, `/notes`, `/maps` become real top-level routes** backed by cross-campaign queries (a user's own campaigns only), while `/creature/:id` and `/maps/:encounterMapId` are the "own endpoint" detail routes the brief asks for. Campaign-scoped actions (editing a homebrew creature, editing a map) still enforce campaign-membership/DM authorization server-side exactly as today — moving the route doesn't change the authz model.
- **Only alive creature instances spawn on map load**: today, adding a participant to an encounter is a manual DM action with no status filter. Fix: the map view's spawn/token-list query filters `monster_instances.status = 'alive'` (existing enum already has `alive|dead|fled|captured` — no schema change, a missing `WHERE` clause).
- **Bestiary is read-only inside a session**: `/campaigns/:id/session` never renders creature-edit affordances — it links out to `/creature/:id` for reference, doesn't embed the editor.
- Every creature gets a descriptive-image field + placeholder fallback: `monsters` has no image column yet (`REVISION-PLAN.md` §3 flagged the same gap and deferred it) — this plan adds a minimal `art_asset_id`-equivalent (see §1.1) without pulling in the full deferred media/content-addressing rewrite.

### 1.1 Schema additions (additive only)
- `monsters.image_url TEXT` (nullable) — reuses the existing local-disk `/uploads` static-serving convention already used elsewhere in this codebase, not a new storage system. `NULL` → client renders the existing deterministic-initial placeholder pattern.
- No changes to `encounter_maps`/`combat_participants` needed for the route split itself (positioning schema is reused as-is).

### 1.2 `docs/api.md`
Generated/maintained alongside route changes — documents the real endpoint list (method, path, auth requirement, request/response shape), not aspirational routes.

---

## 2. Template vs. instance — uniqueness fix

Current bug (confirmed in `services/monsters.ts`): `is_unique` enforcement is scoped `WHERE campaign_id = $1` and counts instances of any status. Fix:

- Enforcement becomes **system-wide** (drop the `campaign_id` scope from the uniqueness check) and **living-only** (`WHERE status = 'alive'`).
- Clear server-side error (`409 CONFLICT`, machine code `UNIQUE_CREATURE_ALREADY_LIVE`) naming the campaign the existing living instance belongs to.
- **Duplicate-report script** (`packages/server/src/db/scripts/reportUniqueDuplicates.ts`): read-only, lists every `is_unique=true` monster with more than one `status='alive'` instance across the whole system today (pre-migration data may already violate the new rule).
- **Migration**: adds the corrected constraint path (this is enforced in the service layer per this project's existing "app-layer, not declarative" precedent for cross-table invariants — same as `PLAN.md` §3.3 item 4 — not a DB CHECK, since "living" is a status column, not a structural one). Existing violating data is left alone (never silently mutated) and surfaced by the report script; the DM resolves it manually (mark one dead, or unflag `is_unique`).

---

## 3. Board positions readable at a glance 🎲

Consult `dnd-rules` for: creature size → cell footprint table (§3.2).

- **Coordinate labels**: column letters (A, B, C…) + row numbers on both axes of `BattleMap.tsx`'s grid — CSS grid header row/column, computed from `grid_columns`/`grid_rows`.
- **Configurable cell size**: currently 3 presets (Small/Medium/Large); extend `encounter_maps.cell_size_px` to accept a free numeric value (already an `INT` column — this is a UI-only change, a number input replacing the preset buttons), default 5 ft = 1 cell per the brief.
- **Token contents**: `Token.tsx` currently renders portrait-or-placeholder + name tooltip only. Add: HP indicator (compact bar, reusing `HPBar`'s visual language at token scale), condition icons (reusing `EffectBadge`'s icon set, small), faction-colored ring (new `combat_participants.faction` or reuse existing side/role data — see implementation).
- **Size-based footprint**: per dnd-rules output, Tiny→shares a cell, Small/Medium→1 cell, Large→2×2, Huge→3×3, Gargantuan→4×4 (to confirm exact SRD table via the subagent, not assumed here). Token rendering spans `N×N` grid cells instead of always 1×1.
- **Side panel two-way sync**: participant list shows coordinates (`pos_x,pos_y` → letter/number label); hovering/selecting a list row highlights the corresponding token (shared selection state), and vice versa.
- **Current turn**: already has an amber ring (`Token.tsx`) — verify it stays unambiguous once faction-ring color is added (two rings, or turn indicator takes visual priority — a design call, not a rules call).
- **Zoom/pan/center-on-active**: `BattleMap.tsx` today is a plain scrollable `overflow-auto` container. Add CSS-transform-based zoom (scale) + drag-to-pan (pointer events, matching this app's existing native-pointer-event drag pattern used for token placement — no new dependency), and a "center on active" button that scrolls/transforms the viewport to the active participant's token.

---

## 4. Movement with real cost 🎲

Consult `dnd-rules` for: diagonal movement variant, alternate speeds, dash interaction, difficult-terrain stacking, standing from prone, moving through occupied spaces (§4 of the subagent's four-section output, written to `docs/rules/movement.md`).

- **Schema**: `encounter_maps` gains a per-cell terrain layer — `map_cell_overrides` table (`encounter_map_id`, `x`, `y`, `cost_type` enum `normal|difficult|impassable|special`, `special_cost` nullable int), sparse (only non-normal cells stored; missing = normal cost 1).
- **Pathfinding**: server-side Dijkstra/BFS-with-cost over the cell grid (small grids, ≤50×50 per existing `grid_columns`/`grid_rows` cap — a plain weighted BFS is sufficient, no need for A* heuristics at this size) — a new pure function in `services/movement.ts`, unit-testable with no DB/DOM dependency.
- **Reachable-cell highlighting**: client requests reachable set for the selected participant's remaining budget; server computes and returns it (not recomputed client-side from possibly-stale terrain data).
- **Server-side validation**: the token-move endpoint (currently `PATCH .../participants/:pid/position` with zero validation) becomes the enforcement point — computes path cost from current position to target, rejects (`409 INSUFFICIENT_MOVEMENT`) if it exceeds the participant's remaining movement budget for the turn, and decrements the budget transactionally on success. This closes the exact gap the brief calls out ("cannot be exceeded... validate server-side").
- **Client**: highlight reachable cells (from the server-computed set) when a participant is selected; remaining movement shown numerically (already partially exists in `ActionEconomyPanel`, needs wiring to the new terrain-aware budget instead of the flat display-only one).

---

## 5. Action economy 🎲

Consult `dnd-rules` for the newly-added actions' rolls/DCs/limits (§5 of the subagent's output → `docs/rules/actions.md`).

- Extend `ACTION_REGISTRY` (`packages/web/src/encounters/actionEconomy.ts`) with: **climb, swim, search, disengage, ready**. (Standing-from-prone and jump already exist as movement-cost helpers, not registry entries — kept as-is, that's the correct modeling per the existing file's own comment.)
- **Object interaction**: add a fourth tracked resource alongside action/bonus/reaction/movement — one free object interaction per turn, consumed by a small explicit UI action ("Use an object") rather than folded into the free-text action list.
- **DM undo**: the action-economy state (`combat_participants` action-economy columns, per migration `1784269759666`) gets a small server-side history — the simplest correct version is a single "undo last consumption" per participant per turn (matching this project's existing preference for the smallest mechanism that satisfies the requirement, not a full undo stack) — reverts the last slot/movement/object-interaction spend in one transaction.
- All of this stays **client-registry + server-persisted-counters**, the existing architecture (`actionEconomy.ts`'s own header comment explains why: the server only needs to know about the three slots + movement + object interaction, not named-action semantics) — no server rewrite needed, just registry additions and the undo endpoint.

---

## 6. Selectable attacks and damage 🎲

Consult `dnd-rules` for: critical-hit resolution, resistance/vulnerability/immunity stacking order, advantage/disadvantage interaction with criticals (§6 → `docs/rules/attacks-and-damage.md`).

- **Structured attack list**: characters/monsters get a real `attacks` JSONB array (on `characters` and reusing `monsters.actions`' existing structured-action fields added in `PLAN.md` §3.5 — `attackBonus`/`damageDice`/`damageType`/`saveDc` already exist there) rather than the current "equipped weapon shortcut" being the only path. Selecting an attack drives both the attack roll and the damage roll from one definition instead of two independently-triggered buttons.
- **Damage resolution applies resistances/vulnerabilities/immunities**: currently nothing reads `monsters.damage_vulnerabilities/resistances/immunities` at all. New pure function `services/damageResolution.ts` (`computeAppliedDamage(rawDamage, damageType, target)` → halved/doubled/zeroed + a breakdown string) — applied when damage is committed via the existing signed-delta HP endpoint, given the roll's damage type. Advantage/disadvantage already works for the d20 half of an attack roll (existing `dice_rolls.keep`); this extends the same "always show the breakdown" principle to the damage half.
- **Roll breakdown UI**: extend `DiceRoller`/`QuickDiceRoller`'s existing breakdown display to show the resistance/vulnerability adjustment step explicitly (e.g. "8 fire → resisted → 4"), not just the raw dice.

---

## 7. Per-campaign roles

Already correct — confirmed by direct grep audit: `campaign_members.role` resolved per-request in `middleware/campaign.ts`/`services/authz.ts`, zero global role flags anywhere in server or web source. Work here is **verification, not construction**:

- Add the integration test the brief explicitly asks for: a player-role session hitting a known DM-only URL directly (bypassing the UI) gets a clean `403`, across characters/monster-instances/reveals/notes/action-economy-undo endpoints. Extends the existing `encounters.actionEconomyAuthz.integration.test.ts` pattern rather than inventing a new one.

---

## 8. New interface (scoped)

Per §0's reality check: **not a second full redesign**. Scope is exactly the screens that don't exist yet:

- **Entry transition**: new `/` route — app name, short (≤1.5s), skippable (click/keypress advances immediately), `prefers-reduced-motion` shows the static end-state with no animation at all. Redirects to `/login` (unauthenticated) or `/home` (authenticated) after.
- **`/home`**: today's `DashboardPage` content, renamed/moved, unchanged visually (it already reasonably matches "a hub, not a hidden sidebar" — four-panel grid of characters/campaigns/notes).
- **Bestiary split**: `/bestiary` tabbed Basic/Campaign-specific, card grid (image-forward, filter by type/CR, search), built fresh since no bestiary-index route exists today (`MonstersPage` today is campaign-nested only).
- **`/creature/:id`**: full sheet on its own route, reusing the existing `StatBlock` component.
- **`/maps/:encounterMapId`**: full-screen (§1, §3).
- Mockups for exactly these (landing transition, `/bestiary`, `/creature/:id`, `/maps/:encounterMapId`) go under `mockups/` before implementation, per the brief's instruction — not for `/home`, `/campaigns/:id/session`, or anything already shipped in the previous session's redesign.

---

## Sequencing

One phase per commit, `npm run test --workspaces` + `tsc -b --force` (web) / `tsc --noEmit` (server) + `oxlint` (both) after each, matching the verification discipline already established in this repo:

0. ✅ `dnd-rules` subagent (`.claude/agents/dnd-rules.md`) — committed.
1. Route/domain separation (§1) + `docs/api.md`.
2. Template/instance uniqueness fix (§2) + duplicate-report script.
3. Board readability (§3) — consult `dnd-rules` for size→footprint first.
4. Movement cost + pathfinding (§4) — consult `dnd-rules` for movement edge cases first; this is the largest single phase (new schema, pathfinding function, server-side enforcement).
5. Action economy gaps (§5) — consult `dnd-rules` for the five new actions' mechanics first.
6. Attacks & damage (§6) — consult `dnd-rules` for resistance-stacking/crit rules first.
7. Per-campaign role verification tests (§7) — small, can land alongside any of the above.
8. New interface, scoped (§8) — mockups first, then implementation.

Conflicts/scope decisions that override the literal brief are listed in `OPEN_QUESTIONS.md`, per the brief's own instruction.
