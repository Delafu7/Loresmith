import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, CampaignRole } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useJoinCampaign } from '../lib/useJoinCampaign';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { ThemePicker } from '../components/ThemePicker';
import { Sidebar, NavItemList, NavItem } from '../components/ui/Nav';

interface CampaignShellContextValue {
  campaignId: number;
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
  const campaignId = Number(params.campaignId);
  const { roleForCampaign } = useAuth();

  useJoinCampaign(campaignId);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<{ campaign: Campaign; myRole: CampaignRole }>(`/campaigns/${campaignId}`),
    enabled: Number.isInteger(campaignId),
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
            <NavItem to="maps">Maps</NavItem>
            <NavItem to="notes">Notes</NavItem>
            <NavItem to="dice-rolls">Dice Rolls</NavItem>
          </NavItemList>
          <div className="mt-auto flex flex-col gap-3 max-md:flex-row max-md:flex-wrap max-md:items-center">
            {isDm && <HideEverythingButton campaignId={campaignId} />}
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

// Always-visible panic button (PLAN.md §2.1/§11.5) — deliberately lives in
// the persistent nav, not tucked inside a settings page or the Encounter
// tab, since a DM needs it reachable in one click from wherever they
// currently are mid-session, not after navigating away from whatever they're
// looking at. Confirms first (same convention as CharacterSheetPage's
// delete button) since it's broad — it re-hides every reveal across the
// whole campaign, not just the current view.
function HideEverythingButton({ campaignId }: { campaignId: number }) {
  const mutation = useMutation({
    mutationFn: () => api.post<void>(`/campaigns/${campaignId}/reveals/hide-all`),
  });
  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Hide everything from players? This re-hides every revealed field, HP band, and effect across the whole campaign.')) {
          mutation.mutate();
        }
      }}
      disabled={mutation.isPending}
      title="Re-hide every revealed field, HP, and effect across the whole campaign"
      className="min-h-11 w-full rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-red-400 hover:bg-red-950/70 disabled:opacity-50 md:w-auto"
    >
      Hide everything
    </button>
  );
}
