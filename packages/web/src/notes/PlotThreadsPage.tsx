import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignMember, PlotThread } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatTimestamp } from '../lib/dates';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

interface ThreadFormValues {
  title: string;
  description: string;
}

function emptyThreadForm(): ThreadFormValues {
  return { title: '', description: '' };
}

// Staleness (Phase 3 "plot threads") is computed here on read, never
// stored server-side either (see the migration's own comment) — this is
// purely a display label, not a value anything else depends on.
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
}

/**
 * Phase 3 "plot threads" — a DM's running list of open story hooks.
 * Visibility is per-user (entity_visibility, Phase 1.3), not a plain
 * boolean: a thread can be shared with some players and not others. A
 * player only ever receives threads already shared with them (server-side
 * filter) and sees a read-only view; the DM gets full CRUD plus the sharing
 * checklist.
 */
export function PlotThreadsPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingThread, setEditingThread] = useState<PlotThread | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const threadsQuery = useQuery({
    queryKey: ['plotThreads', campaignId],
    queryFn: () => api.get<{ plotThreads: PlotThread[] }>(`/campaigns/${campaignId}/plot-threads`),
  });
  const threads = (threadsQuery.data?.plotThreads ?? []).filter((th) => showResolved || th.status === 'open');

  const membersQuery = useQuery({
    queryKey: ['campaign', campaignId, 'members'],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
    enabled: isDm,
  });
  const players = (membersQuery.data?.members ?? []).filter((m) => m.role !== 'dm');

  const [form, setForm, clearDraft] = useFormDraft(`draft:plotThread:new:${campaignId}`, emptyThreadForm);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ plotThread: PlotThread }>(`/campaigns/${campaignId}/plot-threads`, {
        title: form.title,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      setForm(emptyThreadForm());
      clearDraft();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['plotThreads', campaignId] });
    },
  });

  const touchMutation = useMutation({
    mutationFn: (threadId: string) => api.post<{ plotThread: PlotThread }>(`/campaigns/${campaignId}/plot-threads/${threadId}/touch`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plotThreads', campaignId] }),
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { threadId: string; status: 'open' | 'resolved' }) =>
      api.patch<{ plotThread: PlotThread }>(`/campaigns/${campaignId}/plot-threads/${vars.threadId}`, { status: vars.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plotThreads', campaignId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (threadId: string) => api.delete(`/campaigns/${campaignId}/plot-threads/${threadId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plotThreads', campaignId] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('plotThreads.title')}</h2>
        {isDm && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('plotThreads.cancel') : t('plotThreads.newThread')}
          </Button>
        )}
      </div>

      {isDm && showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label={t('plotThreads.titleLabel')} htmlFor="threadTitle">
            <Input id="threadTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label={t('plotThreads.descriptionLabel')} htmlFor="threadDescription">
            <Textarea
              id="threadDescription"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('plotThreads.saving') : t('plotThreads.saveThread')}
          </Button>
        </Card>
      )}

      <label className="flex items-center gap-1.5 text-xs text-stone-400 mb-4">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
        {t('plotThreads.showResolved')}
      </label>

      {threadsQuery.isLoading && <Loading />}
      {threadsQuery.isError && <ErrorBanner message={errorMessage(threadsQuery.error)} />}
      {threadsQuery.data && threads.length === 0 && <EmptyState message={t('plotThreads.noThreads')} />}

      {(touchMutation.isError || statusMutation.isError || deleteMutation.isError) && (
        <ErrorBanner message={errorMessage((touchMutation.error ?? statusMutation.error ?? deleteMutation.error) as unknown)} />
      )}

      <ul className="space-y-3">
        {threads.map((thread) => {
          const stale = daysSince(thread.last_touched_at);
          return (
            <li key={thread.id}>
              <Card>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-stone-100 flex items-center gap-2">
                    {thread.title}
                    {thread.status === 'resolved' && (
                      <span className="rounded-full border border-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                        {t('plotThreads.statusResolved')}
                      </span>
                    )}
                    {thread.status === 'open' && stale >= 14 && (
                      <span className="rounded-full border border-amber-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                        {t('plotThreads.staleTag', { days: stale })}
                      </span>
                    )}
                  </h3>
                  {isDm && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => touchMutation.mutate(thread.id)}
                        disabled={touchMutation.isPending}
                        className="min-h-11 px-1 text-stone-400 hover:text-stone-100 text-xs disabled:opacity-50"
                      >
                        {t('plotThreads.touch')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          statusMutation.mutate({ threadId: thread.id, status: thread.status === 'open' ? 'resolved' : 'open' })
                        }
                        disabled={statusMutation.isPending}
                        className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs disabled:opacity-50"
                      >
                        {thread.status === 'open' ? t('plotThreads.markResolved') : t('plotThreads.reopen')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingThread(thread)}
                        className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                      >
                        {t('plotThreads.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(t('plotThreads.deleteConfirm', { title: thread.title }))) deleteMutation.mutate(thread.id);
                        }}
                        className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                      >
                        {t('plotThreads.delete')}
                      </button>
                    </div>
                  )}
                </div>
                {thread.description && <p className="text-sm text-stone-300 whitespace-pre-wrap">{thread.description}</p>}
                {isDm && (
                  <p className="text-xs text-stone-500">
                    {thread.visibleToUserIds && thread.visibleToUserIds.length > 0
                      ? t('plotThreads.sharedWithCount', { count: thread.visibleToUserIds.length })
                      : t('plotThreads.dmOnly')}
                  </p>
                )}
                <p className="text-xs text-stone-500">
                  {t('plotThreads.lastTouched', { date: formatTimestamp(thread.last_touched_at) })}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>

      <PlotThreadEditModal campaignId={campaignId} thread={editingThread} players={players} onClose={() => setEditingThread(null)} />
    </div>
  );
}

function PlotThreadEditModal({
  campaignId,
  thread,
  players,
  onClose,
}: {
  campaignId: string;
  thread: PlotThread | null;
  players: CampaignMember[];
  onClose: () => void;
}) {
  if (thread === null) return null;
  return <PlotThreadEditForm campaignId={campaignId} thread={thread} players={players} onClose={onClose} />;
}

function PlotThreadEditForm({
  campaignId,
  thread,
  players,
  onClose,
}: {
  campaignId: string;
  thread: PlotThread;
  players: CampaignMember[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const draftKey = `draft:plotThread:edit:${thread.id}`;
  const [form, setForm, clearDraft] = useFormDraft<ThreadFormValues>(draftKey, () => ({
    title: thread.title,
    description: thread.description ?? '',
  }));
  const [visibleUserIds, setVisibleUserIds] = useState<string[]>(thread.visibleToUserIds ?? []);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<{ plotThread: PlotThread }>(`/campaigns/${campaignId}/plot-threads/${thread.id}`, {
        title: form.title,
        description: form.description || null,
      }),
  });

  const visibilityMutation = useMutation({
    mutationFn: (userIds: string[]) => api.put(`/campaigns/${campaignId}/plot-threads/${thread.id}/visibility`, { userIds }),
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    await Promise.all([updateMutation.mutateAsync(), visibilityMutation.mutateAsync(visibleUserIds)]);
    clearDraft();
    void queryClient.invalidateQueries({ queryKey: ['plotThreads', campaignId] });
    onClose();
  }

  function toggleUser(userId: string) {
    setVisibleUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  return (
    <Modal open onClose={onClose} title={t('plotThreads.editModalTitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('plotThreads.titleLabel')} htmlFor="threadEditTitle">
          <Input id="threadEditTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('plotThreads.descriptionLabel')} htmlFor="threadEditDescription">
          <Textarea
            id="threadEditDescription"
            rows={4}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        <Field label={t('plotThreads.sharedWithLabel')} htmlFor="threadEditVisibility">
          {players.length === 0 ? (
            <p className="text-xs text-stone-500">{t('plotThreads.noPlayers')}</p>
          ) : (
            <div id="threadEditVisibility" className="space-y-1">
              {players.map((p) => (
                <label key={p.user_id} className="flex items-center gap-2 text-sm text-stone-300">
                  <input type="checkbox" checked={visibleUserIds.includes(p.user_id)} onChange={() => toggleUser(p.user_id)} />
                  {p.display_name}
                </label>
              ))}
            </div>
          )}
        </Field>
        {(updateMutation.isError || visibilityMutation.isError) && (
          <ErrorBanner message={errorMessage((updateMutation.error ?? visibilityMutation.error) as unknown)} />
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending || visibilityMutation.isPending}>
            {updateMutation.isPending || visibilityMutation.isPending ? t('plotThreads.saving') : t('plotThreads.saveChanges')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('plotThreads.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
