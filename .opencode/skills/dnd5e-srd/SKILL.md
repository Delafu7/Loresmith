---
name: dnd5e-srd
description: >
  General D&D 5th Edition gameplay rules framework, covering BOTH the 2014
  rules (SRD 5.1, OGL) and the 2024 rules (SRD 5.2, "5.5e"/One D&D, CC-BY).
  Use ALWAYS when acting as a Dungeon Master or game assistant needing the
  RULES (not a spell/weapon/monster database): combat structure, ability
  checks, saving throws, conditions, movement, resting, character
  creation, species/racial traits, class progression, spellcasting
  mechanics. Use even without the words "D&D" or "rule" - e.g. "how does
  advantage work", "what's a dwarf's speed", "spell slots for a level 5
  wizard", "what does prone do", "create a character", "2024 rules
  changes". Always confirm which edition (2014 or 2024) applies before
  answering, since mechanics differ. Does NOT contain spell/monster/item
  catalogs with exact stats - store those in the app's own data. Don't
  invent rules from memory: consult this skill first.
---

# D&D 5e — General Rules Framework (2014 + 2024 editions)

This skill covers the **rules framework** for both current D&D 5e
editions:

- **2014 rules** — SRD 5.1, licensed under the OGL 1.0a. Often just called
  "5e".
- **2024 rules** — SRD 5.2, licensed under CC-BY-4.0. Also called "5.5e"
  or "One D&D" in casual use, though Wizards' own current label is just
  "the 2024 rules". This is a real revision with mechanical differences,
  not merely errata.

Both editions live side by side under `references/2014/` and
`references/2024/`, with matching data under `data/2014/` and
`data/2024/`. See `ATTRIBUTION.md` for licensing details.

Do not invent rules from memory: consult the files below first.

## Which edition?

**Always establish which edition a campaign/table uses before applying
rules** — the two are not interchangeable (see "Key differences" below).
If it's not already established in this conversation or the app's
campaign settings, ask the user once, then remember it for the session.
When genuinely unsure and it doesn't block the immediate answer, default
to 2024 (the current, actively-sold ruleset) and say you're doing so.

## What to read for what (same layout in both editions)

| You need...                                                    | 2014 file                              | 2024 file                              |
|--------------------------------------------------------------------|-------------------------------------------|--------------------------------------------|
| Combat structure, movement, attacks, cover                         | `references/2014/combat.md`                | `references/2024/combat.md`                 |
| D20 tests, checks, saves, advantage, proficiency, skills            | `references/2014/ability-checks.md`        | `references/2024/ability-checks.md`         |
| Conditions (Stunned, Prone...)                                      | `references/2014/conditions.md`            | `references/2024/conditions.md`             |
| Exploration, travel, resting                                        | `references/2014/adventuring.md`           | `references/2024/adventuring.md`            |
| Racial/species traits, speed, size                                  | `references/2014/races.md`                 | `references/2024/species.md`                |
| Class overview (hit die, saves, proficiencies, subclasses)          | `references/2014/classes.md`               | `references/2024/classes.md`                |
| Step-by-step character creation                                     | `references/2014/character-creation.md`    | `references/2024/character-creation.md`     |
| Skills list                                                          | `references/2014/skills.md`                | (merged into `ability-checks.md`)            |
| General spellcasting mechanics                                       | `references/2014/spellcasting-rules.md`    | (see `ability-checks.md` "Magic" action + `character-creation.md` spellcasting formulas) |
| General item/currency rules, hazards                                 | `references/2014/equipment-items.md`, `references/2014/world-hazards.md` | not included (see note below) |

## Looking up structured data (classes, species, feats, levels...)

```bash
python3 scripts/query.py <edition: 2014|2024> <category> <name>
python3 scripts/query.py <edition> <category> --list
python3 scripts/query.py --categories
```

Examples:
```bash
python3 scripts/query.py 2014 races elf
python3 scripts/query.py 2024 species elf
python3 scripts/query.py 2014 levels wizard-5
python3 scripts/query.py 2024 levels wizard-5
python3 scripts/query.py 2024 feats --list
python3 scripts/query.py 2014 conditions stunned
```

**Not included on purpose (either edition):** `spells`, `monsters`,
`equipment`, `magic-items` catalogs with exact stats/damage/prices. This
skill is the rulebook, not the campaign database — store the actual
spells known, weapons carried, and monsters encountered in your app's own
data layer, using these rules to interpret them.

## Key differences between the editions (high level)

- **Character creation order:** 2014 goes race → class → abilities →
  background. 2024 goes **class → background+species → abilities**.
- **Ability bonuses:** 2014 gives fixed bonuses per race. 2024 moved that
  to the **background** instead (species no longer grants ability bonuses).
- **Race → Species:** 2024 renamed "race" to "species" and reworked several
  (e.g. no subrace ability splits the same way).
- **Backgrounds grant a feat directly** in 2024 (not in 2014).
- **Weapon Mastery** is new in 2024 (`weapon-mastery-properties` category).
- Numeric fundamentals (proficiency bonus by level, ability modifiers, DC
  ranges, travel pace) are the same between editions.
- Units in this skill's text have been **converted from feet to meters**
  (5 ft. = 1.5 m, the standard tabletop conversion factor) for both
  editions, to match a metric table. If the user needs original imperial
  units, say so rather than guessing a re-conversion.

## Important notes

- The 2024 `adventuring.md`/`combat.md` reference some mechanics (Hazards,
  Short/Long Rest specifics) that the official SRD 5.2 defers to a "Rules
  Glossary" not included in this dataset — treat those as "ask the GM/use
  standard D&D assumptions" rather than an exact quoted rule.
- 2014 backgrounds/feats in the raw data are nearly empty (SRD 5.1 only
  freely released Acolyte and Grappler) — don't treat that as "the full
  list." 2024 is more complete (4 backgrounds, 17 feats).
- Data comes from the open-source project `5e-bits/5e-database` (MIT +
  OGL 1.0a for 2014 content) plus text adapted directly from the official
  SRD 5.2 PDF (CC-BY-4.0) for 2024 general rules. See `ATTRIBUTION.md`.
