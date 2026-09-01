// Search/filter/list half of the item catalog — extracted from
// ItemRepositoryPage.tsx so it can be reused by GlobalItemInventoryPage.tsx
// (the campaign-independent item list at /compendium/items) without
// duplicating the search/type/rarity filtering or table markup. The caller
// owns the actual GET /catalog/items query (its params differ: campaign
// stash browsing passes campaignId + the campaign's edition; the global
// compendium view passes neither) and supplies per-row actions via
// `renderRowActions` (import-to-stash quantity+button for the campaign
// stash; nothing, or an edit link, for the compendium view) — this
// component only owns the browse UI itself.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ItemCatalogEntry, ItemRarity, ItemType } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

export const RARITY_COLOR: Record<ItemRarity, string> = {
  mundane: 'text-stone-500',
  common: 'text-stone-300',
  uncommon: 'text-emerald-400',
  rare: 'text-sky-400',
  very_rare: 'text-violet-400',
  legendary: 'text-amber-400',
  artifact: 'text-red-400',
};

const ITEM_TYPES: ItemType[] = ['weapon', 'armor', 'shield', 'tool', 'adventuring_gear', 'magic_item', 'consumable', 'mount', 'vehicle', 'trinket'];
const ITEM_RARITIES: ItemRarity[] = ['mundane', 'common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact'];

export function ItemCatalogBrowser({
  items,
  isLoading,
  error,
  renderRowActions,
}: {
  items: ItemCatalogEntry[];
  isLoading: boolean;
  error: unknown;
  renderRowActions?: (item: ItemCatalogEntry) => ReactNode;
}) {
  const { t } = useLocale();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');

  const filtered = items.filter(
    (i) =>
      (!search || i.name.toLowerCase().includes(search.toLowerCase())) &&
      (!typeFilter || i.item_type === typeFilter) &&
      (!rarityFilter || i.rarity === rarityFilter),
  );

  return (
    <div>
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

      {isLoading && <Loading />}
      {error !== undefined && error !== null && <ErrorBanner message={errorMessage(error)} />}

      <div className="overflow-x-auto rounded-lg border border-stone-800">
        <table className="w-full text-sm">
          <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">{t('items.list.colName')}</th>
              <th className="text-left px-3 py-2">{t('items.list.colType')}</th>
              <th className="text-left px-3 py-2">{t('items.list.colRarity')}</th>
              {renderRowActions && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
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
                {renderRowActions && <td className="px-3 py-2 text-right">{renderRowActions(i)}</td>}
              </tr>
            ))}
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={renderRowActions ? 4 : 3}>
                  <EmptyState message={t('items.list.noMatches')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
