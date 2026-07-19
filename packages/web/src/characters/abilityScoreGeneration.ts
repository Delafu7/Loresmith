// Pure helpers for the ability-score-generation methods offered during
// character creation (Phase 3.8). The "Roll" method's actual dice come from
// the server (POST /campaigns/:id/roll-ability-scores, see
// services/abilityScoreRoll.ts on the backend) — this file only covers the
// two methods that need no server round-trip at all.

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

/** 5e PHB standard array — assigned to the six abilities as the player sees fit. */
export const STANDARD_ARRAY: number[] = [15, 14, 13, 12, 10, 8];

/** 5e PHB point-buy cost table: score -> points spent (scores run 8-15 only). */
export const POINT_BUY_COST: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

export function pointBuyTotalCost(scores: Record<AbilityKey, number>): number {
  return ABILITY_KEYS.reduce((sum, key) => sum + (POINT_BUY_COST[scores[key]] ?? 0), 0);
}
