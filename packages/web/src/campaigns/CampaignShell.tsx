import { createContext, useContext, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, CampaignRole } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useJoinCampaign } from '../lib/useJoinCampaign';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { ThemePicker } from '../components/ThemePicker';
import { Sidebar, NavItemList, NavItem } from '../components/ui/Nav';
import { isUuid } from '../lib/ids';

interface CampaignShellContextValue {
  campaignId: string;
  campaign: Campaign;
  role: CampaignRole;
}

const CampaignShellContext = createContext<CampaignShellContextValue | null>(null);

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
        {pending ? 'Exporting…' : 'Export campaign (JSON)'}
      </button>
      {error !== null && <p className="text-red-400 mt-1">{errorMessage(error)}</p>}
    </div>
  );
}

export function CampaignShell() {
  const params = useParams<{ campaignId: string }>();
  const campaignId = params.campaignId ?? '';
  const { roleForCampaign } = useAuth();

  useJoinCampaign(campaignId);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<{ campaign: Campaign; myRole: CampaignRole }>(`/campaigns/${campaignId}`),
    enabled: isUuid(campaignId),
  });

  if (campaignQuery.isLoading) return <Loading label="Loading campaign…" />;
  if (campaignQuery.isError) return <ErrorBanner message={errorMessage(campaignQuery.error)} />;
  if (!campaignQuery.data) return null;

  const role = roleForCampaign(campaignId) ?? campaignQuery.data.myRole;
  const isDm = role === 'dm';

  return (
    <CampaignShellContext.Provider value={{ campaignId, campaign: campaignQuery.data.campaign, role }}>
      <div className="min-h-dvh bg-stone-950 text-stone-100 flex flex-col md:flex-row">
        <Sidebar className="pt-[max(1rem,env(safe-area-inset-top))]">
          <div>
            <div className="flex flex-wrap gap-x-2 text-xs text-stone-500">
              <NavLink to="/home" className="hover:text-stone-300">
                ← Home
              </NavLink>
              <NavLink to="/campaigns" className="hover:text-stone-300">
                All campaigns
              </NavLink>
            </div>
            <h1 className="font-display text-lg font-medium mt-1 truncate">{campaignQuery.data.campaign.name}</h1>
            <span className="text-xs uppercase tracking-wide text-amber-500">{role}</span>
          </div>
          <NavItemList>
            <NavItem to="characters">Characters</NavItem>
            {isDm && <NavItem to="monsters">Bestiary</NavItem>}
            <NavItem to="session">Session</NavItem>
            {/* "Session Log" — the DM's per-session recap (SessionLogPage), NOT
                the live combat view above. Not DM-gated: any member can read the
                recap log; only the write actions inside the page are DM-only. */}
            <NavItem to="session-log">Session Log</NavItem>
            <NavItem to="maps">Maps</NavItem>
            <NavItem to="notes">Notes</NavItem>
            <NavItem to="dice-rolls">Dice Rolls</NavItem>
            <NavItem to="assets">Assets</NavItem>
            {isDm && <NavItem to="catalog">Catalog</NavItem>}
          </NavItemList>
          <div className="mt-auto flex flex-col gap-3 max-md:flex-row max-md:flex-wrap max-md:items-center">
            {isDm && <ExportCampaignButton campaignId={campaignId} campaignName={campaignQuery.data.campaign.name} />}
            <ThemePicker />
          </div>
        </Sidebar>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </CampaignShellContext.Provider>
  );
}

