# Character Creation (SRD 5.2 / 2024 rules)

The 2024 rules changed the character-creation **order** compared to 2014:
you now choose your **class first**, then your **origin** (background +
species), not species-then-class. Backgrounds also now grant a **feat**
directly, and "race" was renamed **species**.

## Step 1: Choose a Class
Pick a class (see `references/2024/classes.md`). The Class Overview:

| Class     | Likes...        | Primary Ability      | Complexity |
|-----------|------------------|------------------------|------------|
| Barbarian | Battle           | Strength                | Average    |
| Bard      | Performing       | Charisma                | High       |
| Cleric    | Gods             | Wisdom                  | Average    |
| Druid     | Nature           | Wisdom                  | High       |
| Fighter   | Weapons          | Strength or Dexterity   | Low        |
| Monk      | Unarmed combat   | Dexterity and Wisdom    | High       |
| Paladin   | Defense          | Strength and Charisma   | Average    |
| Ranger    | Survival         | Dexterity and Wisdom    | Average    |
| Rogue     | Stealth          | Dexterity                | Low        |
| Sorcerer  | Power            | Charisma                | High       |
| Warlock   | Occult lore      | Charisma                | High       |
| Wizard    | Spellbooks       | Intelligence             | Average    |

A level 1 character has 0 XP. If your GM starts you above level 1, also
write your chosen subclass on the sheet (see "Starting at Higher Levels").
Note any armor training your class grants.

## Step 2: Determine Origin (Background + Species)

### Choose a Background
Pick from `scripts/query.py backgrounds <name>` (SRD only fully details
Acolyte; others — Criminal, Sage, Soldier — are named but not detailed in
the free SRD). A background:
- Suggests which 3 abilities to raise (see the Ability Scores step).
- **Grants a feat** — write it down (17 feats are in the SRD; look one up
  with `scripts/query.py feats <name>`, or list them all with
  `scripts/query.py feats --list`).
- Grants proficiency in **2 skills** and **1 tool**.
- Provides starting equipment (spendable alongside your class's gear).

### Choose a Species
Options in the SRD: Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling,
Human, Orc, Tiefling (see `references/2024/species.md`). Your species sets
your **size** and **Speed**, plus its traits.

### Choose Languages
You know Common plus **2** more, chosen or rolled from the Standard
Languages table (Common Sign Language, Draconic, Dwarvish, Elvish, Giant,
Gnomish, Goblin, Halfling, Orc). Rare languages (Abyssal, Celestial, Deep
Speech, Druidic, Infernal, Primordial, Sylvan, Thieves' Cant,
Undercommon) require a feature that grants them.

## Step 3: Determine Ability Scores

Generate six numbers with one of:
- **Standard Array:** 15, 14, 13, 12, 10, 8.
- **Random Generation:** roll 4d6 drop lowest, six times.
- **Point Cost:** 27 points; cost table: 8→0, 9→1, 10→2, 11→3, 12→4,
  13→5, 14→7, 15→9.

Assign to Strength/Dexterity/Constitution/Intelligence/Wisdom/Charisma —
favor your class's primary ability. Then **apply your background's
bonus**: +2 to one of its three listed abilities and +1 to a different
one, OR +1 to all three (never above 20 at this step).

**Ability Modifiers**

| Score | Mod | Score | Mod |
|-------|-----|-------|-----|
| 3     | −4  | 12–13 | +1  |
| 4–5   | −3  | 14–15 | +2  |
| 6–7   | −2  | 16–17 | +3  |
| 8–9   | −1  | 18–19 | +4  |
| 10–11 | +0  | 20    | +5  |

## Step 4: Choose an Alignment
Pick one of the nine (Lawful/Neutral/Chaotic × Good/Neutral/Evil). Player
characters are assumed non-evil by default — check with your GM first if
you want to play an evil-aligned character.

## Step 5: Fill in the Rest

- **Class features:** record your level 1 features from
  `references/2024/classes.md` / `scripts/query.py features <name>`.
- **Saving throws / skills:** ability modifier + Proficiency Bonus (+2 at
  level 1) wherever you're proficient.
- **Passive Perception** = 10 + your Wisdom (Perception) check modifier.
- **Hit Points at level 1** (die max, not rolled):

  | Class                                         | HP Maximum          |
  |-------------------------------------------------|------------------------|
  | Barbarian                                        | 12 + Con. modifier      |
  | Fighter, Paladin, or Ranger                      | 10 + Con. modifier      |
  | Bard, Cleric, Druid, Monk, Rogue, or Warlock      | 8 + Con. modifier       |
  | Sorcerer or Wizard                               | 6 + Con. modifier       |

- **Initiative** = Dexterity modifier.
- **Armor Class** = 10 + Dexterity modifier unarmored, or per your armor's
  rules. Equipment stats/prices aren't part of this skill's dataset (by
  design — see `SKILL.md`); track them in your app's own data layer.
- **Attack bonus:** Melee = Strength mod + Prof. Bonus; Ranged = Dexterity
  mod + Prof. Bonus (unless a weapon property like Finesse lets you choose).
- **Spellcasting** (if applicable): Save DC = 8 + spellcasting ability mod
  + Prof. Bonus; Attack bonus = spellcasting ability mod + Prof. Bonus.

## Leveling Up

1. Choose which class gains the level (see Multiclassing below if it's a
   class you don't already have).
2. **Hit Points:** roll your class's Hit Die + Con. modifier (min. 1), or
   use the fixed value:

   | Class                                          | HP per Level         |
   |----------------------------------------------------|-------------------------|
   | Barbarian                                            | 7 + Con. modifier         |
   | Fighter, Paladin, or Ranger                          | 6 + Con. modifier         |
   | Bard, Cleric, Druid, Monk, Rogue, or Warlock          | 5 + Con. modifier         |
   | Sorcerer or Wizard                                   | 4 + Con. modifier         |

3. Record the new level's class features —
   `scripts/query.py levels <class>-<level>`.
4. Proficiency Bonus increases at the levels shown below; update every
   number on the sheet that includes it.
5. If a feat raised an ability score to an even number, update the derived
   modifier (and HP retroactively if it was Constitution).

**Character Advancement**

| Level | XP      | Prof. Bonus | Level | XP      | Prof. Bonus |
|-------|---------|-------------|-------|---------|-------------|
| 1     | 0       | +2          | 11    | 85,000  | +4          |
| 2     | 300     | +2          | 12    | 100,000 | +4          |
| 3     | 900     | +2          | 13    | 120,000 | +5          |
| 4     | 2,700   | +2          | 14    | 140,000 | +5          |
| 5     | 6,500   | +3          | 15    | 165,000 | +5          |
| 6     | 14,000  | +3          | 16    | 195,000 | +5          |
| 7     | 23,000  | +3          | 17    | 225,000 | +6          |
| 8     | 34,000  | +3          | 18    | 265,000 | +6          |
| 9     | 48,000  | +4          | 19    | 305,000 | +6          |
| 10    | 64,000  | +4          | 20    | 355,000 | +6          |

**Tiers of play:** 1–4 apprentice adventurers (local threats), 5–10 full
adventurers (iconic spells like Fireball, extra attacks; city/kingdom-
scale threats), 11–16 reality-bending power (regional threats), 17–20
peak of class power (world-scale stakes).

## Multiclassing

Requires a score of **13+** in the primary ability of both your current
class(es) and the new one. Total character level (not per-class level)
determines your XP-to-level and Proficiency Bonus. Hit Dice pool together
if the die type matches; otherwise track separately per class. You only
get the new class's *starting* proficiencies partially (see the specific
class description). Extra Attack and multiple AC-calculation features
don't stack across classes — you pick one.

## Starting at Higher Levels

Use the same creation steps, then apply the "Level Advancement" rules up
to your starting level; you begin with the level's minimum XP. The GM may
grant extra starting equipment/magic items for higher starting levels.
