import { createContext, useContext } from 'react';
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

