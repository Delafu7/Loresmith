export const dashboard = {
  // {charactersPlural}/{campaignsPlural} are passed as '' or 's' by the
  // caller — every supported language happens to pluralize these two nouns
  // with a plain trailing 's', so this stays a single shared template per
  // language rather than needing real ICU plural rules.
  statsKicker: '{characters} character{charactersPlural} · {campaigns} campaign{campaignsPlural}',
  welcome: 'Welcome back, {name}',
  navCampaigns: 'All campaigns',
  navBestiary: 'Bestiary',
  navMaps: 'Maps',
  navNotes: 'Notes',
  yourCharacters: 'Your characters',
  noCharacters: "You don't own any characters yet.",
  npcBadge: 'NPC',
  yourCampaigns: 'Your campaigns',
  noCampaigns: "You're not in any campaigns yet.",
  allCampaignsLink: 'All campaigns →',
  yourNotes: 'Your notes',
  noNotesWritten: "You haven't written any notes yet.",
  allNotesLink: 'All notes →',
  campaignActivity: 'Campaign activity',
  noCampaignNotes: 'No notes in your campaigns yet.',
};
