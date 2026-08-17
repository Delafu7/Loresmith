# Loresmith VTT — Design Consistency Audit

**Scope of this pass**: does the app's ~35 screens actually use the already-locked
**"Field Ledger"** design system (`packages/web/src/index.css`), or has usage drifted from
it? This is explicitly *not* a new palette/type proposal — Field Ledger is final. Where
`DESIGN_AUDIT.md` (repo root) already covers a screen, that was for **information
architecture** (nav shape, routes, missing/invented screens vs. the `nocturne.html` /
`map.html` mockups) — it explicitly marked the *visual token* pass "out of scope,
flagged for a follow-up" (its line 128). This document is that follow-up.

**Screens covered**: all ~35 routes in `App.tsx`. `DESIGN_AUDIT.md` structurally covered
Dashboard, Characters, Session Log, Initiative/Bestiary/Maps/Homebrew/Calendar (as
concepts, not files) and the live map view — this pass re-examines those plus the ~25
screens it didn't touch: Landing, Login/Register, Profile, Campaign List/Members/Settings,
Character Sheet + Creation Wizard, Monsters/Creature Editor, Items (global + campaign),
Compendium (editor + items), Notes/Plot Threads/Locations-Factions/Calendar, Bastions
(+ detail), Dice Roll History, Assets, Catalog Editor, Races/Classes, Reference,
Styleguide, About, and the full `encounters/` combat apparatus (~20 files).

**Bottom line**: Field Ledger's core mechanism — recoloring the actual Tailwind CSS
variables behind `stone-*`/`amber-*`/`red-*`/`emerald-*`/`yellow-*`/`orange-*`/`sky-*`
utility classes per `data-theme` (see `index.css` lines 42–155) — means the overwhelming
majority of the app inherits the palette automatically with **zero per-component drift
possible** by construction. That's unusual and worth stating plainly: this audit did not
find widespread inconsistency. What it found is a **narrow, well-defined set of
components that bypass that mechanism** (raw hex, or Tailwind color families the
mechanism doesn't cover), plus **two reference documents that no longer describe the
system they document**.

---

## 1. Audit table

| Issue | Severity | File(s) |
|---|---|---|
| `docs/design-tokens.md` describes the superseded "Nocturne" system (Inter/Fraunces, indigo/violet `--color-accent`) — not the shipped Field Ledger tokens (Bitter/Plex Sans/Plex Mono, brass/wax-red). A reader following this doc today gets the wrong font names, wrong hex values, and a stale rationale for why buttons are outline-not-filled. | **High** | `docs/design-tokens.md` (369 lines, entirely stale) |
| `StyleguidePage.tsx`'s own prose still says "Nocturne design system reference," "Fraunces for h1-h3... Inter for everything else," and links `docs/design-tokens.md` as "the full write-up." The rendered swatches/type samples are correct (they read live classes off `index.css`), but the *words on the page* misdescribe them. This is the one page whose entire purpose is to be the source of truth. | **High** | `packages/web/src/styleguide/StyleguidePage.tsx:1-6, 189, 214` |
| Six raw hex literals bypass the theme-override mechanism entirely — won't repaint for Crimson/Amber themes or light mode, unlike everything else in the app. | **Medium** | `encounters/vision/VisionOverlay.tsx:181,188` (`#555555`, `#0c0a09`); `encounters/elements/ElementPropertyPanel.tsx:66` (`#888888` placeholder, low-risk); `encounters/elements/registry.tsx:180,221,246` (`#fbbf24`, `#a855f7`, `#fbbf24`) |
| An undocumented "arcane/spell" semantic color (`violet-*`/`indigo-*`/`purple-*`) is used across ~13 files for spellcasting, magical effects, lair actions, and door-trap indicators — never added to `index.css`'s theme-override block the way `red`/`emerald`/`yellow`/`orange`/`sky` were. It renders fine in the default Ember theme (stock Tailwind violet happens to read as intended against Field Ledger's brown/stone backdrop) but silently fails to repaint under Crimson or Amber, and was never contrast-checked for light mode the way every other pairing in `index.css` explicitly was (see its own comment at lines 91-99). | **Medium** | `characters/CharacterSheetPage.tsx` (5 occurrences), `characters/CharactersListPage.tsx` (2), `characters/InventoryPanel.tsx` (2), `components/EffectBadge.tsx` (5), `encounters/EffectDots.tsx` (2), `encounters/DispositionPanel.tsx` (1, `indigo`), `encounters/LairActions.tsx` (2), `items/ItemCatalogBrowser.tsx` (1), `dice/DiceRollHistoryPage.tsx` (2), `campaigns/CampaignReferencePage.tsx` (1), `monsters/MonstersPage.tsx` (2, `purple`) |
| A handful of one-off Tailwind colors outside any documented semantic ramp: `green-400/800` (used for a "success/available" state in 3 files where `emerald-*` — the app's actual heal/success color — would be the correct token), `cyan-400`, `slate-950`. | **Low** | `encounters/elements/DoorActionPanel.tsx:79`, `encounters/BattleModePlayerPanel.tsx:375,427`, `encounters/ActionEconomyPanel.tsx:386,454` (all `green-*` where `emerald-*` is the established success color); `encounters/elements/registry.tsx:106` (`cyan-400`); `encounters/BattleMap.tsx:86,1359` (`purple-700`, `slate-950`) |
| `LoginPage.tsx`/`RegisterPage.tsx`/`ProfilePage.tsx`/`AboutPage.tsx`/`LandingPage.tsx` don't import the shared `Feedback.tsx` primitives (`Loading`/`ErrorBanner`/`EmptyState`/`Skeleton`) that ~74 other files in the app use consistently. For Landing/About this is correct — they're static, no data fetching. For Login/Register/Profile it's worth a manual confirm: they may have equivalent inline error handling (not evaluated line-by-line in this pass) rather than a real gap — flagged for the user to confirm, not a fix prescribed here per the "don't invent scope" constraint. | **Low (needs confirm)** | `auth/LoginPage.tsx`, `auth/RegisterPage.tsx`, `profile/ProfilePage.tsx` |
| Inline `style={{...}}` usage audited across the app (7 files) is legitimate in every instance found — dynamic HP-bar widths, canvas/grid pixel positioning in `BattleMap.tsx`/`Token.tsx`/`registry.tsx`, and one CSS-variable-driven radial gradient on `LandingPage.tsx` that correctly references `var(--color-stone-800/950)` and therefore already repaints per theme. **No drift found here** — listed for completeness, not as an issue. | Info only | — |
| Micro-text sizing (`text-[10px]`/`text-[11px]`, ~40 occurrences across the app) matches the documented type scale (`docs/design-tokens.md:170`, "figcaption / micro — 11px") even though that doc is otherwise stale. **Not drift.** | Info only | — |

---

## 2. Consistency verdict by area

- **Color (stone/amber/red/emerald/yellow/orange/sky)**: Matches Field Ledger everywhere by construction — the override mechanism makes off-token usage of these seven families structurally impossible as long as components use the plain Tailwind class names (which, per the grep pass behind this audit, they universally do). No screen deviates.
- **Color (everything else — violet/indigo/purple/green/cyan/slate)**: Drifted. This is real, undocumented scope: an "arcane" accent family the app clearly wants (it's used consistently for spell/magic/lair-action semantics, not randomly), but it was never formally added to the token system the rest of the app follows. See §8 for the token fix.
- **Typography**: Matches. Every screen sampled uses `font-display`/plain body text/`font-mono` for numbers, consistent with `index.css`'s global `h1-h3` rule and the per-component convention shown in `StyleguidePage.tsx`. The only typography problem is documentation (the styleguide's prose), not usage.
- **Spacing / radius / shadow**: Matches. `rounded-md`/`rounded-lg` and the `shadow-sm/md/lg` utilities (which resolve to the Field Ledger `--radius-*`/`--shadow-*` tokens) are used consistently; no arbitrary radius/shadow values found in the grep pass.
- **Focus states / reduced motion**: Matches — handled globally in `index.css` (lines 245-291), applies to every interactive element app-wide including `NavLink`s the app's own components don't directly render. Nothing screen-specific to fix.
- **Loading / empty / error states**: Matches on the ~30 data-driven screens that were spot-checked (`Feedback.tsx` primitives used consistently, e.g. `GlobalItemInventoryPage.tsx` delegates `isLoading`/`error` straight through). Three auth/profile screens flagged above need a manual confirm, not a prescribed fix.

---

## 3-5. Existing tokens (source of truth: `packages/web/src/index.css`, default "Ember" / dark mode)

### Color

| Token role | Hex (dark/Ember) | Hex (light, `prefers-color-scheme`) |
|---|---|---|
| `stone-950` — page background | `#251f18` | `#efebe6` |
| `stone-900` — card/panel background | `#322920` | `#e7e1da` |
| `stone-100` — primary text | `#efebe6` | `#28221a` |
| `stone-500` — muted text / AA-safe border | `#a58e73` | `#7c6750` |
| `amber-500` — primary interactive (links, focus ring, button border+text) | `#d0806c` | `#b1492f` |
| `amber-600` — mid accent, **non-text fills only** | `#b25138` | `#993f29` |
| `red-600` — danger/damage | `#9f4538` | `#8c392c` |
| `emerald-500` — heal/success | `#639c6d` | `#588960` |
| `yellow-600` — warning / "injured" HP band | `#b68f35` | `#917127` |
| `orange-600` — "bloodied" HP band only | `#b66835` | `#8c4f27` |
| `sky-500` — info / temp-HP | `#5e8ba1` | `#517b90` |

Contrast, recomputed directly from the hex values above (not carried over from the stale
doc, which has old-palette numbers):

| Pairing | Ratio (dark) | Verdict |
|---|---|---|
| `text-stone-100` on `stone-950` | 13.7:1 | Pass AAA |
| `text-amber-500` on `stone-950` (link/focus-ring use) | 5.4:1 | Pass AA — matches the range `index.css:264` already claims for this exact pairing (3.9–5.4:1 across surfaces) |
| `amber-600` as a **filled button background** with text on top | 4.3:1 | **Fails AA (4.5:1)** — this is exactly why the shared `Button` component's primary variant is outline/ghost, not filled (confirmed correct in `StyleguidePage.tsx:226` and `AMBER_SWATCHES` notes) |

Deliberate, documented AA gap (not a bug): hairline decorative borders (`stone-700`/`stone-800`) sit below the 3:1 non-text guideline by design — functional borders use `stone-600`/`stone-500` instead, which pass. Stated in `index.css:91-99`.

### Typography

- `--font-display: 'Bitter'` (headings, applied globally to `h1-h3` via `:where()` — zero component edits)
- `--font-sans: 'IBM Plex Sans'` (body/UI — overrides Tailwind's own `font-sans` token)
- `--font-mono: 'IBM Plex Mono'` (every numeric value in the app — overrides Tailwind's own `font-mono` token)
- Micro/eyebrow scale: 10-11px (`text-[10px]`/`text-[11px]`), used consistently, matches `docs/design-tokens.md:170`'s "figcaption / micro" spec (the one part of that doc still accurate).

### Spacing / radius / shadow

- `--radius-md: 8px`, `--radius-lg: 14px`
- `--shadow-sm/md/lg`: hairline ring + optional drop shadow, scaled by `stone-800/700/500` per tier — see `index.css:28-30`.
- No project-specific spacing scale beyond Tailwind's own defaults; none needed (no drift found).

---

## 6. UX rules audit

- **Loading/empty/error**: `Feedback.tsx` primitives in consistent use across ~74 files (per grep). Three screens flagged in §1 for manual confirm.
- **Responsive**: Table auto-stacks to cards below `sm:` (documented + demoed on `/styleguide`); inputs enforce 44px min height / 16px mobile text (iOS zoom threshold) per `StyleguidePage.tsx:254` comment — consistent with what was spot-checked.
- **Focus/keyboard**: Global `:focus-visible` rule (`index.css:268-272`) covers every button/link/`[role=button]`/`[tabindex]` app-wide, including router `NavLink`s. No screen-level gaps found.
- **Reduced motion**: Global `prefers-reduced-motion` rule (`index.css:282-291`) applies app-wide.
- **Z-index layering**: Only meaningfully load-bearing in `Token.tsx` (drag/select stacking, `encounters/Token.tsx:304`) and modal/overlay components — not audited exhaustively in this pass; no conflicts surfaced during the grep/read pass.
- **Touch targets**: 44px minimum documented and applied to form controls (`Field`/`Input`); not independently re-verified per-screen here.

---

## 7. Layout recommendations for drifted areas

No screen has *structural* layout drift from Field Ledger — the findings in this pass are
all token-usage drift (wrong color family, raw hex, stale docs), not layout. Recommended
fixes per drifted file are the migration-plan rows in §9 — they're class/token swaps, not
re-layouts.

---

## 8. Token fixes needed in `index.css`

Two options for the undocumented "arcane" family — **flagging for user decision**, not deciding here (per the "confirm with user" constraint):

**Option A — formalize it.** Add a `violet-*` (or rename to a semantic-sounding slot) block to each of the three `[data-theme]` sections and the light-mode media query in `index.css`, following the exact pattern already used for `red`/`emerald`/`yellow`/`orange`/`sky` (lines 125-154 and 178-203). This gets magic/spell/lair-action UI onto the same per-theme, per-mode repainting mechanism as everything else, with a real contrast check.

**Option B — fold it into an existing token.** If "arcane" doesn't need its own identity, remap those ~13 files' `violet-*`/`indigo-*`/`purple-*` classes onto `sky-*` (already the app's "info" color and closest in temperature) or `amber-*` (already the accent). Simpler, no `index.css` change, but loses the visual distinction between "this is magical" and "this is generic accent/info" that the current ad hoc usage seems to be reaching for.

No other token additions needed — `stone`/`amber`/`red`/`emerald`/`yellow`/`orange`/`sky` already cover everything else in use.

---

## 9. Migration plan (file-by-file, ordered by impact)

1. **`docs/design-tokens.md`** — rewrite (or archive with a pointer) to describe Field Ledger, not Nocturne. Highest-impact single fix: this is the document a future contributor reads first.
2. **`packages/web/src/styleguide/StyleguidePage.tsx:1-6, 189, 214`** — update the header prose and the type-section description to name Field Ledger / Bitter+Plex Sans+Plex Mono instead of Nocturne / Fraunces+Inter. Component usage on this page is already correct; only the copy is wrong.
3. **Decide Option A vs. B (§8)** for the arcane/spell color, then apply it across: `characters/CharacterSheetPage.tsx`, `characters/CharactersListPage.tsx`, `characters/InventoryPanel.tsx`, `components/EffectBadge.tsx`, `encounters/EffectDots.tsx`, `encounters/DispositionPanel.tsx`, `encounters/LairActions.tsx`, `items/ItemCatalogBrowser.tsx`, `dice/DiceRollHistoryPage.tsx`, `campaigns/CampaignReferencePage.tsx`, `monsters/MonstersPage.tsx`.
4. **Replace stray `green-*` with `emerald-*`** (the app's real success/heal token) in `encounters/elements/DoorActionPanel.tsx:79`, `encounters/BattleModePlayerPanel.tsx:375,427`, `encounters/ActionEconomyPanel.tsx:386,454`. Mechanical, zero visual-intent change (green ≈ emerald already).
5. **Replace raw hex with CSS custom properties** in `encounters/vision/VisionOverlay.tsx:181,188` and `encounters/elements/registry.tsx:180,221,246` — swap `#555555`/`#0c0a09` for `var(--color-stone-*)` equivalents, and `#fbbf24`/`#a855f7` for whatever Option A/B lands on for the arcane family (steps 3-5 are really one coordinated change).
6. **One-off `cyan-400` (`registry.tsx:106`) and `purple-700`/`slate-950` (`BattleMap.tsx:86,1359`)** — fold into the nearest covered token once the maintainer confirms intended meaning (not guessed here).
7. **Confirm (don't yet fix)** whether `LoginPage.tsx`/`RegisterPage.tsx`/`ProfilePage.tsx` need `Feedback.tsx` primitives or already have equivalent handling — a quick manual check, likely a non-issue.

---

**Nothing in this pass required touching any file besides this one.** Awaiting approval before any Phase 2 implementation (which, per the brief, should be scoped to the items above — no palette/type/style changes, since Field Ledger stays locked).
