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
import type { Character, CharacterItem, ItemCatalogEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ItemCatalogBrowser, RARITY_COLOR } from './ItemCatalogBrowser';

export function ItemRepositoryPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
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

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{t('items.list.heading')}</h2>
          <Link to={`/campaigns/${campaignId}/catalog`} className="text-xs text-amber-500 hover:text-amber-400 underline">
            {t('items.list.manageCatalogLink')}
          </Link>
        </div>

        {importMutation.isError && <ErrorBanner message={errorMessage(importMutation.error)} />}

        <ItemCatalogBrowser
          items={catalogQuery.data?.items ?? []}
          isLoading={catalogQuery.isLoading}
          error={catalogQuery.isError ? catalogQuery.error : null}
          renderRowActions={(i) => (
            <div className="flex items-center justify-end gap-2">
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
              <button
                type="button"
                disabled={importMutation.isPending}
                onClick={() => importMutation.mutate({ itemId: i.id, quantity: importQuantities[i.id] ?? 1 })}
                className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1 text-xs"
              >
                {t('items.list.importToStash')}
              </button>
            </div>
          )}
        />
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
