# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This is a D&D web application **at the pre-code stage**: there is no application source, no package.json at the repo root, no build/lint/test tooling, and this directory is not yet a git repository. Don't assume a framework, language, or file layout — none has been chosen yet. When the user starts adding real application code, update this file with the actual stack, commands, and architecture rather than guessing ahead of that work.

The only things currently in the repo are planning artifacts for an **OpenCode** setup (`.opencode/`) that pre-defines a set of subagents and a rules skill for the D&D domain — these encode design decisions the eventual app should follow.

## Existing subagent definitions (`.opencode/agents/`)

These are OpenCode subagent configs (not Claude Code subagents), but they document intended architecture for this project and are worth honoring when building the real thing:

- **rpg-data-model-architect** — schema design/migrations. Its core rule: strictly separate **catalog data** (races, classes, monster archetypes, item/spell templates — shared, rarely mutated reference tables) from **campaign-instance data** (live combatants, current HP, inventories, active sessions — mutated frequently, scoped to one campaign). A "monster" catalog entry defines what a goblin is; a "monster instance" is the specific goblin with 7 HP in room 3. Never conflate the two in one table.
- **rpg-api-endpoint-engineer** — REST/GraphQL endpoints and auth/authz. Defines a layered authorization model: authenticate → verify campaign membership → check role (DM vs. Player) → check resource ownership. DMs get full CRUD within their campaigns; players can read everything in their campaigns but can only create/edit/delete their own characters and inventory items, and can never touch NPCs or campaign settings unless granted DM role. Default-deny.
- **rpg-ui-component-builder** — React components for character sheets, inventory management, DM panels, and live session views (initiative trackers, combat dashboards). Functional components + hooks, controlled forms, co-located state lifted only when shared.
- **multiplayer-sync-engineer** — WebSocket sync for turn order, HP, and combat state across concurrent clients. Server is always authoritative (clients send intentions like "apply 15 damage," never raw state); atomic DB updates (e.g. `UPDATE ... SET hp = hp - $damage WHERE id = $id AND hp - $damage >= 0`) or optimistic concurrency with a version column; reconciliation on reconnect via full state sync, not merge.
- **dnd-srd-rules-validator** — read-only validator that checks character builds, monster stat blocks, and level-ups against D&D SRD legality (race/class compatibility, spell access, proficiencies, multiclass prerequisites). Presumes legal unless the SRD explicitly prohibits it.
- **pre-merge-reviewer** — read-only reviewer invoked after any other agent finishes a task, checking correctness, security, and data-model consistency before merge.

These are OpenCode-specific agent configs and won't be auto-invoked by Claude Code, but their descriptions capture the domain rules (catalog/instance separation, DM/player authorization layers, server-authoritative multiplayer state) that should carry over into however the app actually gets built.

## D&D 5e rules skill (`.opencode/skills/dnd5e-srd/`)

A reference skill (also OpenCode-specific) covering the D&D 5e rules *framework* — combat, ability checks, conditions, character creation, spellcasting mechanics — for **both** the 2014 (SRD 5.1/OGL) and 2024 (SRD 5.2/CC-BY) rule sets side by side under `references/2014/` and `references/2024/`, with structured data under `data/2014/` and `data/2024/` queryable via:

```bash
python3 .opencode/skills/dnd5e-srd/scripts/query.py <2014|2024> <category> <name>
python3 .opencode/skills/dnd5e-srd/scripts/query.py <2014|2024> <category> --list
python3 .opencode/skills/dnd5e-srd/scripts/query.py --categories
```

Key points if referencing this data:
- The two rules editions are **not interchangeable** — establish which one applies before answering rules questions (2014 goes race→class→abilities→background; 2024 goes class→background+species→abilities and moves ability bonuses to background).
- This skill has no spell/monster/item catalogs with exact stats by design — that data belongs in the app's own data layer; the skill is only the rulebook for interpreting it.
- Distances in the reference text are converted from feet to meters (5 ft. = 1.5 m).
