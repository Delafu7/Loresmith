# Bastions (2024)

Consulted for: the future `bastions` / `bastion_facilities` schema and seed-data design (Phase 4 backlog — the level-5+ PC downtime subsystem). Edition: **2024 only.** Bastions have **no 2014 counterpart at all** — this is not a case of "both editions have it, worded differently" (like every other doc in this directory so far); the 2014 ruleset simply does not include a Bastion/stronghold-management subsystem. There is nothing to compare against, and nothing here applies to a `campaigns.srd_edition = '2014'` campaign unless the DM explicitly imports 2024 content into a 2014 game (see **DM-configurable** below — that's a real, if unusual, table-level choice, not something this app should silently allow or silently block).

## Source note — read this before trusting anything below

**This content is not in `.opencode/skills/dnd5e-srd/`.** Checked: `python3 .opencode/skills/dnd5e-srd/scripts/query.py --categories`, both `references/2014/` and `references/2024/` directory trees, every category the query script exposes. No Bastion content anywhere, which is expected and not a bug in the skill — Bastions are Dungeon Master's Guide content, not SRD 5.2/CC-BY content, and the skill's own scope is rules-framework text, not DMG subsystems.

**Also confirmed absent from every *free* official rules page**, before falling back to the sources actually used:

- Fetched D&D Beyond's free **"Basic Rules (2024)"** table of contents directly (`dndbeyond.com/sources/dnd/br-2024`). Its full page list is: `character-classes`, `character-origins`, `creating-a-character`, `creature-stat-blocks`, `dms-toolbox`, `equipment`, `feats`, `how-to-use-a-monster`, `magic-items`, `magic-items-a-z`, `playing-the-game`, `rules-glossary`, `spell-descriptions`, `spells`, `the-basics`, `tracking-sheets` — no `bastions` page. Also live-fetched `dms-toolbox`, `rules-glossary`, `playing-the-game`, and `the-basics` directly and searched each for the literal string "bastion" — zero matches in any of them.
- Directly hit `dndbeyond.com/sources/dnd/dmg-2024/bastions` (the chapter's real URL, confirmed to exist via the `dmg-2024` table of contents, which does list `bastions` as a chapter). It **307-redirects straight to the D&D Beyond marketplace purchase page with zero response body** — no partial preview text at all, unlike some other paywalled chapters that show a teaser. Confirms: **the full Bastions chapter is paid 2024 Dungeon Master's Guide content only, with no free full-text equivalent published by WotC on D&D Beyond.**

Two free, official WotC sources were used instead, matching this project's "never invent a rule — find a legitimate free source or say so" standard (same approach as `docs/rules/encounter-xp-budget.md`):

1. **Primary source — `Unearthed Arcana 2023: Bastions and Cantrips`**, a WotC public playtest packet published 2023-10-05, introducing the Bastion system ahead of the 2024 DMG's release. Hosted on WotC's own CDN at `media.dndbeyond.com/compendium-images/ua/bastions-cantrips/BRF3GSu0nTfNu8p4/UA2023-BastionsCantrips.pdf`, linked with no login/paywall from the official public announcement post `dndbeyond.com/posts/1591-bastions-and-cantrips-build-a-base-and-test`. Downloaded and read in full this session (23 pages; not recalled from training data).
   - **A note on the PDF's own footer, in the interest of full transparency**: every page footer reads "Version 2.0 ©2023 Wizards of the Coast LLC. **Confidential information. Do not distribute.**" This is boilerplate left over from WotC's internal playtest-document template — the same line appears on essentially every UA PDF WotC has published this way for years — and does **not** reflect an actual access restriction: the file sits on WotC's own public CDN with no authentication, and WotC's own blog post links directly to it as the intended way for the whole community to download and playtest it. I'm flagging the footer text anyway rather than silently omitting it, since "do not distribute" sitting in a source doc we're about to build a public schema from deserves an explicit call-out, not a quiet pass.
2. **Corroborating source — "Exploring Bastions from the 2024 Dungeon Master's Guide"**, an official D&D Beyond staff blog post (`dndbeyond.com/posts/1828-exploring-bastions-from-the-2024-dungeon-masters`, published 2024-11-12, around the DMG's street date, tagged `Dungeon Master's Guide`), published as free promotional/preview content — the same publication pattern as the `DM's Toolbox` page used for the encounter-XP-budget doc. This is a **summary**, not the full final chapter text, but it directly quotes and paraphrases several load-bearing mechanics from the **actual shipped 2024 DMG**. Read in full this session, including its public comment thread (useful for confirming at least one specific facility prerequisite survived unchanged into the final book — see below).

### Why both sources matter, and what that does to confidence levels below

The UA document is an explicit **playtest draft** — its own standard disclaimer says: "This article is presented for playtesting and feedback. The options here are experimental and in draft form. They aren't officially part of the game... If we make this material official, it will be refined based on your feedback." Any numeric detail in it could have changed before the final book shipped. The Nov 2024 blog post, however, **directly corroborates the following specific mechanics against the final, published book**, word-for-word or number-for-number:

| Mechanic | UA 2023 text | Confirmed in Nov 2024 DMG post? |
|---|---|---|
| Level-5 acquisition threshold | "characters acquire their Bastions when they reach level 5" | Yes — "assume each character will receive one once they reach level 5" |
| Facility Space table (Cramped=4 / Roomy=16 / Vast=36 five-ft squares) | Verbatim table | Yes — identical numbers restated |
| Special Facility Acquisition schedule (2 @ lvl5, 4 @ lvl9, 5 @ lvl13, 6 @ lvl17) | Verbatim table | Yes — identical numbers restated ("two immediately... another two at level 9 and one more at levels 13 and 17") |
| The 7 order types and their names | Craft, Empower, Harvest, Maintain, Recruit, Research, Trade | Yes — identical 7-item list, same names |
| Bastion turn cadence (7 in-game days by default, DM-adjustable) | Stated + 4 example scenarios | Yes — restated, plus the post adds its own worked-scenario table (not in the UA doc) |
| Bastion Defenders attack-loss mechanic (roll d6s; lose 1 defender per die that shows a 1) | "Roll 6d6; for each die that rolls a 1, one Bastion Defender dies" | Yes — "a number of d6s are rolled. For each die that rolls a 1, your Bastion loses that many Bastion Defenders" |
| "Request for Aid" event's exact numbers (1d6 per defender sent; total ≥10 solves it for 1d6×100 GP; total <10 solves it for half reward + loses 1 defender) | Verbatim | Yes — numbers restated identically |
| Ramps/stairs/corridors are free; multi-floor construction allowed | Stated | Yes — a reader asked specifically about multi-floor support and the article's author confirmed "Ramps and stairs are a free part of Bastion design, so you can extend your Bastion up or down across multiple floors" |
| Combining Bastions doesn't share resources/orders, only pools Bastion Defenders for defense | Stated | Yes — restated near-verbatim |
| At least one named special facility's prerequisite survives unchanged (Smithy: Fighting Style feature or Unarmored Defense feature) | Stated | Yes, indirectly — a reader in the post's comment thread explicitly complained "just like in the playtest, forge clerics and artificers won't be able to own a smithy," unchallenged by the article's author, confirming the same class-feature gate is still present in the shipped book |

Given that level of point-by-point corroboration across acquisition, the space table, the acquisition schedule, the full order list, turn cadence, the defender-loss mechanic, and at least one named facility's exact prerequisite, **the playtest document's overall framework is treated as reliable** for this doc. However, per-facility numeric details the corroborating post did **not** independently restate — exact GP costs, exact Bastion Point dice, exact hireling counts, the full Bastion Events table beyond "Attack" and "Request for Aid," the complete Basic Facilities list, the Menagerie/Craft-Potion/Craft-Scroll cost tables, etc. — are marked **"UA-sourced, not independently re-confirmed against final text"** throughout this doc. Treat those as this project's best-available approximation, not a guaranteed-exact transcription of the shipped book. If 100% exactness against the physical/digital final DMG ever matters (e.g., before publishing anything as official errata-quality content, or if a player disputes a specific number at the table), re-verify against the actual 2024 DMG text — this doc's honesty about that gap is the whole point of writing it this way.

**Do not cite this content in code comments as "SRD 5.2"** — Bastions are not SRD/CC-BY content in either playtest or final form. Cite as `D&D 2024 DMG — Bastions (UA 2023 playtest text, corroborated by D&D Beyond's Nov 2024 DMG preview post; see docs/rules/bastions.md)`.

---

## 1. Eligibility, acquisition, and Bastion space/facility size

### Official rule

- **It's a DM opt-in, not automatic.** "It's up to the DM to decide whether Bastions are available in a campaign." (UA, "Bastions" intro.) Confirmed structurally by the Nov 2024 post treating it as a chapter DMs choose to run, not a default-on subsystem.
- **Level 5 threshold.** "If you allow Bastions in your campaign, characters acquire their Bastions when they reach level 5." (UA.) Confirmed in the final-DMG post: "The rules for Bastions assume each character will receive one once they reach level 5, although it is possible to award one later."
- **Not mandatory per-character.** "Not every character needs to have a Bastion. It's fine for some players in your campaign to opt in to Bastion ownership and others to opt out. Characters without Bastions of their own can still gain some benefits from their friends' Bastions." (UA.) The UA text does **not** specify what those "some benefits" mechanically are — flagged as an edge case below, not resolved by either source.
- **Acquisition method — vaguer in the UA text, formalized in the final book.** UA: "You and the players can decide together how these come into being. A character might inherit or receive a parcel of land... or they might take a preexisting structure and refurbish it." The **Nov 2024 post gives four explicitly named methods**, confirmed as final-book content: **Reward** (given for completing a quest or an agreement with a patron), **Built** (players build from scratch, "usually initiated at an earlier level"), **Captured** (claimed after defeating an enemy force occupying the site), **Rebuilt** (a mix of the above, turning a "less-than-typical location into a stronghold"). Use the final-book's 4-method list as the authoritative one — it's newer, more specific, and directly confirmed via a free official source.
- **Bastion form is player-chosen flavor, not a mechanical prerequisite.** UA gives class-flavor suggestions (Wizard→tower, Cleric→shrine, Fighter→fortified keep, Rogue→guild hall/lodge) but is explicit these are non-binding suggestions, not rules ("Characters of other classes might choose one of these forms or combine them... multiple characters can combine their Bastions to form a single large structure").
- **Facility Space** — three named sizes, each with a maximum area measured in 5-foot squares:

  | Space | Maximum Area |
  |---|---|
  | Cramped | 4 squares |
  | Roomy | 16 squares |
  | Vast | 36 squares |

  Squares "can be stacked so that a facility's area is distributed over multiple levels or stories." Corridors, ramps, and staircases connecting facilities are free and don't count against a facility's space. Confirmed multi-floor support in the final book per the corroboration table above.
- **Starting layout at level 5**: 2 basic facilities (player's choice of type; one must be Cramped, the other Roomy) + 2 special facilities of the character's choice, from among those they currently qualify for. Confirmed identical in the final-DMG post: "Their Bastion starts with two basic facilities, one Cramped and the other Roomy, and two special facilities for which the character qualifies."
- **Basic facilities**: purely flavor/roleplay — "Basic facilities don't generate Bastion Points, but they can inspire meaningful roleplaying opportunities." No orders can be issued to them. Bought with gold + in-game time (see §2 tables), can be built/enlarged any time, don't require the character to be present, and a Bastion can have more than one of the same type. The playtest's Basic Facilities list (7 types): **Bedroom, Courtyard, Dining Room, Kitchen, Parlor, Storage, Washroom.** (Flag: the Nov 2024 post's comment thread has a DM saying you *can* have "a pub" as a basic facility narratively before level 13 unlocks the special-facility Pub — this could mean the final book added "Pub" (or similar) as an 8th basic-facility option, or it could just mean re-skinning "Dining Room"/"Parlor" as a pub is allowed narratively without a distinct catalog entry. **Not resolved by either source** — see Unresolved section.)
- **Special facilities**: mechanical-benefit-granting, level-gated only (no gold/time cost — "special facilities do not require time and gold to construct... are available immediately once you reach the appropriate level," per the Nov 2024 post). Total special facilities owned scales with level:

  | Level | Total Special Facilities |
  |---|---|
  | 5 | 2 |
  | 9 | 4 |
  | 13 | 5 |
  | 17 | 6 |

  Each special facility can normally be chosen only once per Bastion (its own description says otherwise for the few that allow duplicates — none of the transcribed special facilities in this doc's catalog explicitly allow duplicates, unlike basic facilities). **On every level-up** (any level, not just 5/9/13/17), a character may swap one currently-held special facility for a different one they now qualify for.
- **Defensive walls** (optional, player-built, not a facility): 20 ft. high, may include a walkway + access ladder/lift; 250 GP and 10 days per 5-foot square of wall. If the Bastion is **fully** enclosed by defensive walls and comes under attack (see §6), the number of dice rolled to determine Bastion Defender losses is reduced by 2.
- **Combining Bastions**: 2+ PCs may merge their Bastions into a single structure. This does **not** change how many special facilities each character has, how those facilities work, or who can issue orders to them — each combined Bastion "functions as if it were completely separate" for orders/hirelings. The **only** thing combining changes is Bastion Defenders during an attack event: defenders lost from one combined character's Bastion can be applied against another combined character's defender pool instead, if the two Bastions are combined.

### Data model translation

- **New catalog table** `bastion_facility_catalog` — shared, edition-scoped, rarely-mutated reference data (never campaign-specific), same category as `races`/`classes`/`spells` per this project's catalog/instance split:

  ```sql
  CREATE TABLE bastion_facility_catalog (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_key         TEXT NOT NULL UNIQUE,        -- 'arcane_study', 'war_room', ...
    name              TEXT NOT NULL,
    facility_type     TEXT NOT NULL CHECK (facility_type IN ('basic','special')),
    edition_scope     TEXT NOT NULL DEFAULT '2024' CHECK (edition_scope = '2024'),
      -- kept as a real column (not omitted) purely for consistency with every
      -- other catalog table's edition_scope convention (races/classes/etc use
      -- CHECK IN ('2014','2024','both')) — but Bastions genuinely has no 2014
      -- or 'both' rows, ever, so the CHECK is pinned to '2024' rather than
      -- offering values that can never legally occur.
    min_level         INT,                          -- NULL for basic facilities; 5/9/13/17 for special
    prerequisite_text TEXT,                          -- human-readable ("Ability to use an Arcane Focus as a Spellcasting Focus"); see Edge cases below for why this is prose, not a structured/queryable rule
    default_space     TEXT CHECK (default_space IN ('cramped','roomy','vast')),
    hireling_count    INT,                          -- NULL for War Room ("varies, see below" — starts at 2, grows via Recruit)
    order_type        TEXT CHECK (order_type IN ('craft','empower','harvest','maintain','recruit','research','trade')),
    bp_die            TEXT,                          -- '1d4' | '1d6' | '1d8' | '1d10'; NULL for basic facilities
    benefits          JSONB,                         -- genuinely variable per-facility mechanical detail (Craft sub-options, Pub Special table, Craft Potion cost table, etc.) — matches PLAN.md §3.3's "JSONB only for genuinely variable, unqueried structure" precedent; nothing in `benefits` is ever filtered/sorted/joined across facilities
    source_note       TEXT NOT NULL DEFAULT 'UA 2023 playtest text; not independently re-confirmed against final 2024 DMG numeric details'
  );
  ```

  Seed data for this table is exactly the transcribed catalog in §2 below (29 special facilities + 7 basic facility types). **Every seed row should carry the UA-sourced disclaimer in `source_note`** (or a per-row override for the handful of facts the Nov 2024 post directly corroborated, e.g. Smithy's prerequisite) so a future session querying this table sees the confidence caveat inline, not just in this doc.

- **New campaign-instance tables**:

  ```sql
  CREATE TABLE bastions (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id                    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    owner_character_id             UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    name                           TEXT,
    combined_group_id              UUID,             -- shared value across all Bastions combined together; NULL = not combined. A self-referencing "group id" rather than a self-FK, since combining is symmetric/many-to-many-ish among a set, not a parent/child pair.
    bastion_points                 INT NOT NULL DEFAULT 0 CHECK (bastion_points >= 0),
    bastion_defenders              INT NOT NULL DEFAULT 0 CHECK (bastion_defenders >= 0),
    status                         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','fallen','abandoned')),
    turn_interval_days             INT NOT NULL DEFAULT 7,   -- DM-configurable cadence override, see DM-configurable section
    last_turn_in_game_day          INT,                       -- anchors to campaign_events.in_game_day's day-count convention (see below) — NOT a TIMESTAMPTZ
    consecutive_turns_without_orders INT NOT NULL DEFAULT 0,  -- drives "Fall of a Bastion" (see §7)
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ON bastions (campaign_id);
  CREATE INDEX ON bastions (owner_character_id);
  ```

  **Important existing-convention correction to build on**: `packages/server/src/db/migrations/1784269811666_create-campaign-events.ts`'s own migration comment says, verbatim: *"This is the same representation Phase 4's Bastion turns will anchor to — settled here first so Bastion doesn't invent a second, competing time system."* That table uses `in_game_day INT` (days since an arbitrary campaign epoch, day 0 = campaign start), **not** a real-world timestamp or a free-text date. Bastion-turn timing (`last_turn_in_game_day` above, and `bastion_turns.in_game_day` below) must use this exact same `INT` day-count convention, per that already-settled precedent — do not introduce a second time representation for Bastions.

  Also note: **`characters` has no `level` column.** Character level is `character_classes.level` summed per class (multiclassing), confirmed directly from `packages/server/src/db/migrations/1784269738666_create-character-classes-and-proficiencies.ts` — there is no single `characters.level` to read. Every level-gate check in this doc (level 5/9/13/17 thresholds, per-facility `min_level`, magic-item-rarity level prereqs) must compute **total character level** as `SELECT COALESCE(SUM(level), 0) FROM character_classes WHERE character_id = $1`, not assume a stored scalar column exists.

  ```sql
  CREATE TABLE bastion_facilities ( -- instance rows, both basic and special
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bastion_id     UUID NOT NULL REFERENCES bastions(id) ON DELETE CASCADE,
    catalog_id     UUID NOT NULL REFERENCES bastion_facility_catalog(id),
    space          TEXT NOT NULL CHECK (space IN ('cramped','roomy','vast')), -- may exceed catalog's default_space if player enlarged it
    status         TEXT NOT NULL DEFAULT 'operational' CHECK (status IN ('operational','shut_down')), -- Bastion Events can force this to 'shut_down' for exactly one turn
    config         JSONB, -- facility-specific player-selected state: Garden's chosen type, Pub's currently-tapped Pub Special, Training Area's chosen Expert Trainer, etc. — genuinely per-facility variable, matches JSONB precedent
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX ON bastion_facilities (bastion_id);

  CREATE TABLE bastion_turns ( -- one row per resolved Bastion turn (audit trail)
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bastion_id     UUID NOT NULL REFERENCES bastions(id) ON DELETE CASCADE,
    turn_number    INT NOT NULL,
    in_game_day    INT NOT NULL,       -- see campaign_events convention above
    was_maintain   BOOLEAN NOT NULL,   -- true if character wasn't present / issued Maintain instead of per-facility orders
    event_roll     INT,                -- d20 result, only set when was_maintain = true
    event_key      TEXT CHECK (event_key IN ('nothing','attack','lost_hirelings','refugees','friendly_visitors','request_for_aid','honored_guest','extraordinary_opportunity','criminal_hireling','magical_discovery')),
    event_outcome  JSONB,              -- variable per event type (dice rolled, GP awarded, defenders lost, etc.)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bastion_id, turn_number)
  );

  CREATE TABLE bastion_orders ( -- one row per order issued on a turn (0 rows if Maintain was issued instead)
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bastion_turn_id     UUID NOT NULL REFERENCES bastion_turns(id) ON DELETE CASCADE,
    bastion_facility_id UUID NOT NULL REFERENCES bastion_facilities(id),
    order_type          TEXT NOT NULL CHECK (order_type IN ('craft','empower','harvest','recruit','research','trade')), -- 'maintain' deliberately excluded here — it's whole-Bastion, tracked on bastion_turns.was_maintain, not per-facility
    paid_reroll_gp       INT,          -- the optional 25 GP "roll BP die twice, take higher" spend
    bp_die_roll          INT NOT NULL,
    bp_awarded           INT NOT NULL,
    result               JSONB,        -- which Craft/Harvest/etc. sub-option was chosen, item produced, etc.
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```

- **Server-side validation is required, not optional**, for every write path above — this is not an advisory-only calculator like `xpBudget.ts`; Bastion orders grant real, persisted resources (GP, magic items, Bastion Points, temporary combat-relevant boons). A malicious or buggy client must not be able to bypass:
  1. **Level gates** — a facility can't be added, and an order can't be issued to a facility whose `min_level` exceeds the owning character's summed level (recomputed server-side from `character_classes`, never trusted from the client).
  2. **Prerequisite gates** — e.g. Smithy/Training Area/War Room require Fighting Style or Unarmored Defense; Sanctuary/Sacristy/Sanctum/Reliquary require a Holy Symbol/Druidic Focus as Spellcasting Focus; Arcane Study/Demiplane require an Arcane Focus as Spellcasting Focus; Workshop/Guildhall require Expertise in a skill; Observatory requires any Spellcasting Focus. These are **not** simple enum lookups — see Edge cases below on why `prerequisite_text` is prose, and what that implies for validation.
  3. **One order per facility per Bastion turn** (Meditation Chamber's Empower order is the sole documented exception — it grants one *additional* free order to a different facility, even one already ordered this turn).
  4. **Maintain excludes everything else** — issuing Maintain to a Bastion on a turn must reject any simultaneously-submitted per-facility order for that same turn.
  5. **Bastion Points balance can't go negative** — spending BP on a magic item (or the 10 BP reputation boon, or the 100 BP resurrection) must be an atomic conditional update (`UPDATE bastions SET bastion_points = bastion_points - $cost WHERE id = $id AND bastion_points >= $cost`), matching this project's existing "atomic DB update, not read-then-write" standard for any resource spend.
  6. **Magic item rarity ↔ level prereq** at time of BP spend (Rare needs owner level ≥9, Very Rare ≥13, Legendary ≥17 — see §3 table).
  7. **A `shut_down` facility can't receive an order** until it's repaired (automatically, at the start of the Bastion's next turn, per the Attack/Lost-Hirelings/Criminal-Hireling events).
  8. **The 100 BP "return to life at next dawn" benefit can't be reused until the character has gained at least one level since the last use** — this is a real anti-abuse rule in the source text, not a suggestion.

### Edge cases

- **"Some benefits" for Bastion-less characters riding on a friend's Bastion** is stated to exist but never mechanically defined by either source ("Characters without Bastions of their own can still gain some benefits from their friends' Bastions"). Do not invent a mechanic for this — treat it as DM narrative discretion only, not a computable rule, and don't build a "shared facility access for non-owners" feature without an explicit DM-facing note that this is un-ruled territory.
- **Basic-facility "Pub" ambiguity** (see Official rule above) — until the final book's exact Basic Facilities list is independently verified, do not hard-code a fixed 7-item enum for basic facility types in a way that blocks a DM from adding a custom basic facility name; keep `bastion_facility_catalog.name` free-text-seedable rather than a closed CHECK-constrained enum, precisely because this one detail is unconfirmed.
- **`prerequisite_text` is prose, not a structured rule, on purpose.** Several prerequisites reference concepts that don't map onto a single existing schema column: "Ability to use an Arcane/Holy Symbol/Druidic Focus as a Spellcasting Focus" is a **class-feature-derived capability**, not a stored boolean on `characters`; "Fighting Style feature" and "Unarmored Defense feature" are specific **class features** a character may or may not have taken (not every Fighter/Ranger/Paladin necessarily has Fighting Style if using a subclass or variant rule; not every Monk/Barbarian/Sorcerer with Unarmored Defense access has necessarily kept it). "Expertise in a skill" requires checking `character_skill_proficiencies.level = 'expertise'` for **any** skill (not a specific one). None of these can be pre-computed into a single denormalized boolean on `characters` without risking drift the moment class features change — the query needs to walk `character_classes` → the class/subclass's granted features (however this app already tracks "does this character have class feature X" for other level-gated content) at evaluation time, not trust a cached flag. **If this app doesn't yet have a generic "does character X currently have class feature Y" query,** that's a real gap this feature exposes — flag it to whoever implements Bastion facility-gating rather than faking the check with a hardcoded per-class lookup table that will drift from the character's actual features (e.g., from feats, multiclass dips, or homebrew).
- **Combining Bastions is symmetric, not hierarchical** — modeling it as a self-referencing parent/child FK (`combined_into_bastion_id`) would wrongly imply one Bastion "owns" the others; use a shared nullable group identifier instead (as modeled above), since defender-pooling during an attack applies uniformly across every Bastion in the group, not from children up to a parent.
- **Special-facility swap on level-up** must preserve BP/config state correctly: if a character swaps out a facility, any Bastion Points already earned stay with the Bastion (BP live on `bastions`, not on `bastion_facilities`), but any facility-specific `config` (a chosen Garden type, a tapped Pub Special) is lost with the swapped-out instance row — this is a real design choice worth surfacing in the UI as a confirmation step ("swapping out this facility will lose its current configuration"), not a silent data-loss bug.
- **Defensive-wall attack-dice reduction (−2 dice) requires the wall to be *fully* enclosing** — a partial wall grants nothing per the source text ("If your Bastion is completely enclosed by defensive walls..."). Don't implement a partial-credit scaling (e.g. "−1 die per 50% enclosure") — the source gives an all-or-nothing threshold, and anything else would be an invented rule.
- **Level derivation must sum multiclass levels**, not read a single class's level — a level 3 Fighter / level 2 Rogue character is level-5-total and should qualify for a Bastion the moment the sum crosses each threshold, matching standard 5e "character level" semantics used everywhere else in this app (spell slots, proficiency bonus, etc.).

### What must be tested

- `bastions.integration.test.ts` (server-side, matching this repo's `*.integration.test.ts` convention):
  - A character below total level 5 cannot have a Bastion created for them via a crafted API call, even if the client claims a higher level.
  - Special facility count enforcement at each breakpoint: a level-5 character can hold at most 2 special facilities; attempting to add a 3rd via a crafted request is rejected; the count becomes legal again only after crossing level 9 (then 4 allowed), 13 (5), 17 (6).
  - Adding a special facility whose `min_level`/`prerequisite_text` the character doesn't currently satisfy is rejected server-side, not just hidden client-side (e.g., attempt to add a Smithy for a character with neither Fighting Style nor Unarmored Defense).
  - Prerequisite check re-evaluates dynamically: a character who gains a Fighting Style mid-campaign (e.g., via a feat or multiclass dip) becomes eligible for Smithy/Training Area/War Room without a manual data migration.
  - A facility swap at level-up correctly removes the old `bastion_facilities` row and its `config`, while leaving `bastions.bastion_points` untouched.
  - Combining two Bastions correctly pools Bastion Defender losses (an Attack event on one combined Bastion may deduct from either Bastion's defender count, per the DM/player's choice) but never merges `bastion_points` or shares hirelings/orders across the pair.
  - Fully-enclosed defensive walls reduce attack-event dice by exactly 2; a partially-built wall (e.g. 3 of 4 sides) grants zero reduction.

---

## 2. Facilities (Basic and Special) — full catalog

**Sourcing status for this whole section: UA 2023 playtest text**, structurally corroborated per the table in the Source note (acquisition schedule, space table, order names), but the **specific per-facility numbers below (GP costs, BP dice, hireling counts, sub-option tables) are not independently re-confirmed against the final 2024 DMG** except where explicitly marked "(confirmed final)."

### Basic facilities (7, playtest list — see Edge case above on possible final-book expansion)

Bedroom, Courtyard, Dining Room, Kitchen, Parlor, Storage, Washroom. No orders, no Bastion Points, no level gate — bought with gold/time (see tables below), any number of each allowed, no character presence required to build.

**Adding a basic facility:**

| Facility Space | GP Cost | Time Required |
|---|---|---|
| Cramped | 500 GP | 20 days |
| Roomy | 1,000 GP | 45 days |
| Vast | 3,000 GP | 125 days |

**Enlarging a basic facility (no in-game mechanical benefit — cosmetic/space only):**

| Space Increase | GP Cost | Time Required |
|---|---|---|
| Cramped → Roomy | 500 GP | 25 days |
| Roomy → Vast | 2,000 GP | 80 days |

### Special facilities — master index (29 total, confirmed schedule per §1)

| Level | Facility | Prerequisite | Order |
|---|---|---|---|
| 5 | Arcane Study | Ability to use an Arcane Focus as a Spellcasting Focus | Craft |
| 5 | Armory | None | Trade |
| 5 | Barracks | None | Recruit |
| 5 | Garden | None | Harvest |
| 5 | Library | None | Research |
| 5 | Sanctuary | Ability to use a Holy Symbol or Druidic Focus as a Spellcasting Focus | Craft |
| 5 | Smithy | Fighting Style feature or Unarmored Defense feature | Craft |
| 5 | Storehouse | None | Trade |
| 5 | Workshop | Expertise in a skill | Craft |
| 9 | Gaming Hall | None | Trade |
| 9 | Greenhouse | None | Harvest |
| 9 | Laboratory | None* | Craft |
| 9 | Sacristy | Ability to use a Holy Symbol or Druidic Focus as a Spellcasting Focus | Craft |
| 9 | Scriptorium | None* | Craft |
| 9 | Stable | None | Trade |
| 9 | Teleportation Circle | None | Recruit |
| 9 | Theater | None | Empower |
| 9 | Training Area | Expertise in a skill, Fighting Style feature, or Unarmored Defense feature | Empower |
| 9 | Trophy Room | None | Research |
| 13 | Archive | None | Research |
| 13 | Meditation Chamber | None | Empower |
| 13 | Menagerie | None | Recruit |
| 13 | Observatory | Ability to use a Spellcasting Focus | Empower |
| 13 | Pub | None | Research |
| 13 | Reliquary | Ability to use a Holy Symbol or Druidic Focus as a Spellcasting Focus | Harvest |
| 17 | Demiplane | Ability to use an Arcane Focus as a Spellcasting Focus | Empower |
| 17 | Guildhall | Expertise in a skill | Recruit |
| 17 | Sanctum | Ability to use a Holy Symbol or Druidic Focus as a Spellcasting Focus | Empower |
| 17 | War Room | Fighting Style feature or Unarmored Defense feature | Recruit |

\* Laboratory and Scriptorium have "None" as their *facility* prerequisite, but the source notes some of the **orders** issuable to them carry their own additional prerequisites (e.g. crafting a scroll above Common rarity has a minimum level, same as the magic-item-by-rarity gate elsewhere).

**(Smithy's prerequisite line — "Fighting Style feature or Unarmored Defense feature" — is the one specific fact independently confirmed to survive unchanged into the final book, per the Source note's corroboration table.)**

### Special facility details — space, hirelings, BP die, and benefits

| Facility | Space | Hirelings | BP Die (Order) | Key benefit(s) |
|---|---|---|---|---|
| Arcane Study | Roomy | 1 | 1d4 (Craft) | Long-rest → cast *Identify* free, 1×/7 days. Craft: an Arcane Focus, or a blank spellbook. |
| Archive | Roomy | 1 | 1d8 (Research) | Holds 1 reference book (advantage on a specific INT skill, per book). Research → *Legend Lore*-equivalent info in 7 days. |
| Armory | Roomy | 1 | 1d4 (Trade) | Trade: stock the Armory (100 GP + 100 GP/defender, halved with a Smithy) → while stocked, roll d8 instead of d6 for defender losses in an Attack event; stock is consumed after any event. |
| Barracks | Roomy | 0 | 1d4 (Recruit) | Houses up to 12 Bastion Defenders. Recruit: +4 defenders at no GP cost (if not full). Multiple Barracks allowed. |
| Demiplane | Vast | 0 | 1d10 (Empower) | Level 17. Extradimensional room, scry-proof. Empower (7 days) → temp HP = 5×level after a long rest there. Fabrication: Magic action, 1×/long rest, create a nonmagical object ≤5-ft cube from mundane materials. |
| Garden | Roomy | 1 | 1d4 (Harvest) | Choose type (Decorative/Food/Herb/Poison) at creation; re-type via 21-day hireling task. Harvest yields per type: Decorative→10 bouquets/perfume (5 GP ea.); Food→50 GP produce; Herb→a *Potion of Healing*; Poison→2 vials Antitoxin or 1 vial Basic Poison. Enlarge to Vast (2,000 GP) = 2 gardens' worth + 1 hireling. |
| Gaming Hall | Vast | 4 | 1d6 (Trade) | Level 9. Trade → gambling den for 7 days, then roll d100 on a Gambling Den Winnings table (payouts scale 3d6 GP up to 10d6×10 GP). |
| Greenhouse | Roomy | 1 | 1d6 (Harvest) | Level 9. One plant grows 3 magical fruits/day; eating one grants *Lesser Restoration*; unpicked fruit loses magic after 24h. |
| Guildhall | Vast | 0 | 1d10 (Recruit) | Level 17. Prereq: Expertise in a skill. Comes with a ~50-member guild of a chosen type (Sample Guilds table: Adventurers', Bakers', Brewers', Cartographers', Entertainers', Jewelers', Masons', Shipbuilders', Thieves'). Recruit → assign the guild a themed task (guild-specific). |
| Laboratory | Roomy | 1 | 1d6 (Craft) | Level 9. Craft options: Liquid Concoction (Acid/Alchemist's Fire/Ink, half price), rare Poison, or a magic Potion (Craft Potion cost/min-level table by rarity; hireling's effective level = half the character's level, rounded up). |
| Library | Roomy | 1 | 1d4 (Research) | Research: pick any topic, 7 days → learn 3 accurate facts (DM-determined). |
| Meditation Chamber | Cramped | 0 | 1d8 (Empower) | Level 13. Empower → can issue one *extra* order to another special facility this turn, even one already ordered (the one explicit exception to "one order per facility per turn"). Fortify Self: 7 continuous days meditating (can't leave) → advantage on 2 random saving throws (Fortified Saves d6 table) for the next 7 days. |
| Menagerie | Vast | 2 | 1d8 (Recruit) | Level 13. Houses 4 Large creatures (or Medium/Small equivalents). Recruit → add a creature from a Menagerie Creatures table (named beasts with GP costs) or by CR (0=50 GP, ¼=250, ½=500, up to at least CR 3=3,500 — table may extend further; not fully captured in this transcription, see Edge cases). Housed creatures count as Bastion Defenders unless the player opts them out. |
| Observatory | Roomy | 1 | 1d8 (Empower) | Level 13. Prereq: any Spellcasting Focus. Long rest there → cast *Contact Other Plane* free, 1×/7 days. Empower → 7 nights of stargazing, then roll a die: even = nothing, odd = grants a random supernatural Charm (Darkvision/Heroism/Vitality) to self or an ally on the same plane. |
| Pub | Roomy | 1 | 1d8 (Research) | Level 13. Research → Information Gathering: spy network reports on events within 10 miles + the location/movement of any familiar creature within 50 miles, over 7 days. Pub Special: 1 magical beverage on tap (Pub Special table — e.g. *Enlarge* effect, *Spider Climb*, extended Darkvision, Necrotic resistance, Frightened immunity — 24h duration, swappable between turns). Enlarge to Vast (2,000 GP) → 2 beverages on tap + 3 more hirelings (4 total). |
| Reliquary | Cramped | 1 | 1d8 (Harvest) | Level 13. Prereq: Holy Symbol/Druidic Focus. Long rest → cast *Greater Restoration* free, 1×/7 days. Harvest → craft a single-use Tiny talisman usable once as a Spellcasting Focus that ignores Material components (even costly ones ≤1,000 GP). |
| Sacristy | Roomy | 1 | 1d6 (Craft) | Level 9. Prereq: Holy Symbol/Druidic Focus. Short rest there → regain one expended spell slot of 5th level or lower, 1×/long rest. Craft: Holy Water (scalable damage by extra GP spent, up to +5d6) or a temporary Sacred Item (7-day duration, from a fixed list: *Pearl of Power*, *Periapt of Wound Closure*, *Ring of Water Walking*, *Sending Stones*, *Staff of the Adder*, *Staff of the Python*, *Wand of Magic Detection*). |
| Sanctuary | Roomy | 1 | 1d4 (Craft) | Level 5. Prereq: Holy Symbol/Druidic Focus. Long rest → cast *Healing Word* free, 1×/7 days, at spell level = half character level (rounded down). Craft: a Sacred Focus (Druidic wooden staff or Holy Symbol). |
| Sanctum | Roomy | 4 | 1d10 (Empower) | Level 17. Prereq: Holy Symbol/Druidic Focus. Long rest → cast *Heal* free, 1×/7 days. Empower → daily rites grant temp HP = character level to self or a chosen ally after each long rest, for 7 days. Sanctum Recall: *Word of Recall* can target the Sanctum even overriding a previously chosen destination; the arriving creature also gets a *Heal* effect. |
| Scriptorium | Roomy | 1 | 1d6 (Craft) | Level 9. Craft: a Book Replica, up to 50 copies of paperwork (1 GP/copy, distributable within 10 miles), or a magic Scroll (Craft Scroll cost/min-level table by rarity; hireling's effective level = half character level, rounded up). |
| Smithy | Roomy | 2 | 1d4 (Craft) | Level 5. Prereq: Fighting Style or Unarmored Defense (**confirmed final**). Craft: ammo/Simple weapons at half price, armor/adventuring gear at half price, or Martial weapons at half price — plus masterwork versions (become permanent +1 items once *Magic Weapon* is cast on them and ends). |
| Stable | Roomy | 1 | 1d6 (Trade) | Level 9. Comes with 1 Riding Horse/Camel + 2 Ponies/Mules; houses 3 Large-equivalent animals (enlargeable to 6 as Vast, 2,000 GP). Trade: buy/sell mounts; sale profit +20% over standard (→+50% at lvl 13, +100% at lvl 17). |
| Storehouse | Roomy | 1 | 1d4 (Trade) | Level 5. Trade: procure ≤500 GP of goods (→≤2,000 GP at lvl 9, ≤5,000 GP at lvl 13) or sell stored goods for +10% over standard (→+20% at lvl9, +50% at lvl13, +100% at lvl17). |
| Teleportation Circle | Roomy | 0 | 1d6 (Recruit) | Level 9. Permanent teleportation circle. Recruit → invite a friendly Mage (or Archmage at owner level 17+); 50% chance they accept and stay 7 days, can be asked to cast one spell (Wizard spell ≤4th for a Mage, ≤8th for an Archmage; Material costs paid by the owner). Guest doesn't defend and leaves if the Bastion is attacked. |
| Theater | Vast | 4 | 1d6 (Empower) | Level 9. Empower → 14-day rehearsal + indefinite 7+-day performance run. PCs can serve as Composer/Writer, Conductor/Director, or Performer. DC 15 CHA (Performance) check per contributor at rehearsal end; majority success → each contributor gains a Theater die (d6, upgrading to d8 at lvl13, d10 at lvl17) usable once to boost a check/attack/save. |
| Training Area | Vast | 4 | 1d6 (Empower) | Level 9. Prereq: Expertise in a skill, Fighting Style, or Unarmored Defense. Choose 1 Expert Trainer (Battle/Skills/Tools/Unarmed Combat Expert) from a table; swappable each turn. Empower → 7 days training (8h/day) grants the trainer's benefit for 7 days to any character who trained the whole time. |
| Trophy Room | Roomy | 1 | 1d6 (Research) | Level 9. Research: Lore (any topic, 3 accurate facts) or Trinket Trophy (50% chance of a single-use trinket that casts one spell from a fixed list — *Clairvoyance*, *Death Ward*, *Find Traps*, *Locate Creature*, *Magic Weapon*, *Remove Curse*, *Speak with Dead* — with no components required). |
| War Room | Vast | starts at 2, up to 10 (Lieutenants) | 1d10 (Recruit) | Level 17. Prereq: Fighting Style or Unarmored Defense. Comes with 2 Lieutenants (Veteran stat block, owner's alignment) — don't count as Bastion Defenders, but each housed Lieutenant reduces attack-event defender-loss dice by 1. Recruit: gain a Lieutenant (max 10), or muster Soldiers (each Lieutenant recruits 100 Guards, or 20 mounted, fed at 1 GP/day/unit, disbands if unfed or unled). |
| Workshop | Roomy | 2 | 1d4 (Craft) | Level 5. Prereq: Expertise in a skill. Short rest there → Heroic Advantage, 1×/long rest. Craft: a Tiny nonmagical object using one of 8 named tool proficiencies, free unless worth ≥10 GP (then half price). |

### Data model translation

Covered above under §1 (`bastion_facility_catalog.benefits` JSONB carries everything in the "Key benefit(s)" column that doesn't fit a scalar column — Craft/Harvest sub-option lists, cost-by-rarity tables, Pub Special / Gambling Den Winnings / Expert Trainer / Sample Guilds sub-tables). These sub-tables are candidates for their **own** small catalog tables (e.g. `bastion_pub_specials`, `bastion_expert_trainers`) if the app ever needs to query/filter them individually (e.g. "show me all Pub Specials"); until then, JSONB is correct per the "genuinely variable, unqueried structure" precedent — don't over-normalize ahead of an actual query need.

### Edge cases

- **Menagerie's CR-based cost table is only partially captured** in this transcription — the source table extends at least through CR 3 (3,500 GP) in the visible text; whether it continues to higher CRs (and at what cost) wasn't confirmed in this session's read. Seed only the confirmed rows (CR 0 through 3, plus the named-creature table) and mark higher CRs as "needs re-verification against the source" rather than extrapolating a cost curve.
- **Facility name collisions with class features/spells** — e.g. "Sanctuary" is also a 1st-level spell name; "Reliquary" reads similarly to generic fantasy vocabulary. Namespace the catalog's `index_key` distinctly (`bastion_sanctuary`, not `sanctuary`) if this app's other catalog tables (spells, items) could ever share a lookup surface, to avoid an accidental join against the wrong table.
- **Facilities with 0 hirelings can still take orders** — Barracks (Recruit), Demiplane (Empower), and Teleportation Circle (Recruit) all list `Hirelings: 0`. Don't gate "can this facility receive an order" on `hireling_count > 0` — that's a real bug risk given how many facilities have a nonzero hireling count as the common case.
- **Some orders have sub-choices that are themselves gated** (e.g. Laboratory's Craft: Potion sub-option requires the facility's *effective hireling level* — half the owner's level, rounded up — to meet the target potion's minimum level; a level-9 owner can craft up to Rare (hireling level ≈5, meets Rare's min-level-9 requirement only via the *character's* level being checked, not the halved hireling level — re-read carefully: the Craft Potion table's "Min. Level" column gates the **owner's own level**, not the hireling's derived level, which only affects crafting time/quality flavor). This is easy to implement backwards — write a targeted test (see below) asserting the min-level check runs against the owning character's level, not the halved hireling stand-in level.

### What must be tested

- Full catalog seed-data snapshot test: 29 special facilities + 7 basic facility types load with the exact level/prerequisite/space/hireling/order values transcribed above (catches a seed-script typo the same way `xpBudget.test.ts` catches a threshold-table typo).
- Craft/Harvest/Research/Trade/Empower/Recruit sub-option gating: a level-9 character can Craft a Rare potion in a Laboratory (min level 9 met); a level-8 character with the same facility cannot (min level not met), even though the facility itself has no level prerequisite of its own.
- Pub enlargement to Vast correctly doubles the concurrent Pub Special count (1→2) and adds exactly 3 hirelings (1→4), not a flat "+1 special."
- Meditation Chamber's Empower order correctly allows issuing a second order to a *different*, already-ordered facility on the same turn, while every other special facility rejects a second order attempt on the same turn.

---

## 3. Bastion Points and facility benefits

### Official rule

- Every **special** facility generates Bastion Points (BP) when its owner issues it an order (basic facilities never do). The BP die is per-facility (see §2 table) — roll it once per order.
- **Issuing Maintain instead** generates a flat **1d4 BP per special facility** in the Bastion (rolled per facility, not once for the whole Bastion), in lieu of each facility's own normal order-based BP.
- **Paying to improve the odds**: spending 25 GP when issuing an order to a facility lets the player roll that facility's BP die **twice and take the higher result**. This option is **not** available when issuing Maintain.
- **Spending BP — magic items** (once per level gained, one item per level-up):

  | Magic Item Rarity | Level Prereq (of the owning character) | Cost |
  |---|---|---|
  | Common | — | 20 BP |
  | Uncommon | — | 70 BP |
  | Rare | 9 | 250 BP |
  | Very Rare | 13 | 350 BP |
  | Legendary | 17 | 700 BP |

  Any item acquired this way must be DM-approved. The character must physically be **in their Bastion** to claim the item — if away, it waits securely until they arrive. Characters who've reached level 20 can spend BP for a magic item each time they earn a bonus feat (every 30,000 XP above 355,000 XP) — this specific clause reads as a holdover from the 2014-style "epic boon" XP progression and its exact final-book wording is **unconfirmed**; flag before implementing literally (see Unresolved section).
- **Other BP spends**: 10 BP on level-up → advantage on all Charisma checks within 50 miles of the Bastion for the next 7 days. 100 BP → return to life at the Bastion at the next dawn after dying; **cannot be used again until the character gains at least one more level.**
- **BP are per-character, per-Bastion — never transferable** between characters or between a character's own multiple Bastions (if they somehow have more than one; the source assumes one Bastion per character in the normal case).

### Data model translation

Covered under §1's `bastions.bastion_points` column and `bastion_orders.bp_awarded`/`bp_die_roll` columns. Additional notes:

- The magic item spend needs a join to whatever this app's item catalog uses for `rarity` (confirm the exact column name/enum on the `items` catalog table before implementing — not verified in this pass since it's outside this doc's scope, but the Bastion feature depends on it existing and being queryable by rarity).
- The "must be in their Bastion to claim" condition implies Bastion-acquired magic items need a **pending/claimed** state distinct from "granted" — e.g. `character_items` (existing table) shouldn't get a row until the character is confirmed present; until then, track the pending item on `bastion_orders.result` (JSONB) or a small `bastion_pending_rewards` table, and only materialize a `character_items` row on claim. This is a real state-machine detail worth deciding explicitly before implementation, not improvising ad hoc.
- The 10 BP / 100 BP non-item spends both produce **temporary, duration-bound effects** on the owning character — these are `active_effects` candidates (existing table, see §1's schema review), but `active_effects.source_type` currently has a fixed `CHECK (source_type IN ('spell','class_feature','monster_ability','item','manual'))` with **no `'bastion_facility'` (or similar) value**. Implementing this literally means either reusing `'manual'` (loses the specific provenance) or extending that CHECK constraint — flagging this precisely as an application-code change the calling session should make, per this doc's read-only-against-app-code constraint.

### Edge cases

- **25 GP reroll option interacts with Maintain's flat 1d4** — the source is explicit the reroll option "can't be used... when issuing the Maintain order to the Bastion," so a UI/API that allows the 25 GP spend alongside a Maintain order is implementing a rule that doesn't exist.
- **Level-20 epic-boon-style BP magic item clause is the single most likely candidate in this whole document to have changed for the final book** — 2024's XP progression and post-20 "bonus feat" cadence should be cross-checked against how this app's `characters`/leveling logic already handles level 20 (if it does at all) before this specific clause is implemented; don't wire it up as a hard rule without that cross-check.
- **Claiming a Bastion-acquired magic item requires "presence,"** which this app needs a concrete definition for — is presence tracked at all today (e.g., via map/token location, or purely narrative/DM-adjudicated)? If this app has no location-tracking concept for a character being "at" a specific non-encounter location, this claim-gating condition may need to be DM-adjudicated (a DM manually flips a "claimed" flag) rather than system-enforced — flag this as a possible gap between the rule and this app's current capabilities, not silently drop the requirement.

### What must be tested

- BP die roll + award: issuing an order awards a BP amount within the die's valid range (e.g. `1d6` → 1-6), with the 25 GP reroll-and-take-higher option correctly implemented as `max(roll1, roll2)`, not `roll1 + roll2` or a re-roll-and-discard.
- Maintain issues exactly `1d4` per special facility (not per basic facility, not per Bastion as a whole) and blocks any per-facility order from being recorded on the same turn.
- Magic-item BP spend is atomically decremented and rejected if `bastion_points < cost` even under concurrent requests (matches this project's existing atomic-update standard for resource spends elsewhere).
- Magic-item BP spend is rejected if the target rarity's level prerequisite isn't met by the owning character's current summed level (Rare below level 9, Very Rare below 13, Legendary below 17).
- The 100 BP resurrection spend is rejected on a second attempt before the character has gained a level since the first use.

---

## 4. Orders

### Official rule (confirmed final — see corroboration table in Source note)

Seven order types exist. Six ("special orders") are issued to one or more individual special facilities; the seventh (Maintain) is issued to the whole Bastion at once and cannot be combined with any special order on the same turn.

- **Craft.** Hirelings begin crafting an item craftable in that facility. The owning character can do the work personally instead, but then the work pauses whenever they leave the Bastion until they return.
- **Empower.** The facility confers a temporary empowerment on the owning character or someone else, as defined per-facility.
- **Harvest.** A resource is produced and gathered by hirelings (or personally, with the same leave-pauses-work caveat as Craft). While a Harvest is in progress, the facility can't be used to Harvest anything else even if some special ability would otherwise allow two simultaneous orders.
- **Maintain.** Issued to the entire Bastion, not to a facility. Prohibits any other order being issued to the Bastion that turn. Each special facility generates 1d4 BP instead of its normal order-based BP. The DM rolls once on the Bastion Events table (§6) after a Maintain order. If a character isn't present in their Bastion on a given turn, **the Bastion automatically acts as though Maintain was issued** that turn (whether or not the player consciously chose it).
- **Recruit.** Hirelings recruit creatures/people to the Bastion (defenders, guild members, mounts, guests, depending on facility).
- **Research.** Hirelings (or the character personally, same leave-pauses-work caveat) gather information.
- **Trade.** Hirelings buy/sell goods or services stored or produced in the facility.

A character can issue one order **per Bastion turn**, to one or more special facilities in that turn (i.e., "one order per facility, but multiple facilities can each get an order on the same turn" — the limit is per-facility-per-turn, not "the whole Bastion gets exactly one order per turn"). Re-read carefully: the source's exact framing is "a character... can issue special orders... to one or more of their Bastion's special facilities" — so the real constraint is **one order per facility per turn**, with no cap on how many *different* facilities can each receive an order in the same turn (subject to the character being present/able to communicate with hirelings — see corroborating post: "When a character is present in their Bastion or can communicate with their hirelings in some capacity, they can issue an order").

### Data model translation

Covered under §1's `bastion_orders` table (`order_type` CHECK excludes `'maintain'` deliberately, tracked instead via `bastion_turns.was_maintain`) and the uniqueness/exclusivity rules noted there.

### Edge cases

- **"One order per facility per turn" is a per-facility limit, not a per-Bastion limit** — a Bastion with 4 special facilities can have up to 4 different orders issued on the same turn (one each), which is easy to mis-implement as "a character gets exactly one Bastion action per turn total." Get this right; it changes the shape of `bastion_orders` (many rows per turn, not at most one).
- **"Present or can communicate with hirelings"** is the actual gating condition for issuing *any* special order, not merely "present at the Bastion" — a character adventuring far away who has some in-fiction means of remote communication (sending, a familiar, a Teleportation Circle guest, etc.) may still be able to issue orders per this reading. This is DM-adjudicated in practice ("can communicate... in some capacity" is not a hard mechanical test) — don't hard-code "character must be at Bastion's map location" as the sole gate without a DM-override escape hatch, since the source explicitly allows for remote issuance under DM judgment.
- **Auto-Maintain on absence is automatic, not opt-in** — if no per-facility orders are issued for a turn and the character wasn't present, the system should default to Maintain (and roll a Bastion Event) rather than leaving the turn in an undefined "nothing happened" state. This interacts with "Fall of a Bastion" (§7) — auto-Maintain still counts as "issuing an order" for the fall-tracking purposes below, since it's explicitly described as the Bastion having "acted."

### What must be tested

- A single Bastion turn can record multiple distinct `bastion_orders` rows (different `order_type`s, different `bastion_facility_id`s) as long as no facility appears twice.
- Attempting to issue two orders to the same facility on the same turn is rejected (except Meditation Chamber's Empower-granted bonus order, per §2).
- A turn where the character issues zero explicit orders and wasn't present resolves as `was_maintain = true` with a Bastion Event roll recorded, not as a no-op turn.
- Attempting to submit both a Maintain order and any per-facility order in the same turn is rejected.

---

## 5. Bastion turns

### Official rule (confirmed final — see corroboration table in Source note)

- A Bastion turn occurs, by default, **every 7 in-game days** — "the DM can alter the frequency of Bastion turns" (explicit DM-configurable knob, not a fixed constant).
- Turns are resolved regardless of whether the characters are currently in their Bastion or out adventuring. The corroborating post's worked-scenario table (confirmed final content, not in the UA doc) gives four example resolutions:

  | Scenario | Bastion Turn Resolution |
  |---|---|
  | Traveling on a long journey (7+ days) | 1 Bastion turn every 7 days of travel |
  | Time between adventures while staying at the Bastion | 1 Bastion turn per week of rest time |
  | Party returns after 6 days adventuring, stays for the night | 1 Bastion turn after spending the night |
  | Adventuring near the Bastion, returning each night | 1 Bastion turn after 7 days of nearby questing |

- Guidance for slowing the pace during long downtime: "if the characters have a long period of downtime between adventures, say six months or more, you might call for a Bastion turn every month instead of every 7 days." Target pacing guidance (non-binding, DM judgment): "aim for about six to eight Bastion turns per level."
- On a turn, a character issues per-facility orders and/or Maintain (see §4), then the results (BP, Bastion Events if Maintain, resource production) resolve.

### Data model translation

Covered under §1 (`bastions.turn_interval_days`, `bastions.last_turn_in_game_day`, `bastion_turns.in_game_day`, all anchored to the existing `campaign_events.in_game_day` INT day-count convention per that migration's own stated intent).

- **Next-turn-due computation** is app-layer, not a DB constraint: `next_due_day = bastion.last_turn_in_game_day + bastion.turn_interval_days` (or `campaign start (0) + turn_interval_days` for a Bastion's first turn). This mirrors `campaign_events`'s own "no auto-advance logic: the DM decides when in-game time passes" design — Bastion turns should **not** silently auto-resolve on a timer; the DM/player advances `in_game_day` (already how this app's calendar works) and then explicitly triggers turn resolution, matching the existing manual-advance precedent rather than inventing an automatic cron-like mechanism this app has no other example of.

### Edge cases

- **Turn cadence is a per-Bastion setting, not necessarily campaign-wide** — different PCs' Bastions could plausibly run on different cadences if the DM wants (e.g. one PC's remote fortress checks in monthly, another's downtown guildhall checks weekly) even though the source frames this as a whole-campaign DM choice in its examples. Model `turn_interval_days` on `bastions`, not `campaigns`, to leave that flexibility open without over-committing to either interpretation — this is the safer default since a per-Bastion column can always be set identically across every Bastion in a campaign to simulate a "campaign-wide" cadence, but the reverse (campaign-wide column) can't represent per-Bastion divergence at all.
- **"Six to eight turns per level" is explicitly non-binding pacing advice**, not a rule to enforce or warn against programmatically — do not build a "you're falling behind/ahead of pace" validator; this is DM narrative pacing, same category as the XP-budget doc's advisory-only troubleshooting notes.

### What must be tested

- `next_due_day` computation correctly reflects a DM-adjusted `turn_interval_days` (e.g. 30 for the "six months of downtime" scenario) rather than assuming the hardcoded default of 7 everywhere.
- Turn resolution is never auto-triggered by a background job/timer — only by an explicit DM/player action advancing `in_game_day` and resolving the turn (regression guard against accidentally building an unwanted auto-advance feature this app has no precedent for).

---

## 6. Bastion Defenders and Bastion Events (random events table)

### Official rule (Attack mechanic and Request for Aid confirmed final; the rest of the table is UA-sourced only — see Source note)

- **Bastion Defenders** are a plain headcount (no individual stat tracking — "we don't present or require statistics for Bastion hirelings and defenders. All a player needs to track is the number of each in their Bastion"). Certain special facilities grant/house defenders (Barracks via Recruit, Menagerie creatures unless opted out, Honored Guest mercenaries, etc.).
- **Bastion Events trigger only when Maintain is issued** — "At the end of any Bastion turn in which a character issues the Maintain order to their Bastion, the DM rolls once on the Bastion Events table." Since absence auto-triggers Maintain (§4), this means **every turn a character isn't present at their Bastion risks a random event.**
- **Bastion Events table** (d20):

  | d20 | Event |
  |---|---|
  | 1–9 | Nothing significant happens |
  | 10 | Attack |
  | 11–12 | Lost Hirelings |
  | 13–14 | Refugees |
  | 15 | Friendly Visitors |
  | 16 | Request for Aid |
  | 17 | Honored Guest |
  | 18 | Extraordinary Opportunity |
  | 19 | Criminal Hireling |
  | 20 | Magical Discovery |

- **Attack** (confirmed final mechanic): a hostile force attacks but is defeated. Roll 6d6; for each die showing a 1, one Bastion Defender dies (removed from roster). Additionally, one random special facility is damaged and shut down until repaired at the start of the next turn (free repair, no cost). If the Bastion has no Bastion Defenders, or loses them all in this attack, a **second** special facility also shuts down. A shut-down facility generates no BP if Maintain is issued while it's down. (Armory's "roll d8 instead of d6 per die" stocked-bonus, per §2, modifies this roll.)
- **Criminal Hireling**: one hireling has a criminal past that surfaces; pay a 1d6×100 GP bribe to keep them, or they're arrested and removed (their facility is short-staffed and unusable next turn; replaced free afterward).
- **Extraordinary Opportunity**: gain 2d4 bonus BP if the player spends 500 GP (hosting a festival, funding research, appeasing a noble — narrative details worked out with the DM).
- **Friendly Visitors**: visitors offer 1d6×100 GP for brief use of one special facility; doesn't block the owner's own orders to that facility.
- **Honored Guest**: a guest arrives; roll (or choose) on a d4 sub-table: (1) grateful guest gives a free letter-of-recommendation favor; (2) guest requests sanctuary, leaves before the next turn, gives a 1d6×100 GP gift; (3) a group of friendly mercenaries joins as +4 Bastion Defenders (no housing facility required) until dismissed/killed; (4) the guest is a dragon or other flying monster that perches atop the Bastion until the next turn unless killed/driven off (Indifferent unless provoked, then Hostile; may be bribable to leave).
- **Lost Hirelings**: one random special facility's hirelings leave (cause is DM/player's choice); unusable next turn, replaced free afterward.
- **Magical Discovery**: hirelings find/create an Uncommon magic item of the player's choice (not armor, a shield, or a weapon); it's **temporary** — functions from the moment it's claimed until the start of the Bastion's next turn, then turns to dust.
- **Refugees**: 2d4 refugees seek shelter (fleeing a monster attack, disaster, etc.). If no basic facility is large enough to house them, they camp just outside instead. They pay 1d6×100 GP for hospitality/protection and stay until relocated or until a hostile force attacks the Bastion.
- **Request for Aid** (confirmed final mechanic): the Bastion is asked to help a local leader (a search, brigands, etc.). If the player agrees, they must dispatch one or more Bastion Defenders; roll 1d6 per defender sent. Total ≥10: problem solved, reward = 1d6×100 GP. Total <10: problem still solved, but reward is halved **and** one dispatched Bastion Defender is killed (removed from roster).

### Data model translation

Covered under §1 (`bastion_turns.event_roll`/`event_key`/`event_outcome`). Additional notes:

- `event_outcome` (JSONB) needs to hold genuinely variable per-event shapes: dice results and defenders-lost count for Attack; GP amount + which sub-result for Request for Aid/Honored Guest/Refugees/Friendly Visitors; the specific magic item chosen for Magical Discovery; the specific facility affected for Lost Hirelings/Criminal Hireling. This is squarely "genuinely variable, unqueried structure" — a real JSONB use case, not a shortcut around normalization.
- **GP awards/costs from events must credit/debit `character_currency.gp`** (existing table, `gp INT` column — whole gold pieces only; every GP figure in this whole doc is a whole number, so no fractional-currency handling is ever needed here) via the same atomic-update pattern as any other currency change in this app, not a raw client-submitted balance.
- Bastion Defender headcount lives on `bastions.bastion_defenders` (a plain integer per §1) — matches the source's own "just a headcount, no individual stats" design; don't build out individual defender NPC records unless a future feature explicitly needs them (e.g. naming/personality flavor text could live in a simple `TEXT[]` or small side table if the UI wants that, but it's not mechanically required by the rules).

### Edge cases

- **Only "Attack" and "Request for Aid" are independently confirmed against the final book.** The other 7 event descriptions (Lost Hirelings, Refugees, Friendly Visitors, Honored Guest, Extraordinary Opportunity, Criminal Hireling, Magical Discovery) and the d20 range table itself are **UA-sourced only** — treat their exact numbers (GP multipliers, d4 sub-tables, dice pools) as this doc's best-available approximation, not verified-final numbers, and say so in any seed-data comment.
- **Auto-Maintain-on-absence means Bastion Events are the *default* outcome of simply not engaging with the Bastion system for a session**, not a rare occurrence — if a campaign has multiple PCs each with their own Bastion and the party spends several real sessions away from all of them, the DM could be rolling several Bastion Events per turn cycle. This is intentional per the source (roleplay hooks), but worth surfacing to the DM UI as "N events pending resolution" rather than silently accumulating unresolved events.
- **"No Bastion Defenders left → second facility shuts down" in the Attack event** must be evaluated **after** applying this same attack's defender losses, not against the pre-attack count — an off-by-one here (checking defender count before vs. after the 6d6 resolution) changes whether the second-facility-shutdown clause triggers.
- **Armory's d8-substitution modifies the *number rolled on each die*, not the *number of dice*** — still 6 dice total in an Attack event, just d8s instead of d6s when the Armory is stocked. Don't conflate this with the defensive-wall's separate "−2 dice" reduction (§1) — the two stack (a stocked Armory changes die type; a fully-walled Bastion reduces die count), and both can apply to the same Attack event simultaneously.

### What must be tested

- Bastion Events only ever roll when a turn resolves as Maintain (explicit or auto), never on a turn with per-facility orders issued.
- Attack event: 6d6 roll (or 6d8 if Armory is stocked) correctly counts 1s for defender loss; the "second facility shuts down" clause only triggers when the post-loss defender count is exactly 0.
- Request for Aid: the ≥10/<10 threshold and its two distinct outcomes (full reward + no losses vs. halved reward + 1 defender lost) are each independently tested at the boundary (total exactly 10 vs. exactly 9).
- GP awards from any event are credited to `character_currency.gp` via an atomic update, never a raw client-supplied balance.
- A shut-down facility (from Attack, Lost Hirelings, or Criminal Hireling) generates 0 BP if Maintain is issued while it's still down, and becomes orderable again starting the following turn without any manual DM action required.

---

## 7. Fall of a Bastion / voluntary abandonment

### Official rule

- **Automatic fall**: "If a character issues no orders to their Bastion for a number of consecutive Bastion turns equal to the character's level (typically because the character is dead or otherwise out of commission), the hirelings abandon the Bastion and the site is eventually looted." The character can later return and start a **new** Bastion, "perhaps building it amid the ruins of the old one" (flavor-only, no mechanical partial-credit specified).
- **Voluntary abandonment**: a character can give up their Bastion at any time; it's vacated, eventually looted, "and might even be burned to the ground." They may start a new Bastion elsewhere.
- **New Bastion after either fall scenario**: use the Special Facility Acquisition table (§1) for how many special facilities the new Bastion starts with, based on the character's **current** level (not level 5, if they're now higher) — plus the standard 2 basic facilities (one Cramped, one Roomy) of the player's choice.

### Data model translation

- `bastions.consecutive_turns_without_orders` (per §1) increments on every turn where **zero** orders (including Maintain) were explicitly issued by the player — this is a distinct condition from "auto-Maintain due to absence" (§4), which the source treats as the Bastion having "acted." Re-read carefully: the fall condition is "issues **no orders**," and auto-Maintain is explicitly described as the Bastion acting *as though* Maintain was issued — so **auto-Maintain should reset this counter to 0, not increment it.** The fall condition is realistically about a genuinely disengaged/dead/unreachable character for whom *not even the automatic fallback* is occurring (i.e., no `bastion_turns` row is being resolved for them at all, turn after turn) — see Edge cases below, this is one of the more ambiguous points in the whole doc.
- On fall or voluntary abandonment: set `bastions.status = 'fallen'` or `'abandoned'` respectively; a genuinely new `bastions` row should be created for any subsequent Bastion (don't resurrect/reset the old row), since the source frames this as a distinct new structure ("perhaps built amid the ruins"), and preserving the fallen Bastion's row intact gives a clean campaign history/audit trail for free.

### Edge cases

- **What exactly increments `consecutive_turns_without_orders` is the most ambiguous mechanical point in this entire ruleset.** Two readings are both textually defensible:
  1. **(a)** The counter only increments when literally *no Bastion turn is being resolved at all* for that character (e.g., the DM has stopped tracking that PC's Bastion entirely, or the player is unreachable/the character is dead with no one managing it) — auto-Maintain (§4) counts as "the Bastion acting," so it resets the counter.
  2. **(b)** The counter increments any time the *player* personally issues zero explicit orders, even if the system auto-resolves Maintain on their behalf — i.e., "issuing no orders" is read literally as "the player didn't choose anything," regardless of the automatic fallback.
  Reading (a) is more consistent with the source's own parenthetical ("typically because the character is dead or otherwise out of commission") — a dead character can't even trigger auto-Maintain in any meaningful sense if no one is playing them, whereas a character who's merely away adventuring gets auto-Maintain (and Bastion Events) every single turn, which reads as the Bastion continuing to function, not falling. **Recommend (a)** for this app's implementation, but this is an explicit interpretive choice this app is making, not a resolved rule — document it as such in code, exactly like the encounter-XP-budget doc's mixed-level-party interpretive choice.
- **No mechanical partial credit for "building amid the ruins"** — don't invent a discount/bonus for rebuilding on a former Bastion site; treat a post-fall new Bastion identically to any other fresh acquisition, just flavored differently.
- **A character's level at time of re-founding may be well above 5** — the Special Facility Acquisition table lookup for a new Bastion must use the character's **current** total level, which could already qualify them for more than the base 2 special facilities (e.g., a level-13 character starting fresh gets 5 special facilities immediately, not 2).

### What must be tested

- The interpretive choice for `consecutive_turns_without_orders` (recommend (a) above) is implemented and has an explicit test + code comment flagging it as an interpretive choice, not an official rule.
- A Bastion whose owning character reaches `consecutive_turns_without_orders == character's current level` transitions to `status = 'fallen'` and stops accepting new orders.
- A new Bastion founded post-fall by a level-13 character starts with 5 special facilities (per the level-13 row of the Acquisition table), not the base 2.

---

## Genuinely unresolved / ambiguous (interpretive choices)

Consolidated from the edge cases above — every place this app must make a choice the sources don't make for us:

1. **What benefit a Bastion-less character gets from a friend's Bastion** — stated to exist, never defined. Treat as DM narrative-only; do not build a mechanic for it. (§1)
2. **Whether the final DMG's Basic Facilities list matches the UA's 7-item list exactly, or added an 8th (e.g. "Pub" as a basic facility)** — a comment-thread remark implies you can have "a pub" pre-level-13, but doesn't confirm whether that's a new catalog entry or just re-skinning "Dining Room." Keep the basic-facility catalog open-ended/seedable rather than a closed enum until this is re-verified against the actual book. (§1)
3. **The exact final-book wording of the level-20-and-beyond "bonus feat XP threshold → BP magic item" clause** — this reads like a 2014-style epic-boon holdover and is the single numeric detail in this doc most likely to have changed; cross-check against how this app already handles (or doesn't handle) level 20+ progression before implementing literally. (§3)
4. **What "consecutive Bastion turns with no orders issued" means relative to the auto-Maintain-on-absence rule** — two textually defensible readings; this doc recommends reading (a) (auto-Maintain resets the counter; only a genuinely un-resolved Bastion, e.g. a dead/abandoned character, accumulates toward the fall threshold) but flags it explicitly as an interpretive choice, not a resolved rule. (§7)
5. **"Present or can communicate with hirelings" as the order-issuing gate** is DM-adjudicated in the source's own language, not a hard mechanical test (e.g. does a Sending spell count? A familiar? A Teleportation Circle guest relaying messages?) — this app should provide a DM-override affordance rather than hard-coding "must be at the Bastion's map location" as the only path to issuing an order. (§4)
6. **Whether the Bastion Events table's 8 non-Attack/non-Request-for-Aid entries are numerically unchanged in the final book** — only those two are independently corroborated; the rest carry a "best-available approximation" caveat that should propagate into any seed-data comments and, ideally, into a DM-facing "unverified numbers" note if this content is ever surfaced directly to players. (§6)
7. **Whether the Menagerie's CR-to-cost table extends meaningfully past CR 3** — only confirmed through CR 3 (3,500 GP) in this session's read; don't extrapolate the curve. (§2)

## DM-configurable, never hardcoded

- **Whether Bastions are available in a campaign at all** — explicit DM opt-in per the source's own framing ("it's up to the DM to decide whether Bastions are available in a campaign"). Needs a real toggle — a `campaigns` settings field (matching this project's existing precedent for optional-rule toggles, e.g. `campaigns.ability_reroll_setting` per the migrations list) — not an assumption that every 2024-edition campaign automatically gets Bastions. Recommend `campaigns.bastions_enabled BOOLEAN NOT NULL DEFAULT false` (or a JSONB settings key if this app already has a general per-campaign settings blob) rather than inferring availability from `srd_edition = '2024'` alone.
- **Bastion turn cadence** — explicitly DM-adjustable (7 days is a default, not a hard rule); model as `bastions.turn_interval_days`, DM-editable per Bastion (§5).
- **Awarding a Bastion later than level 5, or via a method other than the four named ones** — the source explicitly allows this ("it is possible to award one later"); don't hard-gate Bastion creation to exactly level 5, only to level ≥5.
- **Random Bastion Event resolution narrative** — the DM and player jointly narrate the outcome of a rolled event; the numeric results (GP, dice, defender losses) are fixed by the table, but how the fiction plays out is explicitly left open ("the event is resolved immediately, with the player and DM working together to expand story details as needed"). Nothing to enforce here beyond recording the numeric outcome.
- **A 2014-edition campaign that wants to use Bastions anyway** is not something either source addresses (Bastions is inherently 2024-only content) — if this app ever wants to support that combination, it's a deliberate cross-edition content-import decision for the DM to make explicitly, not something the app should silently allow (mixing systems) or silently block (removing DM agency) without a clear opt-in control, consistent with how `docs/rules/encounter-xp-budget.md`'s DM-configurable section treats `srd_edition` as the sole existing campaign-level rules toggle this app reads today — Bastions would be the first feature to need a *content* toggle independent of `srd_edition`, which is worth flagging to whoever designs the settings schema.

## What must be tested (consolidated checklist)

In addition to each section's own "What must be tested" above, at minimum these server-side integration tests (matching this repo's `*.integration.test.ts` convention) should exist before Bastions ships, since none of this is advisory-only — every order, event, and BP/GP spend mutates persisted state a malicious or buggy client could otherwise forge:

- [ ] Level-gate enforcement on Bastion creation, special-facility acquisition, and special-facility count, all recomputed server-side from `character_classes` (never trusting a client-submitted level).
- [ ] Prerequisite-gate enforcement (Fighting Style/Unarmored Defense, Spellcasting Focus type, skill Expertise) re-evaluated dynamically against the character's actual current features, not a cached/denormalized flag.
- [ ] One-order-per-facility-per-turn enforcement, with Meditation Chamber's documented exception, and Maintain's mutual exclusivity with any per-facility order.
- [ ] BP awards match each facility's documented die (with the 25 GP roll-twice-take-higher option correctly implemented, and correctly disallowed under Maintain).
- [ ] BP spends are atomic, never permit a negative balance, and enforce the magic-item rarity↔level table.
- [ ] GP awards/costs from any Bastion order or event are applied to `character_currency.gp` atomically, never from a client-submitted balance.
- [ ] Bastion Events only roll on Maintain turns (explicit or auto-triggered by absence); the Attack event's dice-count/die-type modifiers (defensive wall −2 dice, stocked Armory d6→d8) both apply correctly and independently.
- [ ] Request for Aid's ≥10/<10 threshold produces the two distinct documented outcomes, tested at the exact boundary.
- [ ] Fall-of-a-Bastion counter behavior matches this doc's documented interpretive choice (§7), with an explicit code comment citing it as an interpretive choice.
- [ ] A new Bastion founded after a fall or voluntary abandonment correctly uses the character's *current* level for the Special Facility Acquisition lookup, not level 5.
- [ ] `campaigns.bastions_enabled` (or equivalent toggle) actually gates every Bastion-related write endpoint — a crafted API call against a campaign with Bastions disabled must be rejected, not just hidden from the UI.
