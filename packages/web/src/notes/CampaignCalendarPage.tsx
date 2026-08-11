import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignEvent } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Field, Input, Textarea } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { useFormDraft } from '../lib/useFormDraft';
import { useLocale } from '../i18n/LocaleContext';

interface EventFormValues {
  inGameDay: string;
  title: string;
  description: string;
}

function emptyEventForm(): EventFormValues {
  return { inGameDay: '', title: '', description: '' };
}

/**
 * Phase 3 "campaign calendar" — a DM-entered, manual timeline of in-world
 * events, anchored to in_game_day (days since an arbitrary campaign epoch,
 * not a real date — see CampaignEvent's own comment in lib/types.ts). No
 * auto-advance: the DM logs events as they happen at the table. All-member
 * read, DM-only write — same baseline as locations/plot threads' own
 * content once shared.
 */
export function CampaignCalendarPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const isDm = role === 'dm';
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CampaignEvent | null>(null);

  const eventsQuery = useQuery({
    queryKey: ['campaignEvents', campaignId],
    queryFn: () => api.get<{ events: CampaignEvent[] }>(`/campaigns/${campaignId}/events`),
  });
  const events = eventsQuery.data?.events ?? [];

  const [form, setForm, clearDraft] = useFormDraft(`draft:campaignEvent:new:${campaignId}`, emptyEventForm);

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ event: CampaignEvent }>(`/campaigns/${campaignId}/events`, {
        inGameDay: Number(form.inGameDay),
        title: form.title,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      setForm(emptyEventForm());
      clearDraft();
      setShowCreate(false);
      void queryClient.invalidateQueries({ queryKey: ['campaignEvents', campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) => api.delete(`/campaigns/${campaignId}/events/${eventId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['campaignEvents', campaignId] }),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || form.inGameDay.trim() === '') return;
    createMutation.mutate();
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('campaignCalendar.title')}</h2>
        {isDm && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? t('campaignCalendar.cancel') : t('campaignCalendar.newEvent')}
          </Button>
        )}
      </div>

      {isDm && showCreate && (
        <Card as="form" onSubmit={handleCreate} className="mb-6 gap-4">
          <Field label={t('campaignCalendar.dayLabel')} htmlFor="eventDay">
            <Input
              id="eventDay"
              type="number"
              required
              value={form.inGameDay}
              onChange={(e) => setForm((f) => ({ ...f, inGameDay: e.target.value }))}
            />
          </Field>
          <Field label={t('campaignCalendar.titleLabel')} htmlFor="eventTitle">
            <Input id="eventTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label={t('campaignCalendar.descriptionLabel')} htmlFor="eventDescription">
            <Textarea
              id="eventDescription"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
          <Button type="submit" variant="primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? t('campaignCalendar.saving') : t('campaignCalendar.saveEvent')}
          </Button>
        </Card>
      )}

      {eventsQuery.isLoading && <Loading />}
      {eventsQuery.isError && <ErrorBanner message={errorMessage(eventsQuery.error)} />}
      {eventsQuery.data && events.length === 0 && <EmptyState message={t('campaignCalendar.noEvents')} />}
      {deleteMutation.isError && <ErrorBanner message={errorMessage(deleteMutation.error)} />}

      <ul className="space-y-3">
        {events.map((event) => (
          <li key={event.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-stone-100">
                  <span className="text-amber-500">{t('campaignCalendar.dayTag', { day: event.in_game_day })}</span> {event.title}
                </h3>
                {isDm && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingEvent(event)}
                      className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                    >
                      {t('campaignCalendar.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('campaignCalendar.deleteConfirm', { title: event.title }))) deleteMutation.mutate(event.id);
                      }}
                      className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                    >
                      {t('campaignCalendar.delete')}
                    </button>
                  </div>
                )}
              </div>
              {event.description && <p className="text-sm text-stone-300 whitespace-pre-wrap">{event.description}</p>}
            </Card>
          </li>
        ))}
      </ul>

      <CampaignEventEditModal campaignId={campaignId} event={editingEvent} onClose={() => setEditingEvent(null)} />
    </div>
  );
}

function CampaignEventEditModal({
  campaignId,
  event,
  onClose,
}: {
  campaignId: string;
  event: CampaignEvent | null;
  onClose: () => void;
}) {
  if (event === null) return null;
  return <CampaignEventEditForm campaignId={campaignId} event={event} onClose={onClose} />;
}

function CampaignEventEditForm({ campaignId, event, onClose }: { campaignId: string; event: CampaignEvent; onClose: () => void }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const draftKey = `draft:campaignEvent:edit:${event.id}`;
  const [form, setForm, clearDraft] = useFormDraft<EventFormValues>(draftKey, () => ({
    inGameDay: String(event.in_game_day),
    title: event.title,
    description: event.description ?? '',
  }));

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<{ event: CampaignEvent }>(`/campaigns/${campaignId}/events/${event.id}`, {
        inGameDay: Number(form.inGameDay),
        title: form.title,
        description: form.description || null,
      }),
    onSuccess: () => {
      clearDraft();
      void queryClient.invalidateQueries({ queryKey: ['campaignEvents', campaignId] });
      onClose();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || form.inGameDay.trim() === '') return;
    updateMutation.mutate();
  }

  return (
    <Modal open onClose={onClose} title={t('campaignCalendar.editModalTitle')}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label={t('campaignCalendar.dayLabel')} htmlFor="eventEditDay">
          <Input
            id="eventEditDay"
            type="number"
            required
            value={form.inGameDay}
            onChange={(e) => setForm((f) => ({ ...f, inGameDay: e.target.value }))}
          />
        </Field>
        <Field label={t('campaignCalendar.titleLabel')} htmlFor="eventEditTitle">
          <Input id="eventEditTitle" required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('campaignCalendar.descriptionLabel')} htmlFor="eventEditDescription">
          <Textarea
            id="eventEditDescription"
            rows={4}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>
        {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? t('campaignCalendar.saving') : t('campaignCalendar.saveChanges')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('campaignCalendar.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
