// Structured, selectable attack list (REFACTOR-PLAN.md §6) — CRUD for
// character_attacks. Actually rolling/applying these lives in
// encounters/AttackRoller.tsx (needs a live encounter + targets, neither of
// which exist on the character sheet); this panel is just authoring.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CharacterAttack } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

interface AttackDraft {
  name: string;
  mode: 'attack' | 'save' | 'none';
  attackBonus: string;
  saveDc: string;
  saveAbilityIndex: (typeof ABILITIES)[number];
  damageDice: string;
  damageType: string;
}

function emptyDraft(): AttackDraft {
  return { name: '', mode: 'attack', attackBonus: '', saveDc: '', saveAbilityIndex: 'dex', damageDice: '', damageType: '' };
}

export function CharacterAttacksPanel({ characterId, editable }: { characterId: string; editable: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<AttackDraft>(emptyDraft());

  const attacksQuery = useQuery({
    queryKey: ['character', characterId, 'attacks'],
    queryFn: () => api.get<{ attacks: CharacterAttack[] }>(`/characters/${characterId}/attacks`),
  });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post<{ attack: CharacterAttack }>(`/characters/${characterId}/attacks`, {
        name: draft.name,
        attackBonus: draft.mode === 'attack' && draft.attackBonus.trim() ? Number(draft.attackBonus) : undefined,
        saveDc: draft.mode === 'save' && draft.saveDc.trim() ? Number(draft.saveDc) : undefined,
        saveAbilityIndex: draft.mode === 'save' ? draft.saveAbilityIndex : undefined,
        damageDice: draft.damageDice.trim() || undefined,
        damageType: draft.damageType.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'attacks'] });
      setDraft(emptyDraft());
      setShowForm(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (attackId: string) => api.delete(`/characters/${characterId}/attacks/${attackId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'attacks'] });
    },
  });

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.attacks.title')}</h3>
        {editable && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="text-xs text-amber-500 hover:text-amber-400"
          >
            {showForm ? t('common.cancel') : `+ ${t('characters.attacks.addAttack')}`}
          </button>
        )}
      </div>

      {attacksQuery.isLoading && <Loading />}
      {attacksQuery.isError && <ErrorBanner message={errorMessage(attacksQuery.error)} />}
      {attacksQuery.data && attacksQuery.data.attacks.length === 0 && !showForm && (
        <EmptyState message={t('characters.attacks.empty')} />
      )}

      <ul className="space-y-1.5 mb-2">
        {attacksQuery.data?.attacks.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-stone-800 bg-stone-950 px-3 py-1.5 text-sm">
            <div>
              <span className="text-stone-100 font-medium">{a.name}</span>
              <span className="text-stone-500 text-xs ml-2">
                {a.save_dc != null
                  ? t('characters.attacks.dcSave', { dc: a.save_dc, ability: a.save_ability_index?.toUpperCase() ?? '' })
                  : a.attack_bonus != null
                    ? t('characters.attacks.toHit', { bonus: a.attack_bonus })
                    : null}
                {a.damage_dice && ` · ${a.damage_dice}${a.damage_type ? ` ${a.damage_type}` : ''}`}
              </span>
            </div>
            {editable && (
              <button
                type="button"
                onClick={() => deleteMutation.mutate(a.id)}
                disabled={deleteMutation.isPending}
                className="text-red-400 hover:text-red-300 text-xs"
                aria-label={t('characters.attacks.deleteAria', { name: a.name })}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {showForm && (
        <div className="rounded-md border border-stone-800 bg-stone-950 p-3 space-y-2">
          {addMutation.isError && <ErrorBanner message={errorMessage(addMutation.error)} />}
          <input
            type="text"
            placeholder={t('characters.attacks.namePlaceholder')}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
            <label className="flex items-center gap-1">
              <input type="radio" checked={draft.mode === 'attack'} onChange={() => setDraft((d) => ({ ...d, mode: 'attack' }))} />
              {t('characters.attacks.modeAttack')}
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={draft.mode === 'save'} onChange={() => setDraft((d) => ({ ...d, mode: 'save' }))} />
              {t('characters.attacks.modeSave')}
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={draft.mode === 'none'} onChange={() => setDraft((d) => ({ ...d, mode: 'none' }))} />
              {t('characters.attacks.modeNeither')}
            </label>
          </div>
          {draft.mode === 'attack' && (
            <input
              type="number"
              placeholder={t('characters.attacks.attackBonusPlaceholder')}
              value={draft.attackBonus}
              onChange={(e) => setDraft((d) => ({ ...d, attackBonus: e.target.value }))}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          )}
          {draft.mode === 'save' && (
            <div className="flex gap-2">
              <input
                type="number"
                placeholder={t('characters.attacks.saveDcPlaceholder')}
                value={draft.saveDc}
                onChange={(e) => setDraft((d) => ({ ...d, saveDc: e.target.value }))}
                className="flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
              />
              <select
                value={draft.saveAbilityIndex}
                onChange={(e) => setDraft((d) => ({ ...d, saveAbilityIndex: e.target.value as AttackDraft['saveAbilityIndex'] }))}
                className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
              >
                {ABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {a.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('characters.attacks.damageDicePlaceholder')}
              value={draft.damageDice}
              onChange={(e) => setDraft((d) => ({ ...d, damageDice: e.target.value }))}
              className="flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
            <input
              type="text"
              placeholder={t('characters.attacks.damageTypePlaceholder')}
              value={draft.damageType}
              onChange={(e) => setDraft((d) => ({ ...d, damageType: e.target.value }))}
              className="flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
          </div>
          <button
            type="button"
            disabled={!draft.name.trim() || addMutation.isPending}
            onClick={() => addMutation.mutate()}
            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
          >
            {addMutation.isPending ? t('characters.attacks.adding') : t('characters.attacks.addAttack')}
          </button>
        </div>
      )}
    </section>
  );
}
