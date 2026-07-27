import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Campaign, MonsterCatalogEntry } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Portrait } from '../components/Portrait';
import { ButtonLink } from '../components/ui/Button';
import { formatCrLabel } from './formatCr';

// No :id in the URL — a picker over the user's own campaigns, since
// "campaign-specific creatures" only means something once you've chosen
// which campaign. Route: /bestiary/campaign.
export function BestiaryCampaignPickerPage() {
  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ campaigns: Campaign[] }>('/campaigns'),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-400">Pick a campaign to see its homebrew creatures.</p>
      {campaignsQuery.isLoading && <Loading />}
      {campaignsQuery.isError && <ErrorBanner message={errorMessage(campaignsQuery.error)} />}
      {campaignsQuery.data && campaignsQuery.data.campaigns.length === 0 && (
        <EmptyState message="You're not in any campaigns yet." />
      )}
      <ul className="grid sm:grid-cols-2 gap-3">
        {campaignsQuery.data?.campaigns.map((c) => (
          <li key={c.id}>
            <Link
              to={`/bestiary/campaign/${c.id}`}
              className="block rounded-md bg-stone-900 shadow-sm hover:bg-stone-800/70 transition-colors px-4 py-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-stone-100">{c.name}</span>
                <span className="text-xs uppercase tracking-wide text-stone-500">{c.my_role}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Route: /bestiary/campaign/:id — that campaign's homebrew creatures only
// (no global-catalog union; the Basic tab already covers that).
export function BestiaryCampaignPage() {
  const params = useParams<{ id: string }>();
  const campaignId = Number(params.id);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<{ campaign: Campaign; myRole: string }>(`/campaigns/${campaignId}`),
    enabled: Number.isInteger(campaignId),
  });

  const monstersQuery = useQuery({
    queryKey: ['catalog', 'monsters', 'campaign', campaignId],
    queryFn: () =>
      api.get<{ monsters: MonsterCatalogEntry[] }>(`/catalog/monsters?campaignId=${campaignId}&homebrewOnly=true`),
    enabled: Number.isInteger(campaignId),
  });

  if (campaignQuery.isLoading) return <Loading />;
  if (campaignQuery.isError) return <ErrorBanner message={errorMessage(campaignQuery.error)} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display text-lg font-medium">{campaignQuery.data?.campaign.name}</h2>
        {campaignQuery.data?.myRole === 'dm' && (
          <ButtonLink to={`/campaigns/${campaignId}/monsters/new`} variant="primary" size="sm">
            + New homebrew creature
          </ButtonLink>
        )}
      </div>

      {monstersQuery.isLoading && <Loading />}
      {monstersQuery.isError && <ErrorBanner message={errorMessage(monstersQuery.error)} />}
      {monstersQuery.data && monstersQuery.data.monsters.length === 0 && (
        <EmptyState message="No homebrew creatures in this campaign yet." />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
        {monstersQuery.data?.monsters.map((m) => (
          <Link
            key={m.id}
            to={`/creature/${m.id}`}
            className="rounded-md bg-stone-900 shadow-sm hover:bg-stone-800/70 transition-colors overflow-hidden group"
          >
            <div className="aspect-square bg-stone-950 flex items-center justify-center">
              <Portrait fileUrl={m.image_url} alt={m.name} size="xl" placeholderLabel={m.name} />
            </div>
            <div className="p-3">
              <p className="font-medium text-stone-100 truncate group-hover:text-amber-400">{m.name}</p>
              <p className="text-xs text-stone-500">
                CR {formatCrLabel(m.challenge_rating)} · {m.creature_type}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
