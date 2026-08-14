import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import type { LairActionAvailableEvent } from '../lib/socketTypes';
import { useSocket } from '../lib/SocketContext';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

/**
 * Phase 2 "lair actions (round-start trigger)" — DM-only prep editor. A
 * lair belongs to the place/scene this encounter represents, not to any one
 * monster's catalog row (services/encounters.ts's updateEncounter, PATCH
 * /campaigns/:id/encounters/:encounterId). Free-text name/description pairs,
 * same shape as a monster's own stat-block entries.
 */
export function LairActionsEditor({ campaignId, encounter }: { campaignId: string; encounter: Encounter }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState(encounter.lair_actions ?? []);
  const [open, setOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (lairActions: Array<{ name: string; description: string }> | null) =>
      api.patch<{ encounter: Encounter }>(`/campaigns/${campaignId}/encounters/${encounter.id}`, { lairActions }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounter.id] });
    },
  });

  function addEntry() {
    setEntries((prev) => [...prev, { name: '', description: '' }]);
  }
  function updateEntry(i: number, patch: Partial<{ name: string; description: string }>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function removeEntry(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }
  function save() {
    const cleaned = entries.filter((e) => e.name.trim() !== '' && e.description.trim() !== '');
    saveMutation.mutate(cleaned.length > 0 ? cleaned : null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-stone-400 hover:text-amber-400 underline decoration-dotted"
      >
        {t('encounters.lairActions.editButton', { count: encounter.lair_actions?.length ?? 0 })}
      </button>
    );
  }

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950 p-3 space-y-2">
      <h4 className="text-xs uppercase text-stone-500">{t('encounters.lairActions.title')}</h4>
      {entries.map((entry, i) => (
        <div key={i} className="space-y-1 border-b border-stone-800 pb-2 last:border-0">
          <input
            type="text"
            value={entry.name}
            onChange={(e) => updateEntry(i, { name: e.target.value })}
            placeholder={t('encounters.lairActions.nameLabel')}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
          />
          <textarea
            rows={2}
            value={entry.description}
            onChange={(e) => updateEntry(i, { description: e.target.value })}
            placeholder={t('encounters.lairActions.descriptionLabel')}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
          />
          <button type="button" onClick={() => removeEntry(i)} className="text-[10px] text-red-400 hover:text-red-300">
            {t('encounters.lairActions.removeEntry')}
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={addEntry} className="text-xs text-stone-400 hover:text-amber-400">
          {t('encounters.lairActions.addEntry')}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={save}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 px-2 py-1 text-xs font-medium disabled:opacity-50"
        >
          {saveMutation.isPending ? t('encounters.lairActions.saving') : t('encounters.lairActions.save')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-stone-500 hover:text-stone-300">
          {t('common.close')}
        </button>
      </div>
      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}
    </div>
  );
}

/**
 * Phase 3 "terrain/complications on encounters" — unlike LairActionsEditor
 * above, this is visible to every campaign member (see the migration's own
 * comment on why: difficult terrain/hazards are things players can see and
 * react to, not a DM secret). DM gets an editable blur-to-save textarea
 * (same idiom as CharacterSheetPage.tsx's gmNotes field); a player gets a
 * plain read-only block, and nothing at all when it's empty.
 */
export function TerrainNotesPanel({ campaignId, encounter, isDm }: { campaignId: string; encounter: Encounter; isDm: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(encounter.terrain_notes ?? '');

  const saveMutation = useMutation({
    mutationFn: (terrainNotes: string) =>
      api.patch<{ encounter: Encounter }>(`/campaigns/${campaignId}/encounters/${encounter.id}`, { terrainNotes: terrainNotes || null }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounter.id] });
    },
  });

  if (!isDm) {
    if (!encounter.terrain_notes) return null;
    return (
      <div className="rounded-md border border-stone-800 bg-stone-950 p-3 text-sm">
        <h4 className="text-xs uppercase text-stone-500 mb-1">{t('encounters.terrainNotes.title')}</h4>
        <p className="text-stone-300 whitespace-pre-wrap">{encounter.terrain_notes}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950 p-3 space-y-1">
      <h4 className="text-xs uppercase text-stone-500">{t('encounters.terrainNotes.title')}</h4>
      <textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== (encounter.terrain_notes ?? '')) saveMutation.mutate(draft);
        }}
        placeholder={t('encounters.terrainNotes.placeholder')}
        className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
      />
      {saveMutation.isError && <ErrorBanner message={errorMessage(saveMutation.error)} />}
    </div>
  );
}

interface Notice extends LairActionAvailableEvent {
  key: string;
}

/**
 * Room-wide (no DM/player split, see sockets/broadcast.ts's
 * broadcastLairActionAvailable) — a narratively-visible "the lair acts"
 * moment, same visual language as ConcentrationCheckPrompt.tsx's banner.
 */
export function LairActionBanner({ encounterId }: { encounterId: string }) {
  const { t } = useLocale();
  const { socket } = useSocket();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    function onLairAction(payload: LairActionAvailableEvent) {
      if (payload.encounterId !== encounterId) return;
      setNotices((prev) => [...prev, { ...payload, key: `${payload.currentRound}-${payload.serverTimestamp}` }]);
    }
    socket.on('LAIR_ACTION_AVAILABLE', onLairAction);
    return () => {
      socket.off('LAIR_ACTION_AVAILABLE', onLairAction);
    };
  }, [socket, encounterId]);

  if (notices.length === 0) return null;

  return (
    <div className="fixed top-14 left-1/2 z-50 w-[min(28rem,calc(100vw-1rem))] -translate-x-1/2 space-y-2">
      {notices.map((notice) => (
        <div key={notice.key} className="rounded-md border border-violet-600 bg-stone-900 p-3 text-sm shadow-lg">
          <p className="font-semibold text-violet-400">{t('encounters.lairActions.bannerTitle', { round: notice.currentRound })}</p>
          {(notice.lairActions ?? []).map((entry, i) => (
            <p key={i} className="text-stone-300">
              <span className="font-medium text-stone-100">{entry.name}:</span> {entry.description}
            </p>
          ))}
          <button
            type="button"
            onClick={() => setNotices((prev) => prev.filter((n) => n.key !== notice.key))}
            className="mt-2 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
          >
            {t('encounters.concentration.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
