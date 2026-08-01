# Design Audit — `design/` mockups vs. current implementation

Source mockups: `design/nocturne.html` (design-system + full campaign-hub shell, 8 screens)
and `design/map.html` (dedicated fullscreen map/battle view). Both are Claude-Design
"bundled page" exports — self-executing artifacts, not raw HTML. Their real markup was
extracted by decoding the embedded `__bundler/template` JSON string (base64/gzip inside
the file); nothing here was guessed from the compiled bundle wrapper.

---

## Phase 1 — Design inventory

### 1a. `nocturne.html` — the shell

A persistent **left sidebar**, fixed at 236px, always visible:

- Brand block: shield icon + "Longrest" + "Campaign Hub" subtitle
- Nav list, in this exact order: **Dashboard · Characters · Session Log · Initiative ·
  Bestiary · Maps · Homebrew · Calendar** (8 items, flat list, no grouping, no DM/player
  variants shown)
- Pinned to the bottom of the sidebar: a **"Next Session" card** — date/time + session
  title only. Not a link into a workspace; a read-only announcement.

Plus one piece of chrome that floats **outside** the sidebar/main split, persistent
across all 8 screens: a **circular dice-roller FAB**, bottom-right, expands upward into
a small popover (d4–d100 face picker, roll button, big result readout, last-5 history).

Main content area swaps between 8 screens on nav click (client-side state, no distinct
URLs shown in the mockup — routing scheme not specified):

| Screen | What it shows |
|---|---|
| Dashboard | Party card grid (4 characters, HP/AC bar) + "Latest chronicle" card + "World calendar" preview card (3 upcoming events) |
| Characters | Card grid of the party; click opens a modal with full ability scores, HP/AC/Speed, blurb, equipment tags |
| Session Log | Vertical timeline of past sessions (date, title, prose summary) |
| Initiative | Full turn-order tracker: cards with initiative badge, name, PC/condition tags, HP bar, **+/− HP buttons**, "Next Turn" button top-right |
| Bestiary | Card grid: name, CR tag, type, HP/AC, notes |
| Maps | 2-column: a *small* map preview (colored dot tokens over a grid background, no fog/battle logic) + a plain "on the grid" name list beside it |
| Homebrew | Card grid: category tag, title, author, summary |
| Calendar | Flat list of dated events with a type tag |

### 1b. `map.html` — the dedicated map view

**No persistent app nav/sidebar at all** — this file renders standalone: a thin top
strip (location breadcrumb text, "Map" title, and a 2-way **Exploration / Battle**
segmented toggle) directly above a full-height 2-pane layout (`1fr` canvas + fixed
`280px` sidebar). Nothing else wraps it.

- **Exploration mode**: SVG map with a fog-of-war mask (radial reveal circles around
  discovered points), hand-drawn terrain shapes, clickable POI pins, one party-position
  dot with a pulse ring, caption "Fog of war — revealed as the party explores". Right
  sidebar: a "Points of interest" list (undiscovered ones dimmed) + a one-line "Party"
  status ("Approaching the Sundered Bridge").
- **Battle mode**: SVG grid map (50px cells), shaded terrain cells, circular tokens
  with HP bars and a pulsing ring on the active combatant, caption "5 ft grid —
  difficult terrain shaded, drag tokens to move". Right sidebar: a **read-only** "Turn
  order" list (name + HP bar only, no HP edit controls) + a single "Next Turn" button.

Nothing else appears: no DM/player distinction, no minimize control, no
encounter/session switcher, no "Start/End Combat" or "roll initiative" actions (mode is
just a toggle — implies combatants and initiative already exist), no action-economy
panel, no attack roller, no combat log, no participant detail overlay, no add/remove
participant UI.

### 1c. Design tokens / component vocabulary (from `nocturne.html`'s `<helmet><style>`)

- Dark theme only: `--color-bg:#161826`, `--color-surface:#232532`, accent
  `--color-accent:#9184d9` (blurple) with a full neutral/accent OKLCH tonal ramp
  (100–900), a separate `--color-accent-2` ramp, and deck-only `--color-section*` tokens.
- Type: Inter (variable weights 400–700) for body, same family at weight 500 for
  headings; `h1` 42px down to `h6` 13px uppercase.
- Spacing scale `--space-1..8` (2.8px→22.4px), radii `--radius-sm/md/lg` (4/8/14px),
  three elevation shadow tiers.
- Component classes: `.btn` (`-primary`/`-secondary`/`-ghost`/`-icon`), `.input`,
  `.radio`, `.seg`/`.seg-opt` (segmented control — this is exactly what drives
  map.html's Exploration/Battle toggle), `.card` (+ `-kicker`/`-title`/`-body`/`-meta`),
  `.tag` (`-accent`/`-accent-2`/`-neutral`/`-outline`), `.nav`, `.table`,
  `.dialog`/`-backdrop`. Rules (`.hr`, table row separators) fade to transparent at
  both ends — called out in the CSS comments as "a Nocturne signature."
- Icons: Phosphor icon font (`.ph`, `.ph-fill`).

### 1d. Navigation graph

```
nocturne.html shell (persistent sidebar):
  Dashboard ⇄ Characters ⇄ Session Log ⇄ Initiative ⇄ Bestiary ⇄ Maps ⇄ Homebrew ⇄ Calendar
  (flat, single click, no sub-navigation shown; "Next Session" card is NOT a nav
  target — it has no onClick in the mockup's own component logic)

map.html (standalone, no route/entry point shown into or out of it):
  Exploration ⇄ Battle   (client-side toggle, same view, no navigation)
```

The mockups never show how you arrive at `map.html` from the shell, or where its
"back" affordance is — see Open Questions.

---

## Phase 2 — Audit vs. current implementation

Current app inventory (from `App.tsx` / `CampaignShell.tsx` / `AppLayout.tsx`):
outer `AppLayout` (sticky header, breadcrumbs, user menu — no nav links) wraps
`/home`, `/profile`, `/campaigns`, `/bestiary/*`, `/creature/:id`, `/notes`, and a
second nested shell `CampaignShell` (left sidebar) under `/campaigns/:id/*` with 10
nav items: **Characters · Bestiary · Items · Session · Session Log · Notes · Dice
Rolls · Assets · Catalog · Members**. A separate chromeless route,
`/campaigns/:id/live/:encounterId` → `LiveMapPage`, already exists outside both shells.

### Design element → status

| Design element | Status | Notes |
|---|---|---|
| Chromeless fullscreen map route, own thin top strip | **Implemented** | `LiveMapPage.tsx` already matches this structural pattern (outside `AppLayout`/`CampaignShell`, own top strip) |
| Exploration ⇄ Battle 2-way toggle | Partially implemented | Current model has `status` (preparing/active/paused/completed) **and** `mode` (exploration/combat) — two axes where the mockup shows one. The mode toggle itself (`setEncounterMode`) exists and is exposed via buttons, but not as the mockup's `.seg` two-option control, and it's bundled inside a much larger DM panel, not a lightweight top-strip toggle |
| Auto-route into fullscreen map when a session/combat goes active | **Implemented** | `useLiveMapAutoOpen.ts`, mounted campaign-wide, already does exactly this |
| Fog-of-war exploration rendering (SVG reveal circles, POI pins) | Missing | No fog-of-war/POI system exists anywhere in the codebase — exploration mode today reuses the same grid `BattleMap.tsx` component with free movement, not a distinct POI/fog view |
| Right-sidebar "Points of interest" list (exploration) | Missing | No POI concept in the data model or UI |
| Right-sidebar read-only "Turn order" list + single "Next Turn" button (battle) | Partially implemented | `InitiativeStrip.tsx` shows turn order, but as a horizontal strip pinned *above* the map, not a 280px right sidebar; it's interactive (click to open a participant), not read-only; "Next Turn"/advance-turn exists but lives in `BattleModeDmPanel.tsx`, not as a standalone button in that sidebar |
| "Next Session" read-only announcement card in the nav shell | Missing | No such card exists in `CampaignShell`'s sidebar or anywhere else |
| "Session" as a full nav-linked multi-encounter tabbed workspace | **Resolved** | `EncountersPage.tsx` reduced to a list + single-selection prep view (no more open-tabs strip, no more concurrently-mounted `CombatTracker`s). Traded off: a DM can no longer prep two encounters side-by-side in open tabs — flagged and accepted in the approved plan, since `useLiveMapAutoOpen` already routes everyone to the fullscreen map once an encounter goes active anyway |
| "Session Log" nav item → timeline of past session recaps | **Implemented, matches well** | `SessionLogPage.tsx` (route `session-log`) is structurally very close to nocturne's Session Log screen |
| Campaign-scoped "Dashboard" screen (party grid + latest chronicle + calendar preview) | **Resolved (partial)** | New `CampaignDashboardPage.tsx` is now the campaign index/default landing (party grid + next-session card + latest-chronicle card). Calendar preview card intentionally omitted — no calendar feature/data model exists; still tracked as out-of-scope net-new work below |
| "Initiative" as a single embedded-in-shell tracker screen (HP +/− editing) | Missing as designed | The closest current analog is `BattleModeDmPanel.tsx`'s HP controls, but that only exists nested inside the fullscreen live map/prep workspace, not as its own shell nav screen |
| "Maps" as a lightweight preview screen (small map + name list) | Missing | No such screen exists; the only "map" surface is the full interactive `BattleMap.tsx` |
| "Homebrew" as one card-grid screen | Deviates from design | Current app spreads homebrew across `CatalogEditorPage.tsx` (11 entity types), `BestiaryCampaignPage.tsx`, and item creation in `ItemRepositoryPage.tsx` — functionally richer, structurally different |
| "Calendar" screen | Missing | No calendar feature exists anywhere in the codebase |
| Persistent global dice-roller FAB | Missing | `DiceRoller.tsx`/`QuickDiceRoller.tsx` exist but are only mounted inline inside specific panels (inventory, skills, saves, combat panels), never as a shell-level floating widget |
| Design tokens (dark palette, Inter, `.btn`/`.card`/`.tag`/`.seg` vocabulary, fading-rule signature) | Not audited here | Would require a full pass over `packages/web/src/index.css`/Tailwind config against the mockup's token values — out of scope for this pass, flagged for a follow-up if visual restyling is in scope |

### Invented concepts (present in code, no mockup counterpart)

Listed with file(s) and how deeply coupled each is, most-coupled first:

1. **The entire in-combat DM/player control apparatus** —
   `SessionOverlayPanel.tsx`, `BattleModeDmPanel.tsx`, `BattleModePlayerPanel.tsx`,
   `ActionEconomyPanel.tsx`, `AttackRoller.tsx`, `CombatLogPanel.tsx`,
   `ParticipantSheetPanel.tsx`. Deeply coupled: these are the majority of
   `encounters/`'s ~20 files and implement real D&D 5e mechanics (action economy,
   contested rolls, damage/resistance math, condition tracking) that a static HTML
   mockup would never attempt to render in detail. **This is very likely necessary
   product functionality the mockup simply abstracted away**, not accidental scope
   creep — flagged for a decision, not for deletion (see Open Questions).
2. **`EncountersPage.tsx`'s tabbed multi-encounter workspace** (route `session`,
   open-tabs strip, per-tab `CombatTracker`) — moderately coupled: it's the current
   entry point for the "Session" nav item and for pre-combat roster building
   (add participants before combat starts). This is the concrete "sessions
   over-engineered" the user flagged: the mockup's sidebar has no session workspace,
   only a passive announcement card plus (once active) the fullscreen map.
3. **Encounter minimize / force-fullscreen / cross-session switcher** —
   `liveMapState.ts`, the "Minimize" button and encounter-switcher `<select>` in
   `LiveMapPage.tsx`, the `force-fullscreen` server route. No mockup counterpart
   (map.html shows no exit affordance or session switcher at all). Loosely coupled —
   additive UI on top of the route, easy to keep or trim independently of the rest.
4. **`status`/`mode` two-axis state machine** (`preparing → active → paused/completed`
   × `exploration ↔ combat`) vs. the mockup's single Exploration/Battle toggle.
   Deeply coupled — this is the server's core encounter state model
   (`services/encounters.ts`), touched by nearly every combat route.
5. **Nav items with no mockup counterpart**: Items, Notes, Dice Rolls, Assets,
   Catalog, Members. These read as legitimate campaign-management/admin screens a
   product needs that a two-mockup design pass simply didn't get around to
   illustrating, not misreadings of something the mockups do show. Lightly coupled to
   the map/session question — flagged for completeness, not urgent.

### Prioritized remediation plan (ordered by architectural impact)

1. **Decide the shell/nav question first** (blocks everything else — see Open
   Questions #1). The mockups show two different, seemingly-incompatible shapes for
   "how you get to the map": a full persistent 8-item sidebar shell (nocturne) vs. a
   route with zero shared chrome (map.html). Current code already has both patterns
   built (`CampaignShell` sidebar, `LiveMapPage` chromeless route) but the *nav
   sidebar itself* doesn't match nocturne's 8 items, and there's no default-landing
   rule that sends a player to the map first.
2. **Reduce `EncountersPage.tsx`** to match the mockup's "announce + route" model:
   replace the tabbed workspace with something closer to a "Next Session" card (or a
   minimal upcoming-encounters list) that hands off to `LiveMapPage` the moment an
   encounter goes active, rather than being a workspace itself. This is the change
   with the clearest mandate (explicitly confirmed by the user) and the least
   architectural risk, since `useLiveMapAutoOpen` + `LiveMapPage` already handle the
   "route to map on activation" half.
3. **Make the map the default landing view inside a campaign**, once #1 resolves
   what "default" means (campaign index route? every page redirects if a live
   encounter exists? something else?).
4. **Reconcile Exploration/Battle mode presentation** with the mockup's lightweight
   `.seg` toggle and read-only battle sidebar, without breaking the
   `status`/`mode` two-axis server model underneath (the model itself is sound and
   doesn't need to change — only its surface).
5. **Everything else** (fog-of-war/POI system, campaign-scoped Dashboard, Calendar,
   standalone Initiative/Maps/Homebrew shell screens, global dice FAB, visual token
   pass) — genuinely new/missing features or cosmetic work, not drift to fix. Lowest
   priority unless the user confirms they want net-new scope built.

---

## Open Questions — resolved

All five were put to the user directly; answers below now drive the implementation
plan (see plan file / next steps).

1. **Nav shell relationship** → `map.html` replaces the shell during live play; it's
   what `LiveMapPage.tsx` already does. `nocturne.html`'s persistent sidebar is the
   normal browsing shell. **Action**: rebuild `CampaignShell`'s sidebar to nocturne's
   8 items (Dashboard/Characters/Session Log/Initiative/Bestiary/Maps/Homebrew/
   Calendar), replacing the current 10-item list.
2. **Default landing with no active encounter** → nocturne's campaign-scoped
   Dashboard (party grid + latest chronicle + calendar preview + "Next Session"
   card). **Action**: this screen doesn't exist yet and needs to be built; it becomes
   the campaign index redirect target instead of `characters`.
3. **In-combat DM/player control apparatus** (action economy, attack roller, combat
   log, participant sheet) → keep as-is, reachable via overlay/drawer over the
   fullscreen map, close to today's `SessionOverlayPanel` wiring. **Action**: no
   rework needed here beyond whatever the shell/nav change requires structurally.
4. **Roster prep** (adding participants before combat) → keep close to where it is
   today, as its own lightweight step separate from the fullscreen map. **Action**:
   minimal change — reduced session-announcement UI still needs *some* prep entry
   point, just not the current full tabbed workspace.
5. **Minimize / force-fullscreen / switch-session** → keep; no mockup counterpart,
   but useful additive UX that doesn't conflict with the design. **Action**: none.

**Nothing has been changed in code yet.** Next: turn the confirmed remediation plan
into a phased implementation plan (routing/nav rework, new campaign Dashboard,
reduced session-announcement surface, EncountersPage prep-workflow split) and get it
approved before touching code, per the same plan-mode workflow used for prior
features in this project.
