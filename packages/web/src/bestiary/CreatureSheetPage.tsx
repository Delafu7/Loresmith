// Individual creature sheet, own route (REFACTOR-PLAN.md §1: /creature/:id).
// Read-only reference material — this is the route linked from a live
// session's participant rows, deliberately never embedding edit affordances
// (editing a homebrew creature stays in its own campaign's Bestiary tab /
// CreatureEditorPage, which is DM-authoring context, not reference lookup).

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { MonsterCatalogEntry } from '../lib/types';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { Portrait } from '../components/Portrait';
import { StatBlock } from '../components/StatBlock';
import { isUuid } from '../lib/ids';

export function CreatureSheetPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';

  const monsterQuery = useQuery({
    queryKey: ['catalog', 'monster', id],
    queryFn: () => api.get<{ monster: MonsterCatalogEntry }>(`/catalog/monsters/${id}`),
    enabled: isUuid(id),
  });

  return (
    <div className="min-h-dvh bg-stone-950 text-stone-100">
      <header className="border-b border-stone-800 px-4 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <Link to="/bestiary/basic" className="text-xs text-stone-500 hover:text-stone-300">
          ← Bestiary
        </Link>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5 sm:py-8">
        {monsterQuery.isLoading && <Loading />}
        {monsterQuery.isError && <ErrorBanner message={errorMessage(monsterQuery.error)} />}
        {monsterQuery.data && (
          <>
            <div className="flex items-center gap-4">
              <Portrait
                fileUrl={monsterQuery.data.monster.image_url}
                alt={monsterQuery.data.monster.name}
                size="xl"
                placeholderLabel={monsterQuery.data.monster.name}
              />
              <div>
                <h1 className="font-display text-2xl font-medium">{monsterQuery.data.monster.name}</h1>
                <p className="text-sm text-stone-500">
                  {monsterQuery.data.monster.size} {monsterQuery.data.monster.creature_type}
                  {monsterQuery.data.monster.alignment ? `, ${monsterQuery.data.monster.alignment}` : ''}
                </p>
              </div>
            </div>
            <StatBlock monster={monsterQuery.data.monster} />
          </>
        )}
      </main>
    </div>
  );
}
