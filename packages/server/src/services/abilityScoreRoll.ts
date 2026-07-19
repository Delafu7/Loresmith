// Automated ability score generation — "roll 4d6, drop the lowest, six
// times" (5e PHB standard method). Server-authoritative RNG, same reasoning
// as services/diceRolls.ts's rollDice: a client-supplied "I rolled an 18"
// can't be trusted any more than a player fudging physical dice, but this
// app already draws that line at the server for every other roll, so ability
// generation follows it too. Deliberately NOT persisted through dice_rolls —
// that table always attaches a roll to a campaign_id + character_id/
// monster_instance_id, but ability generation happens BEFORE the character
// row exists, and its "roll 4, drop 1, six independent sets" shape doesn't
// fit dice_rolls' single-d20-with-advantage model anyway.

function rollDie(sides: number): number {
  return 1 + Math.floor(Math.random() * sides);
}

export interface AbilityScoreSet {
  dice: number[];
  droppedIndex: number;
  total: number;
}

/** Pure: given 4 already-rolled dice, drop the lowest and sum the rest. Split
 * out from the rolling itself so the drop-lowest logic is unit-testable
 * without mocking Math.random. */
export function dropLowestOfFour(dice: [number, number, number, number]): AbilityScoreSet {
  let droppedIndex = 0;
  for (let i = 1; i < dice.length; i++) {
    if (dice[i]! < dice[droppedIndex]!) droppedIndex = i;
  }
  const total = dice.reduce((sum, d, i) => (i === droppedIndex ? sum : sum + d), 0);
  return { dice: [...dice], droppedIndex, total };
}

export function rollAbilityScoreSet(): AbilityScoreSet {
  const dice: [number, number, number, number] = [rollDie(6), rollDie(6), rollDie(6), rollDie(6)];
  return dropLowestOfFour(dice);
}

/** Six independent sets — one per ability — assigned by the player afterward. */
export function rollAbilityScores(): AbilityScoreSet[] {
  return Array.from({ length: 6 }, () => rollAbilityScoreSet());
}
