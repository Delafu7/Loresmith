// English — the canonical dictionary. Every other locale file's shape is
// checked against this one (`satisfies typeof en` in es.ts/fr.ts), so a key
// added here that's missing elsewhere is a compile error, not a silent
// runtime fallback discovered later.
//
// First-pass scope (deliberately not the whole app yet): login/register,
// the home dashboard, the campaign sidebar nav, and the handful of shared
// components those screens use (Loading, ThemePicker, PasswordInput).
// Everything else still reads in English regardless of locale — see
// LocaleContext.tsx's `t()` for the fallback-to-key behavior that makes an
// untranslated screen degrade to plain English text rather than throwing.
export const en = {
  common: {
    loading: 'Loading…',
    logOut: 'Log out',
    theme: 'Theme',
    language: 'Language',
  },
  login: {
    title: 'Sign in',
    subtitle: 'Continue your campaign.',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    submitting: 'Signing in…',
    noAccount: 'No account?',
    register: 'Register',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
  },
  register: {
    title: 'Create an account',
    subtitle: 'Join or start a campaign.',
    displayName: 'Display name',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 8 characters.',
    submit: 'Create account',
    submitting: 'Creating account…',
    haveAccount: 'Already have an account?',
    signIn: 'Sign in',
  },
  dashboard: {
    // {charactersPlural}/{campaignsPlural} are passed as '' or 's' by the
    // caller — every supported language happens to pluralize these two
    // nouns with a plain trailing 's', so this stays a single shared
    // template per language rather than needing real ICU plural rules.
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
  },
  nav: {
    home: '← Home',
    allCampaigns: 'All campaigns',
    characters: 'Characters',
    bestiary: 'Bestiary',
    session: 'Session',
    sessionLog: 'Session Log',
    maps: 'Maps',
    notes: 'Notes',
    diceRolls: 'Dice Rolls',
    assets: 'Assets',
    catalog: 'Catalog',
    exportCampaign: 'Export campaign (JSON)',
    exporting: 'Exporting…',
  },
};
