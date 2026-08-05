// Cast-from-encounter (brief: "spend the slot, apply the effect/condition
// to targets") — bundles the character sheet's existing per-slot "Spend"
// button (SpellcastingPanel.tsx) and the DM's existing per-participant
// EffectApplyDialog into one action, callable by a player for their own
// character. See services/casting.ts (server) for why this isn't one
// bundled with a spell picker: this app has no spell -> effect_definition
// mapping in its data model, so the caster picks BOTH which slot to spend
// and which mechanical effect (if any) to apply — same "DM/player declares
// the mechanical shape" posture as EffectApplyDialog already has.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ResourcePool, SnapshotParticipant } from '../lib/types';
import { useCharacterResources, resourcesQueryKey } from '../characters/useResourcePools';
import { useEffectDefinitionsCatalog } from '../lib/useCatalog';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

const CASTABLE_RESOURCE_RE = /^(spell_slot_|warlock_pact_slot_)\d+$/;

export function CastPanel({
  encounterId,
  casterCharacterId,
  participants,
}: {
  encounterId: string;
  casterCharacterId: string;
  participants: SnapshotParticipant[];
}) {
  const { t } = useLocale();
  const { campaign } = useCampaignShell();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [resourceKey, setResourceKey] = useState('');
  const [effectDefinitionId, setEffectDefinitionId] = useState('');
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());

  const resourcesQuery = useCharacterResources(casterCharacterId);
  const effectDefinitionsQuery = useEffectDefinitionsCatalog(campaign.id);

  const castMutation = useMutation({
    mutationFn: () =>
      api.post(`/encounters/${encounterId}/cast`, {
        characterId: casterCharacterId,
        resourceKey,
        effectDefinitionId: effectDefinitionId === '' ? undefined : effectDefinitionId,
        targetParticipantIds: [...targetIds],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourcesQueryKey(casterCharacterId) });
      setEffectDefinitionId('');
      setTargetIds(new Set());
      setOpen(false);
    },
    // EFFECT_APPLIED (which this route also triggers) keeps every client's
    // participant effects list in sync — no local cache write needed there.
  });

  const castableSlots = (resourcesQuery.data?.resources ?? []).filter(
    (r: ResourcePool) => CASTABLE_RESOURCE_RE.test(r.resource_key) && r.current_value > 0,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={castableSlots.length === 0}
        className="text-xs text-amber-500 hover:text-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('encounters.cast.trigger')}
      </button>
    );
  }

  function toggleTarget(participantId: string) {
    setTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  const canSubmit = resourceKey !== '' && (effectDefinitionId === '' || targetIds.size > 0);

  return (
    <div className="rounded-md border border-stone-700 bg-stone-950 p-2 space-y-2">
      <div>
        <label className="block text-[10px] text-stone-500 mb-0.5" htmlFor="cast-slot-select">
          {t('encounters.cast.slotLabel')}
        </label>
        <select
          id="cast-slot-select"
          value={resourceKey}
          onChange={(e) => setResourceKey(e.target.value)}
          className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
        >
          <option value="">{t('encounters.cast.selectSlot')}</option>
          {castableSlots.map((r) => (
            <option key={r.resource_key} value={r.resource_key}>
              {r.resource_key} ({r.current_value}/{r.max_value})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-[10px] text-stone-500 mb-0.5" htmlFor="cast-effect-select">
          {t('encounters.cast.effectLabel')}
        </label>
        <select
          id="cast-effect-select"
          value={effectDefinitionId}
          onChange={(e) => setEffectDefinitionId(e.target.value)}
          className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
        >
          <option value="">{t('encounters.cast.noEffect')}</option>
          {(effectDefinitionsQuery.data?.effectDefinitions ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {effectDefinitionId !== '' && (
        <div>
          <span className="block text-[10px] text-stone-500 mb-0.5">{t('encounters.cast.targetsLabel')}</span>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {participants.map((p) => (
              <label
                key={p.participantId}
                className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-[11px] text-stone-300"
              >
                <input
                  type="checkbox"
                  checked={targetIds.has(p.participantId)}
                  onChange={() => toggleTarget(p.participantId)}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSubmit || castMutation.isPending}
          onClick={() => castMutation.mutate()}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-2 py-1 text-xs"
        >
          {castMutation.isPending ? t('encounters.cast.casting') : t('encounters.cast.cast')}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
        >
          {t('common.cancel')}
        </button>
      </div>
      {castMutation.isError && <ErrorBanner message={errorMessage(castMutation.error)} />}
    </div>
  );
}
