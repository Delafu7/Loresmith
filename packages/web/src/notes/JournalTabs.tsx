import { NavLink } from 'react-router-dom';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';
import { useCampaignShell } from '../campaigns/CampaignShell';

// Shared sub-nav for the five worldbuilding/DM-prep pages that used to be
// five separate top-level sidebar entries (Notes, Plot Threads, Locations &
// Factions, Calendar, Reference) — collapsed into one "Journal" sidebar
// entry (CampaignShell.tsx) with this tab strip taking over switching
// between them, mirroring the existing Locations/Factions in-page tab style
// (LocationsFactionsPage.tsx) but routed (each tab is still its own route,
// own data-fetching, own sockets) rather than local state.
const TABS: { to: string; labelKey: TranslationKey }[] = [
  { to: 'notes', labelKey: 'nav.notes' },
  { to: 'plot-threads', labelKey: 'nav.plotThreads' },
  { to: 'locations', labelKey: 'nav.locationsFactions' },
  { to: 'calendar', labelKey: 'nav.campaignCalendar' },
  { to: 'reference', labelKey: 'nav.reference' },
];

export function JournalTabs() {
  const { t } = useLocale();
  const { campaignId } = useCampaignShell();

  return (
    <div className="flex gap-2 mb-4 border-b border-stone-800 overflow-x-auto">
      {TABS.map(({ to, labelKey }) => (
        <NavLink
          key={to}
          to={`/campaigns/${campaignId}/${to}`}
          className={({ isActive }) =>
            `min-h-11 px-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              isActive ? 'border-amber-500 text-amber-400' : 'border-transparent text-stone-400 hover:text-stone-200'
            }`
          }
        >
          {t(labelKey)}
        </NavLink>
      ))}
    </div>
  );
}
