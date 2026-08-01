import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { CombatTracker } from './CombatTracker';
import { useBreadcrumb } from '../components/layout/BreadcrumbContext';

const STATUS_ORDER: Record<Encounter['status'], number> = { active: 0, paused: 1, preparing: 2, completed: 3 };

// Reduced from a multi-tab workspace to a list + single selection: once an
// encounter goes active, useLiveMapAutoOpen (CampaignShell) already pushes
// everyone — DM included — into the fullscreen live map, so this page only
// ever needs to render one encounter's prep-mode CombatTracker at a time,
// not several concurrently-mounted ones. See DESIGN_AUDIT.md / the approved
// plan for why: design/nocturne.html has no multi-encounter workspace at
// all, only a passive "next session" pointer (now CampaignDashboardPage).
export function EncountersPage() {
  const { campaignId, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ encounter: Encounter }>(`/campaigns/${campaignId}/encounters`, { name }),
    onSuccess: (data) => {
      setName('');
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['encounters', campaignId] });
      setSelectedId(data.encounter.id);
    },
  });

  const sorted = useMemo(
    () => [...(encountersQuery.data?.encounters ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [encountersQuery.data],
  );

  const encountersById = new Map(sorted.map((e) => [e.id, e]));
  const selectedEncounter = selectedId ? encountersById.get(selectedId) : undefined;
  useBreadcrumb(2, selectedEncounter ? [{ label: selectedEncounter.name }] : []);

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
                  onClick={() => setSelectedId(enc.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                    enc.id === selectedId ? 'bg-amber-950 text-amber-400 font-medium' : 'bg-stone-900 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{enc.name}</span>
                    <StatusBadge status={enc.status} active={enc.id === selectedId} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0">
          {selectedEncounter ? <CombatTracker encounter={selectedEncounter} /> : <EmptyState message={t('encounters.page.selectOrCreate')} />}
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
