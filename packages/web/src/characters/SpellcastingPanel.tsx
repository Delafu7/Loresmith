import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  CharacterClass,
  CharacterSpell,
  CharacterSpellSource,
  ClassCatalog,
  ResourcePool,
  SpellCatalogEntry,
} from '../lib/types';
import { useSpellsCatalog } from '../lib/useCatalog';
import { useCharacterResources, useResourcePoolMutations } from './useResourcePools';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { Combobox } from '../components/Combobox';
import { useLocale } from '../i18n/LocaleContext';

const SPELL_SLOT_RE = /^spell_slot_(\d+)$/;
const PACT_SLOT_RE = /^warlock_pact_slot_(\d+)$/;

function slotLevel(resourceKey: string): number {
  const m = SPELL_SLOT_RE.exec(resourceKey) ?? PACT_SLOT_RE.exec(resourceKey);
  return m ? Number(m[1]) : 0;
}

/**
 * Character sheet spellcasting panel (PLAN.md §6.2's SpellcasterPanel):
 * a slot tracker plus known/prepared spell list. Self-gates on whether the
 * character actually has spellcasting (checked below, once resources have
 * loaded) and renders nothing for a non-caster — the CALLER (CharacterSheetPage)
 * doesn't need to know this rule; it just always mounts the panel.
 *
 * The single most important correctness rule here (per the task brief and
 * services/spellSlots.ts): regular spell_slot_N rows and Warlock Pact Magic's
 * warlock_pact_slot_N rows are TWO SEPARATE resource pools that must never be
 * summed or merged into one display — a Paladin 3/Warlock 2 has both a
 * regular 2nd-level slot AND a separate pact slot at the same character
 * level, and conflating them would silently misrepresent available slots.
 * They are rendered as two distinct sections below, sourced from two
 * distinct filtered lists, with no shared total anywhere in this component.
 */
export function SpellcastingPanel({
  characterId,
  edition,
  characterClasses,
  classesCatalog,
  editable,
  canAct,
}: {
  characterId: string;
  edition: '2014' | '2024' | 'both';
  characterClasses: CharacterClass[];
  classesCatalog: ClassCatalog[];
  editable: boolean;
  // CONTROL gate (useCharacterCanAct) — separate from `editable` (ownership).
  // Governs slot spend/recover only (SlotMeter); learn/prepare/unlearn stay
  // on `editable`.
  canAct: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const resourcesQuery = useCharacterResources(characterId);
  const { spend, recover } = useResourcePoolMutations(characterId);

  const spellsQuery = useQuery({
    queryKey: ['character', characterId, 'spells'],
    queryFn: () => api.get<{ spells: CharacterSpell[] }>(`/characters/${characterId}/spells`),
  });

  const spellsCatalogQuery = useSpellsCatalog(edition);

  const resources = resourcesQuery.data?.resources ?? [];
  const spellSlotPools = resources
    .filter((r) => SPELL_SLOT_RE.test(r.resource_key))
    .sort((a, b) => slotLevel(a.resource_key) - slotLevel(b.resource_key));
  const pactSlotPools = resources
    .filter((r) => PACT_SLOT_RE.test(r.resource_key))
    .sort((a, b) => slotLevel(a.resource_key) - slotLevel(b.resource_key));

  const toggleMutation = useMutation({
    mutationFn: ({ spellId, classId, isPrepared }: { spellId: string; classId: string | null; isPrepared: boolean }) => {
      const qs = classId != null ? `?classId=${classId}` : '';
      return api.patch<{ spell: CharacterSpell }>(`/characters/${characterId}/spells/${spellId}${qs}`, { isPrepared });
    },
    onSuccess: (data) => {
      queryClient.setQueryData<{ spells: CharacterSpell[] }>(['character', characterId, 'spells'], (prev) =>
        prev ? { spells: prev.spells.map((s) => (s.id === data.spell.id ? data.spell : s)) } : prev,
      );
    },
  });

  const unlearnMutation = useMutation({
    mutationFn: ({ spellId, classId }: { spellId: string; classId: string | null }) => {
      const qs = classId != null ? `?classId=${classId}` : '';
      return api.delete<void>(`/characters/${characterId}/spells/${spellId}${qs}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<{ spells: CharacterSpell[] }>(['character', characterId, 'spells'], (prev) =>
        prev
          ? { spells: prev.spells.filter((s) => !(s.spell_id === variables.spellId && s.class_id === variables.classId)) }
          : prev,
      );
    },
  });

  const learnMutation = useMutation({
    mutationFn: (input: {
      spellId: string;
      classId: string | null;
      isPrepared: boolean;
      alwaysPrepared: boolean;
      source: CharacterSpellSource;
    }) => api.post<{ spell: CharacterSpell }>(`/characters/${characterId}/spells`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['character', characterId, 'spells'] });
      setAdding(false);
    },
  });

  // Renders nothing until we know for sure whether this character casts
  // spells, per the task brief — avoids flashing an empty panel for
  // non-casters while the resources query is still in flight.
  if (resourcesQuery.isLoading) return null;
  if (spellSlotPools.length === 0 && pactSlotPools.length === 0) return null;

  const spellById = new Map((spellsCatalogQuery.data?.spells ?? []).map((s) => [s.id, s]));
  const classById = new Map(classesCatalog.map((c) => [c.id, c]));
  const spellRows = [...(spellsQuery.data?.spells ?? [])].sort((a, b) => {
    const la = spellById.get(a.spell_id)?.level ?? 0;
    const lb = spellById.get(b.spell_id)?.level ?? 0;
    if (la !== lb) return la - lb;
    return (spellById.get(a.spell_id)?.name ?? '').localeCompare(spellById.get(b.spell_id)?.name ?? '');
  });

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.spells.title')}</h3>

      {spellSlotPools.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-stone-400 mb-2">{t('characters.spells.spellSlots')}</h4>
          <div className="flex flex-wrap gap-2">
            {spellSlotPools.map((pool) => (
              <SlotMeter
                key={pool.resource_key}
                pool={pool}
                canAct={canAct}
                mutationPending={spend.isPending || recover.isPending}
                tone="slot"
                onSpend={() => spend.mutate({ resourceKey: pool.resource_key })}
                onRecover={() => recover.mutate({ resourceKey: pool.resource_key })}
              />
            ))}
          </div>
        </div>
      )}

      {pactSlotPools.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-stone-400 mb-2">
            {t('characters.spells.pactMagic')} <span className="text-stone-600 normal-case">{t('characters.spells.pactMagicNote')}</span>
          </h4>
          <div className="flex flex-wrap gap-2">
            {pactSlotPools.map((pool) => (
              <SlotMeter
                key={pool.resource_key}
                pool={pool}
                canAct={canAct}
                mutationPending={spend.isPending || recover.isPending}
                tone="pact"
                onSpend={() => spend.mutate({ resourceKey: pool.resource_key })}
                onRecover={() => recover.mutate({ resourceKey: pool.resource_key })}
              />
            ))}
          </div>
        </div>
      )}

      {(spend.isError || recover.isError) && (
        <ErrorBanner message={errorMessage((spend.error ?? recover.error) as unknown)} />
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-stone-400">{t('characters.spells.spellsHeading')}</h4>
          {editable && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="text-xs text-amber-500 hover:text-amber-400">
              {t('characters.spells.learnSpell')}
            </button>
          )}
        </div>

        {spellRows.length === 0 ? (
          <p className="text-stone-500 text-sm italic">{t('characters.spells.noSpells')}</p>
        ) : (
          <ul className="space-y-1">
            {spellRows.map((row) => {
              const spell = spellById.get(row.spell_id);
              return (
                <li key={row.id} className="flex items-center gap-2 text-sm py-0.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={row.is_prepared || row.always_prepared}
                    aria-label={t('characters.spells.preparedAria', {
                      name: spell?.name ?? t('characters.spells.spellFallbackId', { id: row.spell_id }),
                    })}
                    disabled={!editable || row.always_prepared || toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({ spellId: row.spell_id, classId: row.class_id, isPrepared: !row.is_prepared })
                    }
                    className={`h-4 w-4 rounded-full border flex-shrink-0 ${
                      row.is_prepared || row.always_prepared ? 'bg-amber-500 border-amber-500' : 'bg-transparent border-stone-600'
                    } ${editable && !row.always_prepared ? 'cursor-pointer' : 'cursor-default'}`}
                    title={
                      row.always_prepared
                        ? t('characters.spells.alwaysPrepared')
                        : row.is_prepared
                          ? t('characters.spells.prepared')
                          : t('characters.spells.notPrepared')
                    }
                  />
                  <span className="text-stone-300 flex-1 truncate">{spell?.name ?? `Spell #${row.spell_id}`}</span>
                  <span className="text-xs text-stone-600 w-14 text-right">
                    {spell ? (spell.level === 0 ? t('characters.spells.cantrip') : t('characters.spells.levelAbbrev', { level: spell.level })) : ''}
                  </span>
                  {row.class_id != null && (
                    <span className="text-xs text-stone-600 w-20 truncate">{classById.get(row.class_id)?.name ?? ''}</span>
                  )}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => unlearnMutation.mutate({ spellId: row.spell_id, classId: row.class_id })}
                      className="text-red-400 hover:text-red-300 text-sm px-1"
                      aria-label={t('characters.spells.unlearnAria', { name: spell?.name ?? t('characters.spells.spellFallback') })}
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {(toggleMutation.isError || unlearnMutation.isError) && (
          <ErrorBanner message={errorMessage((toggleMutation.error ?? unlearnMutation.error) as unknown)} />
        )}

        {adding && (
          <LearnSpellForm
            spellsCatalog={spellsCatalogQuery.data?.spells ?? []}
            characterClasses={characterClasses}
            classesCatalog={classesCatalog}
            knownSpellIds={new Set(spellRows.map((r) => `${r.spell_id}:${r.class_id ?? 'none'}`))}
            pending={learnMutation.isPending}
            onLearn={(input) => learnMutation.mutate(input)}
            onCancel={() => setAdding(false)}
          />
        )}
        {learnMutation.isError && <ErrorBanner message={errorMessage(learnMutation.error)} />}
      </div>
    </section>
  );
}

const TONE_FILLED: Record<'slot' | 'pact', string> = {
  slot: 'bg-amber-500 border-amber-500',
  pact: 'bg-sky-500 border-sky-500',
};

function SlotMeter({
  pool,
  canAct,
  mutationPending,
  tone,
  onSpend,
  onRecover,
}: {
  pool: ResourcePool;
  canAct: boolean;
  // M10: SlotMeter had no isPending guard at all, unlike the structurally
  // identical ResourcePoolPanel two files over — a rapid double-click could
  // fire two spend requests before the first's response updated
  // pool.current_value client-side. The server's atomic UPDATE ... WHERE
  // current_value - $1 >= 0 still prevents going negative, but the double
  // request itself (and its out-of-order-response potential) is still worth
  // closing at the UI layer, same as every other resource mutation control.
  mutationPending: boolean;
  tone: 'slot' | 'pact';
  onSpend: () => void;
  onRecover: () => void;
}) {
  const { t } = useLocale();
  const level = slotLevel(pool.resource_key);
  const pips = Array.from({ length: pool.max_value });
  const interactive = canAct && !mutationPending;
  return (
    <div className="rounded-md border border-stone-700 bg-stone-950 px-3 py-2 min-w-[4.5rem] text-center">
      <div className="text-[10px] uppercase text-stone-500">{t('characters.spells.levelAbbrev', { level })}</div>
      <div className="flex items-center justify-center gap-0.5 my-1 flex-wrap max-w-[6rem]">
        {pips.map((_, i) => {
          const filled = i < pool.current_value;
          return (
            <button
              key={i}
              type="button"
              disabled={!interactive}
              title={filled ? t('characters.spells.useSlot') : t('characters.spells.restoreSlot')}
              aria-label={
                filled
                  ? t('characters.spells.useSlotAria', { level })
                  : t('characters.spells.restoreSlotAria', { level })
              }
              onClick={() => (filled ? onSpend() : onRecover())}
              className={`h-3 w-3 rounded-full border flex-shrink-0 ${
                filled ? TONE_FILLED[tone] : 'bg-transparent border-stone-600'
              } ${interactive ? 'cursor-pointer' : 'cursor-default'}`}
            />
          );
        })}
      </div>
      <div className="text-xs text-stone-300">
        {pool.current_value}/{pool.max_value}
      </div>
    </div>
  );
}

function LearnSpellForm({
  spellsCatalog,
  characterClasses,
  classesCatalog,
  knownSpellIds,
  pending,
  onLearn,
  onCancel,
}: {
  spellsCatalog: SpellCatalogEntry[];
  characterClasses: CharacterClass[];
  classesCatalog: ClassCatalog[];
  knownSpellIds: Set<string>;
  pending: boolean;
  onLearn: (input: {
    spellId: string;
    classId: string | null;
    isPrepared: boolean;
    alwaysPrepared: boolean;
    source: CharacterSpellSource;
  }) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const classById = new Map(classesCatalog.map((c) => [c.id, c]));
  const [spellId, setSpellId] = useState('');
  const [classId, setClassId] = useState<string>(characterClasses[0]?.class_id ?? '');
  const [isPrepared, setIsPrepared] = useState(false);
  const [alwaysPrepared, setAlwaysPrepared] = useState(false);
  const [source, setSource] = useState<CharacterSpellSource>('class');

  const sorted = [...spellsCatalog].sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));

  function submit() {
    if (!spellId) return;
    onLearn({
      spellId,
      classId: classId || null,
      isPrepared,
      alwaysPrepared,
      source,
    });
  }

  return (
    <div className="rounded-md border border-stone-700 bg-stone-950 p-3 mt-2 space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[10rem]">
          <label className="block text-[10px] text-stone-500 mb-0.5">{t('characters.spells.spellLabel')}</label>
          <Combobox
            value={spellId}
            onChange={setSpellId}
            placeholder={t('characters.spells.searchSpells')}
            options={sorted.map((s) => {
              const key = `${s.id}:${classId || 'none'}`;
              const known = knownSpellIds.has(key);
              return {
                value: String(s.id),
                label: `${s.level === 0 ? t('characters.spells.cantrip') : t('characters.spells.levelAbbrev', { level: s.level })} — ${s.name}${known ? ` (${t('characters.spells.known')})` : ''}`,
                disabled: known,
              };
            })}
          />
        </div>
        <div>
          <label className="block text-[10px] text-stone-500 mb-0.5">{t('characters.spells.grantingClass')}</label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('characters.spells.noneOption')}</option>
            {characterClasses.map((cc) => (
              <option key={cc.class_id} value={cc.class_id}>
                {classById.get(cc.class_id)?.name ?? t('characters.classSummary.classFallback', { id: cc.class_id })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-stone-500 mb-0.5">{t('characters.spells.sourceLabel')}</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as CharacterSpellSource)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="class">{t('characters.spells.sourceClass')}</option>
            <option value="race">{t('characters.spells.sourceRace')}</option>
            <option value="feat">{t('characters.spells.sourceFeat')}</option>
            <option value="item">{t('characters.spells.sourceItem')}</option>
          </select>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input type="checkbox" checked={isPrepared} onChange={(e) => setIsPrepared(e.target.checked)} />
          {t('characters.spells.prepared')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-400">
          <input type="checkbox" checked={alwaysPrepared} onChange={(e) => setAlwaysPrepared(e.target.checked)} />
          {t('characters.spells.alwaysPrepared')}
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!spellId || pending}
          onClick={submit}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-sm"
        >
          {t('characters.spells.learnButton')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
