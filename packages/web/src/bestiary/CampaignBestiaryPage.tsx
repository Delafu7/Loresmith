import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignBestiaryEntry } from '../lib/types';
import type { BestiaryUpdatedEvent } from '../lib/socketTypes';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useSocket } from '../lib/SocketContext';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button, ButtonLink } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input, Textarea } from '../components/ui/Field';
import { StatBlock } from '../components/StatBlock';
import { formatCrLabel } from './formatCr';

// Task 1: the curated per-campaign bestiary — distinct from
// /campaigns/:id/monsters (combat-spawn + homebrew-authoring workbench,
// unaffected by this page) and from /bestiary (the global catalog). See
// CampaignShell.tsx's nav item comment for the three-surface naming split.
export function CampaignBestiaryPage() {
  const { campaignId, role } = useCampaignShell();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const isDm = role === 'dm';
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryKey = ['campaignBestiary', campaignId];
  const entriesQuery = useQuery({
    queryKey,
    queryFn: () => api.get<{ entries: CampaignBestiaryEntry[] }>(`/campaigns/${campaignId}/bestiary`),
  });

  // A remote DM edit (or another of the DM's own tabs) should refresh this
  // list live, same "bare invalidation signal" contract as the server's
  // BESTIARY_UPDATED emit — see sockets/broadcast.ts's header comment there.
  useEffect(() => {
    function onUpdated(payload: BestiaryUpdatedEvent) {
      if (payload.campaignId !== campaignId) return;
      void queryClient.invalidateQueries({ queryKey: ['campaignBestiary', campaignId] });
    }
    socket.on('BESTIARY_UPDATED', onUpdated);
    return () => {
      socket.off('BESTIARY_UPDATED', onUpdated);
    };
  }, [socket, campaignId, queryClient]);

  const updateMutation = useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: Record<string, unknown> }) =>
      api.patch<{ entry: CampaignBestiaryEntry }>(`/campaigns/${campaignId}/bestiary/${entryId}`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => api.delete<void>(`/campaigns/${campaignId}/bestiary/${entryId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const attachTagMutation = useMutation({
    mutationFn: ({ entryId, name }: { entryId: string; name: string }) =>
      api.post<{ entry: CampaignBestiaryEntry }>(`/campaigns/${campaignId}/bestiary/${entryId}/categories`, { name }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const detachTagMutation = useMutation({
    mutationFn: ({ entryId, categoryId }: { entryId: string; categoryId: string }) =>
      api.delete<void>(`/campaigns/${campaignId}/bestiary/${entryId}/categories/${categoryId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const entries = entriesQuery.data?.entries ?? [];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{t('nav.bestiary')}</h2>
        {isDm && <ButtonLink to="add" variant="primary" size="sm">{t('campaignBestiary.addButton')}</ButtonLink>}
      </div>

      {entriesQuery.isLoading && <Loading />}
      {entriesQuery.isError && <ErrorBanner message={errorMessage(entriesQuery.error)} />}
      {removeMutation.isError && <ErrorBanner message={errorMessage(removeMutation.error)} />}
      {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
      {entries.length === 0 && !entriesQuery.isLoading && (
        <EmptyState message={isDm ? t('campaignBestiary.emptyDm') : t('campaignBestiary.emptyPlayer')} />
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-800">
        <table className="w-full text-sm">
          <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">{t('campaignBestiary.colName')}</th>
              <th className="text-left px-3 py-2">{t('campaignBestiary.colType')}</th>
              <th className="text-left px-3 py-2">{t('campaignBestiary.colTags')}</th>
              {isDm && <th className="text-left px-3 py-2">{t('campaignBestiary.colDiscovered')}</th>}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <Fragment key={entry.id}>
                <tr className="border-t border-stone-800 hover:bg-stone-900/60">
                  <td className="px-3 py-2 text-stone-100">
                    <button
                      type="button"
                      onClick={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
                      className="hover:text-amber-400 text-left"
                    >
                      {entry.custom_name || entry.monster.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-stone-400">
                    {entry.monster.creature_type} · CR {formatCrLabel(entry.effective.challenge_rating)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {entry.categories.map((c) => (
                        <Badge key={c.id} variant="accent">
                          {c.name}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  {isDm && (
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-1.5 text-xs text-stone-300">
                        <input
                          type="checkbox"
                          checked={entry.discovered}
                          onChange={(e) => updateMutation.mutate({ entryId: entry.id, body: { discovered: e.target.checked } })}
                        />
                        {entry.discovered ? t('campaignBestiary.discoveredYes') : t('campaignBestiary.discoveredNo')}
                      </label>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
                    >
                      {expandedId === entry.id ? t('campaignBestiary.hide') : t('campaignBestiary.view')}
                    </Button>
                    {isDm && (
                      <button
                        type="button"
                        disabled={removeMutation.isPending}
                        onClick={() => {
                          if (confirm(t('campaignBestiary.confirmRemove', { name: entry.custom_name || entry.monster.name }))) {
                            removeMutation.mutate(entry.id);
                          }
                        }}
                        className="text-red-400 hover:text-red-300 text-xs px-1"
                        aria-label={t('campaignBestiary.removeAriaLabel', { name: entry.custom_name || entry.monster.name })}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === entry.id && (
                  <tr className="border-t border-stone-800">
                    <td colSpan={isDm ? 5 : 4} className="px-3 py-3 bg-stone-950/40">
                      <BestiaryEntryDetail
                        entry={entry}
                        isDm={isDm}
                        onUpdate={(body) => updateMutation.mutate({ entryId: entry.id, body })}
                        onAttachTag={(name) => attachTagMutation.mutate({ entryId: entry.id, name })}
                        onDetachTag={(categoryId) => detachTagMutation.mutate({ entryId: entry.id, categoryId })}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BestiaryEntryDetail({
  entry,
  isDm,
  onUpdate,
  onAttachTag,
  onDetachTag,
}: {
  entry: CampaignBestiaryEntry;
  isDm: boolean;
  onUpdate: (body: Record<string, unknown>) => void;
  onAttachTag: (name: string) => void;
  onDetachTag: (categoryId: string) => void;
}) {
  const { t } = useLocale();
  const [customName, setCustomName] = useState(entry.custom_name ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [armorClassOverride, setArmorClassOverride] = useState(String(entry.stat_overrides.armor_class ?? ''));
  const [hpOverride, setHpOverride] = useState(String(entry.stat_overrides.hit_point_average ?? ''));
  const [newTag, setNewTag] = useState('');

  const overriddenFields = Object.keys(entry.stat_overrides);

  function saveDetails() {
    const statOverrides: Record<string, unknown> = {};
    if (armorClassOverride.trim() !== '') statOverrides.armorClass = Number(armorClassOverride);
    if (hpOverride.trim() !== '') statOverrides.hitPointAverage = Number(hpOverride);
    onUpdate({
      customName: customName.trim() === '' ? null : customName,
      notes: notes.trim() === '' ? null : notes,
      ...(Object.keys(statOverrides).length > 0 ? { statOverrides } : {}),
    });
  }

  return (
    <div className="space-y-4">
      {isDm && (
        <div className="grid sm:grid-cols-2 gap-3 rounded-md bg-stone-900 p-3">
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            {t('campaignBestiary.detail.customName')}
            <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={entry.monster.name} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            {t('campaignBestiary.detail.armorClassOverride')}
            <Input
              type="number"
              value={armorClassOverride}
              onChange={(e) => setArmorClassOverride(e.target.value)}
              placeholder={String(entry.monster.armor_class)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            {t('campaignBestiary.detail.hpOverride')}
            <Input
              type="number"
              value={hpOverride}
              onChange={(e) => setHpOverride(e.target.value)}
              placeholder={String(entry.monster.hit_point_average)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-400 sm:col-span-2">
            {t('campaignBestiary.detail.notes')}
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <div className="sm:col-span-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder={t('campaignBestiary.detail.tagPlaceholder')}
                className="w-40"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTag.trim() !== '') {
                    onAttachTag(newTag.trim());
                    setNewTag('');
                  }
                }}
              />
              {entry.categories.map((c) => (
                <Badge key={c.id} variant="accent" className="cursor-pointer" onClick={() => onDetachTag(c.id)}>
                  {c.name} ✕
                </Badge>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={saveDetails}>
              {t('campaignBestiary.detail.save')}
            </Button>
          </div>
        </div>
      )}

      {!isDm && entry.notes && <p className="text-sm text-stone-300 italic">{entry.notes}</p>}

      {overriddenFields.length > 0 && (
        <p className="text-xs text-stone-500">
          {t('campaignBestiary.detail.overriddenNote', { fields: overriddenFields.join(', ') })}
        </p>
      )}

      <StatBlock monster={entry.effective} />
    </div>
  );
}
