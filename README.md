# Loresmith

A campaign management tool for D&D Dungeon Masters, with a real-time player-facing view. See [`PLAN.md`](./PLAN.md) for the full technical design and phased roadmap.

**Status: Phase 3 (creatures, battle map, dice roller, images, armor) complete, plus a Phase 3.6 usability/combat-depth pass.** Phase 1 covered auth, campaigns, PC/NPC character sheets, a starter monster catalog, a single-encounter live combat tracker with real-time DM/player sync, and basic campaign notes. Phase 2 added spellcasting, inventory, resource pools & rests, multiclassing, active effects/conditions, and a multi-encounter combat tracker (see git history / `PLAN.md` for details). Phase 3 added five more features on top:

- **Images & file uploads**: `POST /campaigns/:id/assets` (multipart, mime/size-validated, randomized filenames — never the client-supplied name), served back via `express.static` at `/uploads`. Used for character portraits and, via the same pipeline, battle-map backgrounds.
- **Creatures / bestiary CRUD**: campaign-scoped homebrew monsters (`is_homebrew` + `owning_campaign_id`, mirroring the existing effect-definitions homebrew pattern) alongside the read-only global catalog — DM-only create/edit/delete, `edition_scope` always server-derived from the campaign so a homebrew creature can never accidentally hide itself from its own campaign's bestiary browse.
- **Campaign race/class curation**: `GET/POST /campaigns/:id/races` and `GET/POST /campaigns/:id/classes` (plus `PATCH`/`DELETE /:entryId` and `POST /bulk-remove`), mirroring the campaign bestiary's `campaign_bestiary_entries` pattern — a DM imports specific global (or homebrew) races/classes into a campaign and can give any of them a campaign-local `overrides` JSONB tweak, shallow-merged over the catalog row at read time. Distinct from the catalog's own homebrew-fork mechanism (`/campaigns/:id/catalog/{races,classes}/:id/duplicate`, which copies a row into a brand-new catalog row): characters still reference `races.id`/`classes.id` directly, so importing, editing, or removing a campaign entry never affects an existing character or another campaign's copy. UI at `/campaigns/:id/races-classes`.
- **Battle map**: a per-encounter grid (configurable size/cell size, optional background image), tokens dragged via native pointer events with snap-to-cell, synced live to every connected client over `MAP_UPDATED`/`TOKEN_MOVED` — no canvas/SVG library, just CSS grid + absolutely-positioned divs.
- **d20 dice roller**: server-authoritative RNG (the client never computes or submits a roll result), Normal/Advantage/Disadvantage (2 dice, keep highest/lowest), a campaign-wide roll history with cursor pagination, and a `DICE_ROLLED` broadcast that respects DM-hidden rolls.
- **Armor & equipment AC**: an auto/manual toggle per character — `manual` (the default, unchanged pre-Phase-3 behavior) keeps today's flat typed-in AC; `auto` computes it live from equipped armor + shield (light/medium/heavy Dex-cap rules) every time gear or Dex changes, broadcasting the new AC to any live encounter the character is currently a combat participant in.

Phase 3.6 layered on eight more improvements:

- **Unique/duplicate monster instances**: `monsters.is_unique` caps a catalog stat block (named villains, legendaries) at one live instance per campaign; every other monster can be spawned repeatedly and is auto-labeled ("Goblin 1", "Goblin 2", ...) when the DM doesn't supply a custom name.
- **Position visibility**: the combat tracker's list view (not just the battle map) now shows each participant's grid coordinates or "unplaced" at a glance.
- **Arbitrary-dice engine**: the roller now supports any standard die (d4–d100) and free-typed expressions (`2d6+3`), not just d20 checks, plus a new `damage` roll type — with a "Roll dice" quick-roll widget on the Dice Rolls page.
- **Attack selection & damage rolling**: equipped weapons and monster actions each get independent Attack + Damage buttons (choosing between a fighter's longsword/longbow or a goblin's scimitar/shortbow is just clicking the one you want), backed by a new `GET /catalog/damage-types` endpoint and structured `damageDice`/`damageType` fields on monster actions.
- **Turn actions / action economy**: `combat_participants` now tracks action/bonus-action/reaction/movement per turn (reset automatically on turn advance). Dash, Grab, Shove, Throw, Dodge, Help, and Hide are all available from the active participant's row, defined in a frontend-only registry so new actions never require a backend change.
- **Show-password toggles** on the login/register forms.
- **Searchable comboboxes** replace plain `<select>`s for spells, items, and the combat tracker's participant picker.
- **Dashboard/home view**: the new landing page (`/`) aggregates a user's characters, campaigns, and notes (their own plus recent campaign notes) via `GET /me/dashboard`; the plain campaign list moved to `/campaigns`.

**Phase 6 (reveal engine generalization, PLAN.md §11)** generalizes the DM/player redaction pattern `hp_visibility` already proved out to arbitrary NPC/monster-instance stat-block fields (AC, speed, senses, languages, notes, saving throws, skills, resistances/immunities, traits, actions, legendary actions, reactions):

- `entity_field_reveals` (per-entity, per-field `revealed`/`playerOverride`, campaign-scoped `reveal_defaults` allowlist) — `hp_visibility` and `active_effects.visible_to_players` are deliberately left as their own separate mechanisms, not folded in.
- `GET`/`PATCH .../reveals` on both `/characters/:id` and `/monster-instances/:id` (DM-only), plus `POST /campaigns/:id/reveals/hide-all` (the panic button — also flips every live `hp_visibility` to `hidden` and every `active_effects.visible_to_players` to `false`) and `POST /encounters/:id/reveals/reset`.
- A `REVEAL_CHANGED` socket event (same DM-true/player-redacted-or-override split as `HP_CHANGED`), folded into `FULL_STATE_SYNC` for `armorClass` specifically since that's the one reveal-gated field the combat-tracker snapshot already carries.
- Frontend: a reusable `useReveals`/`RevealToggle` pair, wired into the combat tracker's per-participant AC toggle, an NPC-only "Reveal to players" panel on the character sheet, an always-visible "Hide everything" button in the campaign nav, and a "Reset reveals" button on the encounter view.

The encounter builder (CR/XP budgeting), session timeline, handouts, and a campaign-settings UI for editing `reveal_defaults` itself (currently DB-default only, no editor) remain unbuilt per `PLAN.md`'s roadmap.

## Stack

- **Backend**: Node.js + Express + TypeScript, PostgreSQL, Redis-backed sessions, Socket.io (`packages/server`)
- **Frontend**: React + TypeScript + Vite, Tailwind CSS, TanStack Query, React Router, Socket.io client (`packages/web`)
- **Dev infra**: Docker Compose (Postgres + Redis)

## Prerequisites

- Node.js 20+ (developed against Node 24)
- Docker + Docker Compose
- npm 10+ (this is an npm workspaces monorepo — `packages/server` and `packages/web`)

## Setup

```bash
# 1. Install all workspace dependencies (run once, from the repo root)
npm install

# 2. Copy the example env file and adjust if needed (defaults work out of the box)
cp .env.example .env

# 3. Start Postgres + Redis
docker compose up -d

# 4. Run database migrations
npm run migrate

# 5. Seed reference data (D&D SRD catalog for both 2014/2024 rules editions,
#    pulled from .opencode/skills/dnd5e-srd) plus a demo campaign, characters,
#    a starter bestiary, and a prepared encounter
npm run seed
```

The seed script prints login credentials at the end. Currently:

- **DM**: `dm@example.com` / `password123`
- **Player**: `player@example.com` / `password123`
- **Player**: `quinn@example.com` / `password123` (owns Kessia Duskbane, the Phase 2 multiclass demo character)

All three belong to the demo campaign "The Sunless Vale", which has three PCs (a Fighter, a Cleric, and a multiclass Paladin 3/Warlock 2 — Kessia, for exercising the spell-slot/Pact-Magic split and multiclass prerequisites) plus one NPC, a 4-monster starter bestiary, and one prepared encounter ("Ambush on the Old Road") ready to start. Kessia also comes with known spells, an active resource pool, and equipped items, so the Phase 2 character-sheet panels have real data to render immediately.

The seed also plants one example of each Phase 3 feature, all re-runnable/idempotent via `npm run seed`: a homebrew monster ("Vale Lurker", owned by the demo campaign, alongside the global bestiary), a generated placeholder image used as both Brenna Ironhide's portrait and the prepared encounter's map background, that encounter's battle map pre-configured with all five participants already placed on the grid, three sample dice rolls on the Dice Rolls page (including one DM-hidden roll, to see the visibility split in action), and Brenna Ironhide opted into `armor_class_mode='auto'` (AC 18, computed live from her equipped Chain Mail + Shield) so the auto/manual toggle has a real character to demonstrate on immediately.

## Running the app

```bash
# In one terminal: the API + WebSocket server (http://localhost:3001)
npm run dev:server

# In another terminal: the frontend dev server (http://localhost:5173)
npm run dev:web
```

Open `http://localhost:5173` and log in with any seeded account above — you'll land on the new dashboard; the plain campaign list is at `/campaigns`. The Vite dev server proxies `/auth`, `/me`, `/campaigns`, `/characters`, `/monster-instances`, `/encounters`, `/effects`, `/catalog`, `/assets`, `/uploads`, and `/socket.io` to the backend on port 3001 (see `packages/web/vite.config.ts`) — no separate CORS/proxy setup needed in dev. A few paths (`/campaigns/:id/characters|encounters|notes`) are both real API endpoints and real frontend routes since there's no `/api` prefix; the proxy tells a hard page navigation (refresh, deep link) apart from the app's own `fetch()` calls by `Accept` header, so both land in the right place.

## Environment variables

Set in `.env` at the repo root (loaded by both the server's npm scripts and, indirectly, by Vite's proxy target):

| Variable | Purpose | Default (`.env.example`) |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgres://dnd:dnd@localhost:5433/dnd_campaign_manager` |
| `REDIS_URL` | Redis connection string (session store) | `redis://localhost:6380` |
| `SESSION_SECRET` | Express session signing secret | placeholder — change before any real deployment |
| `PORT` | Backend HTTP port | `3001` |
| `CLIENT_ORIGIN` | Allowed CORS origin for the frontend | `http://localhost:5173` |
| `MAX_UPLOAD_BYTES` | Max size (bytes) for a `POST /campaigns/:id/assets` upload | `5242880` (5 MiB) — falls back to this if unset |

Note: Postgres/Redis are mapped to host ports **5433**/**6380** (not the standard 5432/6379) in `docker-compose.yml`, since those default ports were already in use by other local services on the machine this was built on — adjust both the compose file and `DATABASE_URL`/`REDIS_URL` together if you change this.

Uploaded files (character portraits, battle-map backgrounds) are written to `packages/server/uploads/campaigns/<campaignId>/<uuid>.<ext>` on local disk and are **gitignored** — nothing under `uploads/` is committed, and the directory is created on demand (the seed script and the upload route both `mkdir -p` it as needed). This matches the project's no-cloud-dependency posture (Postgres/Redis are both local containers already); if this ever needs a multi-instance/horizontal deployment, `uploads/` would need to move to shared/networked storage (e.g. a mounted volume or object storage) rather than a single instance's local disk — noted here as a known limitation, not solved by this phase.

## Backups

`docker-compose.yml`'s named volume (`postgres_data`) protects against container
removal but not against a bad migration, an accidental delete, or wanting to roll
back to a known-good state. Two scripts wrap `pg_dump`/`pg_restore` against the
`postgres` service directly (no local `psql`/`pg_dump` install needed — everything
runs inside the container via `docker compose exec`):

```bash
scripts/backup.sh                        # writes backups/<timestamp>.sql (gitignored)
scripts/restore.sh backups/20260101-120000.sql   # DESTRUCTIVE: drops + recreates the DB first
```

Both read `POSTGRES_USER`/`POSTGRES_DB` from `.env` if present, otherwise fall back
to `docker-compose.yml`'s defaults (`dnd`/`dnd_campaign_manager`). Run `scripts/backup.sh`
before any migration you're not fully sure about — `npm run migrate:down` handles
undoing a single migration cleanly, but a full dump is the only way back if a
migration itself corrupted data rather than just the schema.

## Tests

```bash
npm test   # runs both workspaces' test suites
```

- `packages/server`: Vitest, 8 test files / 46 tests. Pure unit tests cover HP delta/temp-HP math, ability/DEX modifiers, turn-advance round-wrap logic, hit-dice rest-recovery arithmetic, and armor-class auto-compute (light/medium/heavy Dex-cap rules, shield stacking). Four integration tests exercise real Postgres: `rollInitiative` against the live seeded demo encounter (restores the rows it touches afterward — requires `docker compose up -d` + a migrated/seeded database first), plus three Phase 2 tests using throwaway campaign/character rows (never touching seeded demo data) for rest recovery (`performRest`), concentration auto-replace, and multiclass spell-slot/prerequisite computation.
- `packages/web`: Vitest + Testing Library (jsdom) — pure D&D math helpers (ability modifiers, proficiency bonus, skill/save math).

Run `npm test` twice in a row if you touch anything DB-related — the integration tests are written to be idempotent/order-independent, and a repeat run is the cheapest way to catch state leakage before it corrupts the seeded demo campaign.

## Building for production

```bash
npm run build   # builds both workspaces (tsc for the server, tsc + vite build for the web client)
```

### Docker images

`packages/server/Dockerfile` and `packages/web/Dockerfile` build from the **repo root** as build context (`docker build -f packages/server/Dockerfile -t <image> .`), since this is an npm workspaces monorepo. The web image is nginx serving the built static assets, reverse-proxying the same API/Socket.io path prefixes `vite.config.ts` proxies in dev to a backend container (`BACKEND_HOST`/`BACKEND_PORT` env vars, default `server:3001`) — see `packages/web/docker/nginx.conf.template`. The server image needs `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET`/`CLIENT_ORIGIN` (same as `.env.example`) at `docker run` time; migrations/seeding aren't run automatically on container start — run `npm run migrate`/`npm run seed` against the image explicitly first.

`.github/workflows/ci.yml` runs the test suite (with Postgres/Redis services matching `docker-compose.yml`) on every push/PR to `main`, then on push to `main` only, builds and pushes both images to Docker Hub as `<DOCKERHUB_USERNAME>/loresmith-{server,web}:latest` and `:<sha>`. Requires two repo secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token, not your account password).

## Project layout

```
packages/
  server/   # Express API + Socket.io — src/{routes,services,schemas,middleware,sockets,db}
  web/      # React SPA — src/{auth,campaigns,characters,encounters,monsters,notes,dice,dashboard,components,lib}
PLAN.md     # Full technical design: data model, REST API, real-time sync, frontend architecture, roadmap
CLAUDE.md   # Repo guidance/context notes
.opencode/  # D&D 5e SRD reference data + agent-persona configs used during planning/build
```

## Content attribution

The rules catalog (races, classes, backgrounds, feats, conditions, weapon mastery,
starter bestiary) is seeded from the official D&D System Reference Documents (SRD 5.1
under OGL 1.0a for 2014-edition content, SRD 5.2 under CC-BY-4.0 for 2024-edition
content) — see [`ATTRIBUTION.md`](./ATTRIBUTION.md) for the full license text and the
required CC-BY attribution statement, which is also surfaced in-app at `/about`.
