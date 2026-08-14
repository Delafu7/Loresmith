// Campaign-independent item browser at /compendium/items — global SRD items
// union'd with the caller's own personal-compendium items (server-side
// owning_user_id union, services/catalog.ts's listItems), no campaignId in
// the query at all. Read/browse only: creating or editing an item definition
// happens on the compendium's generic entity editor
// (compendium/CompendiumEditorPage.tsx, "Items" segment) — this page is the
// "everything I could put in a campaign" inventory view the plan calls for,
// mirroring ItemRepositoryPage.tsx's browse half via the same
// ItemCatalogBrowser, without any campaign-stash import/give actions.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ItemCatalogEntry } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';
import { ItemCatalogBrowser } from './ItemCatalogBrowser';

export function GlobalItemInventoryPage() {
  const { t } = useLocale();

  const catalogQuery = useQuery({
    queryKey: ['catalog', 'items', 'compendium'],
    queryFn: () => api.get<{ items: ItemCatalogEntry[] }>('/catalog/items?edition=both'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{t('items.list.heading')}</h2>
        <Link to="/compendium" className="text-xs text-amber-500 hover:text-amber-400 underline">
          {t('items.list.manageCatalogLink')}
        </Link>
      </div>

      <ItemCatalogBrowser
        items={catalogQuery.data?.items ?? []}
        isLoading={catalogQuery.isLoading}
        error={catalogQuery.isError ? catalogQuery.error : null}
      />
    </div>
  );
}
