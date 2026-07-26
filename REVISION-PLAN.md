# REVISION-PLAN.md — Loresmith v2

> **v3 note**: a further "Full Refactor" brief landed after this document's §10 shipped — see `REFACTOR-PLAN.md`. It picks up some of this file's still-deferred sections (§2 bestiary polish, parts of §4/§6) in a smaller form scoped to what was actually asked for; §0 there has the full reality-check against this file.

> **Status update (after review):** the sections below (§1–§8, as originally drafted) covered the full v2 revision brief — reveal-system removal, global bestiary, a media/content-addressing overhaul, a new campaign-level canvas map system, a music system, and a table-display route. After discussion, the actual scope for this work round is much narrower — see **§9 (Interface Accessibility & DM Ergonomics)** below, which is what's actually being built now. The decisions that changed things:
>
> - **The reveal engine and `hp_visibility` are both KEPT, not removed.** §1 below (reveal-system removal) does **not** happen. The DM still controls what's visible to players per-field (including occulting a creature's vulnerabilities/resistances/immunities until the party discovers them in play — this already works today via `MONSTER_INSTANCE_REVEALABLE_FIELDS`, no new code needed for that specific case) and per-HP-band. DM-only records (notes, encounter planning) stay hidden via the existing `visible_to_players` flags, untouched.
> - **§2–§6 (global bestiary polish, media overhaul, new maps, music, table display) are deferred**, not abandoned — kept below as a reference design for whenever that work actually gets picked up, but nothing in this round touches them. The existing per-encounter battle map, current media/upload system, and single role-branched SPA all stay exactly as they are.
> - **§7 (redesign) is replaced by §9** — the actual ask turned out to be narrower and more concrete than a full visual redesign: accessibility fixes plus two specific DM-ergonomics gaps (stat lookup and dice rolling both currently require leaving the combat view).
>
> §1–§8 are left below, unedited, as the reference design for the deferred work — do not implement from them without re-confirming scope first.
>
> **Second update:** §9's accessibility/ergonomics pass, while real, turned out to be smaller than what was actually wanted — the ask was a genuine interface restructure, not a patch. **§10 (Structural & Visual Redesign) has now shipped**, in three pieces (nav split; ember theme/typography/`TurnTorch`; the map+side-panel battle-mode layout for both roles, including a small, tested authorization change so a player can spend their own actions during their turn). All verified independently (typecheck/lint/test ×2/build) after each piece landed — see git history for the actual diffs. `reveal_defaults`'s settings editor and the deferred §2–§6 work remain the next candidates if you want to keep going.

---

## 0. Reality check — what the brief assumes vs. what's actually here

The brief is written against the mental model of the *original* project brief (JSON files in `./data/`, Fastify, a `Revealable<T>` wrapper type, an already-existing `/play` route). None of that is what got built. Per the brief's own instruction ("if any existing code conflicts with this brief, this brief wins — tell me what you're overriding"), here is every place the literal brief language doesn't match reality, and what this plan substitutes:

| Brief assumes | Actually true | What this plan does |
|---|---|---|
| JSON files under `./data/`, a `migrate:v2` script that rewrites that JSON | PostgreSQL (`packages/server/src/db/migrations/`), Redis sessions, no JSON data store anywhere | "Migration" = a real `node-pg-migrate` schema migration + a companion idempotent Node backfill script (§8), not a JSON rewriter. Existing uploaded files (not DB rows) are what actually needs a filesystem migration — covered in §3. |
| Fastify + `ws` | Express 5 + Socket.io, already deeply wired (rooms, DM/player socket splitting, reconnection) | Kept as-is. Nothing about this brief requires ripping out a working real-time layer. |
| `Revealable<T>`, a reveal serializer, `<RevealToggle>`, `useReveal()` | Two **separate** mechanisms exist: (1) `entity_field_reveals` + `useReveals()`/`<RevealToggle>` — a per-field DM/player reveal engine, built this session; (2) `hp_visibility` — an older, independent three-state HP-banding system (`exact`/`banded`/`hidden`) that predates the reveal engine and was *deliberately kept separate* from it. There's also a third, unrelated thing: plain `visible_to_players` booleans on `notes`/`active_effects`/`campaign_assets`/`dice_rolls` — simple "DM hides this record" flags, not a per-field engine at all. | **Decision, flagged for your review:** §1 removes (1) and (2) together — HP-band-instead-of-exact-numbers was literally the flagship example in the *original* brief's `Revealable<T>` spec, so it's the same conceptual system even though it shipped as separate code. §1 does **not** touch the plain `visible_to_players` flags — they're not a reveal engine, nothing in this brief asks for them to go, and real features (DM-only notes, DM-hidden dice rolls) depend on them. If you want those gone too, say so and I'll fold them into §1. |
| Bestiary needs to move from per-campaign to global | Already global. `monsters` is a shared catalog table; homebrew creatures get `is_homebrew=true` + `owning_campaign_id` scoping the same way `effect_definitions` already does. There is no per-campaign duplication to merge. | §2 shrinks to what's actually missing: the `usedIn` index and the "never used" filter. No dedup migration needed — flagged as a scope reduction, not padded out to match the brief's assumed effort. |
| A `/play` second-screen route already exists and just needs its redaction layer dropped | No such route exists. The DM and player views are the same React app, branched by `role` inside `CampaignShell` (a deliberate original-design decision to avoid two 80%-identical route trees). | §6 is a genuinely new route (`/table/:campaignId`), not a redaction-removal pass on an existing one. Scoped to what the brief actually describes: map display + handout push + reconnection UI. |
| Maps exist and this is an enhancement pass | A battle map already exists, but it's **encounter-scoped** (`encounter_maps`, one row per encounter, CSS grid + absolutely-positioned divs, no canvas library). The brief wants **campaign-scoped** map library entities, decoupled from any one encounter, canvas-rendered, with fullscreen/calibration/undo. | §4 proposes replacing `encounter_maps` + `combat_participants.pos_x/pos_y` with a new campaign-level `maps` + `map_tokens` design (single source of truth for position, no duplication) rather than bolting the new feature set onto the old table. This is the single biggest architectural change in this brief — see §4.4 for the explicit call-out. |
| Music exists and needs features added | No audio system exists anywhere in the codebase. | §5 is entirely new: schema, Web Audio graph, persistent player. |
| `npm run check`, `npm run migrate:v2`, `npm run media:gc` | None of these scripts exist. Root `package.json` currently has only `dev:server`, `dev:web`, `migrate`, `seed`, `test`, `build` — no `lint`/`format`/`check` at the root at all (the web package has its own `lint` via oxlint; the server package has none). | §8 adds `check` (typecheck + lint + test across both workspaces), `migrate:v2` (the backfill script), and `media:gc`, following this repo's existing script-naming and workspace-delegation conventions. |

Everything below assumes these substitutions. Flag any of them you disagree with before I start §1.

---

## 1. Remove the reveal / hidden-information system

### 1.1 Files deleted outright

**Server**
- `packages/server/src/domain/revealFields.ts`
- `packages/server/src/schemas/reveals.ts`
- `packages/server/src/services/entityFieldReveal.ts`
- `packages/server/src/services/entityFieldReveal.test.ts`
- `packages/server/src/services/entityFieldReveal.integration.test.ts`
- `packages/server/src/services/hpVisibility.ts`
- `packages/server/src/services/hpVisibility.test.ts`

**Client**
- `packages/web/src/components/RevealToggle.tsx`
- `packages/web/src/lib/useReveal.ts`

### 1.2 Files edited (imports/usages stripped, not adapted)

**Server**
- `services/characters.ts` — remove `resolveReveals`/`redactEntityFields`/`resolveHpVisibility`/`redactHpFields` calls in `listCharacters`/`getCharacter`; these go back to returning the plain row.
- `services/monsters.ts` — remove the same redaction calls. The catalog stat-block join (`MONSTER_INSTANCE_STAT_BLOCK_SQL`) itself is **kept** — it's a genuine bug fix independent of the reveal engine (before this session, `GET /monster-instances/:id` never returned AC/traits/actions at all) — just drop the redaction step after the join.
- `services/encounters.ts` — drop `hp_visibility` from `combat_participants`/the `getEncounterCombatSnapshot` query and `CombatSnapshotParticipant` type. Drop the `is_pc` column addition to that query too — it was added solely for the reveal engine's PC-exemption logic and has no other caller.
- `sockets/broadcast.ts` — remove `broadcastRevealChanged`, `resolveFieldRevealBatch`, `broadcastFullStateResync` (all reveal-only). `broadcastHpChanged` collapses to a single room-wide emit (no more `dmSocketIds`/`playerSocketIds` split for HP). `buildFullStateSyncPayload`'s participant rows go back to one plain `hp`/`armorClass` value each, no DM/player branching.
- `routes/characters.ts`, `routes/monsters.ts` — remove the `/reveals` routes and their imports.
- `routes/campaigns.ts` — remove `POST /:id/reveals/hide-all`.
- `routes/encounters.ts` — remove `POST /:id/reveals/reset` and the now-unused `requireEncounterDm`-guarded import of `entityFieldRevealService`.
- `db/seeds/demo.ts` — remove `hpVisibility` from the seeded `combat_participants` inserts.

**Client**
- `encounters/CombatTracker.tsx` — remove `ParticipantArmorClassReveal`, `ResetRevealsButton`, and every `hp_band`/`HPBandPill` branch; HP renders as the plain bar always.
- `characters/CharacterSheetPage.tsx` — remove `RevealPanel`, `NPC_REVEALABLE_FIELDS`.
- `campaigns/CampaignShell.tsx` — remove `HideEverythingButton`.
- `encounters/useEncounterLive.ts` — remove `onRevealChanged`/`RevealChangedEvent` wiring; `armorClass`/`hp` types go back to non-nullable plain values.
- `components/HPBar.tsx` — remove `HPBandPill`; `HPBar` (the exact-numbers bar) stays.
- `lib/socketTypes.ts` — remove `RevealChangedEvent`, `HpVisibility`; `HpChangedEvent`/`FullStateSyncEvent`'s `hp` field collapses to `{ hpCurrent, hpMax, hpTemp }` only (no more `| { band: HpBand }` union).
- `lib/types.ts` — remove `HpVisibility`, `HpBand`, `hp_band` fields, `ParticipantHp` union (collapses to a plain shape); `armorClass`/`hp` fields drop their `| null` reveal-gated variants.

### 1.3 Schema migration

One new migration (append-only — the original `entity_field_reveals`/`reveal_defaults`/`hp_visibility`-adding migrations already ran and stay in history; this adds a new migration that reverses them):

```sql
DROP TABLE entity_field_reveals;
ALTER TABLE campaigns DROP COLUMN reveal_defaults;
ALTER TABLE combat_participants DROP COLUMN hp_visibility;
```

No data-loss concern worth a backup step here — these columns hold DM-authored reveal *state* (what's currently shown to players), not authored *content*; losing it just means everything defaults back to "DM sees everything, players see nothing" until re-authored under whatever v2's model ends up being (per §6, v2 has no per-field redaction concept at all — the table display just shows what's on the active map).

### 1.4 `PLAN.md` — annotate, don't silently delete

`PLAN.md` §11 documents the reveal engine's design in detail. Deleting it would erase the record of a real design decision that was made and shipped. Following the precedent already in `PLAN.md` §10 (superseded open questions get struck through with a `~~...~~` + resolution note, not deleted), §11 gets a header note: *"Removed in v2 — see REVISION-PLAN.md §1. Kept here for history."* The section body stays as-is underneath.

### 1.5 DM-only fields become plain fields

`tactics_notes`/`morale`/`secrets` etc. — wait, these don't currently exist as columns (they were never built; the original brief's `Creature`/`Conflict` DM-only field lists were aspirational, not implemented). Nothing to flatten here. If/when those fields get added in a later milestone, they're just plain columns rendered conditionally by route (DM screens render them, the table-display route in §6 never does) — noted for future work, not a §1 deliverable.

### 1.6 Verification

End state: `grep -rIn "reveal\|Reveal\|hp_visibility\|hpVisibility\|hp_band\|hpBand\|HpBand" packages/server/src packages/web/src` returns zero hits outside of `PLAN.md`'s own text (not grepped, it's a doc) and this file.

---

## 2. Bestiary becomes global

Already true architecturally (see §0's table) — `monsters` is one shared table, `is_homebrew`/`owning_campaign_id` scope homebrew entries to their campaign, `monster_instances` is the per-campaign placement. What's actually missing:

- **`usedIn` index**: `SELECT DISTINCT campaign_id FROM monster_instances WHERE monster_id = $1` — cheap enough to compute on read for the bestiary detail view; no new column needed. Exposed as `usedInCampaignIds: number[]` on `GET /catalog/monsters/:id`.
- **Filters**: `GET /catalog/monsters?usedInCampaign=<id>` (has at least one instance in that campaign) and `?neverUsed=true` (zero instances anywhere) — both straightforward `EXISTS`/`NOT EXISTS` subquery additions to the existing catalog query builder.
- No migration needed. No dedup-collision UI needed (nothing to deduplicate).

---

## 3. Images everywhere

### 3.1 Storage — new `media` table, content-addressed

```sql
CREATE TABLE media (
  id                BIGSERIAL PRIMARY KEY,
  sha256            TEXT NOT NULL UNIQUE,
  mime_type         TEXT NOT NULL,
  size_bytes        INT NOT NULL,
  original_filename TEXT,
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Deliberately **no `campaign_id`** — content-addressing plus a now-global bestiary means the same file can legitimately be referenced by a global catalog monster (visible to every campaign) and a campaign-scoped character portrait at once. Access control lives entirely in *what references the media row* (a character in campaign X, a global monster), not on the media row itself — same posture as today's `/uploads` static mount, which already serves with no per-request auth check (`packages/server/src/index.ts`'s own comment: "no per-request auth check on read"). `/media/:id/:variant` follows that exact precedent, not a new gap.

On upload: hash first, before any derivative work. If a `media` row with that hash already exists, skip writing anything new and just return its id — this is the actual dedup mechanism, not a cleanup pass.

Derivatives via `sharp` (new server dependency): `token` (128×128, cover-crop), `card` (512px wide), `full` (2048px max, original aspect). Original kept untouched. Layout, content-addressed with 2-char shard prefixing to avoid one giant flat directory:

```
packages/server/uploads/media/<sha256[0:2]>/<sha256>/original.<ext>
packages/server/uploads/media/<sha256[0:2]>/<sha256>/token.webp
packages/server/uploads/media/<sha256[0:2]>/<sha256>/card.webp
packages/server/uploads/media/<sha256[0:2]>/<sha256>/full.webp
```

Accept list: `.png .jpg .jpeg .webp .gif .avif`. Reject with `VALIDATION_ERROR` naming the rejected mime type explicitly (matches this repo's existing `middleware/upload.ts` error-message convention). 20 MB cap for general uploads; maps get a separate 100 MB / 8192px cap (§4.1) via a second multer/sharp config, not a shared constant.

Upload paths — one shared `<AvatarPicker>` handles all four:
1. Drag onto a drop zone
2. Paste from clipboard (`paste` event → `clipboardData.files`)
3. Click → file picker
4. Paste an image URL → server fetches it. **Security note, flagged explicitly**: this is a server-side fetch of a user-supplied URL — needs an SSRF guard (block private/loopback/link-local IP ranges after DNS resolution, not just a scheme check), a streamed size cap (abort the connection once the byte cap is exceeded, don't buffer unbounded first), and a fetch timeout. This is the one sub-feature in §3 that needs a security review pass before merge, not just a functionality check.

`npm run media:gc`: scans every `media.id` against every FK that can reference it (`characters.portrait_media_id`, `monsters.avatar_media_id`, a new `monster_gallery_images` join table, `maps.image_media_id`, `audio_tracks.media_id`, `campaign_assets.media_id`), prints orphans, deletes only with `--confirm`.

### 3.2 Where images appear

- `<AvatarPicker>`: one component, used identically for characters and creatures. No image → deterministic placeholder (initial letter + a color derived from `hashToHue(id)`, extending the existing `Portrait` placeholder's initial-letter idea with a real deterministic color instead of a flat gray).
- Detail/description views lead with the image at `card` size — a layout change to `CharacterSheetPage`/bestiary detail, not just a new prop.
- List/grid cards become image-forward (image as the primary element, text below) — touches `MonstersPage`'s grid view, `CharactersListPage`, `EncountersPage`'s participant cards.
- Creature gallery: new `monster_gallery_images` join table (`monster_id`, `media_id`, `position`), rendered as a thumbnail strip under the statblock, click → lightbox (new small component, no external lightbox library needed for a single-image-at-a-time view with prev/next).

### 3.3 Migration from `campaign_assets`

`campaign_assets` **survives, narrowed to handouts only** (title, `visible_to_players`, uploader, campaign scoping — genuinely campaign-specific metadata that a shared `media` blob shouldn't carry). Avatars move to direct `media_id` columns on the record itself:

- `characters.portrait_asset_id` (→ `campaign_assets.id`) becomes `characters.portrait_media_id` (→ `media.id`).
- `monsters` gets a new `avatar_media_id` (→ `media.id`) — didn't have portrait support at all before this.
- `encounter_maps.background_asset_id` is retired along with `encounter_maps` itself (§4) in favor of `maps.image_media_id`.

Backfill script (part of `npm run migrate:v2`, §8): for every existing `campaign_assets` row currently used as a portrait, read the file off disk, hash it, insert/dedupe into `media`, generate its three derivatives, point `characters.portrait_media_id` at the new row, and leave the original `campaign_assets` row in place (harmless leftover — not deleted, since a handout-typed row might coexist and the migration should never silently drop data it isn't certain is unused). Idempotent: re-running skips any character whose `portrait_media_id` is already set.

---

## 4. Maps

The biggest architectural change in this brief. Treated as its own milestone per the brief's own instruction.

### 4.1 Schema — replaces `encounter_maps` entirely

```sql
CREATE TABLE maps (
  id             BIGSERIAL PRIMARY KEY,
  campaign_id    BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  tags           TEXT[] NOT NULL DEFAULT '{}',
  image_media_id BIGINT REFERENCES media(id),
  grid_type      TEXT NOT NULL DEFAULT 'square' CHECK (grid_type IN ('square','hex','none')),
  cell_size_px   NUMERIC NOT NULL DEFAULT 50,
  offset_x       NUMERIC NOT NULL DEFAULT 0,
  offset_y       NUMERIC NOT NULL DEFAULT 0,
  grid_visible   BOOLEAN NOT NULL DEFAULT true,
  view_pan_x     NUMERIC NOT NULL DEFAULT 0,   -- last DM viewport, per §4.2's "remember pan/zoom per map"
  view_pan_y     NUMERIC NOT NULL DEFAULT 0,
  view_zoom      NUMERIC NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE map_tokens (
  id                  BIGSERIAL PRIMARY KEY,
  map_id              BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  character_id        BIGINT REFERENCES characters(id) ON DELETE CASCADE,
  monster_instance_id BIGINT REFERENCES monster_instances(id) ON DELETE CASCADE,
  pos_x               NUMERIC,   -- grid units, float (not integer cell index) so free ("Alt") placement and snapped placement share one coordinate space
  pos_y               NUMERIC,
  scale               NUMERIC NOT NULL DEFAULT 1,  -- derived default from creature size (Large=1.5, Huge=2, Gargantuan=3), DM-overridable
  side                TEXT,      -- faction/side, drives ring color
  name_label_override TEXT,
  z_index             INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(character_id, monster_instance_id) = 1)
);
CREATE UNIQUE INDEX ON map_tokens (map_id, character_id) WHERE character_id IS NOT NULL;
CREATE UNIQUE INDEX ON map_tokens (map_id, monster_instance_id) WHERE monster_instance_id IS NOT NULL;

ALTER TABLE encounters ADD COLUMN map_id BIGINT REFERENCES maps(id) ON DELETE SET NULL;
```

`encounter_maps` and `combat_participants.pos_x/pos_y` are **dropped**. `map_tokens` becomes the single source of truth for "where is this thing" — an encounter just points at the map it's currently using (`encounters.map_id`), and the combat tracker reads/writes position through `map_tokens` keyed by `(map_id, character_id/monster_instance_id)` instead of maintaining its own parallel position columns. This removes a duplicate-position-tracking system rather than adding a second one alongside the first.

**Numbered instances** ("Goblin 1", "Goblin 2") reuse the *existing* auto-naming logic in `services/monsters.ts`'s `createMonsterInstance` (built in Phase 3.6 for `is_unique` handling) — dropping a creature onto a map just calls that same service function, it isn't a new naming system.

### 4.2 Map viewer

- **Konva** (`react-konva`), not plain canvas. Justification: the feature set in §4.3 (drag, click-select, marquee multi-select, a resize/scale transformer, hit-testing for click-to-open-inspector) is exactly Konva's retained-mode scene graph doing what it's built for — plain canvas would mean hand-rolling a small scene graph from scratch (manual hit-testing, manual dirty-rect redraw scheduling) to get the same behavior. The cost is bundle size (~50 KB gzipped), which is fine since the map route is already required to be code-split (§7.3) and won't load for anyone not viewing a map.
- Pan: drag or space+drag. Zoom: wheel + pinch. `F` fits to viewport, `1` sets 100%.
- Persisted pan/zoom: `maps.view_pan_x/y/zoom`, saved (debounced) on change, loaded on open.
- **Fullscreen**: `element.requestFullscreen()`, not F11 — a dedicated UI control. Controls auto-hide after 3s of no pointer movement (a `setTimeout` reset on every `pointermove`), fade back in on movement, `Esc` exits (native to the Fullscreen API; still listen for the `fullscreenchange` event to sync React state). Coordinate correctness across the transition: token/shape positions are always stored and reasoned about in **map-space** (the same units as `map_tokens.pos_x/y`); only the Konva `Stage`'s scale/position (the viewport→screen transform) changes on resize, recomputed from the current viewport dimensions on every `fullscreenchange`/`resize` event — nothing about a token's actual position data needs to change when the chrome around it does.

### 4.3 Tokens

- Circular, avatar-filled (via `<AvatarPicker>`'s `token` derivative — this is the direct payoff of §3's media work), sized to `cell_size_px * scale` when a grid is configured.
- Colored ring by `side`, optional name label (global per-map toggle, not per-token), small condition-icon badges around the edge (reuses the existing `EffectBadge` icon set, rendered smaller).
- Drag-drop from a side drawer (bestiary/character picker) onto the canvas creates a `map_tokens` row (and a fresh `monster_instances` row via the existing auto-naming path, for creatures).
- Manipulation: drag-to-move snaps to `cell_size_px` unless `Alt` is held (free placement — both write the same `pos_x/y` float columns, just with or without rounding first); click selects; drag-empty-space marquee-selects; `Del` deletes; `Ctrl+Z` undoes the last 50 actions.
- **Undo**: client-side ring buffer of the last 50 mutations, each entry storing enough to construct the inverse REST call (e.g. a move stores `{from: {x,y}, to: {x,y}}`, undo re-PATCHes to `from`). No server-side undo log — it's just replaying real mutations backwards, so no new persistence layer needed.
- Click → inspector panel (§7.1's right-side inspector, not a modal): avatar, HP with quick +/− (reuses the existing HP-delta endpoint), conditions (reuses the existing effects endpoints), a link to the full bestiary statblock.
- Default `scale` derived from `monsters.size` (`Large`→1.5, `Huge`→2, `Gargantuan`→3, everything else→1) at token-creation time, stored (not recomputed live) so a DM override persists even if the underlying creature's size field changes later.

### 4.4 Explicit call-out

This replaces a working, tested, in-production-use feature (the div-based battle map, ~5 files, exercised in the existing seed data and combat flow) with a materially different one. It is **not** a drop-in swap — anything currently reading `combat_participants.pos_x/y` or `encounter_maps` (the combat tracker's list-view position column, `TOKEN_MOVED`/`MAP_UPDATED` socket events, `BattleMap.tsx`/`Token.tsx`) gets rewritten, not patched. If you'd rather keep the existing encounter-scoped map as-is and add the new campaign-level map library as a *second*, separate concept, say so — that's a smaller, lower-risk change than the consolidation proposed above, at the cost of two position-tracking systems existing side by side.

---

## 5. Music

Entirely new — nothing here exists today.

```sql
CREATE TABLE audio_tracks (
  id              BIGSERIAL PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  artist          TEXT,
  duration_seconds NUMERIC,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  volume_offset   NUMERIC NOT NULL DEFAULT 0,  -- per-track gain trim, since uploaded files are rarely level-matched
  source_type     TEXT NOT NULL CHECK (source_type IN ('upload','url')),
  media_id        BIGINT REFERENCES media(id),   -- set when source_type='upload'
  external_url    TEXT,                          -- set when source_type='url'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source_type = 'upload') = (media_id IS NOT NULL)),
  CHECK ((source_type = 'url') = (external_url IS NOT NULL))
);

CREATE TABLE audio_playlists (
  id          BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  scene_tag   TEXT CHECK (scene_tag IN ('combat','tavern','travel','dungeon','boss','ambience')),
  hotkey      TEXT CHECK (hotkey IN ('F1','F2','F3','F4','F5','F6','F7','F8')),
  UNIQUE (campaign_id, hotkey)
);

CREATE TABLE audio_playlist_tracks (
  playlist_id BIGINT NOT NULL REFERENCES audio_playlists(id) ON DELETE CASCADE,
  track_id    BIGINT NOT NULL REFERENCES audio_tracks(id) ON DELETE CASCADE,
  position    INT NOT NULL,
  PRIMARY KEY (playlist_id, track_id)
);
```

Accepted upload formats `.mp3 .ogg .m4a .flac .wav` — routed through the same `media` pipeline as images (§3.1) minus the `sharp` derivative step (audio has no derivatives; `mime_type`/`size_bytes` still recorded, dedup by hash still applies — uploading the same track twice, even to two campaigns, stores one file).

**Playback engine**: one shared `AudioContext`, two independently-gained sources (A/B) for crossfading between tracks/playlists, plus a third always-additive gain chain for the ambience loop:

```
sourceA ──▶ gainA ──┐
sourceB ──▶ gainB ──┼──▶ masterGain ──▶ destination
ambience ─▶ gainAmb─┘
```

Crossfade = ramp `gainA.gain` down and `gainB.gain` up together over the configured duration (default 2s) via `gain.linearRampToValueAtTime` (or an equal-power cosine curve via `setValueCurveAtTime` for a smoother perceptual fade — worth the extra code, linear crossfades have an audible dip in the middle). Explicitly **not** animating `<audio>.volume` — the brief is right that this stutters; every volume change goes through a `GainNode`.

**Playback state persistence**: client-side only (`localStorage`, per-user) — current track/position/volume/active playlist. **Not** synced across clients/broadcast over the socket. The brief doesn't ask for players to hear the DM's music selection reflected anywhere, and adding multi-client audio-position sync is a materially harder, unscoped problem (clock drift, buffering differences) — flagged as an explicit boundary, not an oversight.

Persistent player: lives in `CampaignShell`'s nav rail (same component tree as `ThemePicker`), survives route changes since the shell wraps `<Outlet/>`. `F1`–`F8` bindings shown next to each playlist in whatever UI lists them, and globally documented in the `?` shortcuts overlay (§7.4).

---

## 6. Table display

New route, `/table/:campaignId` — kept on the existing session-cookie + campaign-membership auth model rather than introducing an unauthenticated passphrase path (the original brief's `/play` concept predates this project having real player accounts at all; building a second, weaker auth path now would be a regression against the app's own established security model, not a neutral choice — flagged as an override).

- DM sets `campaigns.active_table_map_id` (new column) via a "Show on table" action from the map viewer; the table-display route just renders whatever that currently points at.
- Token mirroring: a boolean the DM toggles (`campaigns.table_mirrors_tokens` or a per-session toggle — leaning per-session, no schema needed, just a socket-broadcast preference) — when on, `map_tokens` changes broadcast to this route the same way they already broadcast to the DM's own map view; when off, the table shows the map with no live token layer.
- Handout push: reuses `campaign_assets` (now handout-only, per §3.3) — a new `HANDOUT_PUSHED { assetId }` / `HANDOUT_DISMISSED` socket pair, small addition to `sockets/broadcast.ts`.
- No server-side redaction of any kind on this route's payload — "what's on the table" is just the map + mirrored tokens + any pushed handout, full stop.
- Reconnection UI: the existing `useEncounterLive`-style "reconnecting…" banner pattern gets generalized into a small `useSocketConnectionState()` hook so this route and the combat tracker share one implementation instead of two copies.
- Fullscreen-first: this route defaults into the same chromeless mode as §4.2's map fullscreen (no nav rail, no inspector) — it's the same underlying map-viewer component, just mounted with `isTableDisplay` and no DM controls rendered.

---

## 7. Interface redesign

### 7.1 Palette

Six named tokens, replacing the current amber/crimson CSS-variable-override hack with a real `@theme` block in Tailwind v4 (still swappable — light/dark stays a `data-theme` attribute, same mechanism, just built on named tokens instead of overriding Tailwind's own `amber`/`stone` scale names):

| Name | Hex | Use |
|---|---|---|
| `ink` | `#16120F` | Dark-theme background |
| `parchment` | `#F3E9DC` | Light-theme background / dark-theme text |
| `ember` | `#E2542A` | Primary accent — buttons, active nav, focus ring |
| `verdigris` | `#4E8C7C` | Secondary accent — success states, "revealed"/"live" indicators |
| `dusk` | `#574B44` | Borders, muted text, dividers |
| `blood` | `#9C2B2B` | Destructive actions only (delete, hide-everything-equivalent panic actions) |

This is a starting proposal, not a final decree — worth your own pass before I wire it in, especially `ember` vs `blood` needing enough separation to stay unambiguous for the "destructive action" cases §7.1's structural rules care about.

### 7.2 Type

Display serif for headings (candidate: **Fraunces** — has enough personality to read as "a rulebook," without tipping into a fantasy-font cliché) + a humanist sans for body/UI (candidate: **Inter** or **Public Sans** — chosen for actual legibility at 16px in a dim room over a distinctive one). Scale, deliberately uneven at the top so `h1` is unmistakable:

```
12 · 14 · 16 · 20 · 26 · 34 · 44   (px, ~1.25–1.3 ratio, wider jump top two steps)
```

### 7.3 Signature element

Proposal: a broken-wax-seal glyph as the campaign switcher in the nav rail (a closed seal when a campaign is selected but not "active"/live, cracked open when a session is in progress), and a torn-parchment-edge top border on every inspector-panel slide-in, reused consistently rather than a different flourish per screen. This is genuinely a taste call — flagged as a starting point, expect to revise it after seeing it rendered.

### 7.4 Structural wireframe

```
┌──────┬──────────────────────────────────────────┬───────────────┐
│ NAV  │                                          │   INSPECTOR   │
│ RAIL │              MAIN CONTENT                │  (collapsible)│
│      │                                          │               │
│ [◈]  │  ┌────────────────────────────────────┐  │  ┌─────────┐  │
│ camp │  │                                    │  │  │ avatar  │  │
│      │  │         bestiary grid /            │  │  │ (card)  │  │
│ Sess │  │         map / character sheet /    │  │  └─────────┘  │
│ Best │  │         etc — one primary action   │  │  Name          │
│ Maps │  │         per screen, top-right      │  │  HP  [+][-]    │
│ Char │  │                                    │  │  AC            │
│ Conf │  │                                    │  │  Conditions    │
│ NPCs │  │                                    │  │  [full sheet]  │
│ World│  │                                    │  │               │
│ Music│  └────────────────────────────────────┘  │               │
│ Notes│                                          │               │
│──────│                                          │               │
│ ♪ ▶▶ │  <- persistent music player, always here │               │
│──────│                                          │               │
│ theme│                                          │               │
└──────┴──────────────────────────────────────────┴───────────────┘
```

Fullscreen map / table-display mode — chrome fully gone, controls fade after 3s idle:

```
┌────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                         [ map canvas,                           │
│                           fills viewport entirely ]              │
│                                                                  │
│                                                                  │
│  (controls, faded to ~0 opacity after 3s idle, fade in on move)  │
│  [exit ⛶]                                    [zoom -][100%][+]  │
└────────────────────────────────────────────────────────────────┘
```

Mobile (≤640px) — nav rail collapses to a bottom tab bar (icons only), inspector becomes a bottom sheet instead of a right-side panel:

```
┌───────────────────────────┐
│        MAIN CONTENT        │
│                             │
│                             │
├───────────────────────────┤
│  [inspector: bottom sheet, │
│   swipe up to expand]      │
├───────────────────────────┤
│ 🏠 🐉 🗺️ 👤 ⚔️  ···         │  <- bottom tab bar, icons only
└───────────────────────────┘
```

### 7.5 Density, speed, accessibility

Straightforward application of the brief's own numbers (16px body minimum, 8px spacing grid using its larger steps, 40×40px targets, virtualized bestiary list, `token`/`card` derivatives in list views, lazy-loaded images with explicit `width`/`height`, route-level code splitting for the map canvas and audio engine specifically, optimistic UI with rollback everywhere, `Cmd/Ctrl+K` global search, a `?` shortcuts overlay, visible focus rings, AA contrast, `prefers-reduced-motion`, keyboard-operable canvas tokens) — no design decisions needed here beyond what's already stated in the brief; these become straightforward implementation checklist items during §7's build commit, verified against the brief's own numeric targets (nav <100ms, bestiary search <50ms) rather than re-litigated here.

---

## 8. Definition of done — translated

- **`npm run check`** (new root script): `tsc -b --force` across both workspaces + `oxlint` for both (server currently has no lint script at all — adding one, matching web's existing config, is part of this work) + `npm run test --workspaces`.
- **`npm run migrate:v2`**: a `node-pg-migrate` schema migration (§1.3, §3.3, §4.1, §5's `CREATE TABLE`/`DROP TABLE` statements) run via the existing `migrate` script, **plus** a new idempotent Node script (`packages/server/src/db/scripts/backfillV2.ts`, run via `npm run migrate:v2` at the root) that: hashes and migrates existing `campaign_assets` portrait files into `media` (§3.3), and reports (never silently drops) anything it can't confidently migrate. Backs up `packages/server/uploads/` to a timestamped sibling directory before touching any file on disk — the Postgres data itself relies on the user's own Postgres backup story, not a snapshot this script takes, since schema migrations are already the durable, reviewable mechanism for DB changes in this repo. Tested against a fixture: a throwaway campaign with a couple of `campaign_assets` portrait rows, asserting `media` rows exist post-run with matching hashes and `characters.portrait_media_id` is set, and that a second run is a no-op (idempotency).
- **Tests**: media dedup + derivative generation (unit, using a small fixture image, mocking or actually invoking `sharp` against it), map coordinate math (pure functions: grid↔pixel, zoom/pan/fullscreen-resize transforms, calibration-rectangle→cell-size math — all unit-testable with no DOM/canvas needed if written as plain functions the Konva layer calls into, which is itself a reason to structure it that way), crossfade gain-curve math (pure function, unit test the ramp values at a few time offsets), the migration backfill script (integration, per above).
- **Playwright**: this repo has no Playwright setup at all today (only Vitest) — this is the first one, so the line item includes the setup cost (`@playwright/test`, a config, a browser install step), not just the one test. Scenario: upload a creature image → place it on a map as a token → enter fullscreen → assert the token's rendered screen position/size matches the expected transform.
- **Mobile check**: manual, via a resized browser viewport during development; I'll report what breaks, but a real device check is worth doing on your end too before calling this done.
- **`README.md`**: update project layout, media storage location, and the new `check`/`migrate:v2`/`media:gc` scripts.

---

## Sequencing

Per your instruction: §1 (removal) lands first, alone, as its own commit, before any addition work starts. After that, one commit per section, in brief order (§2 → §3 → §4 → §5 → §6 → §7 → §8's remaining tooling), running `npm run check` after each. §4 (maps) is the largest single commit by far given the table consolidation in §4.4 — I'd suggest splitting it into its own sub-sequence (schema+backend, then viewer, then tokens, then fullscreen) even though it's still "one commit per section" at the top level, similar to how the original build's Phase 3 was itself five sequential sub-phases.

---

## Open decisions before I start §1

~~1. **HP-banding scope**...~~ — **resolved: kept, not removed.**
~~2. **Maps consolidation**...~~ — **deferred along with the rest of §2–§6.**
~~3. **Palette/type/signature-element**...~~ — **superseded by §9; no full redesign happening this round.**

---

## 9. Interface Accessibility & DM Ergonomics (this is the actual current scope)

Not a redesign. Two kinds of change: (a) accessibility fixes to the existing UI, (b) closing two concrete gaps where the DM currently has to leave the combat view to do something they need mid-session — consulting a stat block and rolling an arbitrary die. No new routes, no schema changes, no new dependencies.

### 9.1 What's already good (verified, not assumed)

- `index.css`'s two themes (Crimson default, Amber alternate) were already checked against WCAG AA per its own top-of-file comment, with one documented known gap (`stone-700` on `stone-800` borders, ~1.7:1, short of the 3:1 non-text guideline).
- Most custom controls already carry real `aria-label`/`aria-pressed`/`role` attributes (`RevealToggle`, `EffectBadge`, `QuickDiceRoller`'s roll-mode radiogroup) — the pattern to extend, not invent.
- Text inputs consistently use `focus:outline-none focus:ring-2 focus:ring-amber-600` — a deliberate, visible focus replacement, not a stripped-and-forgotten outline.

### 9.2 Accessibility gaps found (concrete, this session's audit)

1. **Focus visibility is inconsistent.** Form inputs get an explicit ring (§9.1); `ActionButton` (the primary button component used everywhere — combat actions, dialogs, nav) and other custom controls have no explicit focus style at all, relying on whatever the browser defaults to. Fix: extend the same `focus:outline-none focus:ring-2 focus:ring-amber-600` treatment (or a `focus-visible` variant, so mouse clicks don't show a ring, only keyboard focus does) to `ActionButton`, `RevealToggle`, nav `NavItem`, and any other clickable element.
2. **`RevealToggle` is 20×20px** (`h-5 w-5`) — well under the 40×40px minimum target size this app already commits to elsewhere (`ActionButton`'s `min-h-[2.5rem]` = 40px). Fix: grow the hit target to 40×40px (the visible glyph can stay small; pad the clickable area).
3. **No `prefers-reduced-motion` handling anywhere** — every transition (`transition-colors`, hover states, the RevealToggle fade, etc.) currently ignores it. Fix: one global rule in `index.css` reducing/removing transition durations under that media query, not a per-component change.
4. **Icon-only controls without a label**, beyond the ones already checked — a quick pass over `EffectBadge`'s remove button and similar dense-row icon buttons to confirm every one has `aria-label`, not just the ones already spot-checked this session.
5. **Contrast re-check for anything added since the original audit** — `RevealToggle`'s emerald/stone color choices (added this session) were never run through the same AA check the rest of the palette got; verify or adjust.

### 9.3 DM ergonomics gap #1: stat consultation requires leaving combat

Confirmed by grep: `StatBlock` is never rendered anywhere inside `CombatTracker.tsx`. Today, a DM mid-fight who needs to check a monster's traits/actions/resistances has to navigate away to the Bestiary tab, search, and lose their place in the combat tracker.

**Fix**: add a per-participant "view stats" affordance to each combat-tracker row (an icon button, 40×40px target) that opens the existing `StatBlock` component (already built, already handles the full traits/actions/legendary-actions layout) in an inline slide-over/expand *within* the Session view — no navigation, no new route, no new component beyond a thin wrapper that resolves which `StatBlock` data to show (monster instance → its catalog `monsters` row via `monster_id`, already fetched by `CombatTracker` today via `bestiaryQuery`; character → a compact core-stats view, since `StatBlock` is monster-shaped, not character-shaped — reuse `AbilityScoreGrid`/existing character-sheet panels instead for that case rather than force-fitting `StatBlock`).

### 9.4 DM ergonomics gap #2: dice rolling requires leaving combat

Confirmed by grep: `QuickDiceRoller` (the general "roll anything" widget) is only mounted on the standalone `/dice-rolls` page. `DiceRoller` (the contextual roll-trigger) is embedded in character/monster sheets but not in the combat tracker itself.

**Fix**: mount `QuickDiceRoller` directly in the Session/combat view (a collapsible panel in `CombatTracker`, defaulting open or closed — worth a quick call during implementation on which reads better) so the DM can roll an arbitrary check without leaving the fight. It's an existing, working component — this is a placement change, not new functionality.

### 9.5 Explicitly out of scope for this round

Global `Cmd/Ctrl+K` search, a `?` shortcuts overlay, a full palette/typography change, virtualized lists, code-splitting, and everything in the deferred §2–§6 — none of these were asked for and won't be touched.

### 9.6 Sequencing

Small enough for one pass rather than a multi-commit sequence: (1) the five accessibility fixes in §9.2, (2) the combat-tracker stat-lookup addition (§9.3), (3) the combat-tracker dice-roller addition (§9.4). Each is independently low-risk (no schema/API changes anywhere in this section), so a single commit per item is fine, or all three together if you'd rather review it as one change.

---

## 10. Structural & Visual Redesign (current active plan)

Confirmed scope: nav split into three tabs, a map-centric battle layout for everyone, and a real visual direction. **No schema changes** — this reuses the existing per-encounter `encounter_maps`/`BattleMap` system exactly as it is today (the campaign-level Konva map rewrite in §4 is still deferred); what changes is how that existing system is *reached* and *composed* in the UI, not its data model.

### 10.1 Nav split

Today, `CampaignShell`'s nav has `Characters`, `Bestiary` (DM-only), `Encounter`, `Notes`, `Dice Rolls`. `Encounter` currently bundles turn order *and* the map behind a List/Map toggle inside one component (`CombatTracker`). This splits that into three:

- **Bestiary** — unchanged, already its own tab.
- **Maps** (new top-level tab) — shows the map for whichever encounter is currently active; if none is active, a picker lets the DM select an encounter to view/configure its map ahead of time (prep mode). This is literally today's `<BattleMap>` component, moved out of `CombatTracker` into its own route — the component itself doesn't change.
- **Turns** (renamed from `Encounter`) — initiative order, start/end/roll-initiative/advance-turn controls, participant roster, HP/effects/action-economy — today's List-mode content, minus the map toggle. When the selected encounter's status is `'active'`, this tab switches into **battle mode** (§10.2) instead of the plain roster view.

```
NAV RAIL
┌──────────┐
│ Session  │  <- lands here; shows "no active encounter" or jumps into battle mode
│ Bestiary │
│ Maps     │
│ Turns    │
│ Characters│
│ Notes    │
│ Dice Rolls│
└──────────┘
```

### 10.2 Battle mode — map + side panel, for both roles

Triggered automatically when the Turns tab's selected/active encounter has `status === 'active'`. Reuses the existing `<BattleMap>` for the map half; the side panel differs by role since a DM manages a whole roster and a player acts as one character.

**DM view:**
```
┌────────────────────────────────────────┬───────────────────┐
│                                          │  ROUND 3           │
│                                          │  Active: Goblin 2  │
│                                          │ ─────────────────  │
│              MAP                        │  1. Brenna (PC)    │
│         (BattleMap, unchanged,          │  2. Goblin 1        │
│          full-size)                     │  3. ▶ Goblin 2      │
│                                          │  4. Maribel (PC)    │
│                                          │ ─────────────────  │
│                                          │ [Advance turn]      │
│                                          │ [Roll initiative]   │
│                                          │ [End encounter]     │
│                                          │ [+ Add participant] │
│                                          │ [Roll dice ▾]       │
└────────────────────────────────────────┴───────────────────┘
```
Existing DM tools (stat lookup from §9.3, dice roller from §9.4, HP adjust, effects, reveal toggles) move into this side panel, scoped to whichever participant is selected on the map or in the compact roster list — not deleted, relocated.

**Player view:**
```
┌────────────────────────────────────────┬───────────────────┐
│                                          │  Brenna Ironhide    │
│              MAP                        │  HP ●●●●●○○ 18/28   │
│      (read-only pan/zoom,               │  AC 16               │
│       tokens visible, no edit           │ ─────────────────  │
│       controls)                         │  Actions             │
│                                          │  [Attack] [Dash]     │
│                                          │  [Dodge]  [Help]     │
│                                          │ ─────────────────  │
│                                          │  Inventory           │
│                                          │  Longsword           │
│                                          │  Potion of Healing x2│
│                                          │ ─────────────────  │
│                                          │  [Roll dice ▾]       │
└────────────────────────────────────────┴───────────────────┘
```
This is the direct answer to "players should know what they have in their inventory" — it's now on-screen during the moment it matters (their turn), not only reachable via the character sheet. `Actions` reuses whatever the action-economy registry (`encounters/actionEconomy.ts`) already defines for the active participant; `Inventory` reuses the existing `InventoryPanel`'s data (`GET /characters/:id/items`), rendered in a compact read-mostly list rather than the full editable character-sheet layout.

Outside of battle mode (no active encounter), the Turns tab falls back to today's plain roster/prep view — no map, no side-panel split, just the participant list and encounter controls, matching how it behaves now minus the map toggle.

### 10.3 Visual direction (proposal — approve before implementation)

**Palette** — six named tokens, replacing the amber/crimson CSS-variable-override mechanism with real semantic names (still swappable light/dark via the same `data-theme` attribute):

| Name | Hex | Use |
|---|---|---|
| `ink` | `#16120F` | Dark background |
| `parchment` | `#F3E9DC` | Light background / dark-mode text |
| `ember` | `#E2542A` | Primary accent — active nav, primary buttons, current-turn highlight |
| `verdigris` | `#4E8C7C` | Secondary accent — "revealed"/live states, success |
| `dusk` | `#574B44` | Borders, muted text |
| `blood` | `#9C2B2B` | Destructive actions only |

**Typography** — a display serif for headings (**Fraunces**) + a humanist sans for body/UI (**Inter**), scale with real jumps so `h1` never reads as "slightly bigger body text":

```
12 · 14 · 16 · 20 · 26 · 34 · 44  (px)
```

**Signature element** — the current-turn indicator in battle mode (§10.2's `▶` marker) becomes the app's one recurring motif: a small torch/flame glyph that "passes" from participant to participant as the turn advances, reused consistently (nav rail's active-campaign indicator, the Turns tab's active-encounter marker) rather than a different flourish per screen — ties the visual identity directly to the thing this app is actually for (running a fight), rather than a generic fantasy ornament.

This is a starting proposal, not a final decree — say the word to revise before I wire it into `index.css`/Tailwind's `@theme`.

### 10.4 Sequencing

1. Nav split (§10.1) — extract `<BattleMap>` from `CombatTracker` into its own `MapsPage`, rename the `Encounter` tab/route to `Turns`, add the `Maps` nav item. Pure reorganization, no new components yet.
2. Battle-mode layout (§10.2) — build the two-column map+sidebar shell, wire in the DM side panel (relocating existing tools) and the player side panel (new: compact actions + inventory view).
3. Visual direction (§10.3) — once approved, apply palette/type as a `@theme` block plus the signature-element treatment, across both new and existing screens.

Each step is independently testable (`npm run check` after each); (1) and (2) can land before (3) is approved, since they're structural, not visual.
