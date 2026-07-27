// Cross-campaign map index (REFACTOR-PLAN.md §1: /maps). Maps stay 1:1 with
// an encounter (encounter_maps, REVISION-PLAN.md §4's campaign-level Konva
// rewrite is still deferred — see OPEN_QUESTIONS.md #1), so "every map" means
// "every encounter across every campaign I'm in," grouped by campaign. No
// dedicated cross-campaign endpoint exists for this, so it's one query per
// campaign in parallel rather than a new server aggregate built just for a
// browse index.

import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Campaign, Encounter } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

export function MapsIndexPage() {
  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ campaigns: Campaign[] }>('/campaigns'),
  });

  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const encounterQueries = useQueries({
    queries: campaigns.map((c) => ({
      queryKey: ['encounters', c.id],
      queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${c.id}/encounters`),
      enabled: campaignsQuery.isSuccess,
    })),
  });

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-6 py-4 flex items-center gap-4">
        <Link to="/home" className="text-xs text-stone-500 hover:text-stone-300">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Maps</h1>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {campaignsQuery.isLoading && <Loading />}
        {campaignsQuery.isError && <ErrorBanner message={errorMessage(campaignsQuery.error)} />}
        {campaigns.length === 0 && !campaignsQuery.isLoading && <EmptyState message="You're not in any campaigns yet." />}

        {campaigns.map((c, i) => {
          const eq = encounterQueries[i];
          const encounters = eq?.data?.encounters ?? [];
          if (eq?.isLoading || encounters.length === 0) return null;
          return (
            <section key={c.id}>
              <h2 className="text-sm uppercase tracking-wide text-stone-500 mb-2">{c.name}</h2>
              <ul className="grid sm:grid-cols-2 gap-3">
                {encounters.map((enc) => (
                  <li key={enc.id}>
                    <Link
                      to={`/maps/${enc.id}`}
                      className="block rounded-lg border border-stone-800 bg-stone-900 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-stone-100">{enc.name}</span>
                        <span className="text-xs uppercase tracking-wide text-stone-500">{enc.status}</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </main>
    </div>
  );
}
