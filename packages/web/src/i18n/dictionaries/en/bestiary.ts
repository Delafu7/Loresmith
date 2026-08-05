// The read-only, cross-campaign /bestiary/* screens (BestiaryLayout,
// BestiaryBasicPage, BestiaryCampaignPage, CreatureSheetPage) — distinct
// from the DM-only campaign bestiary tab (monsters.ts).
export const bestiary = {
  crType: 'CR {cr} · {type}',
  layout: {
    tabBasic: 'Basic creatures',
    tabCampaign: 'Campaign-specific',
  },
  basic: {
    searchPlaceholder: 'Search creatures…',
    allTypes: 'All types',
    crMin: 'CR min',
    crMax: 'CR max',
    noMatches: 'No creatures match this filter.',
  },
  campaign: {
    pickPrompt: 'Pick a campaign to see its homebrew creatures.',
    noCampaigns: "You're not in any campaigns yet.",
    newHomebrew: '+ New homebrew creature',
    noHomebrewCreatures: 'No homebrew creatures in this campaign yet.',
    homebrewHeading: 'Homebrew Creatures',
  },
  sheet: {
    backToBestiary: '← Bestiary',
  },
};
