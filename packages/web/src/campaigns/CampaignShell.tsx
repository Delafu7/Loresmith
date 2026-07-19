import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, CampaignRole } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useJoinCampaign } from '../lib/useJoinCampaign';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';

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
      <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col md:flex-row">
        <nav className="md:w-56 border-b md:border-b-0 md:border-r border-stone-800 px-4 py-4 md:min-h-screen">
          <div className="mb-4">
            <NavLink to="/" className="text-xs text-stone-500 hover:text-stone-300">
              ← Dashboard
            </NavLink>
            <NavLink to="/campaigns" className="text-xs text-stone-500 hover:text-stone-300 ml-2">
              All campaigns
            </NavLink>
            <h1 className="text-lg font-semibold mt-1 truncate">{campaignQuery.data.campaign.name}</h1>
            <span className="text-xs uppercase tracking-wide text-amber-500">{role}</span>
          </div>
          <ul className="flex md:flex-col gap-1 flex-wrap">
            <NavItem to="characters" label="Characters" />
            {isDm && <NavItem to="monsters" label="Bestiary" />}
            <NavItem to="encounters" label="Encounter" />
            <NavItem to="notes" label="Notes" />
            <NavItem to="dice-rolls" label="Dice Rolls" />
          </ul>
        </nav>
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </CampaignShellContext.Provider>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <li>
      <NavLink
        to={to}
        className={({ isActive }) =>
          `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            isActive ? 'bg-amber-600 text-stone-950' : 'text-stone-300 hover:bg-stone-800'
          }`
        }
      >
        {label}
      </NavLink>
    </li>
  );
}
