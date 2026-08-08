import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter, MonsterCatalogEntry, MonsterInstance, StatBlockEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useDamageTypesCatalog } from '../lib/useCatalog';
import { useLocale } from '../i18n/LocaleContext';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { HPBar } from '../components/HPBar';
import { HpAdjustForm } from '../components/HpAdjustForm';
import { StatBlock } from '../components/StatBlock';
import { DiceRoller } from '../components/DiceRoller';
import { parseDiceExpression } from '../components/QuickDiceRoller';

export function MonstersPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creatureTypeFilter, setCreatureTypeFilter] = useState('');
  const [crMinFilter, setCrMinFilter] = useState('');
  const [crMaxFilter, setCrMaxFilter] = useState('');
  const [expandedMonsterId, setExpandedMonsterId] = useState<string | null>(null);
  // Nav point 5 — multi-select import straight into an encounter (not just
  // the campaign pool below): a per-row quantity plus a single target-
  // encounter picker, rather than the old one-at-a-time "spawn, then go add
  // it to the encounter separately" flow.
  const [importQuantities, setImportQuantities] = useState<Record<string, number>>({});
  const [importEncounterId, setImportEncounterId] = useState('');

  const bestiaryParams = new URLSearchParams({ edition: campaign.srd_edition, campaignId });
  if (crMinFilter) bestiaryParams.set('crMin', crMinFilter);
  if (crMaxFilter) bestiaryParams.set('crMax', crMaxFilter);
  const bestiaryQueryKey = ['catalog', 'monsters', campaign.srd_edition, campaignId, crMinFilter, crMaxFilter];
  const bestiaryQuery = useQuery({
    queryKey: bestiaryQueryKey,
    queryFn: () => api.get<{ monsters: MonsterCatalogEntry[] }>(`/catalog/monsters?${bestiaryParams.toString()}`),
  });

  const instancesQuery = useQuery({
    queryKey: ['monsterInstances', campaignId],
    queryFn: () => api.get<{ monsterInstances: MonsterInstance[] }>(`/campaigns/${campaignId}/monster-instances`),
  });

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  const spawnMutation = useMutation({
    mutationFn: (monster: MonsterCatalogEntry) =>
      api.post<{ monsterInstance: MonsterInstance }>(`/campaigns/${campaignId}/monster-instances`, {
        monsterId: monster.id,
        hpCurrent: monster.hit_point_average,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });
    },
  });

  // Spawns `quantity` instances of each selected monster (createMonsterInstance
  // auto-numbers them — "Goblin 1, Goblin 2..." — so no client-side naming
  // logic is needed here) and adds every one straight to importEncounterId,
  // sequentially: each step depends on the previous instance actually
  // existing before it can be added as a participant, so this can't be
  // parallelized with Promise.all without risking a half-finished import on
  // a mid-batch failure being harder to reason about.
  const importToEncounterMutation = useMutation({
    mutationFn: async () => {
      const entries = Object.entries(importQuantities).filter(([, qty]) => qty > 0);
      for (const [monsterId, qty] of entries) {
        const monster = bestiaryQuery.data?.monsters.find((m) => m.id === monsterId);
        if (!monster) continue;
        for (let i = 0; i < qty; i++) {
          const { monsterInstance } = await api.post<{ monsterInstance: MonsterInstance }>(
            `/campaigns/${campaignId}/monster-instances`,
            { monsterId: monster.id, hpCurrent: monster.hit_point_average },
          );
          await api.post(`/encounters/${importEncounterId}/participants`, { monsterInstanceId: monsterInstance.id });
        }
      }
    },
    onSuccess: () => {
      setImportQuantities({});
      void queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });
    },
  });

  const totalImportQuantity = Object.values(importQuantities).reduce((sum, qty) => sum + qty, 0);

  const hpMutation = useMutation({
    mutationFn: ({ id, delta, tempDelta }: { id: string; delta: number; tempDelta: number }) =>
      api.patch<{ monsterInstance: MonsterInstance }>(`/monster-instances/${id}/hp`, { delta, tempDelta }),
    onSuccess: (data) => {
      queryClient.setQueryData<{ monsterInstances: MonsterInstance[] } | undefined>(
        ['monsterInstances', campaignId],
        (prev) =>
          prev && {
            monsterInstances: prev.monsterInstances.map((mi) =>
              mi.id === data.monsterInstance.id ? { ...mi, ...data.monsterInstance } : mi,
            ),
          },
      );
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: (instanceId: string) => api.delete<void>(`/campaigns/${campaignId}/monster-instances/${instanceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['monsterInstances', campaignId] });
    },
  });

  // Unlike deleteInstanceMutation above (no confirmation — losing a spawned
  // instance is cheap, you can just re-spawn it), deleting a homebrew
  // creature destroys an entire hand-authored stat block permanently, so this
  // one asks first via a plain window.confirm, consistent with how
  // CharacterSheetPage.tsx's character-delete button already does the same.
  const deleteMonsterMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/campaigns/${campaignId}/monsters/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bestiaryQueryKey });
      setExpandedMonsterId(null);
    },
  });

  // Available on every row, not just homebrew ones — forking an official
  // creature into a homebrew copy IS how you get to edit it (fork-on-edit,
  // same as the generic catalog entities in CatalogEditorPage.tsx).
  const duplicateMonsterMutation = useMutation({
    mutationFn: (id: string) => api.post<{ monster: MonsterCatalogEntry }>(`/campaigns/${campaignId}/monsters/${id}/duplicate`, {}),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: bestiaryQueryKey });
      navigate(`/campaigns/${campaignId}/monsters/${data.monster.id}/edit`);
    },
  });

  // Iteration 2 "Shared bestiary" — in-place scope conversion (same row).
  // The catalog union already includes the caller's own library rows
  // regardless of which campaign this page is viewed from (services/
  // catalog.ts's listMonsters), so both actions are reachable from any
  // campaign the DM runs.
  const promoteToLibraryMutation = useMutation({
    mutationFn: (id: string) => api.post<{ monster: MonsterCatalogEntry }>(`/campaigns/${campaignId}/monsters/${id}/promote-to-library`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: bestiaryQueryKey }),
  });
  const assignToCampaignMutation = useMutation({
    mutationFn: (id: string) => api.post<{ monster: MonsterCatalogEntry }>(`/campaigns/${campaignId}/monsters/${id}/assign-to-campaign`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: bestiaryQueryKey }),
  });

  if (role !== 'dm') {
    // UX finding #9 (Iteration 3 audit) — a role-based permission denial is
    // an expected state for that role, not an error condition; ErrorBanner
    // was inconsistent with CampaignMembersPage's own (more appropriate)
    // EmptyState treatment of the exact same situation.
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <EmptyState message={t('monsters.dmOnly')} />
      </div>
    );
  }

  const creatureTypes = [...new Set(bestiaryQuery.data?.monsters.map((m) => m.creature_type) ?? [])].sort();
  const filteredMonsters = (bestiaryQuery.data?.monsters ?? []).filter(
    (m) => !creatureTypeFilter || m.creature_type === creatureTypeFilter,
  );

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-lg font-semibold">{t('monsters.list.heading')}</h2>
          <div className="flex items-center gap-2">
            <select
              value={creatureTypeFilter}
              onChange={(e) => setCreatureTypeFilter(e.target.value)}
              className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="">{t('monsters.list.allTypes')}</option>
              {creatureTypes.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              placeholder={t('monsters.list.crMin')}
              value={crMinFilter}
              onChange={(e) => setCrMinFilter(e.target.value)}
              className="w-20 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
            <input
              type="number"
              min={0}
              placeholder={t('monsters.list.crMax')}
              value={crMaxFilter}
              onChange={(e) => setCrMaxFilter(e.target.value)}
              className="w-20 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            />
            <button
              type="button"
              onClick={() => navigate(`/campaigns/${campaignId}/monsters/new`)}
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
            >
              {t('monsters.list.newHomebrew')}
            </button>
          </div>
        </div>

        {bestiaryQuery.isLoading && <Loading />}
        {bestiaryQuery.isError && <ErrorBanner message={errorMessage(bestiaryQuery.error)} />}
        {deleteMonsterMutation.isError && <ErrorBanner message={errorMessage(deleteMonsterMutation.error)} />}
        {duplicateMonsterMutation.isError && <ErrorBanner message={errorMessage(duplicateMonsterMutation.error)} />}
        {spawnMutation.isError && <ErrorBanner message={errorMessage(spawnMutation.error)} />}
        {importToEncounterMutation.isError && <ErrorBanner message={errorMessage(importToEncounterMutation.error)} />}

        <div className="flex flex-wrap items-center gap-2 rounded-md bg-stone-900 shadow-sm px-3 py-2">
          <span className="text-xs text-stone-500">{t('monsters.list.importToEncounterLabel')}</span>
          <select
            value={importEncounterId}
            onChange={(e) => setImportEncounterId(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
          >
            <option value="">{t('monsters.list.selectEncounter')}</option>
            {encountersQuery.data?.encounters.map((enc) => (
              <option key={enc.id} value={enc.id}>
                {enc.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={totalImportQuantity === 0 || !importEncounterId || importToEncounterMutation.isPending}
            onClick={() => importToEncounterMutation.mutate()}
            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
          >
            {importToEncounterMutation.isPending
              ? t('monsters.list.importing')
              : t('monsters.list.importToEncounterButton', { count: totalImportQuantity })}
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full text-sm">
            <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">{t('monsters.list.colName')}</th>
                <th className="text-left px-3 py-2">{t('monsters.list.colType')}</th>
                <th className="text-left px-3 py-2">{t('monsters.list.colCr')}</th>
                <th className="text-left px-3 py-2">{t('monsters.list.colAc')}</th>
                <th className="text-left px-3 py-2">{t('monsters.list.colHp')}</th>
                <th className="text-left px-3 py-2">{t('monsters.list.colQty')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filteredMonsters.map((m) => (
                <Fragment key={m.id}>
                  <tr className="border-t border-stone-800 hover:bg-stone-900/60">
                    <td className="px-3 py-2 text-stone-100">
                      <button
                        type="button"
                        onClick={() => setExpandedMonsterId((cur) => (cur === m.id ? null : m.id))}
                        className="hover:text-amber-400 text-left"
                      >
                        {m.name}
                      </button>
                      {m.is_homebrew && (
                        <span className="ml-2 inline-block rounded border border-amber-700 text-amber-500 text-[10px] uppercase px-1 py-0.5 align-middle">
                          {t('monsters.list.homebrewBadge')}
                        </span>
                      )}
                      {m.owning_user_id !== null && (
                        <span
                          className="ml-2 inline-block rounded border border-sky-700 text-sky-400 text-[10px] uppercase px-1 py-0.5 align-middle"
                          title={t('monsters.list.libraryBadgeTitle')}
                        >
                          {t('monsters.list.libraryBadge')}
                        </span>
                      )}
                      {m.is_unique && (
                        <span className="ml-2 inline-block rounded border border-purple-700 text-purple-400 text-[10px] uppercase px-1 py-0.5 align-middle">
                          {t('monsters.list.uniqueBadge')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-400">{m.creature_type}</td>
                    <td className="px-3 py-2 font-mono text-stone-400 tabular-nums">{m.challenge_rating}</td>
                    <td className="px-3 py-2 font-mono text-stone-400 tabular-nums">{m.armor_class}</td>
                    <td className="px-3 py-2 font-mono text-stone-400 tabular-nums">{m.hit_point_average}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const alreadySpawned =
                          m.is_unique &&
                          (instancesQuery.data?.monsterInstances.some((mi) => mi.monster_id === m.id) ?? false);
                        const max = m.is_unique ? 1 : 20;
                        return (
                          <input
                            type="number"
                            min={0}
                            max={max}
                            disabled={alreadySpawned}
                            title={alreadySpawned ? t('monsters.list.uniqueAlreadySpawnedTitle') : undefined}
                            value={importQuantities[m.id] ?? ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setImportQuantities((prev) => {
                                const next = { ...prev };
                                if (raw === '') {
                                  delete next[m.id];
                                } else {
                                  next[m.id] = Math.max(0, Math.min(max, Number(raw)));
                                }
                                return next;
                              });
                            }}
                            className="w-14 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-sm text-stone-100 disabled:opacity-40"
                          />
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setExpandedMonsterId((cur) => (cur === m.id ? null : m.id))}
                        className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
                      >
                        {expandedMonsterId === m.id ? t('monsters.list.hide') : t('monsters.list.view')}
                      </button>
                      {m.is_homebrew && (
                        <button
                          type="button"
                          onClick={() => navigate(`/campaigns/${campaignId}/monsters/${m.id}/edit`)}
                          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={duplicateMonsterMutation.isPending}
                        onClick={() => duplicateMonsterMutation.mutate(m.id)}
                        className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800 disabled:opacity-50"
                      >
                        {t('monsters.list.duplicate')}
                      </button>
                      {m.owning_campaign_id === campaignId && (
                        <button
                          type="button"
                          disabled={promoteToLibraryMutation.isPending}
                          onClick={() => promoteToLibraryMutation.mutate(m.id)}
                          title={t('monsters.list.promoteToLibraryTitle')}
                          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800 disabled:opacity-50"
                        >
                          {t('monsters.list.promoteToLibrary')}
                        </button>
                      )}
                      {m.owning_user_id !== null && (
                        <button
                          type="button"
                          disabled={assignToCampaignMutation.isPending}
                          onClick={() => assignToCampaignMutation.mutate(m.id)}
                          title={t('monsters.list.assignToCampaignTitle')}
                          className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800 disabled:opacity-50"
                        >
                          {t('monsters.list.assignToCampaign')}
                        </button>
                      )}
                      {m.is_homebrew && (
                        <button
                          type="button"
                          disabled={deleteMonsterMutation.isPending}
                          onClick={() => {
                            if (confirm(t('monsters.list.confirmDelete', { name: m.name }))) {
                              deleteMonsterMutation.mutate(m.id);
                            }
                          }}
                          className="text-red-400 hover:text-red-300 text-xs px-1"
                          aria-label={t('monsters.list.deleteAriaLabel', { name: m.name })}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                      {(() => {
                        const alreadySpawned =
                          m.is_unique &&
                          (instancesQuery.data?.monsterInstances.some((mi) => mi.monster_id === m.id) ?? false);
                        return (
                          <button
                            type="button"
                            disabled={spawnMutation.isPending || alreadySpawned}
                            title={alreadySpawned ? t('monsters.list.uniqueAlreadySpawnedTitle') : undefined}
                            onClick={() => spawnMutation.mutate(m)}
                            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1 text-xs"
                          >
                            {alreadySpawned ? t('monsters.list.alreadySpawned') : t('monsters.list.spawnInstance')}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                  {expandedMonsterId === m.id && (
                    <tr className="border-t border-stone-800">
                      <td colSpan={7} className="px-3 py-3 bg-stone-950/40">
                        <StatBlock monster={m} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredMonsters.length === 0 && !bestiaryQuery.isLoading && (
                <tr>
                  <td colSpan={7}>
                    <EmptyState message={t('monsters.list.noMatches')} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">{t('monsters.instances.heading')}</h2>
        {instancesQuery.isLoading && <Loading />}
        {instancesQuery.isError && <ErrorBanner message={errorMessage(instancesQuery.error)} />}
        {instancesQuery.data && instancesQuery.data.monsterInstances.length === 0 && (
          <EmptyState message={t('monsters.instances.empty')} />
        )}
        <ul className="grid sm:grid-cols-2 gap-3">
          {instancesQuery.data?.monsterInstances.map((mi) => (
            <li key={mi.id} className="rounded-md bg-stone-900 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-stone-100">{mi.custom_name || mi.monster_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase text-stone-500">{mi.status}</span>
                  <button
                    type="button"
                    // UX finding #9 (Iteration 3 audit) — missing confirm
                    // and double-submit guard, same sweep as the other
                    // destructive-action fixes in this increment.
                    onClick={() => {
                      if (window.confirm(t('monsters.instances.deleteConfirm', { name: mi.custom_name || mi.monster_name || '' }))) {
                        deleteInstanceMutation.mutate(mi.id);
                      }
                    }}
                    disabled={deleteInstanceMutation.isPending}
                    className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                    aria-label={t('monsters.instances.deleteAria')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <HPBar current={mi.hp_current} max={mi.hp_max_override ?? mi.hit_point_average ?? 1} temp={mi.hp_temp} />
              <HpAdjustForm
                compact
                disabled={hpMutation.isPending}
                onApply={(delta, tempDelta) => hpMutation.mutate({ id: mi.id, delta, tempDelta })}
              />
              <MonsterInstanceAttacks
                instance={mi}
                monster={bestiaryQuery.data?.monsters.find((m) => m.id === mi.monster_id)}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// One attack/damage roll pair per monster action that actually has an
// attackBonus (support actions like "Nimble Escape" have no roll to trigger,
// so they're just omitted rather than shown inert) — lets the DM choose
// between a monster's available attacks (e.g. Scimitar vs Shortbow) exactly
// like InventoryPanel's per-weapon buttons do for characters.
function MonsterInstanceAttacks({ instance, monster }: { instance: MonsterInstance; monster: MonsterCatalogEntry | undefined }) {
  const damageTypesQuery = useDamageTypesCatalog();
  const { t } = useLocale();
  if (!monster || !Array.isArray(monster.actions)) return null;
  const actions = (monster.actions as StatBlockEntry[]).filter((a) => typeof a.attackBonus === 'number');
  if (actions.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2">
      {actions.map((action, i) => {
        const parsedDamage = action.damageDice ? parseDiceExpression(action.damageDice) : null;
        const damageTypeName = damageTypesQuery.data?.damageTypes.find((dt) => dt.name === action.damageType)?.name ?? action.damageType;
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500 w-20 flex-shrink-0 truncate">{action.name}</span>
            <DiceRoller
              rollType="attack"
              rollContext={`${monster.name} — ${action.name}`}
              modifier={action.attackBonus!}
              monsterInstanceId={instance.id}
              triggerLabel={t('monsters.instances.attackLabel')}
            />
            {parsedDamage && (
              <DiceRoller
                rollType="damage"
                rollContext={`${monster.name} — ${action.name}${damageTypeName ? ` (${damageTypeName})` : ''}`}
                modifier={parsedDamage.modifier}
                diceSides={parsedDamage.sides}
                diceCount={parsedDamage.count}
                monsterInstanceId={instance.id}
                triggerLabel={t('monsters.instances.damageLabel')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
