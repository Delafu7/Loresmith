// Flat (no nesting) — LocaleContext.test.ts's dictionary-shape checks assume
// exactly one level of section -> string keys, so DiceRollHistoryPage.tsx/
// DiceRoller.tsx/QuickDiceRoller.tsx's strings live here as history-/roller-/
// quick-prefixed keys rather than nested sub-objects.
export const dice = {
  // DiceRollHistoryPage.tsx
  historyTitle: 'Dice Rolls',
  historyLoadingRolls: 'Loading roll history…',
  historyNoRolls: 'No dice rolls yet.',
  historyLoadMore: 'Load more',
  historyLoadingMore: 'Loading…',
  historyCharacterLabel: 'Character #{id}',
  historyMonsterLabel: 'Monster #{id}',
  historyUserLabel: 'User #{id}',
  historyJustNow: 'just now',
  historySecondsAgo: '{count}s ago',
  historyMinutesAgo: '{count}m ago',
  historyHoursAgo: '{count}h ago',
  historyDaysAgo: '{count}d ago',
  // DiceRoller.tsx (also shared by QuickDiceRoller.tsx's own keep toggle)
  rollerDisadvantage: 'Disadv',
  rollerNormal: 'Normal',
  rollerAdvantage: 'Adv',
  rollerRollModeLabel: 'Roll mode',
  rollerRollButton: 'Roll',
  rollerKept: 'Kept',
  rollerNotKept: 'Not kept',
  // QuickDiceRoller.tsx
  quickHeading: 'Roll dice',
  quickPlaceholder: 'e.g. 2d6+3',
  quickRolling: 'Rolling…',
  quickInvalidExpression: 'Expected a die expression like "d20", "2d6", or "2d6+3".',
};
