// Session log — a DM's per-session recap (session number, title, date
// played, recap text). NOT the live combat/encounters "Session" view
// (EncountersPage, route `session`) — see CampaignShell.tsx's nav item
// comment. Full CRUD already exists server-side (routes/campaigns.ts's
// /:id/sessions...); this page is the only web UI for it.

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { SessionLog } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { formatTimestamp } from '../lib/dates';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

interface SessionLogFormValues {
  sessionNumber: string; // kept as a string for a controlled number input; parsed on submit
  title: string;
  playedAt: string;
  recap: string;
}

function emptySessionLogForm(): SessionLogFormValues {
  return { sessionNumber: '', title: '', playedAt: '', recap: '' };
}

// z.string().date().optional().nullable() (and the same for title/recap)
// rejects an empty string but accepts null — an empty form field should
// clear the value, not fail validation.
function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}

export function SessionLogPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingSession, setEditingSession] = useState<SessionLog | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['session-log', campaignId],
    queryFn: () => api.get<{ sessions: SessionLog[] }>(`/campaigns/${campaignId}/sessions`),
  });

  // Draft-persisted create form (see lib/useFormDraft.ts) so a half-written
  // entry survives an accidental navigation away.
  const [form, setForm, clearDraft] = useFormDraft(`draft:sessionLog:new:${campaignId}`, emptySessionLogForm);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ session: SessionLog }>(`/campaigns/${campaignId}/sessions`, {
        sessionNumber: Number(form.sessionNumber),
        title: emptyToNull(form.title),
        playedAt: emptyToNull(form.playedAt),
        recap: emptyToNull(form.recap),
      }),
    onSuccess: () => {
      setForm(emptySessionLogForm());
      clearDraft();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['session-log', campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => api.delete(`/campaigns/${campaignId}/sessions/${sessionId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['session-log', campaignId] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const num = Number(form.sessionNumber);
    if (!Number.isInteger(num) || num <= 0) return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('sessionLog.title')}</h2>
        {isDm && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('sessionLog.cancel') : t('sessionLog.newEntry')}
          </Button>
        )}
      </div>

      {isDm && showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label={t('sessionLog.sessionNumberLabel')} htmlFor="sessionLogNumber">
            <Input
              id="sessionLogNumber"
              type="number"
              min={1}
              step={1}
              required
              value={form.sessionNumber}
              onChange={(e) => setForm((f) => ({ ...f, sessionNumber: e.target.value }))}
            />
          </Field>
          <Field label={t('sessionLog.titleLabel')} htmlFor="sessionLogTitle">
            <Input id="sessionLogTitle" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label={t('sessionLog.datePlayedLabel')} htmlFor="sessionLogPlayedAt">
            <Input
              id="sessionLogPlayedAt"
              type="date"
              value={form.playedAt}
              onChange={(e) => setForm((f) => ({ ...f, playedAt: e.target.value }))}
            />
          </Field>
          <Field label={t('sessionLog.recapLabel')} htmlFor="sessionLogRecap">
            <Textarea id="sessionLogRecap" rows={5} value={form.recap} onChange={(e) => setForm((f) => ({ ...f, recap: e.target.value }))} />
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('sessionLog.saving') : t('sessionLog.saveEntry')}
          </Button>
        </Card>
      )}

      {sessionsQuery.isLoading && <Loading />}
      {sessionsQuery.isError && <ErrorBanner message={errorMessage(sessionsQuery.error)} />}
      {sessionsQuery.data && sessionsQuery.data.sessions.length === 0 && <EmptyState message={t('sessionLog.noEntries')} />}

      {deleteMutation.isError && <ErrorBanner message={errorMessage(deleteMutation.error)} />}

      <ul className="space-y-3">
        {/* Server already orders by session_number ASC — render as returned, don't re-sort. */}
        {sessionsQuery.data?.sessions.map((session) => (
          <li key={session.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-stone-100">
                  {t('sessionLog.session', { number: session.session_number })}
                  {session.title ? ` — ${session.title}` : ''}
                </h3>
                {isDm && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingSession(session)}
                      className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                    >
                      {t('sessionLog.edit')}
                    </button>
                    <button
                      type="button"
                      // UX finding #9 (Iteration 3 audit) + this app's
                      // confirm/undo rule (see BattleModeDmPanel.tsx's
                      // remove-participant comment for the fuller version):
                      // deleting a full session recap is irreversible and
                      // was missing both a confirm and a pending guard,
                      // unlike every sibling delete in this app.
                      onClick={() => {
                        if (window.confirm(t('sessionLog.deleteConfirm', { number: session.session_number }))) {
                          deleteMutation.mutate(session.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                    >
                      {t('sessionLog.delete')}
                    </button>
                  </div>
                )}
              </div>
              {session.played_at && <p className="text-xs text-stone-500">{t('sessionLog.played', { date: session.played_at })}</p>}
              {session.recap && <p className="text-sm text-stone-300 whitespace-pre-wrap">{session.recap}</p>}
              <p className="text-xs text-stone-500">
                {t('sessionLog.createdUpdated', { created: formatTimestamp(session.created_at), updated: formatTimestamp(session.updated_at) })}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <SessionLogEditModal campaignId={campaignId} session={editingSession} onClose={() => setEditingSession(null)} />
    </div>
  );
}

// Session-log-only edit modal (Modal + PATCH-on-submit), same split as
// NotesPage.tsx's NoteEditModal/NoteEditForm — a hook-free wrapper that
// returns null when nothing is being edited, plus an inner form component
// that only mounts once a real row is being edited (so it doesn't keep a
// stale draft key/values around after `session` changes underneath it).
function SessionLogEditModal({
  campaignId,
  session,
  onClose,
}: {
  campaignId: string;
  session: SessionLog | null;
  onClose: () => void;
}) {
  if (session === null) return null;
  return <SessionLogEditForm campaignId={campaignId} session={session} onClose={onClose} />;
}

function SessionLogEditForm({ campaignId, session, onClose }: { campaignId: string; session: SessionLog; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  // Draft-persisted per session id (see lib/useFormDraft.ts). `session` is
  // already-loaded data handed in synchronously when the modal opens, so
  // useFormDraft's own lazy initializer (only runs when no draft exists yet)
  // gives the "resumed draft wins, otherwise hydrate from the session" split
  // for free — same reasoning as NoteEditForm.
  const draftKey = `draft:sessionLog:edit:${session.id}`;
  const [form, setForm, clearDraft] = useFormDraft<SessionLogFormValues>(draftKey, () => ({
    sessionNumber: String(session.session_number),
    title: session.title ?? '',
    playedAt: session.played_at ?? '',
    recap: session.recap ?? '',
  }));

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<{ session: SessionLog }>(`/campaigns/${campaignId}/sessions/${session.id}`, {
        sessionNumber: Number(form.sessionNumber),
        title: emptyToNull(form.title),
        playedAt: emptyToNull(form.playedAt),
        recap: emptyToNull(form.recap),
      }),
    onSuccess: () => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ['session-log', campaignId] });
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const num = Number(form.sessionNumber);
    if (!Number.isInteger(num) || num <= 0) return;
    updateMutation.mutate();
  }

  return (
    <Modal open onClose={onClose} title={t('sessionLog.editModalTitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('sessionLog.sessionNumberLabel')} htmlFor="sessionLogEditNumber">
          <Input
            id="sessionLogEditNumber"
            type="number"
            min={1}
            step={1}
            required
            value={form.sessionNumber}
            onChange={(e) => setForm((f) => ({ ...f, sessionNumber: e.target.value }))}
          />
        </Field>
        <Field label={t('sessionLog.titleLabel')} htmlFor="sessionLogEditTitle">
          <Input id="sessionLogEditTitle" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('sessionLog.datePlayedLabel')} htmlFor="sessionLogEditPlayedAt">
          <Input
            id="sessionLogEditPlayedAt"
            type="date"
            value={form.playedAt}
            onChange={(e) => setForm((f) => ({ ...f, playedAt: e.target.value }))}
          />
        </Field>
        <Field label={t('sessionLog.recapLabel')} htmlFor="sessionLogEditRecap">
          <Textarea
            id="sessionLogEditRecap"
            rows={5}
            value={form.recap}
            onChange={(e) => setForm((f) => ({ ...f, recap: e.target.value }))}
          />
        </Field>
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('sessionLog.saving') : t('sessionLog.saveChanges')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('sessionLog.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
