# PLAN.md — Loresmith

## Context

This repo is currently pre-code (only OpenCode agent/skill configs exist under `.opencode/`). The goal is a campaign management web app for D&D Dungeon Masters with a player-facing shared view: character/NPC sheets, spell & attack libraries, campaign notes, active effects/conditions, a live combat tracker (supporting multiple simultaneous encounters, e.g. a split party), and a DM-vs-player visibility split that updates in real time. This document is the output of a five-agent design pass (data model, REST API, real-time sync, frontend architecture, and D&D SRD rules-compliance review) and is meant to be read end-to-end before any implementation begins.

**Decisions locked in for this plan** (confirmed by the user):
- **Database**: PostgreSQL (JSONB support + full-text search via `tsvector`/GIN, needed for notes search and variable-shape catalog fields).
- **Auth**: simple email+password with server-side sessions (not OAuth, not invite-code-only) — a self-hosted small-group tool where the DM and players register directly.
- **MVP scope**: narrow — Phase 1 is only what's needed to actually run a session (characters, monsters, combat tracker, basic notes); spell/item libraries, bestiary browser polish, encounter builder, dice roller, handouts, and rest management land in later phases.

**Grounding data**: the project already has a `dnd5e-srd` reference skill (`.opencode/skills/dnd5e-srd/`) covering both the 2014 (SRD 5.1) and 2024 (SRD 5.2) rules editions side by side, with structured catalog data (races/species, classes, levels, conditions, feats, backgrounds, skills, proficiencies, etc.) queryable via `python3 .opencode/skills/dnd5e-srd/scripts/query.py`. It deliberately has **no spells, monsters, or equipment/magic-item catalogs with real stats** — this app must originate and own those three catalogs itself, seeding everything else (races, classes, conditions, feats, backgrounds, skills) from the SRD skill's data.

---

## 1. Architecture Overview

```
┌─────────────────────┐        HTTPS (session cookie)        ┌──────────────────────┐
│  React SPA (Vite)   │ ─────────────────────────────────────▶│  Express REST API    │
│  DM view / Player   │◀───────────────────────────────────── │  (auth, CRUD, combat │
│  view, same shell,  │                                        │   mutations)         │
│  role-branched       │        WebSocket (Socket.io)          │                       │
│                      │◀═══════════════════════════════════▶│  Socket.io server     │
└─────────────────────┘   rooms: campaign:{id}, encounter:{id} └──────────┬────────────┘
                                                                            │
                                                                            ▼
                                                                  ┌──────────────────┐
                                                                  │   PostgreSQL      │
                                                                  │ (+ Redis sessions) │
                                                                  └──────────────────┘
```

- **Single Express process** serves both the REST API and the Socket.io upgrade, sharing the same session store (Redis) so WebSocket handshakes authenticate off the same cookie — no duplicated auth logic.
- **All state-changing combat actions go through REST** (`PATCH /characters/:id/hp`, `POST /encounters/:id/advance-turn`, etc.). Each is a single atomic DB transaction; on success, the handler emits the corresponding Socket.io event to the relevant room(s). WebSockets are a broadcast layer, never a second write path.
- **The SPA is a single build** — DM and player see the same `CampaignShell` component tree, branched by role (read from `campaign_members`), not two separate apps. This avoids two 80%-identical route trees drifting apart.

---

## 2. Technology Stack & Justification

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js + Express | Given (user-specified) |
| Database | PostgreSQL | JSONB for variable-shape fields (monster actions, spell scaling), generated `tsvector` + GIN index for notes full-text search, robust concurrent-write support for combat state |
| Sessions | Redis-backed Express sessions, `httpOnly`/`Secure`/`SameSite=Lax` cookie | Instant revocation (kick a session, force logout on password change) without a JWT blocklist; same session store authenticates the Socket.io handshake, so auth logic isn't duplicated across REST and WS |
| Real-time | Socket.io | Native room primitives (`socket.join()`/`socket.to(room).emit()`) are essential here — the room topology is nested (`campaign:{id}` + `encounter:{id}`) to support multiple concurrent encounters with disjoint rosters; built-in reconnect/backoff and ack callbacks give a ready-made idempotency channel. Raw `ws` would mean hand-rolling all of this; SSE was considered for the read-only player view but rejected because players also submit actions (attacks, potions), which would split idempotency/reconnection logic across two transports for no gain |
| Frontend build | Vite + React + TypeScript | This is a session-cookie-authed SPA behind an Express API with no crawlable/public content — no reason for Next.js's SSR/SSG machinery, which would just add a second server to reconcile with the auth model. CRA is not a live option |
| Styling / components | Tailwind CSS + a headless primitive library (Radix Primitives or React Aria Components) | The app needs both dense data surfaces (stat blocks, initiative lists, bestiary tables) and fully bespoke game widgets (dice roller, HP bar with temp-HP overlay, initiative tracker) that no full kit (MUI/Chakra) ships natively — a full kit actively fights you the first time you need a custom `HPBar`. Headless primitives supply the hard accessibility work (focus trap, ARIA, keyboard nav) without imposing visual opinions |
| Server-cache / data-fetching | TanStack Query | Query-key-addressable cache that the Socket.io layer can patch directly (see §5.4), built-in optimistic mutations with rollback |
| Routing | React Router | One `CampaignShell` per campaign, nested routes, role-gated via a `RequireRole`/`RequireOwnership` wrapper |
| Validation | Zod (backend request schemas) | Shared shape between create/update (`.partial()`), enums mirror DB `CHECK` constraints |

---

## 3. Data Model

Full entity groups:

- **Cross-cutting**: `users`, `srd_editions`, `campaigns`, `campaign_members`, `locations`, `sessions`, `session_events`, `campaign_assets`, `tags`, `notes`, `note_tags`, `dice_rolls`.
- **Catalog / reference** (edition-scoped, shared across campaigns, rarely mutated): `ability_scores`, `skills`, `languages`, `alignments`, `damage_types`, `magic_schools`, `weapon_properties`, `proficiencies`, `conditions`, `races`, `subraces`, `classes`, `subclasses`, `class_levels`, `class_features`, `backgrounds`, `feats`, `spells`, `spell_classes`, `items`, `monsters`, `cr_xp_table`, `effect_definitions`, plus the amendments in §3.3.
- **Campaign-instance** (scoped to one campaign, mutated constantly): `characters`, `character_classes`, `character_skill_proficiencies`, `character_saving_throw_proficiencies`, `character_spells`, `character_items`, `character_resource_pools`, `monster_instances`, `encounters`, `combat_participants`, `active_effects`, `rest_events`, `rest_event_characters`, `encounter_templates`, `encounter_template_monsters`.

### 3.1 The one hard rule: catalog vs. instance

**Catalog data** (races, classes, monster archetypes, item/spell templates) is shared across all campaigns and rarely mutated. **Campaign-instance data** (live combatants, current HP, inventories, active encounters) is scoped to one campaign and mutated constantly. Never conflate the two:

- **Characters**: `characters` is the persistent sheet/template (campaign-scoped, not globally shared — but structurally "the definition," HP lives here since it persists across fights and rests). `combat_participants` is the live-combatant row: initiative, turn order, join/leave round, scoped to one `encounters` row.
- **Monsters**: `monsters` is the archetype ("what a goblin is" — global catalog). `monster_instances` is "this specific goblin in campaign #4" with its own HP/status, optionally recurring for named villains. `combat_participants` references instances, never the catalog directly.
- **Items**: `items` is the template (damage die, weight, rarity). `character_items` is the owned/equipped instance (quantity, attunement, charges, custom name), attached to a character OR a monster instance.
- **Spells**: `spells` is the definition. `character_spells` is the known/prepared join, one row per (character, spell, granting class) so multiclass casters track spell lists per class.
- **Effects/conditions**: `conditions` (from the SRD skill) is flavor text only. `effect_definitions` is the app-owned mechanical template (duration type/value, concentration, stacking rule). `active_effects` is the applied instance with a real duration countdown, save DC, source, and target.

### 3.2 Full schema

```sql
-- ===================== Cross-cutting =====================

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE srd_editions (
  code TEXT PRIMARY KEY CHECK (code IN ('2014','2024')),
  name TEXT NOT NULL
);

CREATE TABLE campaigns (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  dm_user_id  BIGINT NOT NULL REFERENCES users(id),
  srd_edition TEXT NOT NULL REFERENCES srd_editions(code),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX ON campaigns (dm_user_id);

CREATE TABLE campaign_members (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('dm','player')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, user_id)
);

CREATE TABLE locations (
  id                 BIGSERIAL PRIMARY KEY,
  campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  parent_location_id BIGINT REFERENCES locations(id),
  name               TEXT NOT NULL,
  description        TEXT,
  map_asset_id       BIGINT, -- FK added after campaign_assets exists
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON locations (campaign_id);

CREATE TABLE sessions (
  id             BIGSERIAL PRIMARY KEY,
  campaign_id    BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_number INT NOT NULL,
  title          TEXT,
  played_at      DATE,
  recap          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, session_number)
);

CREATE TABLE session_events (
  id           BIGSERIAL PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sort_order   INT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN
                 ('combat_start','combat_end','note','milestone','npc_intro','item_found','rest')),
  reference_id BIGINT, -- polymorphic: encounter_id/note_id/character_id depending on event_type
  description  TEXT NOT NULL
);
CREATE INDEX ON session_events (session_id, sort_order);

CREATE TABLE campaign_assets (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
  asset_type          TEXT NOT NULL CHECK (asset_type IN ('image','handout','map')),
  file_url            TEXT NOT NULL,
  title               TEXT,
  description         TEXT,
  visible_to_players  BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON campaign_assets (campaign_id);

ALTER TABLE locations ADD CONSTRAINT fk_locations_map_asset
  FOREIGN KEY (map_asset_id) REFERENCES campaign_assets(id);

CREATE TABLE tags (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE CASCADE, -- NULL = global tag
  name        TEXT NOT NULL,
  UNIQUE (campaign_id, name)
);

CREATE TABLE notes (
  id                 BIGSERIAL PRIMARY KEY,
  campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_id         BIGINT REFERENCES sessions(id) ON DELETE SET NULL,
  location_id        BIGINT REFERENCES locations(id) ON DELETE SET NULL,
  character_id       BIGINT REFERENCES characters(id) ON DELETE SET NULL, -- "about this NPC"
  author_user_id     BIGINT NOT NULL REFERENCES users(id),
  title              TEXT NOT NULL,
  body               TEXT NOT NULL,
  search_vector      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED,
  visible_to_players BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON notes (campaign_id);
CREATE INDEX notes_search_idx ON notes USING GIN (search_vector);

CREATE TABLE note_tags (
  note_id BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE dice_rolls (
  id               BIGSERIAL PRIMARY KEY,
  campaign_id      BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id          BIGINT NOT NULL REFERENCES users(id),
  character_id     BIGINT REFERENCES characters(id) ON DELETE SET NULL,
  encounter_id     BIGINT REFERENCES encounters(id) ON DELETE SET NULL,
  roll_type        TEXT NOT NULL, -- 'attack','damage','save','check','initiative','death_save','custom'
  formula          TEXT NOT NULL, -- '1d20+5'
  result_total     INT NOT NULL,
  result_breakdown JSONB NOT NULL, -- variable roll shape, write-once/read-rarely
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON dice_rolls (campaign_id, created_at);

-- ===================== Catalog / reference =====================
-- edition_scope TEXT CHECK (IN ('2014','2024','both')) on every table that actually forked;
-- edition-invariant tables (ability_scores, skills, damage_types, magic_schools, alignments) skip it.

CREATE TABLE ability_scores (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, full_name TEXT NOT NULL
);

CREATE TABLE skills (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id)
);

CREATE TABLE languages (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both'))
);

CREATE TABLE alignments (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL
);

CREATE TABLE damage_types (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT
);

CREATE TABLE magic_schools (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT
);

CREATE TABLE weapon_properties (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  is_mastery_property BOOLEAN NOT NULL DEFAULT false, -- 2024 weapon-mastery additions
  edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both'))
);

CREATE TABLE proficiencies (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT,
  edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both'))
);

CREATE TABLE conditions (
  id BIGSERIAL PRIMARY KEY,
  index_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  edition_scope TEXT NOT NULL DEFAULT 'both' CHECK (edition_scope IN ('2014','2024','both')),
  UNIQUE (index_key, edition_scope)
);

CREATE TABLE races (
  id BIGSERIAL PRIMARY KEY,
  index_key TEXT NOT NULL,
  name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  speed INT NOT NULL,
  size TEXT NOT NULL,
  ability_bonuses JSONB NOT NULL, -- meaningful for 2014; empty/null for 2024 rows (bonuses moved to background)
  traits JSONB NOT NULL,
  source TEXT,
  UNIQUE (index_key, edition_scope)
);

CREATE TABLE subraces (
  id BIGSERIAL PRIMARY KEY,
  race_id BIGINT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  index_key TEXT NOT NULL,
  name TEXT NOT NULL,
  ability_bonuses JSONB NOT NULL,
  traits JSONB NOT NULL,
  UNIQUE (race_id, index_key)
);

CREATE TABLE classes (
  id BIGSERIAL PRIMARY KEY,
  index_key TEXT NOT NULL,
  name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  hit_die INT NOT NULL,
  primary_ability_id BIGINT REFERENCES ability_scores(id), -- display/summary only; real prereqs live in class_multiclass_prerequisites
  spellcasting_type TEXT NOT NULL DEFAULT 'none'
    CHECK (spellcasting_type IN ('full','half','third','pact','none')), -- SRD-validation amendment
  saving_throw_proficiency_ids BIGINT[] NOT NULL,
  source TEXT,
  UNIQUE (index_key, edition_scope)
);

-- SRD-validation amendment: multiclass prerequisites need 2 abilities for some classes
-- (Paladin: STR 13 AND CHA 13; Ranger/Monk: DEX 13 AND WIS 13) — a single primary_ability_id can't hold this.
CREATE TABLE class_multiclass_prerequisites (
  class_id         BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id),
  minimum_score    INT NOT NULL,
  PRIMARY KEY (class_id, ability_score_id)
);

CREATE TABLE subclasses (
  id BIGSERIAL PRIMARY KEY,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  index_key TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (class_id, index_key)
);

CREATE TABLE class_levels (
  id BIGSERIAL PRIMARY KEY,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  level INT NOT NULL CHECK (level BETWEEN 1 AND 20),
  proficiency_bonus INT NOT NULL,
  features_unlocked JSONB,
  spell_slots JSONB, -- this class's OWN single-classing slot table; NOT used directly for multiclass characters
  UNIQUE (class_id, level)
);

-- SRD-validation amendment: the multiclass slot table is NOT the sum of each class's own slots.
-- Full casters count level 1:1, half-casters (Paladin/Ranger) level÷2 (round down), third-casters
-- (Eldritch Knight/Arcane Trickster) level÷3 (round down); the combined total indexes this table.
CREATE TABLE multiclass_spell_slot_table (
  combined_caster_level INT PRIMARY KEY CHECK (combined_caster_level BETWEEN 1 AND 20),
  spell_slots JSONB NOT NULL -- {"1":4,"2":3,...}
);

CREATE TABLE class_features (
  id BIGSERIAL PRIMARY KEY,
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subclass_id BIGINT REFERENCES subclasses(id) ON DELETE CASCADE,
  level INT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE INDEX ON class_features (class_id, level);

CREATE TABLE backgrounds (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL, name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  skill_proficiency_ids BIGINT[] NOT NULL,
  ability_bonus_choices JSONB,        -- SRD-validation amendment: 2024 backgrounds grant ability bonuses
  granted_feat_id BIGINT REFERENCES feats(id), -- SRD-validation amendment: 2024 backgrounds grant an Origin feat
  description TEXT,
  UNIQUE (index_key, edition_scope)
);

CREATE TABLE feats (
  id BIGSERIAL PRIMARY KEY, index_key TEXT NOT NULL, name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  prerequisite TEXT, -- nice-to-have follow-up: promote to a structured feat_prerequisites join table (Phase 3+)
  description TEXT NOT NULL,
  UNIQUE (index_key, edition_scope)
);

-- App-owned catalogs: the SRD skill has no real data here, so this app is the source of truth.

CREATE TABLE spells (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  level INT NOT NULL CHECK (level BETWEEN 0 AND 9), -- 0 = cantrip
  school_id BIGINT NOT NULL REFERENCES magic_schools(id),
  casting_time TEXT NOT NULL,
  range TEXT NOT NULL,
  component_v BOOLEAN NOT NULL DEFAULT false,
  component_s BOOLEAN NOT NULL DEFAULT false,
  component_m BOOLEAN NOT NULL DEFAULT false,
  material_description TEXT,
  duration TEXT NOT NULL,
  concentration BOOLEAN NOT NULL DEFAULT false,
  ritual BOOLEAN NOT NULL DEFAULT false,
  saving_throw_ability_id BIGINT REFERENCES ability_scores(id),
  attack_type TEXT CHECK (attack_type IN ('melee','ranged')),
  damage_at_level JSONB,
  description TEXT NOT NULL,
  higher_level_description TEXT,
  source TEXT,
  UNIQUE (slug, edition_scope)
);

CREATE TABLE spell_classes (
  spell_id BIGINT NOT NULL REFERENCES spells(id) ON DELETE CASCADE,
  class_id BIGINT REFERENCES classes(id) ON DELETE CASCADE,
  subclass_id BIGINT REFERENCES subclasses(id) ON DELETE CASCADE,
  CHECK (class_id IS NOT NULL OR subclass_id IS NOT NULL)
);
CREATE UNIQUE INDEX ON spell_classes (spell_id, COALESCE(class_id,-1), COALESCE(subclass_id,-1));

CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  item_type TEXT NOT NULL CHECK (item_type IN
    ('weapon','armor','shield','tool','adventuring_gear','magic_item','consumable','mount','vehicle')),
  rarity TEXT NOT NULL DEFAULT 'mundane' CHECK (rarity IN
    ('mundane','common','uncommon','rare','very_rare','legendary','artifact')),
  weight_lb NUMERIC(6,2),
  cost_cp INT,
  armor_class_base INT,
  armor_class_formula TEXT,
  damage_dice TEXT,
  damage_type_id BIGINT REFERENCES damage_types(id),
  requires_attunement BOOLEAN NOT NULL DEFAULT false,
  properties JSONB,
  description TEXT,
  source TEXT,
  UNIQUE (slug, edition_scope)
);

CREATE TABLE monsters (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  edition_scope TEXT NOT NULL CHECK (edition_scope IN ('2014','2024','both')),
  size TEXT NOT NULL,
  creature_type TEXT NOT NULL,
  alignment TEXT,
  armor_class INT NOT NULL,
  armor_class_notes TEXT,
  hit_point_average INT NOT NULL,
  hit_dice TEXT NOT NULL,
  speed JSONB NOT NULL,
  str INT NOT NULL, dex INT NOT NULL, con INT NOT NULL,
  int INT NOT NULL, wis INT NOT NULL, cha INT NOT NULL,
  saving_throws JSONB,
  skills JSONB,
  damage_vulnerabilities TEXT[],
  damage_resistances TEXT[],
  damage_immunities TEXT[],
  condition_immunity_ids BIGINT[],
  senses TEXT,
  languages TEXT,
  challenge_rating NUMERIC(4,2) NOT NULL,
  xp_value INT NOT NULL,
  traits JSONB,
  actions JSONB NOT NULL,
  legendary_actions JSONB,
  reactions JSONB,
  source TEXT,
  UNIQUE (slug, edition_scope)
);
CREATE INDEX ON monsters (challenge_rating);
CREATE INDEX ON monsters (creature_type);

CREATE TABLE cr_xp_table (
  challenge_rating NUMERIC(4,2) PRIMARY KEY,
  xp_value INT NOT NULL
);

CREATE TABLE effect_definitions (
  id BIGSERIAL PRIMARY KEY,
  condition_id BIGINT REFERENCES conditions(id),
  name TEXT NOT NULL,
  description TEXT,
  default_duration_type TEXT NOT NULL CHECK (default_duration_type IN
    ('rounds','minutes','hours','until_save','until_removed','permanent','special')),
  default_duration_value INT,
  concentration BOOLEAN NOT NULL DEFAULT false,
  stacking_rule TEXT NOT NULL DEFAULT 'refresh' CHECK (stacking_rule IN ('none','stack','refresh')),
  is_homebrew BOOLEAN NOT NULL DEFAULT false,
  owning_campaign_id BIGINT REFERENCES campaigns(id) ON DELETE CASCADE,
  CHECK (is_homebrew OR owning_campaign_id IS NULL)
);

-- ===================== Campaign-instance =====================

CREATE TABLE characters (
  id                 BIGSERIAL PRIMARY KEY,
  campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  is_pc              BOOLEAN NOT NULL,
  owner_user_id      BIGINT REFERENCES users(id),   -- player who owns this PC; NULL for NPCs
  created_by_user_id BIGINT NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,
  race_id            BIGINT REFERENCES races(id),
  subrace_id         BIGINT REFERENCES subraces(id),
  background_id      BIGINT REFERENCES backgrounds(id),
  alignment          TEXT,
  str INT NOT NULL, dex INT NOT NULL, con INT NOT NULL,
  int INT NOT NULL, wis INT NOT NULL, cha INT NOT NULL,
  armor_class         INT NOT NULL,
  speed               INT NOT NULL DEFAULT 30,
  hp_max               INT NOT NULL,
  hp_current           INT NOT NULL,
  hp_temp              INT NOT NULL DEFAULT 0,
  hit_dice_remaining   JSONB,  -- {"d8":3} per class; recovery-on-long-rest arithmetic (half, min 1) is app logic
  exhaustion_level     INT NOT NULL DEFAULT 0 CHECK (exhaustion_level BETWEEN 0 AND 6), -- SRD-validation amendment
  senses               TEXT,
  languages            BIGINT[],
  is_alive             BOOLEAN NOT NULL DEFAULT true,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT is_pc OR owner_user_id IS NOT NULL)
);
CREATE INDEX ON characters (campaign_id);
CREATE INDEX ON characters (owner_user_id);
-- Passive perception is NOT a stored column: it's computed at the query/app layer from
-- character_skill_proficiencies + WIS (10 + modifier, +5/-5 for advantage/disadvantage sources).

CREATE TABLE character_classes (
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  class_id     BIGINT NOT NULL REFERENCES classes(id),
  subclass_id  BIGINT REFERENCES subclasses(id),
  level        INT NOT NULL CHECK (level BETWEEN 1 AND 20),
  PRIMARY KEY (character_id, class_id)
);

CREATE TABLE character_skill_proficiencies (
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  skill_id     BIGINT NOT NULL REFERENCES skills(id),
  level        TEXT NOT NULL CHECK (level IN ('proficient','expertise')),
  PRIMARY KEY (character_id, skill_id)
);

CREATE TABLE character_saving_throw_proficiencies (
  character_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  ability_score_id BIGINT NOT NULL REFERENCES ability_scores(id),
  PRIMARY KEY (character_id, ability_score_id)
);

CREATE TABLE character_spells (
  id BIGSERIAL PRIMARY KEY,
  character_id BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  spell_id     BIGINT NOT NULL REFERENCES spells(id),
  class_id     BIGINT REFERENCES classes(id),
  is_prepared  BOOLEAN NOT NULL DEFAULT false,
  always_prepared BOOLEAN NOT NULL DEFAULT false,
  source       TEXT NOT NULL DEFAULT 'class' CHECK (source IN ('class','race','feat','item')),
  UNIQUE (character_id, spell_id, class_id)
);

CREATE TABLE character_resource_pools (
  id            BIGSERIAL PRIMARY KEY,
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  resource_key  TEXT NOT NULL, -- 'ki_points','rage_uses','spell_slot_3', etc. Spell-slot rows here are a
                                -- COMPUTED CACHE for multiclass characters (via multiclass_spell_slot_table),
                                -- not source of truth — recomputed whenever character_classes changes.
  current_value INT NOT NULL,
  max_value     INT NOT NULL,
  recharge_on   TEXT NOT NULL CHECK (recharge_on IN ('short_rest','long_rest','dawn','none')),
  UNIQUE (character_id, resource_key)
);

CREATE TABLE monster_instances (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  monster_id      BIGINT NOT NULL REFERENCES monsters(id),
  custom_name     TEXT,
  hp_max_override INT,
  hp_current      INT NOT NULL,
  hp_temp         INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'alive' CHECK (status IN ('alive','dead','fled','captured')),
  is_recurring    BOOLEAN NOT NULL DEFAULT false,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON monster_instances (campaign_id);

CREATE TABLE character_items (
  id                  BIGSERIAL PRIMARY KEY,
  character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
  item_id             BIGINT NOT NULL REFERENCES items(id),
  quantity            INT NOT NULL DEFAULT 1,
  is_equipped         BOOLEAN NOT NULL DEFAULT false,
  is_attuned          BOOLEAN NOT NULL DEFAULT false,
  custom_name         TEXT,
  charges_remaining   INT,
  notes               TEXT,
  acquired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
);
CREATE INDEX ON character_items (character_id);
CREATE INDEX ON character_items (monster_instance_id);

CREATE TABLE encounters (            -- a campaign can have MANY rows with status='active' at once
  id                 BIGSERIAL PRIMARY KEY,
  campaign_id        BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  location_id        BIGINT REFERENCES locations(id),
  status             TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing','active','paused','completed')),
  current_round      INT NOT NULL DEFAULT 0,
  current_turn_index INT NOT NULL DEFAULT 0,
  sync_seq           INT NOT NULL DEFAULT 0, -- bumped in the same transaction as any mutation; WS clients detect gaps
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON encounters (campaign_id, status);
-- Deliberately no campaigns.active_encounter_id column — that's the classic anti-pattern that
-- assumes one combat per campaign. Concurrency = SELECT * FROM encounters WHERE campaign_id=? AND status='active'.

CREATE TABLE combat_participants (
  id                  BIGSERIAL PRIMARY KEY,
  encounter_id        BIGINT NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
  character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
  initiative_roll     INT NOT NULL,
  initiative_tiebreak INT,
  turn_order          INT NOT NULL,
  joined_round        INT NOT NULL DEFAULT 1,
  left_round          INT,
  hp_visibility       TEXT NOT NULL DEFAULT 'banded' CHECK (hp_visibility IN ('exact','banded','hidden')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
);
CREATE UNIQUE INDEX ON combat_participants (encounter_id, character_id) WHERE character_id IS NOT NULL;
CREATE UNIQUE INDEX ON combat_participants (encounter_id, monster_instance_id) WHERE monster_instance_id IS NOT NULL;
CREATE INDEX ON combat_participants (encounter_id, turn_order);

CREATE TABLE active_effects (
  id                   BIGSERIAL PRIMARY KEY,
  effect_definition_id BIGINT NOT NULL REFERENCES effect_definitions(id),
  character_id         BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  monster_instance_id  BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
  encounter_id         BIGINT REFERENCES encounters(id) ON DELETE SET NULL,
  source_character_id  BIGINT REFERENCES characters(id),
  source_spell_id      BIGINT REFERENCES spells(id),
  source_type          TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN
                          ('spell','class_feature','monster_ability','item','manual')),
  duration_type        TEXT NOT NULL CHECK (duration_type IN
                          ('rounds','minutes','hours','until_save','until_removed','permanent','special')),
  duration_value       INT,
  stack_count          INT, -- SRD-validation amendment: level/stacks for effects like Exhaustion (0-6),
                             -- distinct from duration_value ("rounds left") which doesn't fit Exhaustion's semantics
  applied_at_round     INT,
  save_dc              INT,
  save_ability_id      BIGINT REFERENCES ability_scores(id),
  concentration        BOOLEAN NOT NULL DEFAULT false,
  visible_to_players   BOOLEAN NOT NULL DEFAULT true, -- DM can hide an effect (disguise, trap) from the player feed
  removed_at           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
);
CREATE INDEX ON active_effects (character_id) WHERE removed_at IS NULL;
CREATE INDEX ON active_effects (monster_instance_id) WHERE removed_at IS NULL;
CREATE INDEX ON active_effects (encounter_id);
-- SRD-validation amendment: "You can't concentrate on two spells at once" is a hard invariant,
-- enforced declaratively rather than only in application code:
CREATE UNIQUE INDEX active_effects_one_concentration_per_character
  ON active_effects (character_id) WHERE concentration = true AND removed_at IS NULL;
CREATE UNIQUE INDEX active_effects_one_concentration_per_monster_instance
  ON active_effects (monster_instance_id) WHERE concentration = true AND removed_at IS NULL;

CREATE TABLE rest_events (
  id                   BIGSERIAL PRIMARY KEY,
  campaign_id          BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rest_type            TEXT NOT NULL CHECK (rest_type IN ('short','long')),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  initiated_by_user_id BIGINT REFERENCES users(id),
  notes                TEXT
);

CREATE TABLE rest_event_characters (
  rest_event_id      BIGINT NOT NULL REFERENCES rest_events(id) ON DELETE CASCADE,
  character_id       BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  hp_before          INT NOT NULL,
  hp_after           INT NOT NULL,
  resources_restored JSONB,
  PRIMARY KEY (rest_event_id, character_id)
);

CREATE TABLE encounter_templates (
  id                     BIGSERIAL PRIMARY KEY,
  campaign_id            BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name                   TEXT NOT NULL,
  location_id            BIGINT REFERENCES locations(id),
  party_size             INT NOT NULL,
  party_avg_level        NUMERIC(4,1) NOT NULL,
  target_difficulty      TEXT CHECK (target_difficulty IN ('easy','medium','hard','deadly')),
  status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','activated')),
  activated_encounter_id BIGINT REFERENCES encounters(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE encounter_template_monsters (
  encounter_template_id BIGINT NOT NULL REFERENCES encounter_templates(id) ON DELETE CASCADE,
  monster_id            BIGINT NOT NULL REFERENCES monsters(id),
  quantity              INT NOT NULL DEFAULT 1,
  PRIMARY KEY (encounter_template_id, monster_id)
);
-- Total XP budget = SUM(quantity * cr_xp_table.xp_value), adjusted by the DMG monster-count
-- multiplier — computed in the app layer, not stored.
```

### 3.3 Design tradeoffs

1. **NPC templates piggyback on the monster catalog** rather than getting a third schema — simple reusable NPCs (guards, bandits) are `monsters` + `monster_instances`, matching how the SRD itself stats generic NPCs. Only bespoke, mechanically complex NPCs (multiclass, spellcasting villains) get a full `characters` row. Tradeoff: the DM occasionally has to pick the right bucket.
2. **JSONB only where structure is genuinely variable and unqueried** (`monsters.actions`, `spells.damage_at_level`, `races.traits`); real columns for anything filtered/sorted/joined (`challenge_rating`, `hp_current`, `edition_scope`, `initiative_roll`).
3. **Dual nullable FK + CHECK instead of a polymorphic type/id column** for `active_effects`, `character_items`, and `combat_participants` targets — costs an extra nullable column but keeps enforceable FK integrity and cascade deletes.
4. **Edition compatibility is a trigger/app-layer concern, not declarative** — Postgres CHECK constraints can't reference another table, so keeping a character's race/class/spell/item choices edition-safe needs a `BEFORE INSERT/UPDATE` trigger (or service-layer validation), not a schema constraint. Flagged explicitly so it isn't lost when migrations are written.

### 3.4 SRD rules-compliance review — summary

A dedicated validation pass against `.opencode/skills/dnd5e-srd`'s 2014/2024 rules text confirmed the schema's catalog/instance split, edition-scoping pattern, and JSONB/column judgment are sound. Five amendments (already folded into §3.2 above) came out of that review:

1. **Multiclass prerequisites** need two abilities for some classes (Paladin STR+CHA, Ranger/Monk DEX+WIS) — added `class_multiclass_prerequisites`.
2. **Multiclass spell slots** are not the sum of each class's own slots — they're a combined-caster-level lookup (full casters 1:1, half-casters ÷2, third-casters ÷3) — added `classes.spellcasting_type` + `multiclass_spell_slot_table`; `character_resource_pools` spell-slot rows are a computed cache, not source of truth.
3. **Concentration** ("can't concentrate on two spells at once") is a declarative invariant via a partial unique index on `active_effects`, not just an app-layer check. Implementation note (post-launch correction): applying a new concentration effect **auto-ends** the target's prior one in the same transaction (matching the real SRD rule that casting a new concentration spell breaks the old one) rather than rejecting the second effect — the unique index still exists as a defensive fallback for the concurrent-request race, but it's no longer the primary mechanic callers hit.
4. **Exhaustion** doesn't fit `duration_type`/`duration_value` (it's a level 0–6 with its own 2014-vs-2024 mechanical differences, not a countdown) — added `characters.exhaustion_level` and a generic `active_effects.stack_count` for any other stacking effect.
5. **2024 backgrounds** grant ability-score bonuses and an Origin feat (2014 races grant the bonus instead) — added `backgrounds.ability_bonus_choices` and `backgrounds.granted_feat_id`.

A sixth, lower-priority item: `feats.prerequisite` is free text; promoting it to a structured `feat_prerequisites` join table (the SRD skill's own feat data already models prerequisites structurally) would let feat prerequisites be validated at character-creation time instead of just displayed. Deferred to a later phase since it's not blocking.

### 3.5 Extension schema: creatures, battle map, dice rolls, images, armor

Added when extending the built app with five new features (bestiary CRUD, a battle map, a d20 roller, image uploads, and an armor/AC system). Every change below is **additive only** — new tables, or new nullable/defaulted columns — nothing existing is renamed, retyped, or dropped, so no existing campaign data is affected.

```sql
-- ===== Images / file uploads =====
-- Already speced above (this section) as part of the original plan's Cross-cutting
-- group but never migrated; built now, tightened slightly (mime/size tracked,
-- asset_type narrowed to what this work actually produces).
CREATE TABLE campaign_assets (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
  asset_type          TEXT NOT NULL CHECK (asset_type IN ('image','handout')), -- 'handout' reserved for future use
  file_url            TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  file_size_bytes     INT NOT NULL,
  title               TEXT,
  visible_to_players  BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON campaign_assets (campaign_id);

-- Storage: local disk under a gitignored packages/server/uploads/ directory,
-- served via express.static at /uploads, written with multer (mime allowlist:
-- image/png|jpeg|webp|gif; size cap via MAX_UPLOAD_BYTES env var, default 5MB;
-- filenames are always crypto.randomUUID(), never the client-supplied name).
-- No thumbnail-generation service (no sharp/native image dependency) —
-- thumbnails are CSS object-fit:cover at display size. Matches the project's
-- existing self-hosted/no-cloud-dependency posture (Postgres+Redis are both
-- local containers already); flagged as a known limitation if this ever needs
-- multi-instance/horizontal deployment (resolves the §10 open question below).

ALTER TABLE characters ADD COLUMN portrait_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL;

-- ===== Creatures / bestiary (homebrew scoping) =====
-- Mirrors effect_definitions.is_homebrew/owning_campaign_id exactly — the
-- established pattern in this codebase for "extend a global catalog with
-- campaign-scoped homebrew content without a write-everywhere free-for-all."
ALTER TABLE monsters ADD COLUMN is_homebrew BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE monsters ADD COLUMN owning_campaign_id BIGINT REFERENCES campaigns(id) ON DELETE CASCADE;
ALTER TABLE monsters ADD CONSTRAINT homebrew_scope CHECK (is_homebrew OR owning_campaign_id IS NULL);
ALTER TABLE monsters ADD COLUMN art_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL;
-- Cross-campaign consistency (art_asset_id's row must belong to the same
-- campaign as owning_campaign_id) is a service-layer check, not a DB
-- constraint — same "app-layer, not declarative" precedent as §3.3 item 4.

-- actions/legendary_actions/reactions JSONB shape upgrades going forward from
-- {name, desc} (attack bonus buried in prose) to:
--   {name, description, attackBonus?, damageDice?, damageType?, saveDc?, saveAbilityIndex?}
-- The optional structured fields are what let the dice roller trigger a real
-- attack/save roll for an action; existing seeded actions are left as-is
-- (still displayable, just not roll-triggerable) except for a hand backfill
-- of attackBonus on the current starter bestiary (goblin/wolf/skeleton/orc)
-- so the dice roller has real data to demo against.

ALTER TABLE monster_instances ADD COLUMN art_asset_id_override BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL;
ALTER TABLE monster_instances ADD COLUMN armor_class_override INT; -- used by the armor/AC extension below

-- ===== Battle map =====
CREATE TABLE encounter_maps (
  id                  BIGSERIAL PRIMARY KEY,
  encounter_id        BIGINT NOT NULL UNIQUE REFERENCES encounters(id) ON DELETE CASCADE,
  background_asset_id BIGINT REFERENCES campaign_assets(id) ON DELETE SET NULL,
  grid_columns        INT NOT NULL DEFAULT 20,
  grid_rows           INT NOT NULL DEFAULT 20,
  cell_size_px        INT NOT NULL DEFAULT 50,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One optional 1:1 extension per encounter (not every encounter has a map
-- configured) — same "separate dependent table" precedent as
-- character_resource_pools, rather than nullable columns crammed onto encounters.

ALTER TABLE combat_participants ADD COLUMN pos_x INT; -- both nullable: no
ALTER TABLE combat_participants ADD COLUMN pos_y INT; -- position until the DM places the token.

-- ===== Dice rolls =====
-- The Cross-cutting group above already specs a generic dice_rolls table;
-- this tightens it to match "d20 checks with advantage/disadvantage"
-- specifically rather than a generic multi-die expression logger.
CREATE TABLE dice_rolls (
  id                  BIGSERIAL PRIMARY KEY,
  campaign_id         BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id             BIGINT NOT NULL REFERENCES users(id),
  character_id        BIGINT REFERENCES characters(id) ON DELETE SET NULL,
  monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE SET NULL,
  encounter_id        BIGINT REFERENCES encounters(id) ON DELETE SET NULL, -- nullable: rolls can happen outside combat
  roll_type           TEXT NOT NULL CHECK (roll_type IN
                         ('ability_check','saving_throw','skill_check','attack','initiative','death_save','custom')),
  roll_context        TEXT, -- display label, e.g. 'Stealth', 'STR Save', 'Scimitar'
  d20_rolls           INT[] NOT NULL, -- 1 element normally, 2 for advantage/disadvantage
  keep                TEXT NOT NULL DEFAULT 'normal' CHECK (keep IN ('normal','advantage','disadvantage')),
  modifier            INT NOT NULL DEFAULT 0,
  result_total        INT NOT NULL, -- kept die + modifier
  visible_to_players  BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON dice_rolls (campaign_id, created_at);
CREATE INDEX ON dice_rolls (encounter_id);
-- Nat20/nat1 highlighting is computed client-side from d20_rolls (no
-- redundant stored boolean). character_id/monster_instance_id are
-- independently nullable, not a num_nonnulls=1 CHECK, since a roll can
-- belong to neither (a DM rolling "for the room").

-- ===== Armor & equipment AC =====
-- items.armor_class_base/armor_class_formula already exist (Phase 2) but
-- were write-only (seeded, never read). These new structured columns replace
-- the informal properties.category/str_requirement/stealth_disadvantage
-- keys used ad hoc in seed data, and become what the AC compute function
-- actually reads — armor_class_formula stays as a legacy display string.
ALTER TABLE items ADD COLUMN armor_category TEXT CHECK (armor_category IN ('light','medium','heavy'));
ALTER TABLE items ADD COLUMN dex_modifier_rule TEXT CHECK (dex_modifier_rule IN ('full','max_2','none'));
ALTER TABLE items ADD COLUMN str_requirement INT;
ALTER TABLE items ADD COLUMN stealth_disadvantage BOOLEAN NOT NULL DEFAULT false;
-- Seed update backfills armor_class_base=2 for the Shield row (today only
-- has the free-text '+2 AC' formula) so every armor/shield row has a real
-- numeric base for the compute function to add on top of.

ALTER TABLE characters ADD COLUMN armor_class_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK (armor_class_mode IN ('auto','manual'));
-- Defaulting to 'manual' is the key "don't change existing behavior"
-- guarantee: every character keeps today's flat manually-edited AC until
-- someone explicitly opts into 'auto'. monster_instances.armor_class_override
-- (added above, in the bestiary block) gives DMs the equivalent manual
-- escape hatch for creature instances.
```

**Design notes**:
- Homebrew creatures (`is_homebrew=true`) are the only `monsters` rows that can reference a `campaign_assets` row for art, since only they share a `campaign_id` with the asset — global/seeded monsters have no art (consistent with them having no uploaded content at all).
- `computeArmorClass` (new pure function, `services/armorClass.ts`, same pure-function-first style as `services/hp.ts`/`services/spellSlots.ts`) is explicitly scoped to: unarmored `10 + Dex mod`; one equipped armor item's base + Dex-mod-per-`dex_modifier_rule`; `+2` flat if a shield is equipped (additive, not a replacement). It does **not** attempt to model class-specific Unarmored Defense (Barbarian/Monk) or other exotic AC sources — those stay on `armor_class_mode='manual'`, which is exactly what the manual-override requirement is for.

---

## 4. REST API Design

**Auth**: session cookie (`httpOnly`, `Secure`, `SameSite=Lax`), Redis-backed session store, `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. CSRF mitigated via `SameSite=Lax` + a custom header check on state-changing routes.

**Layered authorization** (applied to every endpoint below): (1) authenticated → (2) campaign member → (3) role check (DM vs Player) → (4) ownership check (players only mutate their own PC/items). Default-deny throughout; DMs get full CRUD in their campaign, players read everything in campaigns they belong to but can only create/edit/delete their own characters and that character's items/spells/resources — never NPCs or campaign settings.

### 4.1 Endpoint catalog

**Campaigns & membership** — `POST/GET/PATCH/DELETE /campaigns(/:id)`, `POST/GET/PATCH/DELETE /campaigns/:id/members(/:userId)`, `POST/GET/PATCH/DELETE /campaigns/:id/sessions(/:sid)`, `POST/GET/PATCH/DELETE /campaigns/:id/locations(/:lid)`.

**Characters** — `GET/POST /campaigns/:id/characters`, `GET/PATCH/DELETE /characters/:id`, `PUT /characters/:id/classes|skill-proficiencies|saving-throw-proficiencies` (bulk replace-all), `GET/POST/PATCH/DELETE /characters/:id/spells(/:spellId)`, `GET/POST/PATCH/DELETE /characters/:id/items(/:itemId)`, `GET /characters/:id/resources`, `POST /characters/:id/resources/:key/spend|recover`, **`PATCH /characters/:id/hp`** — body is `{delta, temp_delta}` (a signed delta, not an absolute value), so the DB update stays a single atomic `UPDATE ... SET hp_current = GREATEST(0, hp_current + $delta)`.

**Catalog/reference (read-only)** — `GET /catalog/{races|subraces|classes|subclasses|class-levels|class-features|backgrounds|feats|spells|items|monsters|conditions|skills|languages|alignments|damage-types|magic-schools|weapon-properties|proficiencies|cr-xp-table}` (accepts `?edition=2014|2024|both`), plus `GET /campaigns/:id/catalog/:resource` pre-filtered by the campaign's `srd_edition`. No write endpoints — catalog is seeded by migration/admin tooling, not the app API.

**Monsters / monster instances** — `GET /catalog/monsters` (bestiary browse, filter CR range/creature_type/edition), `POST/GET/PATCH/DELETE /campaigns/:id/monster-instances(/:id)`, `PATCH /monster-instances/:id/hp` (same signed-delta shape as characters).

**Encounters & combat** — `POST/GET/PATCH/DELETE /campaigns/:id/encounters(/:id)` (list may return several `status=active` rows — no single "active encounter" concept), `POST /encounters/:id/start|end`, `POST/DELETE /encounters/:id/participants(/:pid)`, `POST /encounters/:id/roll-initiative` (server rolls d20+dex), `PATCH /encounters/:id/participants/:pid/initiative` (manual override), `POST /encounters/:id/advance-turn` (one transaction: turn advance + round-based effect decrement + broadcast), `POST/GET/DELETE /encounters/:id/effects(/:id)`, `POST /characters/:id/effects` and `/monster-instances/:id/effects` (apply outside combat, `encounter_id=null`). Every combat mutation endpoint is a single atomic transaction returning full new sub-resource state — exactly what the WS layer re-broadcasts.

**Rest management** — `POST /campaigns/:id/rests` (body `{rest_type, character_ids[]}`; server computes hit-dice/heal, updates `character_resource_pools` per `recharge_on`, writes `rest_events`/`rest_event_characters` transactionally), `GET /campaigns/:id/rests`.

**Notes** — `POST/GET/PATCH/DELETE /campaigns/:id/notes(/:id)`, `GET /campaigns/:id/notes/search?q=` (via `search_vector`), `GET/POST /campaigns/:id/tags`. Players never see `visible_to_players=false` rows — filtered at the query level, not just the client.

**Campaign assets/handouts** — `POST/GET/PATCH/DELETE /campaigns/:id/assets(/:id)`; players only see `visible_to_players=true`.

**Dice roll logging** — `POST /campaigns/:id/dice-rolls` — **server performs the RNG**, not the client (closes a cheating vector); `GET /campaigns/:id/dice-rolls` paginated history.

**Encounter templates/builder** — `POST/GET/PATCH/DELETE /campaigns/:id/encounter-templates(/:id)`, `POST/DELETE /encounter-templates/:id/monsters(/:monsterId)`, `GET /encounter-templates/:id/xp-budget` (pure function, not stored), `POST /encounter-templates/:id/activate` (materializes into `encounters` + `monster_instances` + `combat_participants` in one transaction).

### 4.2 Conventions

- **Validation**: Zod schemas per resource; update schemas are `.partial()` of create; enums mirror DB `CHECK` constraints; cross-field/DB-dependent rules (edition match, character-XOR-monster-instance) live in a service layer.
- **Errors**: `{ "error": { "code", "message", "details" } }` with stable machine codes (`FORBIDDEN_NOT_OWNER`, `NOT_CAMPAIGN_MEMBER`, `VALIDATION_ERROR`, `STALE_TURN`, ...).
- **Pagination**: cursor-based for high-churn logs (`dice_rolls`, note search); offset-based (with `totalCount`) for stable catalog browses (bestiary).

### 4.3 Tradeoffs

1. Coarse-grained, single-purpose combat endpoints (`PATCH .../hp`, `POST .../advance-turn`) rather than a generic PATCH — more routes, but each maps to exactly one atomic transaction and one clean WS broadcast event.
2. Server-authoritative dice rolls rather than trusting client-computed results.
3. NPC read-only-to-players is enforced explicitly and repeatedly across every characters/items/spells/resources route rather than abstracted once — more duplication, but keeps default-deny obvious at the one place it matters most.

### 4.4 Extension API additions

- **Images**: `POST /campaigns/:id/assets` (multipart/form-data; DM always allowed, a player only when the upload targets their own character), `GET /campaigns/:id/assets`, `DELETE /assets/:id`.
- **Creatures**: `POST/PATCH/DELETE /campaigns/:id/monsters(/:monsterId)` — the first write access to a catalog table in this app (every other catalog resource stays read-only-via-API per §4.1's original convention). Mounted under the campaign prefix (not flat under `/catalog/monsters`) for consistency with `/campaigns/:id/monster-instances`. DM-only, and only for rows the DM's own campaign owns (`owning_campaign_id` match); global/seeded monsters remain immutable via the API regardless of role — including edition_scope, which is always set server-side from the owning campaign's own `srd_edition` and is never client-settable, since `listMonsters`'s edition filter would otherwise hide a homebrew row from its own campaign the moment it diverged. `GET /catalog/monsters?campaignId=` extended to union the global catalog with that campaign's homebrew rows, gated by a campaign-membership check from the start (this endpoint previously had no campaign coupling at all, since it only ever served the global catalog).
- **Battle map**: `PUT /encounters/:id/map` (DM-only upsert of background asset + grid config), `PATCH /encounters/:id/participants/:pid/position` (DM-only, body `{x, y}`, both nullable to support "remove from the board").
- **Dice rolls**: `POST /campaigns/:id/dice-rolls` (server performs the RNG, same `1 + Math.floor(Math.random()*20)` idiom as `rollInitiative` — never trust a client-submitted roll result), `GET /campaigns/:id/dice-rolls?encounterId=&cursor=` (cursor-paginated per the existing high-churn-log convention, visibility-filtered like `notes`).
- **Armor**: `PATCH /characters/:id/armor-class-mode` (small dedicated endpoint, `{mode: 'auto'|'manual'}` — matches the existing `PATCH /:id/exhaustion` precedent of a focused single-purpose route rather than folding into the generic character PATCH; switching to `'auto'` triggers an immediate recompute). The existing item-equip toggle (`PATCH /characters/:id/items/:itemId`) and the generic character PATCH (when `dex` changes) both gain a recompute-and-write-back step, gated on `armor_class_mode === 'auto'`.

---

## 5. Real-Time Sync Design

**Transport**: Socket.io (not raw `ws`, not SSE). Native room primitives are essential for the nested topology below; auto-reconnect/backoff and ack callbacks give a ready-made idempotency channel.

### 5.1 Room topology

Two tiers per campaign: `campaign:{campaignId}` (every client joins on connect) and `encounter:{encounterId}` (joined only by clients active in that encounter). A DM running two simultaneous encounters is in both `encounter:12` and `encounter:13` on one socket, multiplexed, with the client routing by `encounterId` in the payload. A player joins only the encounter room(s) where their character has a live `combat_participants` row. This is per-encounter, not per-campaign, specifically because concurrent encounters can have disjoint rosters (split party) — a static campaign room would force clients to filter out irrelevant combat traffic.

### 5.2 Event protocol

All events carry `{encounterId, campaignId, seq, serverTimestamp}` — `seq` is `encounters.sync_seq`, a per-encounter monotonic counter bumped in the same transaction as the mutation; a `seq` gap on the client forces a resync rather than trusting transport ordering alone.

| Event | Recipients | Notes |
|---|---|---|
| `COMBAT_STARTED` | DM + players in encounter | |
| `INITIATIVE_ROLLED` | DM + players | no HP in payload |
| `TURN_ADVANCED` | DM + players | `{currentRound, currentTurnIndex, activeParticipantId}` |
| `DAMAGE_APPLIED` / `HEAL_APPLIED` | DM (exact) / players (filtered) | two payloads computed server-side, see §5.3 |
| `EFFECT_APPLIED` / `EFFECT_EXPIRED` | DM + players unless DM-hidden | respects `active_effects.visible_to_players` |
| `PARTICIPANT_JOINED` / `PARTICIPANT_LEFT` | DM + players | triggers a room-join push if it's a player's own PC |
| `COMBAT_ENDED` | DM + players | clients removed from `encounter:{id}` server-side after |
| `NOTE_UPDATED` | DM always / players only if `visible_to_players` | content omitted entirely (not just flagged) if not visible |
| `FULL_STATE_SYNC` | requesting client only | role-appropriate snapshot keyed by `seq` |

**Key rule**: for anything with a visibility split (damage, notes, hidden effects), compute two payloads server-side and emit twice — never one payload with a client-side "hide if player" flag, since a modified player client could otherwise recover hidden data straight off the wire.

### 5.3 DM-vs-player visibility

Per-participant `combat_participants.hp_visibility` (`exact | banded | hidden`), defaulting to `exact` for PCs and `banded` for monster instances unless the DM reveals it. Band function (server-side): `Healthy` (>75%), `Injured` (50–75%), `Bloodied` (25–50%), `Critical` (<25%, >0), `Down/Dead` (0) — deliberately mirroring 5e's own "Bloodied" language. `active_effects.visible_to_players` mirrors the notes pattern for DM-hidden conditions (a disguised identity, a trap).

### 5.4 Concurrency

The DM-advances-turn-vs-player-submits-damage race is resolved by **reject-and-inform**: each mutation validates against current state inside the same transaction that applies it (e.g. damage carries the turn/round context it was issued against; the conditional `WHERE encounter.current_turn_index = $expectedTurnIndex` matches zero rows if the turn already advanced, and the server returns `409 STALE_TURN`). No cross-request lock is held across a network round-trip — a slow player never blocks the DM.

### 5.5 Reconnection & idempotency

On reconnect, the server re-derives room membership from DB state (not client-claimed state), then the client requests `FULL_STATE_SYNC` per rejoined room and blocks event application until it lands — no merge, no replay of missed events. If the DM disconnects mid-combat, nothing pauses mechanically (state is DB-resident); a `DM_DISCONNECTED` advisory goes to players, player action validation continues normally server-side. Idempotency: every action carries a client-generated `requestId`; server keeps a dedup table `(encounter_id, request_id)` with a TTL, using `INSERT ... ON CONFLICT DO NOTHING RETURNING *` in the same transaction as the mutation — a duplicate returns the cached original outcome rather than silently no-op-ing.

### 5.6 Tradeoffs

1. Two-payload-per-role emits cost more server branching than a client-side redaction flag, but it's the only version where a modified player client can't recover hidden data.
2. Per-encounter rooms with dynamic join/leave add complexity versus a static campaign room — justified specifically by the split-party requirement.
3. Reject-and-inform on stale-turn conflicts costs an occasional redo for the player, in exchange for never having ambiguous combat state.

### 5.7 Extension real-time events

- **`TOKEN_MOVED`** (`{...envelope, participantId, x, y}`) and **`MAP_UPDATED`** (background/grid config changes) — room-wide, no DM/player visibility split needed. Position itself isn't banded like HP; the underlying HP-band/hidden-effect visibility rules already govern what a token's appearance reveals, so the map layer doesn't need its own separate visibility system.
- **`DICE_ROLLED`** — room-wide unless the roll's `visible_to_players=false`, in which case DM-only via the existing `splitSocketsByRole` helper (exact mirror of the effect-visibility broadcast already built for `EFFECT_APPLIED`/`EFFECT_EXPIRED`).
- `getEncounterCombatSnapshot`/`FULL_STATE_SYNC` extended to include `posX`/`posY` per participant and the encounter's map config (if any) at the top level.
- No new broadcast for AC changes in the common case (a plain character PATCH still isn't broadcast, matching today's behavior) — **except** when the character is currently a live combat participant, in which case the new AC is broadcast to that `encounter:{id}` room so the combat tracker's participant row (which will now display AC) stays live for everyone watching, folded into the armor/AC extension rather than a separate general-purpose "character changed" event.
- All new mutations follow the established discipline exactly: bump `encounters.sync_seq` inside the same transaction as the write, and the route calls the new `broadcast*` only after that transaction has committed.

---

## 6. Frontend Architecture

### 6.1 Routes

`/campaigns/:campaignId/` shell with nested routes: dashboard, `/characters`, `/characters/:id` (sheet), `/bestiary` (DM-only), `/encounter-builder` (DM-only), `/encounters` + `/encounters/:id` (combat tracker), `/notes`, `/assets`, `/sessions`, `/rests` (DM-only), `/members` (DM-only). A `RequireRole`/`RequireOwnership` wrapper gates DM-only routes and edit affordances client-side (defense in depth; the API is the real authority).

### 6.2 Hardest three views

- **Character sheet** (`CharacterSheetPage`): `AbilityScoreGrid`, `SavingThrowList`, `SkillList` (tri-state `ProficiencyToggle`), `HPPanel` (`HPBar` + `HPAdjustForm`), `ClassLevelSummary` (multiclass), `SpellcasterPanel` (`SpellSlotTracker` + `SpellList` with prepared toggle), `ResourcePoolPanel`, `InventoryPanel` (`ItemCard` grid). A single `useCharacterEditMode` hook resolves `read | edit-full | edit-own` once, rather than scattering ownership checks per field.
- **Combat tracker**: an `EncounterTabStrip` (not side-by-side panes, not a modal picker) handles multiple simultaneously active encounters — scales to N, keeps each tab's socket room live while mounted. Each `EncounterPanel` has `InitiativeList`/`InitiativeRow`, `DamageApplyDialog`, `EffectApplyDialog`, `ParticipantAddPanel`, `CombatLog`.
- **DM bestiary/encounter builder**: `BestiaryBrowser` (filter/table/`MonsterDetailDrawer`, "Spawn into Encounter" shortcut) separate from `EncounterBuilderPage` (`TemplateMonsterPicker`, `XPBudgetPanel` reading the server-computed budget, `ActivateEncounterButton`).

### 6.3 Real-time reconciliation

On `DAMAGE_APPLIED`, `SocketProvider`'s handler calls `queryClient.setQueryData(['character', targetId], ...)` (or `['monster-instance', targetId]`) directly with the payload's absolute `hpCurrent`/`hpTemp` — a targeted patch, not `invalidateQueries` (a refetch would visibly lag behind the socket event). Payloads carry absolute values, not deltas, so a client's own optimistic update (`onMutate`) and the broadcast echo of that same action converge on the same value with no double-apply risk. A `seq` gap falls back to `invalidateQueries` (full resync), matching the "no merge" principle from §5.5.

### 6.4 Shared primitives

`HPBar`, `StatBlock`, `DiceRoller`, `ItemCard`, `InitiativeRow`, `EffectBadge`, `ResourcePoolMeter`, `ProficiencyToggle`, `RoleGate`/`OwnershipGate` — reused across the character sheet, combat tracker, and bestiary (e.g. `StatBlock` renders in `MonsterDetailDrawer`, the NPC read view, and a compact `InitiativeRow` expansion).

### 6.5 Tradeoffs

1. Tailwind + headless primitives costs more upfront component-building time vs. a full kit, in exchange for not fighting a kit's opinions on bespoke widgets.
2. Patch-in-place on socket events couples cache shape to socket payload shape, justified by needing to avoid visible lag during fast combat.
3. One `CampaignShell` with runtime role branching (vs. separate route trees) adds conditional logic to shared components but avoids duplicating fetch/query-key logic across two near-identical trees.

### 6.6 Extension frontend additions

- New shared primitives — finally building several already-named-but-unbuilt ones from §6.4: `Portrait`/`ImageUploadField`, `StatBlock`, `DiceRoller`.
- `BestiaryPage`/`CreatureEditorPage` (DM-only, matches the already-planned `/bestiary` route from §6.1) — full stat-block editor plus a browse/filter view (CR, creature type, homebrew-vs-global) with a "spawn instance into encounter" shortcut.
- `BattleMap.tsx` + `Token.tsx`, rendered as a "List"/"Map" toggle **inside** the already-mounted `CombatTracker` (not a new modal or route), so the existing `useEncounterLive` socket subscription stays live across the toggle exactly the way it already stays live across the `EncounterTabStrip`'s tab switches. Positioning: plain CSS grid + absolutely-positioned divs — no canvas/SVG/drag library, consistent with the app's existing "raw Tailwind, no visual libraries" style, since grid-cell (not free-form pixel) positioning doesn't need one. Dragging via native pointer events (`onPointerDown`/`onPointerMove`/`onPointerUp` + `setPointerCapture`) with snap-to-nearest-cell on drop; only the final dropped position is persisted/broadcast (no per-pixel streaming mid-drag, to avoid a write/broadcast storm).
- Dice-roller triggers wired onto `SkillsPanel`/`SavingThrowsPanel` (both already compute the exact modifier via `lib/dnd-math.ts`'s `abilityModifier`/`skillModifier`/`proficiencyBonusForLevel` — no new modifier-calculation logic needed, only new roll UI) and a new attack-roll affordance on equipped weapons / monster actions that have the new structured `attackBonus` field. A three-state Normal/Advantage/Disadvantage control at roll time (roll 2d20 on either non-normal setting, keep highest/lowest); nat20/nat1 highlighting computed client-side from the raw `d20_rolls` array.
- `InventoryPanel` extended with an AC breakdown line ("10 base + 2 Dex + 2 shield = 14") and the auto/manual mode toggle — folded into the existing panel rather than a new one, since the equipped-items data it already owns is exactly what AC computation needs.
- `lib/api.ts` gains an `upload()` helper for multipart requests (the existing wrapper always JSON-stringifies bodies today).
- Design polish (per the user's request) is applied as a standing instruction across every one of the above, not a separate pass: keep the established panel shell (`rounded-lg border border-stone-800 bg-stone-900 p-4 sm:p-5`, uppercase micro-headings, the stone/amber dark palette) and improve spacing/hierarchy/interaction smoothness while building each new view, rather than bolting on a new visual language.

---

## 7. Project Folder Structure

```
/
├── packages/
│   ├── server/                    # Express + Socket.io
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── migrations/    # node-pg-migrate or Knex migrations, timestamp-named
│   │   │   │   └── seeds/         # SRD catalog seed scripts (pull from .opencode/skills/dnd5e-srd/data)
│   │   │   ├── routes/            # one file per resource area (characters.ts, encounters.ts, ...)
│   │   │   ├── services/          # business logic + authorization layering, DB transactions
│   │   │   ├── sockets/           # Socket.io namespace/room setup, event emitters
│   │   │   ├── schemas/           # Zod request/response schemas
│   │   │   └── middleware/        # auth, campaign-membership, role, ownership guards
│   │   └── package.json
│   └── web/                       # Vite + React + TS
│       ├── src/
│       │   ├── routes/            # React Router route tree, CampaignShell
│       │   ├── components/        # shared primitives (HPBar, StatBlock, DiceRoller, ...)
│       │   ├── features/          # characters/, encounters/, notes/, bestiary/, encounter-builder/
│       │   ├── hooks/              # useCharacterEditMode, useSocketEvent, ...
│       │   ├── lib/                # TanStack Query client, Socket.io client setup
│       │   └── styles/             # Tailwind config
│       └── package.json
├── .opencode/                      # existing agent/skill configs (unchanged)
├── CLAUDE.md                       # existing
└── PLAN.md                         # this file
```

A monorepo (npm/pnpm workspaces) keeps `server` and `web` independently buildable while sharing nothing but conventions — no shared TS package is needed yet since the API is REST (not tRPC), avoiding a premature shared-types package before the schema stabilizes.

---

## 8. Phased Implementation Roadmap

**Phase 0 — Foundation**
Monorepo scaffolding (Vite + Express workspaces), Postgres + Redis running locally (docker-compose), migration tooling wired up, session-cookie auth end-to-end (register/login/logout/me), campaign + campaign_members CRUD, catalog seed script pulling races/subraces/classes/subclasses/class_levels/class_features/backgrounds/feats/conditions/skills/languages/alignments/damage_types/magic_schools/weapon_properties/proficiencies/ability_scores from `.opencode/skills/dnd5e-srd` for both editions.

**Phase 1 — MVP: run an actual session**
Character CRUD (PC/NPC) with the core stat block (abilities, AC, HP, saves, skills, proficiencies) — no spells/items/resource pools yet. A minimal app-owned `monsters` catalog (hand-entered starter bestiary) + `monster_instances`. Combat tracker: single-encounter-at-a-time UI is acceptable here even though the schema already supports N (defer the `EncounterTabStrip` multi-encounter UI to Phase 2) — initiative, HP application via signed delta, turn/round advance, participant add/remove. DM view vs. player view split with Socket.io wired for combat events only (`COMBAT_STARTED`, `INITIATIVE_ROLLED`, `TURN_ADVANCED`, `DAMAGE_APPLIED`, `PARTICIPANT_JOINED/LEFT`, `COMBAT_ENDED`), banded HP for players. Basic notes (create/read, campaign+session scoped, no tagging/search yet).

**Phase 2 — Character depth & multi-encounter**
Spell & item catalogs (app-owned) + `character_spells`/`character_items`, `character_resource_pools` with short/long rest handling, multiclassing (`character_classes`, `class_multiclass_prerequisites`, `multiclass_spell_slot_table`), `active_effects`/`effect_definitions` with full duration tracking, the concentration unique-index invariant, and `exhaustion_level`. Upgrade the combat tracker UI to the full `EncounterTabStrip` for genuinely concurrent split-party encounters.

**Phase 3 — Creatures, battle map, dice rolls, images, armor** (§3.5/§4.4/§5.7/§6.6 above)
Implemented as five sequential, individually-confirmed sub-phases (each ending in a persona-delegated build + `pre-merge-reviewer` pass, mirroring Phases 0–2's process exactly):
- **3.1 Images & uploads**: `campaign_assets`, local-disk storage + `multer`, upload/list/delete routes, `Portrait`/`ImageUploadField` — built first since 3.2 and 3.3 depend on it.
- **3.2 Creatures / bestiary**: homebrew-scoped `monsters` (mirrors `effect_definitions.is_homebrew`), catalog CRUD (the app's first writable catalog resource), `BestiaryPage`/`CreatureEditorPage`/`StatBlock`.
- **3.3 Battle map**: `encounter_maps`, `combat_participants.pos_x/pos_y`, `TOKEN_MOVED`/`MAP_UPDATED`, `BattleMap`/`Token` as a List/Map toggle inside the existing `CombatTracker`.
- **3.4 d20 dice roller**: `dice_rolls`, advantage/disadvantage (roll 2, keep highest/lowest), server-authoritative RNG (reuses `rollInitiative`'s idiom), per-encounter roll history, `DiceRoller` component wired onto skills/saves/attacks.
- **3.5 Armor & equipment**: structured `items` armor columns, `characters.armor_class_mode` (`auto`/`manual`, defaults to `manual` so no existing character's AC changes), `computeArmorClass` pure function, `InventoryPanel` AC breakdown.

The original Phase 3's remaining items — full bestiary CR/type-filter browser polish (now folded into 3.2), encounter builder with CR/XP budgeting (`encounter_templates`), session timeline/recap (`session_events`), notes tagging + full-text search (`tags`, `search_vector`), and promoting `feats.prerequisite` to a structured table — move to Phase 4 below, since they weren't part of this extension request.

**Phase 4 — Further additions**
Encounter builder with CR/XP budgeting (`encounter_templates`), session timeline/recap (`session_events`), notes tagging + full-text search (`tags`, `search_vector`), structured `feat_prerequisites` if character-creation-time validation becomes a priority.

**Phase 5 — Hardening**
Edition-compatibility trigger/service-layer enforcement (flagged in §3.3 as a known gap), permission edge-case audit (sole-DM demotion, orphaned resources on member removal), load-test the Socket.io room fan-out under multiple concurrent encounters, integration test suite for the authorization matrix (every DM/player × every resource area).

---

## 9. Verification Plan

Once implementation begins, verify each phase end-to-end rather than relying on type-checks alone:

- **Phase 0**: register two users, create a campaign as one (DM), invite the other (player), confirm session cookies gate every route, confirm the SRD seed script populates `races`/`classes`/etc. for both editions (spot-check via `GET /catalog/races?edition=2024` returning species-renamed data).
- **Phase 1**: as DM, create a PC and an NPC, spawn a monster instance, start an encounter, roll initiative, advance turns, apply damage via the signed-delta endpoint, confirm the player browser tab (separate session) receives the Socket.io broadcast in real time and sees banded (not exact) monster HP while seeing exact HP for their own PC.
- **Phase 2**: build a multiclass character (e.g. Paladin 3/Warlock 2), confirm computed spell slots match the multiclass table (not the sum of each class's own table), apply two concentration spells to the same character and confirm the second auto-ends the first (not a rejection), run a short and long rest and confirm `character_resource_pools` recharge correctly per `recharge_on`.
- **Phase 3.1 (images)**: upload an oversized/wrong-mime-type file and confirm server-side rejection (not just client-side); confirm a player can upload a portrait for their own character but not for someone else's, and not at all to a campaign they're not a member of.
- **Phase 3.2 (creatures)**: create a homebrew creature as DM, confirm it appears in `GET /catalog/monsters?campaignId=` alongside the global catalog but is invisible to a different campaign's DM; confirm a global/seeded monster rejects a `PATCH`/`DELETE` attempt even from a DM.
- **Phase 3.3 (battle map)**: DM drags a token to a new cell, confirms the position persists across a page reload, and a second browser tab (the other role) sees the move live via `TOKEN_MOVED` without a manual refresh.
- **Phase 3.4 (dice roller)**: roll a skill check with advantage, confirm both d20s are shown with the higher one visibly "kept"; roll a nat20 and a nat1 and confirm both are highlighted; confirm a DM-hidden roll (`visible_to_players=false`) never reaches a player's `DICE_ROLLED` handler.
- **Phase 3.5 (armor)**: switch a character to `armor_class_mode='auto'`, equip/unequip a shield and confirm AC updates by exactly +2/-2; equip heavy armor on a low-Dex and a high-Dex character and confirm AC is identical for both (no Dex bonus applied); confirm switching back to `'manual'` leaves the last computed value editable as a plain number again.
- **Phase 4**: run the encounter builder against a known party size/level and cross-check the XP budget math against the DMG multiplier table by hand for one example.
- **Phase 5**: two DM browser tabs racing to advance the same encounter's turn while a player submits damage — confirm exactly one succeeds and the other gets a clean `409 STALE_TURN`, not corrupted state.

---

## 10. Open Questions Deferred (not blocking this plan)

- Exact hosting/deployment target (not asked — infra choice can be made independently of this design).
- Whether "Player can create their own notes" is allowed by table convention or DM-only (the API design flagged this as a per-campaign convention, not a hardcoded rule — worth a product decision before Phase 1's notes UI ships).
- ~~Image/asset storage backend (local disk vs. S3-compatible) for `campaign_assets.file_url`~~ — **resolved in §3.5**: local disk under `packages/server/uploads/`, served via `express.static`. Matches the project's existing no-cloud-dependency posture; revisit if this ever needs multi-instance/horizontal deployment.
