# Character Creation — General Process (SRD 5.1)

This is the step-by-step process for building a D&D 5e character, independent
of any specific class/race numbers (those live in `classes.md`, `races.md`,
and the queryable data).

## 1. Choose a race
Pick a race from `references/races.md`. It sets:
- Ability score increases
- Speed (see "Movement" below)
- Size
- Special traits (darkvision, resistances, etc.)
- Languages known

## 2. Choose a class
Pick a class from `references/classes.md`. It sets:
- Hit die (determines HP progression)
- Saving throw proficiencies
- Armor/weapon proficiencies
- Skill choices (see `references/skills.md` for what each skill covers)
- Available subclass (usually chosen at a specific level — see
  `scripts/query.py levels <class>-<level>` for exactly when)

## 3. Determine ability scores
Six abilities: Strength, Dexterity, Constitution, Intelligence, Wisdom,
Charisma. See `references/ability-checks.md` for what each one governs and
how modifiers are derived from the score. Common generation methods:
- **Standard array:** assign 15, 14, 13, 12, 10, 8 to the six abilities.
- **Point buy:** spend a pool of points (27 in the standard rules) to buy
  scores between 8 and 15.
- **Roll:** 4d6, drop the lowest, six times, assign as desired.

Apply racial ability score increases from `references/races.md` after
assigning base scores.

## 4. Choose a background
The SRD includes only one full background example (Acolyte, in
`scripts/query.py backgrounds acolyte`) since backgrounds are largely
publisher content outside the free SRD. A background normally grants:
- Two skill proficiencies
- Sometimes tool/language proficiencies
- Starting equipment
- A roleplaying feature

## 5. Determine hit points
Starting HP = class hit die maximum + Constitution modifier. On each
subsequent level, add either the hit die average (or a roll) + Constitution
modifier. Track this per character as they level.

## 6. Choose equipment
See `references/equipment-items.md` for the general rules on currency,
encumbrance, attunement, and item categories (this skill covers the rules
*framework*, not a priced catalog of every weapon/armor/item — track your
actual inventory in your app's own data layer).

## 7. Spellcasting (if applicable)
If the class is a spellcaster, see `references/spellcasting-rules.md` for
how casting works in general (components, concentration, spell slots, how
many slots a class has at a given level via
`scripts/query.py levels <class>-<level>`). This skill does not include a
spell catalog — track known/prepared spells and their effects in your app's
own data layer.

## Movement types (SRD 5.1)
Every creature has a **speed** (usually walking speed) and sometimes
additional movement types:
- **Walking speed:** the default, listed per race (e.g. 9 m. for most,
  7.5 m. for Dwarves and Halflings).
- **Fly speed:** only some races/creatures; movement through the air.
- **Swim speed:** movement through water without the usual penalties.
- **Climb speed:** movement on vertical surfaces without the usual penalties.
- **Burrow speed:** movement through loose earth/sand (rare, mostly monsters).

General movement rules (difficult terrain, dashing, climbing/swimming/jumping
without a special speed, tracking distance during travel) are in
`references/adventuring.md` and `references/combat.md` (for movement during
a combat turn).

## Leveling up
When a character gains a level:
1. Increase hit points (hit die roll/average + CON modifier).
2. Gain any class features listed for that level —
   `scripts/query.py levels <class>-<new level>` shows exactly what's granted
   (features, spell slots, proficiency bonus).
3. At levels 4, 8, 12, 16, and 19 (varies slightly by class), the character
   usually gets an **Ability Score Improvement** (+2 to one ability, or +1 to
   two, or a feat if the table allows feats).
