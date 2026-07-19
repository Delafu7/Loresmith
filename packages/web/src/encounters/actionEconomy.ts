// Turn-action registry (Phase 3.6). The backend only knows about the three
// 5e economy *slots* (action/bonus action/reaction) plus a movement budget —
// it has no concept of named actions like "Dash" or "Shove" (see
// schemas/encounters.ts's applyActionEconomySchema comment). Everything
// that makes an action recognizable — its name, which slot it costs, and
// whether it triggers a roll — lives here instead, so adding a new action
// later (Dodge, Help, Hide, ...) is a pure addition to this array, no
// server change required.

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
