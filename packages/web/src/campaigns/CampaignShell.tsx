import { createContext, useContext, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, CampaignRole } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';
import { useJoinCampaign } from '../lib/useJoinCampaign';
import { useLiveMapAutoOpen } from './useLiveMapAutoOpen';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { Sidebar, NavItemList, NavItem } from '../components/ui/Nav';
import { NavDrawer } from '../components/layout/NavDrawer';
import { isUuid } from '../lib/ids';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';
import { useHeaderBadge } from '../components/layout/HeaderBadgeContext';

const DESKTOP_COLLAPSED_KEY = 'campaignNavCollapsed';

// Maps a campaign-nested route's leading path segment to its nav label, so
// the breadcrumb trail's second segment ("Home › Campaign › Session") is
// derived once here instead of every nested page registering it itself.
const SECTION_LABEL_KEYS: Record<string, TranslationKey> = {
  dashboard: 'nav.dashboard',
  map: 'nav.map',
  characters: 'nav.characters',
  bestiary: 'nav.bestiary',
  monsters: 'nav.monsters',
  items: 'nav.items',
  session: 'nav.session',
  'session-log': 'nav.sessionLog',
  notes: 'nav.notes',
  'dice-rolls': 'nav.diceRolls',
  assets: 'nav.assets',
  reference: 'nav.reference',
  catalog: 'nav.catalog',
  members: 'nav.members',
  settings: 'nav.settings',
};

interface CampaignShellContextValue {
  campaignId: string;
  campaign: Campaign;
  role: CampaignRole;
}

// Exported (not just the useCampaignShell hook below) so LiveMapPage.tsx
// (map-first encounter system) can provide it too — the fullscreen live
// route lives OUTSIDE this component's tree (no header/nav chrome), but
// still needs every nested component that already calls useCampaignShell()
// (ParticipantSheetPanel, ActionEconomyPanel, ...) to keep working unchanged.
export const CampaignShellContext = createContext<CampaignShellContextValue | null>(null);

export function useCampaignShell(): CampaignShellContextValue {
  const ctx = useContext(CampaignShellContext);
  if (!ctx) throw new Error('useCampaignShell must be used within CampaignShell');
  return ctx;
}

// Phase 4: JSON campaign export (DM-only, matches GET /campaigns/:id/export's
// own requireRole('dm') gate). Downloads the "core content" snapshot
// (services/campaignExport.ts) as a plain JSON file the DM can later feed
// into /campaigns/import (see CampaignListPage.tsx) to restore/duplicate it
// as a brand-new campaign. Stays here in the sidebar rather than moving into
// CampaignSettingsPage (Iteration 3 M7) — it's a one-shot download action,
// not a persistent setting, and every other page in this sidebar footer is
// action chrome too.
function ExportCampaignButton({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleExport() {
    setPending(true);
    setError(null);
    try {
      const data = await api.get<Record<string, unknown>>(`/campaigns/${campaignId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const slug = campaignName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'campaign';
      a.href = url;
      a.download = `${slug}-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={pending}
        className="min-h-11 text-stone-400 hover:text-stone-200 disabled:opacity-50"
      >
        {pending ? t('nav.exporting') : t('nav.exportCampaign')}
      </button>
      {error !== null && <p className="text-red-400 mt-1">{errorMessage(error)}</p>}
    </div>
  );
}

export function CampaignShell() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = params.campaignId ?? '';
  const { roleForCampaign } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop-only, persisted across visits (a DM/player's collapsed
  // preference shouldn't reset every page load) — mobile always starts
  // closed, that state isn't worth persisting for an overlay.
  const [desktopCollapsed, setDesktopCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(DESKTOP_COLLAPSED_KEY) === '1',
  );

  function toggleDesktopCollapsed() {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(DESKTOP_COLLAPSED_KEY, next ? '1' : '0');
      return next;
    });
  }

  useJoinCampaign(campaignId);
  useLiveMapAutoOpen(campaignId);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<{ campaign: Campaign; myRole: CampaignRole }>(`/campaigns/${campaignId}`),
    enabled: isUuid(campaignId),
  });

  // Second breadcrumb segment ("Home › Campaign › Session › …") derived
  // from the current nested route so every section under CampaignShell gets
  // one automatically, without each page registering it itself.
  const section = location.pathname.split('/')[3];
  const sectionLabelKey = section ? SECTION_LABEL_KEYS[section] : undefined;
  useBreadcrumb(
    1,
    campaignQuery.data
      ? [
          { label: campaignQuery.data.campaign.name, to: `/campaigns/${campaignId}` },
          ...(sectionLabelKey ? [{ label: t(sectionLabelKey), to: `/campaigns/${campaignId}/${section}` }] : []),
        ]
      : [],
  );

  const role = roleForCampaign(campaignId) ?? campaignQuery.data?.myRole ?? null;
  // "Who am I here" now lives on the right of the persistent header, next to
  // the avatar (see AppHeader/HeaderBadgeContext) — not in the left sidebar
  // under the campaign name, so every identity indicator is consistently on
  // one side across the whole app.
  useHeaderBadge(role);

  if (campaignQuery.isLoading) return <Loading label="Loading campaign…" />;
  if (campaignQuery.isError) return <ErrorBanner message={errorMessage(campaignQuery.error)} />;
  if (!campaignQuery.data) return null;

  const isDm = role === 'dm';
  const campaignName = campaignQuery.data.campaign.name;

  // Rendered twice (desktop persistent column, mobile drawer) — extracted so
  // the ~20 NavItem lines aren't duplicated. onNavigate closes the mobile
  // drawer after a tap; undefined (desktop) is a no-op prop, harmless.
  function CampaignNavContent({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        <div>
          <h1 className="font-display text-lg font-medium truncate">{campaignName}</h1>
        </div>
        <NavItemList>
          {/* First item, matching design/nocturne.html's sidebar ordering
              — the campaign's default landing view (see App.tsx's index
              redirect). */}
          <NavItem to="dashboard" onClick={onNavigate}>{t('nav.dashboard')}</NavItem>
          {/* Positioned right after Dashboard (not nocturne's literal
              6th-of-8 slot) — this app's map-first premise makes it a
              primary surface, not a secondary browse tab. */}
          <NavItem to="map" onClick={onNavigate}>{t('nav.map')}</NavItem>
          <NavItem to="characters" onClick={onNavigate}>{t('nav.characters')}</NavItem>
          {/* Task 1: curated bestiary, visible to DM + players (server-side
              filters undiscovered creatures for players) — not gated like
              the DM-only "monsters" workbench below. */}
          <NavItem to="bestiary" onClick={onNavigate}>{t('nav.bestiary')}</NavItem>
          {isDm && <NavItem to="monsters" onClick={onNavigate}>{t('nav.monsters')}</NavItem>}
          {isDm && <NavItem to="items" onClick={onNavigate}>{t('nav.items')}</NavItem>}
          <NavItem to="session" onClick={onNavigate}>{t('nav.session')}</NavItem>
          {/* "Session Log" — the DM's per-session recap (SessionLogPage), NOT
              the live combat view above. Not DM-gated: any member can read the
              recap log; only the write actions inside the page are DM-only. */}
          <NavItem to="session-log" onClick={onNavigate}>{t('nav.sessionLog')}</NavItem>
          <NavItem to="notes" onClick={onNavigate}>{t('nav.notes')}</NavItem>
          <NavItem to="dice-rolls" onClick={onNavigate}>{t('nav.diceRolls')}</NavItem>
          <NavItem to="assets" onClick={onNavigate}>{t('nav.assets')}</NavItem>
          {/* Iteration 4 — DM-only crucial-info notes + a coin-value table
              every member can see, both on one page; not gated like the
              DM-only pages below (the page itself hides the notes section
              for a non-DM viewer). */}
          <NavItem to="reference" onClick={onNavigate}>{t('nav.reference')}</NavItem>
          {isDm && <NavItem to="catalog" onClick={onNavigate}>{t('nav.catalog')}</NavItem>}
          {isDm && <NavItem to="members" onClick={onNavigate}>{t('nav.members')}</NavItem>}
          {isDm && <NavItem to="settings" onClick={onNavigate}>{t('nav.settings')}</NavItem>}
        </NavItemList>
        {isDm && (
          <div className="mt-auto">
            <ExportCampaignButton campaignId={campaignId} campaignName={campaignName} />
          </div>
        )}
      </>
    );
  }

  return (
    <CampaignShellContext.Provider value={{ campaignId, campaign: campaignQuery.data.campaign, role: role! }}>
      <div className="min-h-dvh bg-stone-950 text-stone-100 flex flex-col md:flex-row">
        {/* Desktop: persistent column, collapsible (a DM/player's choice
            persists via localStorage). Mobile: never rendered here — the
            NavDrawer below owns mobile presentation entirely, so there's no
            "always-visible squeezed strip" competing with page content. */}
        <div className="hidden md:flex md:flex-shrink-0">
          {desktopCollapsed ? (
            <button
              type="button"
              onClick={toggleDesktopCollapsed}
              aria-label={t('nav.expandSidebar')}
              className="flex w-6 flex-shrink-0 items-center justify-center border-r border-stone-800 text-stone-500 hover:bg-stone-900 hover:text-stone-300"
            >
              »
            </button>
          ) : (
            <Sidebar className="md:min-h-dvh md:w-56 md:border-r md:border-stone-800 relative">
              <button
                type="button"
                onClick={toggleDesktopCollapsed}
                aria-label={t('nav.collapseSidebar')}
                title={t('nav.collapseSidebar')}
                className="absolute right-2 top-4 flex size-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-800 hover:text-stone-300"
              >
                «
              </button>
              <CampaignNavContent />
            </Sidebar>
          )}
        </div>

        {/* Mobile: a hamburger trigger + overlay drawer, reachable one-handed
            at the top of the content area (per-page headers/back links, if
            any, render below this inside <Outlet/>, so this stays the very
            first interactive element on small screens). */}
        <div className="flex items-center gap-2 border-b border-stone-800 px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-haspopup="dialog"
            aria-expanded={mobileNavOpen}
            className="flex size-9 flex-shrink-0 items-center justify-center rounded-md text-stone-300 hover:bg-stone-800"
          >
            ☰
          </button>
          <span className="font-display text-sm font-medium text-stone-100 truncate">{campaignName}</span>
        </div>
        <NavDrawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} title={campaignName}>
          <Sidebar className="h-full">
            <CampaignNavContent onNavigate={() => setMobileNavOpen(false)} />
          </Sidebar>
        </NavDrawer>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </CampaignShellContext.Provider>
  );
}

