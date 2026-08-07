export const dice = {
  historyTitle: 'Lancers de dés',
  historyLoadingRolls: "Chargement de l'historique des lancers…",
  historyNoRolls: 'Aucun lancer de dés pour le moment.',
  historyLoadMore: 'Charger plus',
  historyLoadingMore: 'Chargement…',
  historyCharacterLabel: 'Personnage n° {id}',
  historyCritical: 'Critique',
  historyMonsterLabel: 'Monstre n° {id}',
  historyUserLabel: 'Utilisateur n° {id}',
  historyJustNow: "à l'instant",
  historySecondsAgo: 'il y a {count} s',
  historyMinutesAgo: 'il y a {count} min',
  historyHoursAgo: 'il y a {count} h',
  historyDaysAgo: 'il y a {count} j',
  // Kept as tight as English's own 'Disadv'/'Adv' — this three-button
  // toggle renders inline in very dense rows (one per ability score in
  // SavingThrowsPanel). Note: that row overflows its grid cell even in
  // English at narrower widths — a pre-existing SavingThrowsPanel/
  // DiceRoller layout bug, not something translation length caused or
  // this abbreviation fully fixes; out of scope for a translation pass.
  rollerDisadvantage: 'Dés',
  rollerNormal: 'Normal',
  rollerAdvantage: 'Av',
  rollerRollModeLabel: 'Mode de lancer',
  rollerRollButton: 'Lancer',
  rollerKept: 'Conservé',
  rollerNotKept: 'Non conservé',
  quickHeading: 'Lancer des dés',
  quickPlaceholder: 'p. ex. 2d6+3',
  quickRolling: 'Lancement…',
  quickInvalidExpression: 'Attendu : une expression de dé comme « d20 », « 2d6 » ou « 2d6+3 ».',
};
