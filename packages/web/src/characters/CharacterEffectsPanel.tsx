import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ActiveEffect } from '../lib/types';
import { useEffectDefinitionsCatalog } from '../lib/useCatalog';
import { EffectBadge } from '../components/EffectBadge';
import { EffectApplyDialog, type ApplyEffectFormInput } from '../components/EffectApplyDialog';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

/**
 * Active effects applied to this character OUTSIDE combat (PLAN.md's
 * POST /characters/:id/effects, encounter_id = null). Any campaign member
 * may view — every effect is visible to the whole party (hide/reveal was
 * removed); apply/remove are DM-only, matching services/effects.ts's
 * requireDm gate.
 *
 * The read side (GET /characters/:id/effects) didn't exist in the Phase 2
 * backend this was built against — only the encounter-scoped GET and the
 * outside-combat POST did. Added the matching GET here (see
 * services/effects.ts's listCharacterEffects /
 * routes/characters.ts) rather than building a UI with an apply button but
 * no way to see what's currently active.
 */
export function CharacterEffectsPanel({
  characterId,
  campaignId,
  isDm,
}: {
  characterId: string;
  campaignId: string;
  isDm: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();

  const effectsQuery = useQuery({
    queryKey: ['character', characterId, 'effects'],
    queryFn: () => api.get<{ effects: ActiveEffect[] }>(`/characters/${characterId}/effects`),
  });

  const effectDefinitionsQuery = useEffectDefinitionsCatalog(campaignId);

  const applyMutation = useMutation({
    mutationFn: (input: ApplyEffectFormInput) =>
      api.post<{ effect: ActiveEffect }>(`/characters/${characterId}/effects`, {
        effectDefinitionId: input.effectDefinitionId,
        durationValue: input.durationValue,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'effects'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (effectId: string) => api.delete<void>(`/effects/${effectId}`),
    onSuccess: (_data, effectId) => {
      queryClient.setQueryData<{ effects: ActiveEffect[] }>(['character', characterId, 'effects'], (prev) =>
        prev ? { effects: prev.effects.filter((e) => e.id !== effectId) } : prev,
      );
    },
  });

  const effects = effectsQuery.data?.effects ?? [];

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.effectsPanel.title')}</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {effects.length === 0 && <p className="text-stone-500 text-sm italic">{t('characters.effectsPanel.empty')}</p>}
        {effects.map((e) => (
          <EffectBadge
            key={e.id}
            effect={{
              effectId: e.id,
              effectDefinitionId: e.effect_definition_id,
              name: e.effect_definition_name,
              durationType: e.duration_type,
              durationRemaining: e.duration_value,
              concentration: e.concentration,
              sourceCharacterId: e.source_character_id,
            }}
            removable={isDm}
            onRemove={() => removeMutation.mutate(e.id)}
          />
        ))}
      </div>
      {isDm && (
        <EffectApplyDialog
          effectDefinitions={effectDefinitionsQuery.data?.effectDefinitions ?? []}
          pending={applyMutation.isPending}
          onApply={(input) => applyMutation.mutate(input)}
        />
      )}
      {(applyMutation.isError || removeMutation.isError) && (
        <ErrorBanner message={errorMessage((applyMutation.error ?? removeMutation.error) as unknown)} />
      )}
    </section>
  );
}
