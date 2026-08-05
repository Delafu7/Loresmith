// Encounter-level disposition (friendly/neutral/hostile/unknown) — distinct
// from a participant's faction (board-coloring). Three pieces:
// - DispositionBadge: read-only, shown to everyone at all times (sticky top
//   bar, same visibility as the initiative strip).
// - DispositionControl: DM-only transition form (rendered inside
//   BattleModeDmPanel, already gated to isDm).
// - DispositionHistoryPanel: self-contained fetch + DISPOSITION_CHANGED
//   socket subscription, same shape as CombatLogPanel.tsx (membership-gated
//   route, not DM-only — players see why the mood changed too).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { EncounterDisposition, EncounterDispositionEvent } from '../lib/types';
import type { DispositionChangedEvent } from '../lib/socketTypes';
import { useSocket } from '../lib/SocketContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

const DISPOSITION_LABEL_KEYS: Record<EncounterDisposition, TranslationKey> = {
  friendly: 'encounters.disposition.friendly',
  neutral: 'encounters.disposition.neutral',
  hostile: 'encounters.disposition.hostile',
  unknown: 'encounters.disposition.unknown',
};

const DISPOSITION_BADGE_STYLES: Record<EncounterDisposition, string> = {
  friendly: 'bg-emerald-950 text-emerald-400 border-emerald-800',
  neutral: 'bg-stone-900 text-stone-400 border-stone-700',
  hostile: 'bg-red-950 text-red-400 border-red-800',
  unknown: 'bg-indigo-950 text-indigo-400 border-indigo-800',
};

const ALL_DISPOSITIONS: EncounterDisposition[] = ['friendly', 'neutral', 'hostile', 'unknown'];

export function DispositionBadge({ disposition }: { disposition: EncounterDisposition }) {
  const { t } = useLocale();
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${DISPOSITION_BADGE_STYLES[disposition]}`}
    >
      {t(DISPOSITION_LABEL_KEYS[disposition])}
    </span>
  );
}

export interface DispositionControlProps {
  disposition: EncounterDisposition;
  pending: boolean;
  onTransition: (toDisposition: EncounterDisposition, note?: string) => void;
}

export function DispositionControl({ disposition, pending, onTransition }: DispositionControlProps) {
  const { t } = useLocale();
  const [note, setNote] = useState('');

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950 p-2 flex flex-wrap items-end gap-2">
      <div>
        <span className="block text-[10px] text-stone-500 mb-0.5">{t('encounters.disposition.label')}</span>
        <div className="flex flex-wrap gap-1">
          {ALL_DISPOSITIONS.map((d) => (
            <button
              key={d}
              type="button"
              disabled={pending || d === disposition}
              onClick={() => {
                onTransition(d, note.trim() === '' ? undefined : note.trim());
                setNote('');
              }}
              title={t('encounters.disposition.transitionTo', { disposition: t(DISPOSITION_LABEL_KEYS[d]) })}
              className={`rounded-md border px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                d === disposition
                  ? DISPOSITION_BADGE_STYLES[d]
                  : 'border-stone-700 text-stone-300 hover:bg-stone-800'
              }`}
            >
              {t(DISPOSITION_LABEL_KEYS[d])}
            </button>
          ))}
        </div>
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('encounters.disposition.notePlaceholder')}
        maxLength={500}
        className="min-w-[12rem] flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
      />
      {pending && <span className="text-[10px] text-stone-500">{t('encounters.disposition.transitioning')}</span>}
    </div>
  );
}

export function DispositionHistoryPanel({ encounterId }: { encounterId: string }) {
  const { t } = useLocale();
  const { socket } = useSocket();
  const [liveEvents, setLiveEvents] = useState<EncounterDispositionEvent[]>([]);

  const query = useQuery({
    queryKey: ['dispositionEvents', encounterId],
    queryFn: () => api.get<{ events: EncounterDispositionEvent[] }>(`/encounters/${encounterId}/disposition/events`),
  });

  useEffect(() => {
    function onDispositionChanged(payload: DispositionChangedEvent) {
      if (payload.encounterId !== encounterId) return;
      setLiveEvents((prev) => {
        if (prev.some((e) => e.id === payload.event.id)) return prev;
        return [
          {
            id: payload.event.id,
            encounter_id: encounterId,
            from_disposition: payload.event.fromDisposition,
            to_disposition: payload.event.toDisposition,
            changed_by_user_id: payload.event.changedByUserId,
            note: payload.event.note,
            created_at: payload.event.createdAt,
          },
          ...prev,
        ];
      });
    }
    socket.on('DISPOSITION_CHANGED', onDispositionChanged);
    return () => {
      socket.off('DISPOSITION_CHANGED', onDispositionChanged);
    };
  }, [socket, encounterId]);

  const historyEvents = query.data?.events ?? [];
  const seenIds = new Set(liveEvents.map((e) => e.id));
  const events = [...liveEvents, ...historyEvents.filter((e) => !seenIds.has(e.id))];

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-stone-500">{t('encounters.disposition.historyTitle')}</h3>
      {query.isLoading && <Loading label={t('encounters.disposition.loading')} />}
      {query.isError && <ErrorBanner message={errorMessage(query.error)} />}
      {!query.isLoading && events.length === 0 && <EmptyState message={t('encounters.disposition.historyEmpty')} />}
      <ol className="space-y-1.5">
        {events.map((event) => (
          <li key={event.id} className="rounded-md border border-stone-800 bg-stone-900 px-2.5 py-1.5 text-xs text-stone-300">
            <span className="font-medium text-stone-100">
              {t('encounters.disposition.historyLine', {
                from: t(DISPOSITION_LABEL_KEYS[event.from_disposition]),
                to: t(DISPOSITION_LABEL_KEYS[event.to_disposition]),
              })}
            </span>
            {event.note && <span className="text-stone-400"> — {event.note}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
