// Global item repository (nav point 5) — mirrors MonstersPage.tsx's
// catalog-browse/import pattern for items: a searchable/filterable catalog
// (global items ∪ this campaign's homebrew, same union GET /catalog/items
// already does for MonstersPage's bestiary table) on top, and this
// campaign's stash of imported-but-not-yet-assigned item instances below.
// "Create/duplicate your own item" already has a full UI at
// /campaigns/:id/catalog (CatalogEditorPage.tsx, items is its first/default
// entity) — this page links there rather than rebuilding that form.
//
// DM-only, matching MonstersPage's campaign-management gating — a player's
// own inventory is already managed from CharacterSheetPage's InventoryPanel;
// this page is about the DM stocking and handing out loot.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Character, CharacterItem, ItemCatalogEntry, ItemRarity, ItemType } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

const RARITY_COLOR: Record<ItemRarity, string> = {
  mundane: 'text-stone-500',
  common: 'text-stone-300',
  uncommon: 'text-emerald-400',
  rare: 'text-sky-400',
  very_rare: 'text-violet-400',
  legendary: 'text-amber-400',
  artifact: 'text-red-400',
};

const ITEM_TYPES: ItemType[] = ['weapon', 'armor', 'shield', 'tool', 'adventuring_gear', 'magic_item', 'consumable', 'mount', 'vehicle'];
const ITEM_RARITIES: ItemRarity[] = ['mundane', 'common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'];

export function ItemRepositoryPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  const [importQuantities, setImportQuantities] = useState<Record<string, number>>({});
  const [giveTargets, setGiveTargets] = useState<Record<string, string>>({});

  const catalogQueryKey = ['catalog', 'items', campaign.srd_edition, campaignId];
  const catalogQuery = useQuery({
    queryKey: catalogQueryKey,
    queryFn: () =>
      api.get<{ items: ItemCatalogEntry[] }>(`/catalog/items?edition=${campaign.srd_edition}&campaignId=${campaignId}`),
  });

  const stashQuery = useQuery({
    queryKey: ['campaignItemStash', campaignId],
    queryFn: () => api.get<{ items: CharacterItem[] }>(`/campaigns/${campaignId}/item-stash`),
  });

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  const importMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      api.post(`/campaigns/${campaignId}/item-stash`, { itemId, quantity }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignItemStash', campaignId] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (stashItemId: string) => api.delete(`/campaigns/${campaignId}/item-stash/${stashItemId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignItemStash', campaignId] });
    },
  });

  const giveMutation = useMutation({
    mutationFn: ({ stashItemId, characterId }: { stashItemId: string; characterId: string }) =>
      api.post(`/campaigns/${campaignId}/item-stash/${stashItemId}/give`, { characterId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaignItemStash', campaignId] });
    },
  });

  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message={t('items.dmOnly')} />
      </div>
    );
  }

  const catalogNameById = new Map((catalogQuery.data?.items ?? []).map((i) => [i.id, i]));
  const filteredCatalog = (catalogQuery.data?.items ?? []).filter(
    (i) =>
      (!search || i.name.toLowerCase().includes(search.toLowerCase())) &&
      (!typeFilter || i.item_type === typeFilter) &&
      (!rarityFilter || i.rarity === rarityFilter),
  );

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{t('items.list.heading')}</h2>
          <Link to={`/campaigns/${campaignId}/catalog`} className="text-xs text-amber-500 hover:text-amber-400 underline">
            {t('items.list.manageCatalogLink')}
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="search"
            placeholder={t('items.list.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('items.list.allTypes')}</option>
            {ITEM_TYPES.map((it) => (
              <option key={it} value={it}>
                {t(`items.type.${it}`)}
              </option>
            ))}
          </select>
          <select
            value={rarityFilter}
            onChange={(e) => setRarityFilter(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('items.list.allRarities')}</option>
            {ITEM_RARITIES.map((r) => (
              <option key={r} value={r}>
                {t(`items.rarity.${r}`)}
              </option>
            ))}
          </select>
        </div>

        {catalogQuery.isLoading && <Loading />}
        {catalogQuery.isError && <ErrorBanner message={errorMessage(catalogQuery.error)} />}
        {importMutation.isError && <ErrorBanner message={errorMessage(importMutation.error)} />}

        <div className="overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full text-sm">
            <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">{t('items.list.colName')}</th>
                <th className="text-left px-3 py-2">{t('items.list.colType')}</th>
                <th className="text-left px-3 py-2">{t('items.list.colRarity')}</th>
                <th className="text-left px-3 py-2">{t('items.list.colQty')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.map((i) => (
                <tr key={i.id} className="border-t border-stone-800 hover:bg-stone-900/60">
                  <td className="px-3 py-2 text-stone-100">
                    {i.name}
                    {i.is_homebrew && (
                      <span className="ml-2 inline-block rounded border border-amber-700 text-amber-500 text-[10px] uppercase px-1 py-0.5 align-middle">
                        {t('items.list.homebrewBadge')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-stone-400 capitalize">{t(`items.type.${i.item_type}`)}</td>
                  <td className={`px-3 py-2 capitalize ${RARITY_COLOR[i.rarity]}`}>{t(`items.rarity.${i.rarity}`)}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={importQuantities[i.id] ?? 1}
                      onChange={(e) =>
                        setImportQuantities((prev) => ({ ...prev, [i.id]: Math.max(1, Math.min(99, Number(e.target.value) || 1)) }))
                      }
                      className="w-16 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={importMutation.isPending}
                      onClick={() => importMutation.mutate({ itemId: i.id, quantity: importQuantities[i.id] ?? 1 })}
                      className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1 text-xs"
                    >
                      {t('items.list.importToStash')}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredCatalog.length === 0 && !catalogQuery.isLoading && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState message={t('items.list.noMatches')} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{t('items.stash.heading')}</h2>
        {stashQuery.isLoading && <Loading />}
        {stashQuery.isError && <ErrorBanner message={errorMessage(stashQuery.error)} />}
        {removeMutation.isError && <ErrorBanner message={errorMessage(removeMutation.error)} />}
        {giveMutation.isError && <ErrorBanner message={errorMessage(giveMutation.error)} />}
        {stashQuery.data && stashQuery.data.items.length === 0 && <EmptyState message={t('items.stash.empty')} />}

        <ul className="grid sm:grid-cols-2 gap-3">
          {stashQuery.data?.items.map((stashItem) => {
            const template = catalogNameById.get(stashItem.item_id);
            return (
              <li key={stashItem.id} className="rounded-md bg-stone-900 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-stone-100 truncate">
                      {stashItem.custom_name || template?.name || t('items.stash.itemFallback', { id: stashItem.item_id })}
                    </span>
                    {stashItem.quantity > 1 && <span className="text-stone-500"> ×{stashItem.quantity}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(stashItem.id)}
                    className="text-red-400 hover:text-red-300 text-xs flex-shrink-0"
                    aria-label={t('items.stash.removeAria')}
                  >
                    ✕
                  </button>
                </div>
                {template && <p className={`text-xs capitalize mb-2 ${RARITY_COLOR[template.rarity]}`}>{t(`items.rarity.${template.rarity}`)}</p>}
                <div className="flex items-center gap-2">
                  <select
                    value={giveTargets[stashItem.id] ?? ''}
                    onChange={(e) => setGiveTargets((prev) => ({ ...prev, [stashItem.id]: e.target.value }))}
                    className="flex-1 min-w-0 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
                  >
                    <option value="">{t('items.stash.selectCharacter')}</option>
                    {charactersQuery.data?.characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!giveTargets[stashItem.id] || giveMutation.isPending}
                    onClick={() => giveMutation.mutate({ stashItemId: stashItem.id, characterId: giveTargets[stashItem.id]! })}
                    className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs flex-shrink-0"
                  >
                    {t('items.stash.giveButton')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
