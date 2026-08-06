import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { CampaignBestiaryEntry, MonsterCatalogEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button, ButtonLink } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Field';
import { formatCrLabel } from './formatCr';

// Task 1: browse the global + this campaign's homebrew catalog and bulk-add
// creatures to the curated campaign bestiary (POST /campaigns/:id/bestiary).
// Reuses the same catalog query + filter shape as MonstersPage.tsx/
// BestiaryBasicPage.tsx rather than inventing a new browse UI.
// Iteration 2 "Shared bestiary" — client-local MRU of monster ids this DM
// has added to any campaign's bestiary from this browser, same localStorage
// pattern as AddToEncounterOverlay.tsx's recents (no server-side "recently
// used" endpoint exists, and this is a convenience sort, not authoritative
// data). One flat key, not per-campaign, since "recently used" should
// surface a monster you just added to a DIFFERENT campaign too.
const RECENTS_KEY = 'bestiaryAddRecents';
const RECENTS_MAX = 20;

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function pushRecents(ids: string[]): void {
  try {
    const next = [...ids, ...readRecents().filter((id) => !ids.includes(id))].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the sort option just has nothing to show.
  }
}

type SourceFilter = 'all' | 'srd' | 'mine' | 'campaign';
type SortMode = 'name' | 'recent';

export function AddToBestiaryPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [creatureType, setCreatureType] = useState('');
  const [crMin, setCrMin] = useState('');
  const [crMax, setCrMax] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('name');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecents());

  const catalogParams = new URLSearchParams({ edition: campaign.srd_edition, campaignId });
  if (creatureType) catalogParams.set('creatureType', creatureType);
  if (crMin) catalogParams.set('crMin', crMin);
  if (crMax) catalogParams.set('crMax', crMax);
  const catalogQuery = useQuery({
    queryKey: ['catalog', 'monsters', campaign.srd_edition, campaignId, creatureType, crMin, crMax],
    queryFn: () => api.get<{ monsters: MonsterCatalogEntry[] }>(`/catalog/monsters?${catalogParams.toString()}`),
  });

  const bestiaryQuery = useQuery({
    queryKey: ['campaignBestiary', campaignId],
    queryFn: () => api.get<{ entries: CampaignBestiaryEntry[] }>(`/campaigns/${campaignId}/bestiary`),
  });
  const alreadyAddedIds = useMemo(
    () => new Set(bestiaryQuery.data?.entries.map((e) => e.monster_id) ?? []),
    [bestiaryQuery.data],
  );

  const addMutation = useMutation({
    mutationFn: (monsterIds: string[]) => api.post(`/campaigns/${campaignId}/bestiary`, { monsterIds }),
    onSuccess: (_data, monsterIds) => {
      pushRecents(monsterIds);
      setRecentIds(readRecents());
      void queryClient.invalidateQueries({ queryKey: ['campaignBestiary', campaignId] });
      navigate(`/campaigns/${campaignId}/bestiary`);
    },
  });

  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message={t('campaignBestiary.dmOnly')} />
      </div>
    );
  }

  const creatureTypes = [...new Set(catalogQuery.data?.monsters.map((m) => m.creature_type) ?? [])].sort();

  function matchesSource(m: MonsterCatalogEntry): boolean {
    switch (sourceFilter) {
      case 'srd':
        return m.owning_campaign_id === null && m.owning_user_id === null;
      case 'mine':
        return m.owning_user_id === user?.id;
      case 'campaign':
        return m.owning_campaign_id === campaignId;
      default:
        return true;
    }
  }

  const recentRank = new Map(recentIds.map((id, i) => [id, i]));
  const filtered = (catalogQuery.data?.monsters ?? [])
    .filter((m) => (!search || m.name.toLowerCase().includes(search.toLowerCase())) && matchesSource(m))
    .sort((a, b) => {
      if (sortMode === 'recent') {
        const rankA = recentRank.get(a.id) ?? Infinity;
        const rankB = recentRank.get(b.id) ?? Infinity;
        if (rankA !== rankB) return rankA - rankB;
      }
      return a.name.localeCompare(b.name);
    });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{t('campaignBestiary.add.heading')}</h2>
        <ButtonLink to={`/campaigns/${campaignId}/bestiary`} variant="secondary" size="sm">
          {t('campaignBestiary.add.backToBestiary')}
        </ButtonLink>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Input
          type="search"
          placeholder={t('campaignBestiary.add.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 sm:w-48"
        />
        <Select value={creatureType} onChange={(e) => setCreatureType(e.target.value)} className="sm:w-40">
          <option value="">{t('campaignBestiary.add.allTypes')}</option>
          {creatureTypes.map((ct) => (
            <option key={ct} value={ct}>
              {ct}
            </option>
          ))}
        </Select>
        <Input type="number" placeholder={t('campaignBestiary.add.crMin')} value={crMin} onChange={(e) => setCrMin(e.target.value)} className="sm:w-24" />
        <Input type="number" placeholder={t('campaignBestiary.add.crMax')} value={crMax} onChange={(e) => setCrMax(e.target.value)} className="sm:w-24" />
        <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} className="sm:w-36">
          <option value="all">{t('campaignBestiary.add.sourceAll')}</option>
          <option value="srd">{t('campaignBestiary.add.sourceSrd')}</option>
          <option value="mine">{t('campaignBestiary.add.sourceMine')}</option>
          <option value="campaign">{t('campaignBestiary.add.sourceCampaign')}</option>
        </Select>
        <Select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="sm:w-36">
          <option value="name">{t('campaignBestiary.add.sortName')}</option>
          <option value="recent">{t('campaignBestiary.add.sortRecent')}</option>
        </Select>
      </div>

      {catalogQuery.isLoading && <Loading />}
      {catalogQuery.isError && <ErrorBanner message={errorMessage(catalogQuery.error)} />}
      {addMutation.isError && <ErrorBanner message={errorMessage(addMutation.error)} />}
      {filtered.length === 0 && !catalogQuery.isLoading && <EmptyState message={t('campaignBestiary.add.noMatches')} />}

      <div className="overflow-x-auto rounded-lg border border-stone-800">
        <table className="w-full text-sm">
          <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2" />
              <th className="text-left px-3 py-2">{t('campaignBestiary.add.colName')}</th>
              <th className="text-left px-3 py-2">{t('campaignBestiary.add.colType')}</th>
              <th className="text-left px-3 py-2">{t('campaignBestiary.add.colCr')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const alreadyAdded = alreadyAddedIds.has(m.id);
              return (
                <tr key={m.id} className={`border-t border-stone-800 ${alreadyAdded ? 'opacity-40' : 'hover:bg-stone-900/60'}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={alreadyAdded}
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      aria-label={t('campaignBestiary.add.selectAria', { name: m.name })}
                    />
                  </td>
                  <td className="px-3 py-2 text-stone-100">
                    {m.name}
                    {m.owning_user_id !== null && (
                      <span className="ml-2 text-xs text-amber-500">{t('campaignBestiary.add.sourceMine')}</span>
                    )}
                    {m.owning_campaign_id !== null && (
                      <span className="ml-2 text-xs text-stone-500">{t('campaignBestiary.add.sourceCampaign')}</span>
                    )}
                    {alreadyAdded && <span className="ml-2 text-xs text-stone-500">{t('campaignBestiary.add.alreadyAdded')}</span>}
                  </td>
                  <td className="px-3 py-2 text-stone-400">{m.creature_type}</td>
                  <td className="px-3 py-2 text-stone-400">{formatCrLabel(m.challenge_rating)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 sm:sticky sm:bottom-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-md bg-stone-900 shadow-lg border border-stone-800 px-4 py-3">
            <span className="text-sm text-stone-300">{t('campaignBestiary.add.selectedCount', { count: selected.size })}</span>
            <Button variant="primary" disabled={addMutation.isPending} onClick={() => addMutation.mutate([...selected])}>
              {addMutation.isPending
                ? t('campaignBestiary.add.adding')
                : t('campaignBestiary.add.submitButton', { count: selected.size })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
