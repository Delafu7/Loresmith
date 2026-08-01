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
import { isUuid } from '../lib/ids';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';
import { useHeaderBadge } from '../components/layout/HeaderBadgeContext';

// Maps a campaign-nested route's leading path segment to its nav label, so
// the breadcrumb trail's second segment ("Home › Campaign › Session") is
// derived once here instead of every nested page registering it itself.
const SECTION_LABEL_KEYS: Record<string, TranslationKey> = {
  dashboard: 'nav.dashboard',
  map: 'nav.map',
  characters: 'nav.characters',
  monsters: 'nav.bestiary',
  items: 'nav.items',
  session: 'nav.session',
  'session-log': 'nav.sessionLog',
  notes: 'nav.notes',
  'dice-rolls': 'nav.diceRolls',
  assets: 'nav.assets',
  catalog: 'nav.catalog',
  members: 'nav.members',
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
// as a brand-new campaign — no dedicated settings page exists yet, so this
// lives with the other campaign-level chrome in the sidebar.
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

  return (
    <CampaignShellContext.Provider value={{ campaignId, campaign: campaignQuery.data.campaign, role: role! }}>
      <div className="min-h-dvh bg-stone-950 text-stone-100 flex flex-col md:flex-row">
        <Sidebar>
          <div>
            <h1 className="font-display text-lg font-medium truncate">{campaignQuery.data.campaign.name}</h1>
          </div>
          <NavItemList>
            {/* First item, matching design/nocturne.html's sidebar ordering
                — the campaign's default landing view (see App.tsx's index
                redirect). */}
            <NavItem to="dashboard">{t('nav.dashboard')}</NavItem>
            {/* Positioned right after Dashboard (not nocturne's literal
                6th-of-8 slot) — this app's map-first premise makes it a
                primary surface, not a secondary browse tab. */}
            <NavItem to="map">{t('nav.map')}</NavItem>
            <NavItem to="characters">{t('nav.characters')}</NavItem>
            {isDm && <NavItem to="monsters">{t('nav.bestiary')}</NavItem>}
            {isDm && <NavItem to="items">{t('nav.items')}</NavItem>}
            <NavItem to="session">{t('nav.session')}</NavItem>
            {/* "Session Log" — the DM's per-session recap (SessionLogPage), NOT
                the live combat view above. Not DM-gated: any member can read the
                recap log; only the write actions inside the page are DM-only. */}
            <NavItem to="session-log">{t('nav.sessionLog')}</NavItem>
            <NavItem to="notes">{t('nav.notes')}</NavItem>
            <NavItem to="dice-rolls">{t('nav.diceRolls')}</NavItem>
            <NavItem to="assets">{t('nav.assets')}</NavItem>
            {isDm && <NavItem to="catalog">{t('nav.catalog')}</NavItem>}
            {isDm && <NavItem to="members">{t('nav.members')}</NavItem>}
          </NavItemList>
          {isDm && (
            <div className="mt-auto">
              <ExportCampaignButton campaignId={campaignId} campaignName={campaignQuery.data.campaign.name} />
            </div>
          )}
        </Sidebar>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </CampaignShellContext.Provider>
  );
}

