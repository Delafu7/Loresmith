# Combat (SRD 5.2 / 2024 rules)

## The Order of Combat

A round is about 6 seconds in-game. Combat unfolds in steps:

1. **Establish Positions** — the GM figures out where everyone is.
2. **Roll Initiative** — a Dexterity check that sets turn order (the GM
   rolls once for a group of identical monsters).
3. **Take Turns** — each participant acts in Initiative order; when
   everyone has acted, the round ends and repeats until the fight stops.

**Surprise:** a surprised combatant has Disadvantage on their Initiative
roll. **Ties:** GM decides among tied monsters; players decide among tied
characters; GM decides monster-vs-character ties.

### Your Turn
You can move up to your Speed and take one action, in either order. You can
also communicate freely (no cost), and interact with **one** object/feature
for free during your move or action (a second interaction requires the
Utilize action). You may do nothing at all on your turn.

**Ending combat:** when one side is defeated (killed, knocked out,
surrendered, or fled) or both sides agree to stop.

## Movement and Position

You can move up to your Speed (or not move at all), including climbing,
crawling, jumping, and swimming, combined however you like, until the
Speed is used up.

### Difficult Terrain
Every meter of movement in Difficult Terrain costs 1 extra meter, even if
multiple things in the space count as difficult terrain (low furniture,
rubble, undergrowth, steep stairs, snow, shallow bogs...).

### Breaking Up Your Move
You can split your move around an action/Bonus Action/Reaction on the same
turn. Example: with a Speed of 9 meters, you could go 3 meters, take an
action, then go 6 meters.

### Dropping Prone
Free (no action, no Speed cost) unless your Speed is 0.

### Creature Size and Space

| Size       | Space (meters)     | Space (squares)       |
|------------|---------------------|------------------------|
| Tiny       | 0.75 by 0.75 m.     | 4 per square           |
| Small      | 1.5 by 1.5 m.       | 1 square               |
| Medium     | 1.5 by 1.5 m.       | 1 square               |
| Large      | 3 by 3 m.           | 4 squares (2 by 2)     |
| Huge       | 4.5 by 4.5 m.       | 9 squares (3 by 3)     |
| Gargantuan | 6 by 6 m.           | 16 squares (4 by 4)    |

A creature's space is the area it effectively controls/needs to fight, not
literally its body size.

### Moving around Other Creatures
You can pass through an ally's space, an Incapacitated creature's space, a
Tiny creature's space, or a creature two sizes larger/smaller than you.
Another creature's space otherwise counts as Difficult Terrain. You can't
willingly end your move in another creature's space; if you somehow do,
you gain the Prone condition (unless you're Tiny or larger than it).

### Playing on a Grid (optional)
Each square = 1.5 meters. Translate Speed into squares by dividing by 1.5
(e.g. a Speed of 9 meters = 6 squares). Entering an adjacent unoccupied
square costs 1 square; a Difficult Terrain square costs 2. Diagonal
movement can't cross a wall/tree corner that fills its space.

## Making an Attack

1. **Choose a Target** within range.
2. **Determine Modifiers** — cover, Advantage/Disadvantage, spell/ability
   bonuses or penalties.
3. **Resolve the Attack** — roll to hit; on a hit, roll damage (unless the
   attack says otherwise).

### Cover

| Degree          | Benefit to Target                          | Offered By...                                   |
|------------------|-----------------------------------------------|----------------------------------------------------|
| Half             | +2 AC and Dex saves                            | A creature/object covering at least half the target |
| Three-Quarters   | +5 AC and Dex saves                            | An object covering at least 3/4 of the target        |
| Total            | Can't be targeted directly                     | An object covering the whole target                  |

Only the best applicable degree of cover applies (they don't stack).

### Ranged Attacks
Some weapons (e.g. a Longbow) have a normal range and a longer long range:
Disadvantage beyond normal range, can't attack beyond long range at all.
Making a ranged attack while an enemy who can see you is within 1.5 meters
(and isn't Incapacitated) gives you Disadvantage on the roll.

### Melee Attacks
Default reach is 1.5 meters (some creatures have more, noted in their
description).

### Opportunity Attacks
Triggered when a creature you can see leaves your reach without
Disengaging, Teleporting, or being moved without using its own
movement/action/Bonus Action/Reaction. You spend a Reaction to make one
melee attack against it, resolved right before it leaves your reach.

### Mounted Combat
A willing creature at least one size larger than the rider, with suitable
anatomy, can be a mount.
- **Mount/dismount:** costs half your Speed (round down); must be within
  1.5 meters of the mount. Example: Speed 9 meters → costs 4.5 meters to
  mount.
- **Controlled mount:** shares your Initiative, acts on your turn, limited
  to Dash/Disengage/Dodge unless you're doing something else with it.
- **Independent mount:** keeps its own Initiative and acts on its own.
- **Falling off:** DC 10 Dexterity save or fall Prone within 1.5 meters of
  the mount, when something tries to move it against its will while
  mounted (or when either of you is knocked Prone).

### Underwater Combat
A creature without a Swim Speed has Disadvantage on melee attacks
underwater unless the weapon deals Piercing damage. A ranged weapon attack
underwater automatically misses beyond normal range, and has Disadvantage
within normal range. Everything underwater has Resistance to Fire damage.

## Damage and Healing

- **Hit Points:** current HP ranges from your maximum down to 0.
  **Bloodied** = at half HP or less (no inherent mechanical effect, but
  other rules may reference it).
- **Damage rolls:** roll the weapon/spell's damage dice + relevant
  modifier (weapons add the same ability modifier used for the attack
  roll; spells specify their own dice/modifiers).
- **Critical Hits:** roll all the attack's damage dice twice, add
  modifiers once.
- **Multiple targets, one save-based effect:** roll damage once, applied
  to everyone who fails/succeeds accordingly.
- **Half damage** on a successful save is rounded down.
- **Resistance** halves damage of that type (round down); **Vulnerability**
  doubles it. Multiple instances of the same Resistance/Vulnerability don't
  stack. Order of application: flat adjustments first, then Resistance,
  then Vulnerability. **Immunity** to a damage type/condition means no
  effect from it at all.
- **Knocking a creature out:** a melee attack that would drop a creature to
  0 HP can instead leave it at 1 HP with the Unconscious condition, if the
  attacker chooses.

### Dropping to 0 Hit Points
- A **monster** dies instantly at 0 HP (GM may rule otherwise for a
  specific monster).
- **Massive damage:** if the leftover damage after reaching 0 HP equals or
  exceeds the character's HP maximum, they die outright.
- Otherwise the character falls **Unconscious** and starts making **Death
  Saving Throws**: roll 1d20 each turn at 0 HP (no ability modifier); 10+
  is a success. Three successes = Stable; three failures = dead. A natural
  20 restores 1 HP; a natural 1 counts as two failures. Taking any damage
  at 0 HP is an automatic failure (two if it's a Critical Hit); if that
  damage equals/exceeds your HP maximum, you die.
- **Stabilizing:** the Help action with a successful DC 10 Wisdom
  (Medicine) check stabilizes a creature at 0 HP (stops saves, still
  Unconscious). A Stable, unhealed creature regains 1 HP after 1d4 hours.

### Temporary Hit Points
Lost before regular HP, don't stack with a new grant (choose the higher
one), can't be healed or added to your HP total, and last until depleted
or you finish a Long Rest.
