# API Reference

Generated from the real route files under `packages/server/src/routes/` (not aspirational — see `REFACTOR-PLAN.md` §1.2). Keep this in sync when routes change; it should always match `grep -rn "\.\(get\|post\|patch\|put\|delete\)(" packages/server/src/routes/*.ts`.

**Auth**: session cookie (`connect.sid`, `httpOnly`, `SameSite=Lax`), Redis-backed. Every route below requires `requireAuth` unless noted. State-changing requests (non-GET) additionally require the `X-Requested-With` header (CSRF mitigation — see `middleware/csrf.ts`).

**Authorization layering**, applied per route: authenticated → campaign member (`requireCampaignMember()`) → role (`requireRole('dm')`) → ownership (service-layer, e.g. a player editing only their own character). Default-deny; a route with no explicit role/ownership note is member-readable, DM-writable is the norm for campaign-scoped resources.

**Errors**: `{ "error": { "code", "message", "details" } }` with machine-stable `code`s (`VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, ...).

---

## Auth (`/auth`) — no auth required except `/me`, `/me/theme`

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | |
| POST | `/auth/login` | |
| POST | `/auth/logout` | |
| GET | `/auth/me` | |
| PATCH | `/auth/me/theme` | Per-user UI theme preference |

## Dashboard (`/me`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me/dashboard` | Aggregates the caller's characters, campaigns, own notes, and campaign notes across every campaign they're in |

## Campaigns (`/campaigns`)

| Method | Path | Notes |
|---|---|---|
| POST | `/campaigns` | Creates campaign, caller becomes DM |
| GET | `/campaigns` | Caller's own campaigns |
| GET | `/campaigns/:id` | Member-only |
| PATCH | `/campaigns/:id` | DM-only |
| DELETE | `/campaigns/:id` | DM-only |
| POST | `/campaigns/:id/roll-ability-scores` | Any member |
| POST | `/campaigns/:id/reveals/hide-all` | DM-only — re-hides every reveal, HP band, and effect campaign-wide |
| POST | `/campaigns/:id/members` | DM-only |
| GET | `/campaigns/:id/members` | Member-only |
| PATCH \| DELETE | `/campaigns/:id/members/:userId` | DM-only |
| POST \| GET | `/campaigns/:id/sessions(/:sid)` | Session-log CRUD, write DM-only |
| PATCH \| DELETE | `/campaigns/:id/sessions/:sid` | DM-only |

## Characters (`/campaigns/:id/characters`, flat `/characters`)

| Method | Path | Notes |
|---|---|---|
| GET \| POST | `/campaigns/:id/characters` | Member-only |
| GET \| PATCH \| DELETE | `/characters/:id` | Ownership-gated for players (own PC only); DM full access |
| GET \| PUT | `/characters/:id/classes` \| `/skill-proficiencies` \| `/saving-throw-proficiencies` | Bulk replace-all |
| PATCH | `/characters/:id/hp` | Signed delta `{delta, tempDelta}` |
| PATCH | `/characters/:id/exhaustion` | |
| PATCH | `/characters/:id/armor-class-mode` | `{mode: 'auto'|'manual'}` |
| GET \| POST \| PATCH \| DELETE | `/characters/:id/spells(/:spellId)` | |
| GET \| POST \| PATCH \| DELETE | `/characters/:id/items(/:itemId)` | |
| GET | `/characters/:id/resources` | |
| POST | `/characters/:id/resources/:key/spend` \| `/recover` | |
| GET \| POST | `/characters/:id/effects` | Apply outside combat |
| GET \| PATCH | `/characters/:id/reveals` | DM-only writes — reveal engine |
| GET \| POST | `/characters/:id/attacks` | Owner-or-DM writes — structured, selectable attack list (REFACTOR-PLAN.md §6) |
| PATCH \| DELETE | `/characters/:id/attacks/:attackId` | Owner-or-DM |
| POST | `/characters/:id/apply-damage` | Owner-or-DM. Rolls damage dice server-side (doubled on `isCritical`), applies the target's real `damage_resistances/vulnerabilities/immunities`, then updates HP — sibling to `PATCH .../hp`, not a replacement (REFACTOR-PLAN.md §6) |

## Monsters / bestiary (`/catalog/monsters`, `/campaigns/:id/monsters`, `/campaigns/:id/monster-instances`, flat `/monster-instances`)

| Method | Path | Notes |
|---|---|---|
| GET | `/catalog/monsters` | Global catalog; `?campaignId=` unions in that campaign's homebrew; `&homebrewOnly=true` returns only that campaign's homebrew rows (no global union) — powers `/bestiary/basic` vs `/bestiary/campaign/:id` |
| GET | `/catalog/monsters/:id` | Single creature — own endpoint (powers `/creature/:id`). Global rows: any authenticated user. Homebrew rows: campaign membership required. |
| POST \| PATCH \| DELETE | `/campaigns/:id/monsters(/:monsterId)` | DM-only, homebrew rows owned by that campaign only — global/seeded monsters are immutable via this path regardless of role |
| GET \| POST | `/campaigns/:id/monster-instances` | POST is DM-only |
| GET \| PATCH \| DELETE | `/campaigns/:id/monster-instances/:instanceId` | PATCH/DELETE DM-only |
| PATCH | `/monster-instances/:id/hp` | Signed delta |
| GET \| POST | `/monster-instances/:id/effects` | POST DM-only |
| GET \| PATCH | `/monster-instances/:id/reveals` | PATCH DM-only |
| POST | `/monster-instances/:id/apply-damage` | DM-only — see `/characters/:id/apply-damage` above for the mechanism (REFACTOR-PLAN.md §6) |

## Encounters & combat (`/campaigns/:id/encounters`, flat `/encounters`)

| Method | Path | Notes |
|---|---|---|
| GET \| POST | `/campaigns/:id/encounters` | POST DM-only. A campaign may have several `status='active'` rows at once. |
| GET \| PATCH \| DELETE | `/campaigns/:id/encounters/:encounterId` | PATCH/DELETE DM-only |
| GET | `/encounters/:id` | Flat, membership-gated (not DM-only) — powers `/maps/:mapId`, a standalone full-screen route reached with only an encounter id |
| POST | `/encounters/:id/start` \| `/end` | DM-only |
| POST | `/encounters/:id/reveals/reset` | DM-only |
| POST \| DELETE | `/encounters/:id/participants(/:pid)` | DM-only |
| PATCH | `/encounters/:id/participants/:pid/initiative` | DM-only |
| POST | `/encounters/:id/roll-initiative` | DM-only, server rolls |
| POST | `/encounters/:id/advance-turn` | DM-only |
| PUT | `/encounters/:id/map` | DM-only — grid/background config (also accepts `feetPerCell`, distinct from the pixel-only `cellSizePx` — REFACTOR-PLAN.md §4) |
| GET | `/encounters/:id/map/cell-overrides` | DM-only — terrain (`difficult`/`impassable`/`special`) painted onto the grid (REFACTOR-PLAN.md §4) |
| PUT \| DELETE | `/encounters/:id/map/cell-overrides/:x/:y` | DM-only |
| PATCH | `/encounters/:id/participants/:pid/position` | DM-only. Server-validated during active combat: rejects (`409`, `details.reason`) a move exceeding the mover's remaining budget or blocked by terrain/occupancy; free/unconditional outside active combat or for initial placement (REFACTOR-PLAN.md §4) |
| GET | `/encounters/:id/participants/:pid/reachable` | Owning player OR DM — server-computed reachable-cell set for the mover's remaining budget (REFACTOR-PLAN.md §4) |
| PATCH | `/encounters/:id/participants/:pid/faction` | DM-only — board-readability faction (player/ally/enemy/neutral), REFACTOR-PLAN.md §3 |
| PATCH | `/encounters/:id/participants/:pid/action-economy` | Owning player OR DM. `spend` now also accepts `'object_interaction'` (REFACTOR-PLAN.md §5) |
| POST | `/encounters/:id/participants/:pid/action-economy/undo` | DM-only — reverts exactly the last `action-economy` mutation (REFACTOR-PLAN.md §5) |
| POST | `/encounters/:id/participants/:pid/shove` | DM-only, contested roll |
| GET \| POST | `/encounters/:id/effects` | POST DM-only |
| DELETE | `/effects/:id` | |

## Notes (`/campaigns/:id/notes`)

| Method | Path | Notes |
|---|---|---|
| GET \| POST | `/campaigns/:id/notes` | |
| GET \| PATCH \| DELETE | `/campaigns/:id/notes/:noteId` | `visible_to_players=false` rows filtered at the query level for players |

## Dice rolls (`/campaigns/:id/dice-rolls`)

| Method | Path | Notes |
|---|---|---|
| POST | `/campaigns/:id/dice-rolls` | Server performs the RNG |
| GET | `/campaigns/:id/dice-rolls` | |

## Rests (`/campaigns/:id/rests`)

| Method | Path | Notes |
|---|---|---|
| GET | `/campaigns/:id/rests` | |
| POST | `/campaigns/:id/rests` | DM-only |

## Assets (`/campaigns/:id/assets`, flat `/assets`)

| Method | Path | Notes |
|---|---|---|
| GET \| POST | `/campaigns/:id/assets` | Multipart upload |
| DELETE | `/assets/:id` | |

## Catalog / reference (read-only, `/catalog`)

`GET /catalog/{ability-scores|skills|languages|alignments|damage-types|races|subraces|classes|subclasses|class-levels|class-features|backgrounds|feats|spells|items|effect-definitions}` — most accept `?edition=2014|2024|both`; `effect-definitions` and `spells`/`items` accept `?campaignId=`. No write endpoints — seeded by migration/seed tooling.

---

## Non-HTTP tooling referenced by `REFACTOR-PLAN.md`

- Duplicate-report script (§2) is a CLI script, not an HTTP endpoint — `npm run report:unique-duplicates --workspace=@dnd/server` (`packages/server/src/db/scripts/reportUniqueDuplicates.ts`), read-only.
