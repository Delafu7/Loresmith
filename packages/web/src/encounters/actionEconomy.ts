// Turn-action registry (Phase 3.6). The backend only knows about the three
// 5e economy *slots* (action/bonus action/reaction) plus a movement budget —
// it has no concept of named actions like "Dash" or "Shove" (see
// schemas/encounters.ts's applyActionEconomySchema comment). Everything
// that makes an action recognizable — its name, which slot it costs, and
// whether it triggers a roll — lives here instead, so adding a new action
// later (Dodge, Help, Hide, ...) is a pure addition to this array, no
// server change required.
//
// REFACTOR-PLAN.md §5 / docs/rules/actions.md: Climb and Swim are
// DELIBERATELY not in this registry — neither edition's SRD treats them as
// actions at all (both are movement modes, costing extra feet per foot per
// docs/rules/movement.md §1.4, not an action-economy slot). A "Climb" button
// that consumed an action slot would be inventing a mechanic. Object
// interaction (one free per turn) is also not a registry entry — it's a
// fourth tracked resource, separate from the action/bonus-action/reaction
// slots below (see ActionEconomyPanel.tsx's dedicated button and
// combat_participants.object_interaction_used); only its PAID fallback
// ("Use an Object" / 2024 "Utilize") costs an actual slot, hence the
// `use_object` entry below.

export type ActionSlot = 'action' | 'bonus_action' | 'reaction';

export interface ActionRollTrigger {
  /** Label shown on the roll result, e.g. "Shove (Athletics)". */
  rollContext: string;
  /** Which ability score's modifier to use — this app has no per-skill
   * proficiency data available in the combat tracker (unlike the character
   * sheet's SkillsPanel), so every triggered roll here is a flat ability
   * modifier with no proficiency bonus added, as a documented simplification
   * (same pattern as InventoryPanel's weaponAttackAbilityModifier). */
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
}

export interface ActionDefinition {
  key: string;
  label: string;
  slot: ActionSlot;
  /** Only meaningful for slot:'action' — Dash both consumes the action and
   * doubles the movement budget (applyActionEconomySchema's `dash` flag). */
  isDash?: boolean;
  rollTrigger?: ActionRollTrigger;
  description: string;
}

export const ACTION_REGISTRY: ActionDefinition[] = [
  {
    key: 'dash',
    label: 'Dash',
    slot: 'action',
    isDash: true,
    description: 'Doubles your remaining movement this turn.',
  },
  {
    key: 'grab',
    label: 'Grab (Grapple)',
    slot: 'action',
    rollTrigger: { rollContext: 'Grapple (Athletics)', ability: 'str' },
    description: "Contested Athletics check against the target's Athletics or Acrobatics.",
  },
  {
    key: 'shove',
    label: 'Shove',
    slot: 'action',
    rollTrigger: { rollContext: 'Shove (Athletics)', ability: 'str' },
    description: "Contested Athletics check to knock a target prone or push it 5 ft.",
  },
  {
    key: 'throw',
    label: 'Throw',
    slot: 'action',
    description: 'Ranged attack with a thrown weapon or object — use that weapon\'s own Attack/Damage buttons for the roll.',
  },
  {
    key: 'dodge',
    label: 'Dodge',
    slot: 'action',
    description: 'Attack rolls against you have disadvantage until the start of your next turn.',
  },
  {
    key: 'help',
    label: 'Help',
    slot: 'action',
    description: "Give advantage to an ally's next ability check or attack roll against a creature within 5 ft.",
  },
  {
    key: 'hide',
    label: 'Hide',
    slot: 'action',
    rollTrigger: { rollContext: 'Hide (Stealth)', ability: 'dex' },
    description: 'Stealth check to become hidden.',
  },
  {
    key: 'disengage',
    label: 'Disengage',
    slot: 'action',
    // docs/rules/actions.md §1.4: "rest of THIS turn" — not the longer
    // "until the start of your next turn" window Dodge gets. Easy to
    // misremember as the same duration; it isn't.
    description: "Your movement doesn't provoke opportunity attacks for the rest of this turn.",
  },
  {
    key: 'search',
    label: 'Search',
    slot: 'action',
    // docs/rules/actions.md §1.3: GM picks the skill situationally (2014:
    // Perception or Investigation; 2024: Insight/Medicine/Perception/
    // Survival, all Wisdom). Perception is the one candidate common to both
    // editions' lists — a representative default, not a hardcoded rule; the
    // description below names the GM's discretion explicitly.
    rollTrigger: { rollContext: 'Search (Perception)', ability: 'wis' },
    description:
      "GM-adjudicated check to find something — Wisdom (Perception) or Intelligence (Investigation) in 2014; Wisdom (Insight, Medicine, Perception, or Survival) in 2024.",
  },
  {
    key: 'ready',
    label: 'Ready',
    slot: 'action',
    // docs/rules/actions.md §1.5/§2.2: this only spends the ACTION slot to
    // set up the trigger. Executing the readied response later is a
    // SEPARATE reaction-slot spend (possibly on a different turn) — the DM
    // triggers that second spend manually via the Reaction pip/undo tools
    // when the trigger actually fires, same as any other reaction.
    description:
      'Prepare a triggered response (an action, or up to your speed of movement) to use with your reaction before the start of your next turn. Executing the readied response spends your reaction separately, whenever the trigger fires — if it never fires (or you ignore it), the readied action is lost at the start of your next turn.',
  },
  {
    key: 'use_object',
    label: 'Use an Object',
    slot: 'action',
    // docs/rules/actions.md §1.6/§2.3: the paid fallback for a SECOND object
    // interaction this turn (the first is free — see the dedicated Object
    // Interaction button in ActionEconomyPanel, not this registry). 2024
    // renames this "Utilize" and narrows it to nonmagical objects; mechanic
    // is identical, only the label/wording differs.
    description:
      "Spend your action to interact with an object beyond your one free interaction this turn (2024: \"Utilize\"). Magic items may require their own action per their own description.",
  },
];

/** Jump consumes movement, not an action-economy slot — modeled separately
 * since it's the one requested action with no slot cost at all. Standing
 * long jump = half the STR score in feet; with a running start (10+ ft of
 * movement immediately before), it's the full STR score (5e PHB rule). */
export function jumpDistanceFt(strScore: number, running: boolean): number {
  return running ? strScore : Math.floor(strScore / 2);
}

/** High jump = 3 + STR modifier in feet with a running start; standing
 * (no running start) halves it, rounded down (5e PHB rule) — same shape as
 * jumpDistanceFt above, but keyed off the STR modifier rather than the raw
 * score. */
export function highJumpDistanceFt(strModifier: number, running: boolean): number {
  const full = Math.max(0, 3 + strModifier);
  return running ? full : Math.floor(full / 2);
}

/** Standing up from prone costs movement equal to half your speed, rounded
 * down (5e PHB rule) — also modeled outside the slot registry since it
 * spends movement, not an action/bonus-action/reaction. */
export function standUpCostFt(speedFt: number): number {
  return Math.floor(speedFt / 2);
}
