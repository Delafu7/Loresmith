# Design tokens — Nocturne (superseded)

> **This document is historical.** It describes "Nocturne," a design pass that has
> since been replaced by **"Field Ledger"** (Bitter + IBM Plex Sans + IBM Plex Mono,
> brass/wax-red palette). The current source of truth is
> `packages/web/src/index.css` (the `@theme` block and the `[data-theme]` /
> `prefers-color-scheme` overrides) and the live `/styleguide` route
> (`packages/web/src/styleguide/StyleguidePage.tsx`), which reads its swatches
> directly from those classes. For the current design-consistency audit, see
> `design-system/Loresmith VTT.md`.
>
> None of the hex values, font names, or component specs below reflect the shipped
> app. Kept only because some still-current decisions (e.g. primary buttons being
> outline/ghost rather than filled, due to a contrast failure) originate in the
> reasoning below and were carried forward unchanged.

Extracted from `design/nocturne.html` (a self-unpacking bundle; the real markup/CSS
lives inside `<script type="__bundler/template">` as an escaped JSON string —
see the extraction note at the bottom of this doc if you need to re-derive it).

The bundle turned out to be two things stacked:

1. **"Nocturne"** — a generic, reusable design-system foundation (tokens +
   component classes: buttons, inputs, cards, tags, nav, tables, dialogs) plus
   a full Phosphor icon font. Comments inside it reference "deck section
   dividers" and "slide grounds" — it's a general presentation/app design
   system, not bespoke to this project.
2. **An actual mockup built on top of it** — a single-page app named
   "Longrest" with a sidebar (Dashboard, Characters, Session Log, Initiative,
   Bestiary, Maps, Homebrew, Calendar) and a floating dice roller, using
   sample data ("The Ashbound Company", "The Sundered Vale") that maps
   directly onto this app's real domain. This is the part that shows how the
   system applies to *our* screens.

Everything below is extracted from both layers combined.

## Colors

All colors are dark-theme only — the source defines no light variant.

| Token (source) | Value | Role |
|---|---|---|
| `--color-bg` | `#161826` | Page background |
| `--color-surface` | `#232532` | Card / panel / dialog background |
| `--color-text` | `#e9e9ed` | Primary text |
| `--color-accent` | `#9184d9` | Primary interactive accent (links, primary button border+text, focus rings, active nav) |
| `--color-accent-2` | `#a7a1db` | Secondary accent — defined but **unused by the actual screens** (only appears in the generic foundation layer); not ported |
| `--color-divider` | `color-mix(in srgb, #e9e9ed 16%, transparent)` | Decorative hairline rules, table row separators |

Tonal ramps (both generated on one shared OKLCH lightness scale, so the same
step of neutral/accent reads as the same "weight"):

| Step | Neutral | Accent |
|---|---|---|
| 100 | `#f3f5fe` | `#f5f4ff` |
| 200 | `#e4e7f5` | `#e7e5fe` |
| 300 | `#cfd3e5` | `#d2cefd` |
| 400 | `#b2b6ca` | `#b5abfc` |
| 500 | `#9397ab` | `#968ae0` |
| 600 | `#75798c` | `#796cbf` |
| 700 | `#595d6c` | `#5d5294` |
| 800 | `#3f424d` | `#423a6a` |
| 900 | `#292b31` | `#2b2741` |

Roles observed in the actual screens: neutral-100 = primary text (same as
`--color-text`), neutral-300/400 = secondary text (card meta, muted labels),
neutral-400/500 = disabled/tertiary text, neutral-800 = card border/elevation
ring and nested-surface hover fill, accent-100/800 = filled badge
text/background pair, accent-300 = kicker/eyebrow labels, accent-400/500 =
link and icon accent, accent-500/600/700 = avatar fill variety.

There is also a `--color-section*` triad (`#262a60`/`#353b80`/`#4c5397`) —
explicitly scoped in the source's own comments to "deck-scale fills only, not
interface colors" (slide section dividers in the generic foundation layer).
**Not ported** — this app has nothing analogous to a slide deck.

### How this maps onto the app's existing token system

The app already runs a "recolor Tailwind's own color variables" system
(`packages/web/src/index.css`) — every component uses plain `amber-*`/`stone-*`
Tailwind utilities, and the actual hex values behind those two palette names
are swapped per `data-theme`. Three themes exist today: `ember` (default),
`crimson`, `amber`, keyed to the `users.ui_theme` DB enum
(`'crimson' | 'amber' | 'ember'`, `packages/server/src/schemas/auth.ts`).

Rather than inventing a second, parallel token system, Nocturne is encoded as
**new hex values for the existing `ember` slot** (`:root` / `:root[data-theme="ember"]`
in `index.css`) — every `bg-stone-950`/`text-amber-500`/etc. class already in
the app repaints automatically, with zero component edits required for the
color layer. `crimson` and `amber` are untouched (existing, previously-reviewed
alternates a user can still select).

**Deliberate scope decision, flagged for review — see `OPEN_QUESTIONS.md`
item 10**: this reuses the `ember` *key* (so the `uiTheme` DB enum doesn't
need a migration, honoring "no data-model changes this pass"), but the
`ember` theme now visually renders Nocturne's dark indigo/violet palette, not
the old warm ember-orange/parchment look. A user who explicitly picked
"Ember" (the default, so most users) will see the palette change. Renaming
the enum value or adding a fourth theme is a real, separable follow-up if
that behavior change is unwanted.

Mapping used (existing Tailwind slot → Nocturne source token), chosen to
preserve the app's existing lightness ordering (`stone-950` = darkest = page
bg, `stone-100` = lightest = primary text) and verified against WCAG AA below:

| Tailwind slot | Nocturne source | Hex |
|---|---|---|
| `stone-950` | `--color-bg` | `#161826` |
| `stone-900` | `--color-surface` | `#232532` |
| `stone-800` | `neutral-800` | `#3f424d` |
| `stone-700` | `neutral-700` | `#595d6c` |
| `stone-600` | `neutral-600` | `#75798c` |
| `stone-500` | `neutral-500` | `#9397ab` |
| `stone-400` | `neutral-400` | `#b2b6ca` |
| `stone-300` | `neutral-300` | `#cfd3e5` |
| `stone-200` | `neutral-200` | `#e4e7f5` |
| `stone-100` | `neutral-100` / `--color-text` | `#f3f5fe` |
| `amber-950` | `accent-900` (closest available; source has no 950 step) | `#2b2741` |
| `amber-700` | `accent-700` | `#5d5294` |
| `amber-600` | `accent-600` | `#796cbf` |
| `amber-500` | `accent-500` (≈ flat `--color-accent` #9184d9) | `#968ae0` |
| `amber-400` | `accent-400` | `#b5abfc` |

### Contrast findings (WCAG AA)

Computed against the two real backgrounds the app actually paints
(`stone-950` page bg, `stone-900` card bg):

| Pairing | Ratio | Verdict |
|---|---|---|
| `text-stone-100` on `stone-950` / `stone-900` | 16.2:1 / 14.0:1 | Pass (AAA) |
| `text-stone-500` on `stone-950` / `stone-900` | 6.1:1 / 5.3:1 | Pass AA |
| `text-stone-400` on `stone-900` | 7.6:1 | Pass AA |
| `amber-500` (accent) text/link on `stone-950` / `stone-900` | 5.9:1 / 5.1:1 | Pass AA |
| `amber-400` text on `stone-950` | 8.6:1 | Pass AA |
| **`amber-600` as a filled button background, with either `stone-950` or `stone-100` text on top** | **3.95:1 / 4.10:1** | **Fails AA normal text (4.5:1)** |
| `stone-500` border against `stone-950` / `stone-900` (non-text, 3:1) | 6.1:1 / 5.3:1 | Pass |
| `stone-600` border against `stone-950` / `stone-900` | 4.1:1 / 3.5:1 | Pass (surface case is marginal) |
| `stone-700` border against `stone-900` | 2.3:1 | **Below 3:1 — decorative use only** |
| filled tag: `accent-100` text on `accent-800` bg | 9.4:1 | Pass AA |
| filled tag: `neutral-100` text on `neutral-800` bg | 9.2:1 | Pass AA |

**This is why the button redesign in Phase 2 changes shape, not just color.**
The app's current primary button is a *filled* `bg-amber-600` chip with dark
`text-stone-950` on top — that pattern fails AA once amber-600 becomes a
medium-lightness purple instead of a bright ember orange. The source design's
own `.btn-primary` is actually **outline/ghost**, not filled — `background:
transparent; border-color: var(--color-accent); color: var(--color-accent)`
— which is exactly the accessible option (5.9–5.1:1). The shared `Button`
component adopts the source's real pattern rather than force-fitting the old
filled shape onto new colors. Filled accent backgrounds remain fine and are
kept for *non-text* or already-AA-checked uses: HP bar fills, active-tab
backgrounds, filled badges (dark-800 bg + light-100 text, per the ramp table
above), avatar fills.

## Type

- **Family**: Inter for everything — body and headings both (`--font-heading:
  "Inter"; --font-body: "Inter"`). No second display serif. **The app
  currently pairs Inter (body) with Fraunces (headings,
  `REVISION-PLAN.md` §10.3)** — the source design doesn't use a serif at all.
  Decision: kept Fraunces for `h1`–`h3` (a deliberate, previously-reviewed
  choice for this app's tone) rather than deleting it to match the source
  exactly, since the brief calls this presentation-only and dropping an
  already-shipped, reviewed type choice isn't required to honor Nocturne's
  *system* (spacing/color/component shape) — flagged in `OPEN_QUESTIONS.md`
  item 11 in case full Inter-only was actually wanted.
- **Heading weight**: 500 (medium) — not bold. Every `h1`–`h6` in the source
  uses `font-weight: 500`.
- **Base body**: 15px / line-height 1.55 / weight 400. (The app's existing
  Tailwind base is 16px — kept; see Phase 3 mobile rule that body text must
  never go below 16px, which supersedes the source's 15px baseline on purpose.)
- **Scale** (source, desktop):

  | Element | Size | Line-height | Letter-spacing |
  |---|---|---|---|
  | h1 | 42px | 1.12 | -0.015em |
  | h2 | 32px | 1.12 | -0.015em |
  | h3 | 25px | 1.12 | -0.015em |
  | h4 | 20px | 1.12 | -0.015em |
  | h5 | 16px | 1.12 | -0.015em |
  | h6 | 13px | 1.12 | -0.015em, +0.08em transform (uppercase) |
  | body | 15px | 1.55 | — |
  | figcaption / micro | 11px | — | — |

  In the actual screens, headings are set inline rather than via the `h1`–`h6`
  scale above (every screen title is a hand-set `<h1 style="font-size:26px;
  font-weight:500">`, dashboard welcome is 30px) — so the *effective* in-app
  heading sizes used are 26px (screen titles) and 30px (dashboard hero), not
  the full 42/32/25/20/16/13 ramp. Both are documented; screen titles use 26px.
- This app's existing Tailwind scale (`text-xs`12/`sm`14/`base`16/`xl`20)
  already matches the source's small end closely enough to leave alone (see
  existing comment in `index.css`); only the heading sizes above are new.

## Spacing, radius, borders, shadows

- **Spacing scale**: `--space-1..8` = 2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4px
  (a 2.8px base unit; steps 5 and 7 are skipped in the source). This is
  unusually fine-grained relative to Tailwind's default 4px-based spacing
  scale. Decision: **not ported as a separate scale** — the app already uses
  Tailwind's spacing utilities (`p-4`, `gap-2`, etc.) everywhere, and running
  two spacing systems side by side would violate "don't introduce a second
  styling system." Component padding/gaps in the new shared components are
  chosen from Tailwind's existing scale at the closest visual match instead
  (e.g. source's `--space-3` ≈ 8.4px ≈ Tailwind's `2` (8px) for tight
  padding, `--space-4` ≈ 11.2px ≈ Tailwind's `3` (12px) for card padding).
- **Radius**: `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 14px`.
  Ported as overrides of Tailwind's own `--radius-md`/`--radius-lg` theme
  variables (in `@theme`), so the app's existing 177 `rounded-md` and 55
  `rounded-lg` usages pick up the new corner radii automatically — same
  zero-touch approach as the color remap. `--radius-sm` (4px) already equals
  Tailwind's default `rounded` / `rounded-sm`, no override needed.
- **Borders**: the source uses hairline 1px borders everywhere (buttons,
  inputs, cards-via-shadow-ring). No separate border-width scale.
- **Shadows / elevation**:
  - `--shadow-sm: 0 0 0 1px #3f424d` (hairline ring only — this is how the
    source draws card borders; `.card` itself has no `border` property)
  - `--shadow-md: 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)`
  - `--shadow-lg: 0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65)`
  
  Ported as overrides of Tailwind's `--shadow-sm/md/lg` theme variables — any
  future `shadow-md` class gets the Nocturne glow for free. No "glow" effect
  beyond these ambient-dark box-shadows; no colored/accent glows in the
  source.
- **Rules/dividers**: a signature detail — freestanding `<hr>`-equivalents
  fade to transparent at both ends (48px ramp) rather than terminating in a
  hard line (`.hr` class, and the same technique reused for table row rules).
  Box outlines and short accent marks stay solid. Ported as a `.hr` utility
  class + the same technique in the shared `Table` component.

## Motion

The source defines almost no motion: **one** documented transition, on the
sidebar nav item's background/color on click/hover (`transition: background
.15s`, default easing, no easing token defined). No keyframes, no page
transitions, no scroll animation anywhere in the bundle (this is a static
mockup, not an interactive prototype beyond the tab-switching).

Decision: treat Nocturne's motion character as "quick and utilitarian" —
~150ms, default ease, on color/background/opacity changes only. This app
already has a documented entry transition and `TurnTorch` animation
(`REVISION-PLAN.md` §10) that are more elaborate than anything in the source;
those are kept as-is (they're existing, reviewed, and the brief is
presentation-only — not asked to strip motion the source is simply silent
about), but any *new* motion introduced by this pass (hover states, panel
open/close, bottom-sheet slide-in) targets ~150–200ms ease to match the
source's implied register rather than inventing something slower/flashier.
`prefers-reduced-motion` is already handled globally in `index.css`
(instant cuts) — unchanged, still applies to everything above.

## Component patterns

Patterns below are the ones that repeat across the source; each maps to one
shared component under `packages/web/src/components/ui/`.

### Buttons
- **Primary** (`.btn-primary`): transparent bg, 1px solid border in accent,
  accent text. Hover: 12%-opacity accent tint fill. Active: 22%. See
  contrast note above for why this is filled-*text*, not filled-*bg*.
- **Secondary** (`.btn-secondary`): transparent bg, 1px solid divider
  border, primary text. Hover/active: 7%/14%-opacity text-colored tint.
- **Ghost** (`.btn-ghost`): no border, accent text, tighter horizontal
  padding — used for inline "→" links (Read full log →, Open calendar →).
- **Icon** (`.btn-icon`): 36×36px, no padding, square-ish — used for
  modal-close, HP +/- steppers.
- **Block** (`.btn-block`): `width: 100%`, extra top margin — form submits.
- **Disabled**: `opacity: 0.45`, `cursor: not-allowed` — this single rule
  covers every variant (source-defined, not invented).
- All buttons: `border-radius: var(--radius-md)`, 14px text, heading-family
  (Inter medium), `display: inline-flex` with icon gap.

### Inputs
- `.input`: `min-height: 36px`, `background: var(--color-surface)`,
  1px solid divider border (soft/decorative at rest — see contrast note),
  `border-color` strengthens on hover (45%-opacity text tint) and switches to
  solid accent on `:focus-visible`. Label above, 12px, 70%-opacity text.
- Radio (`.radio`): custom 16px dot, accent fill + `inset 0 0 0 4px bg` ring
  when checked — a "punched-out" look rather than a solid dot.
- Segmented control (`.seg`): pill of options, `:has(input:checked)`
  gets an inset accent ring + accent text — no JS needed, pure `:has()`.
- **Not in source, invented for Phase 2** (flagged for review): validation
  error state (red-adjacent border + helper text — the source has no error
  color at all, so this borrows a desaturated red at the same lightness step
  as `neutral-600`/`700` to stay in-family rather than introducing an
  unrelated hue), and a loading-skeleton shimmer for async form fields.

### Cards
- `.card`: `background: var(--color-surface)`, `border-radius:
  var(--radius-md)`, `padding: var(--space-3)` (≈ Tailwind `p-3`/`p-4`), flex
  column, no border — elevation via `.elev-sm/md/lg` shadow-ring instead.
- `.card-kicker`: 10px uppercase accent eyebrow label.
- `.card-title`: 17px, heading family/weight.
- `.card-body`: 13px, 80%-opacity.
- `.card-meta`: 11px, 50%-opacity, icon-friendly flex row.
- Real screens nest interactive cards (`cursor: pointer` + `sc-camel-on-click`)
  for the character roster and bestiary grid — same `.card` class, just
  clickable.

### Badges / tags
- `.tag`: 11px, pill-ish (`radius-md * 0.75`), four variants — `tag-accent`
  (filled dark-800/light-100, see contrast table), `tag-accent-2` (unused,
  see Colors section), `tag-neutral` (filled dark/light neutral pair),
  `tag-outline` (1px accent border, accent text, transparent bg — same
  outline logic as the primary button).

### Navigation
- Two nav patterns in the source: a horizontal top `.nav` (brand left,
  links right, active link = accent text) used generically, and the actual
  app screens use a **236px fixed left sidebar** instead — icon + label
  rows, active item gets a filled `neutral-800` background chip with a 2px
  accent left border, inactive items are transparent with muted text. A
  "next session" callout card is pinned to the sidebar bottom via
  `margin-top: auto`. The sidebar pattern (not the generic top-nav) is what
  the real screens use and what the migration follows.

### Tables
- `.table`: 14px, uppercase 11px muted column headers, no header underline —
  instead each `<tr>` paints its own bottom rule as a **background-image**
  gradient (the fade-at-both-ends technique from Rules, above) rather than a
  `border-bottom`, so hover can layer a second background without fighting
  the rule. Hover = 4%-opacity text-tint full-row wash, rule stays visible
  underneath.

### Dialog / modal
- `.dialog-backdrop`: fixed inset, centered, 50%-opacity dark scrim
  (`neutral-900`).
- `.dialog`: `width: min(440px, 100%)`, `radius-lg`, `shadow-lg`,
  surface bg. Real screens use a wider variant for the character sheet
  modal (640px, `max-height: 82vh`, internal scroll) — both sizes are
  supported by the shared `Modal` component via a `size` prop.
- Actions row: right-aligned, secondary button first, primary last (only
  "Close" shown in the source's one dialog example — no destructive-action
  example to crib a danger-button color from; invented as a desaturated red
  at the neutral-600/700 lightness step, same choice as the input error
  state, for consistency).

### Panels (map/side-panel composition)
- The Maps screen is a 2-column `grid-template-columns: 2fr 1fr` — map card
  (aspect-ratio 4/3, dot/line grid background, absolutely-positioned round
  tokens) beside a `.card` roster list. This 2-column shape is the desktop
  layout target for the full-screen map view; Phase 3 collapses it to
  full-bleed-map + bottom-sheet on narrow screens (no source guidance for
  mobile — the source has no responsive behavior defined anywhere; every
  screen is fixed desktop-width).

## States invented beyond the source (flagged for review)

The source is a desktop-only, happy-path mockup. Everything below was
designed to match its visual language but has **no source reference** —
review these specifically:

1. **Disabled states** beyond buttons (source only defines button disabled;
   disabled inputs, disabled nav items, disabled tags are new — same
   `opacity: 0.45` rule, extended).
2. **Form validation / error state** — desaturated red at the neutral
   ramp's lightness step (see Inputs above).
3. **Empty states** — no source example. Uses `card-body`-style muted text
   + an outline-button call to action, centered, in a `.card` shell.
4. **Loading skeletons** — pulsing `neutral-800` blocks at the shape of the
   content they replace (card skeleton, table-row skeleton, list-row
   skeleton), `150ms` fade-in when real content arrives, respects
   `prefers-reduced-motion` (no pulse, static block instead).
5. **Long-text overflow** — card/table cells get `text-overflow: ellipsis`
   with a `title` attribute fallback; the source's sample copy is all
   short enough that this was never exercised.
6. **Focus rings** — the source has one line, `:focus-visible { outline: 2px
   solid var(--color-accent); outline-offset: 2px }`, applied to `.input`
   only in the CSS as written; the app's existing global `:focus-visible`
   rule (already in `index.css`, applies to every button/link/tabindex
   element) already matches this exactly, and is kept unchanged.

## Extraction note

`design/nocturne.html` is a self-unpacking "bundler" page: at load time it
reconstructs the real document from a `<script type="__bundler/manifest">`
(asset blobs, keyed by UUID) and a `<script type="__bundler/template">`
(the actual HTML/CSS as an escaped JSON string) via a runtime loader script.
Reading the file directly on disk mostly shows the loader, not the design —
the template was extracted with a short Python script (parse the two
`<script>` JSON blobs, write the template string to a plain `.html` file)
before it could be read normally. No design content was guessed or
hallucinated; every value above traces to a literal token in that extracted
template.
