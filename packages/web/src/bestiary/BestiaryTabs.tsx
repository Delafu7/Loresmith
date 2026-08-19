import { NavLink } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useCampaignShell } from '../campaigns/CampaignShell';

// One sidebar entry ("Bestiary") for two still-separate routes/pages —
// CampaignBestiaryPage (all-member curated creature list) and MonstersPage
// (DM-only combat-spawn + homebrew-authoring workbench). They stay distinct
// pages with their own data/mutations; this tab strip (same routed-tabs
// pattern as notes/JournalTabs.tsx) is only the switcher between them. The
// Monsters tab is hidden for a player — MonstersPage 403s/empty-states for
// non-DMs anyway, so there'd be nothing for them there.
export function BestiaryTabs() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';

  return (
    <div className="flex gap-2 mb-4 border-b border-stone-800 overflow-x-auto">
      <NavLink
        to={`/campaigns/${campaignId}/bestiary`}
        className={({ isActive }) =>
          `min-h-11 px-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
            isActive ? 'border-amber-500 text-amber-400' : 'border-transparent text-stone-400 hover:text-stone-200'
          }`
        }
      >
        {t('nav.bestiary')}
      </NavLink>
      {isDm && (
        <NavLink
          to={`/campaigns/${campaignId}/monsters`}
          className={({ isActive }) =>
            `min-h-11 px-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              isActive ? 'border-amber-500 text-amber-400' : 'border-transparent text-stone-400 hover:text-stone-200'
            }`
          }
        >
          {t('nav.monsters')}
        </NavLink>
      )}
    </div>
  );
}
