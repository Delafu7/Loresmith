import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { CombatTracker } from './CombatTracker';

const STATUS_ORDER: Record<Encounter['status'], number> = { active: 0, paused: 1, preparing: 2, completed: 3 };

export function EncountersPage() {
  const { campaignId, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const autoOpened = useRef(false);

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  function openEncounter(id: string) {
    setOpenTabIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setActiveTabId(id);
  }

  function closeTab(id: string) {
    setOpenTabIds((ids) => {
      const next = ids.filter((i) => i !== id);
      setActiveTabId((current) => (current === id ? (next[0] ?? null) : current));
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: () => api.post<{ encounter: Encounter }>(`/campaigns/${campaignId}/encounters`, { name }),
    onSuccess: (data) => {
      setName('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['encounters', campaignId] });
      openEncounter(data.encounter.id);
    },
  });

  const sorted = useMemo(
    () => [...(encountersQuery.data?.encounters ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [encountersQuery.data],
  );

  // Auto-open the top-sorted encounter once on first load only — after that,
  // which tabs are open is entirely up to the user (this must NOT re-fire on
  // every refetch, or a closed tab would keep popping back open).
  useEffect(() => {
    if (autoOpened.current) return;
    if (sorted.length === 0) return;
    autoOpened.current = true;
    openEncounter(sorted[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  const encountersById = new Map(sorted.map((e) => [e.id, e]));

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-64 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{t('encounters.page.title')}</h2>
            {role === 'dm' && (
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="text-xs rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-2 py-1"
              >
                {showCreate ? t('common.cancel') : t('encounters.page.newButton')}
              </button>
            )}
          </div>

          {showCreate && (
            <form onSubmit={handleCreate} className="mb-3 space-y-2">
              <input
                required
                placeholder={t('encounters.page.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
              />
              {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
              >
                {t('common.create')}
              </button>
            </form>
          )}

          {encountersQuery.isLoading && <Loading />}
          {encountersQuery.isError && <ErrorBanner message={errorMessage(encountersQuery.error)} />}
          {sorted.length === 0 && !encountersQuery.isLoading && <EmptyState message={t('encounters.page.noEncountersYet')} />}

          <ul className="space-y-1">
            {sorted.map((enc) => (
              <li key={enc.id}>
                <button
                  type="button"
                  onClick={() => openEncounter(enc.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                    enc.id === activeTabId ? 'bg-amber-950 text-amber-400 font-medium' : 'bg-stone-900 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{enc.name}</span>
                    <StatusBadge status={enc.status} active={enc.id === activeTabId} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0">
          {/*
            EncounterTabStrip (PLAN.md §6.2/§8 Phase 2): each open tab's
            CombatTracker — and, inside it, useEncounterLive's socket
            room join — stays MOUNTED for as long as its tab stays open,
            regardless of which tab is currently visible. Hiding an inactive
            tab is done with CSS (`hidden`) rather than by not rendering it
            at all, which is what would tear the socket subscription down.
            This is what lets a DM run two genuinely concurrent encounters
            (e.g. a split party) and have both stay live at once.
          */}
          {openTabIds.length > 1 && (
            <div
              className="flex gap-1 border-b border-stone-800 mb-4 overflow-x-auto"
              role="tablist"
              aria-label={t('encounters.page.openEncountersTabs')}
            >
              {openTabIds.map((id) => {
                const enc = encountersById.get(id);
                if (!enc) return null;
                const isActive = id === activeTabId;
                return (
                  <div
                    key={id}
                    role="tab"
                    aria-selected={isActive}
                    className={`flex-shrink-0 flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm cursor-pointer select-none ${
                      isActive ? 'bg-stone-900 text-stone-100 border-x border-t border-stone-800' : 'text-stone-500 hover:text-stone-300'
                    }`}
                    onClick={() => setActiveTabId(id)}
                  >
                    <span className="truncate max-w-[10rem]">{enc.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(id);
                      }}
                      aria-label={t('encounters.page.closeTab', { name: enc.name })}
                      className="text-stone-600 hover:text-stone-300 leading-none"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {openTabIds.length === 0 ? (
            <EmptyState message={t('encounters.page.selectOrCreate')} />
          ) : (
            openTabIds.map((id) => {
              const enc = encountersById.get(id);
              if (!enc) return null;
              return (
                <div key={id} className={id === activeTabId ? '' : 'hidden'}>
                  <CombatTracker encounter={enc} />
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, active }: { status: Encounter['status']; active: boolean }) {
  const { t } = useLocale();
  return (
    <span
      className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
        active ? 'bg-stone-950/30 text-stone-950' : 'bg-stone-800 text-stone-400'
      }`}
    >
      {t(`encounters.status.${status}`)}
    </span>
  );
}
