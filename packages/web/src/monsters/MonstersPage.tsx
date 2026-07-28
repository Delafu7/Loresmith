import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { MonsterCatalogEntry, MonsterInstance, StatBlockEntry } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useDamageTypesCatalog } from '../lib/useCatalog';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { HPBar } from '../components/HPBar';
import { HpAdjustForm } from '../components/HpAdjustForm';
import { StatBlock } from '../components/StatBlock';
import { DiceRoller } from '../components/DiceRoller';
import { parseDiceExpression } from '../components/QuickDiceRoller';

export function MonstersPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creatureTypeFilter, setCreatureTypeFilter] = useState('');
  const [expandedMonsterId, setExpandedMonsterId] = useState<string | null>(null);

  const bestiaryQueryKey = ['catalog', 'monsters', campaign.srd_edition, campaignId];
  const bestiaryQuery = useQuery({
    queryKey: bestiaryQueryKey,
    queryFn: () =>
      api.get<{ monsters: MonsterCatalogEntry[] }>(
        `/catalog/monsters?edition=${campaign.srd_edition}&campaignId=${campaignId}`,
      ),
  });

  const instancesQuery = useQuery({
    queryKey: ['monsterInstances', campaignId],
    queryFn: () => api.get<{ monsterInstances: MonsterInstance[] }>(`/campaigns/${campaignId}/monster-instances`),
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

  if (role !== 'dm') {
    return (
      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
        <ErrorBanner message="The bestiary is only available to the DM." />
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
          <h2 className="text-lg font-semibold">Bestiary</h2>
          <div className="flex items-center gap-2">
            <select
              value={creatureTypeFilter}
              onChange={(e) => setCreatureTypeFilter(e.target.value)}
              className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100"
            >
              <option value="">All types</option>
              {creatureTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => navigate(`/campaigns/${campaignId}/monsters/new`)}
              className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
            >
              + New homebrew creature
            </button>
          </div>
        </div>

        {bestiaryQuery.isLoading && <Loading />}
        {bestiaryQuery.isError && <ErrorBanner message={errorMessage(bestiaryQuery.error)} />}
        {deleteMonsterMutation.isError && <ErrorBanner message={errorMessage(deleteMonsterMutation.error)} />}
        {spawnMutation.isError && <ErrorBanner message={errorMessage(spawnMutation.error)} />}

        <div className="overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full text-sm">
            <thead className="bg-stone-900 text-stone-500 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">CR</th>
                <th className="text-left px-3 py-2">AC</th>
                <th className="text-left px-3 py-2">HP</th>
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
                          Homebrew
                        </span>
                      )}
                      {m.is_unique && (
                        <span className="ml-2 inline-block rounded border border-purple-700 text-purple-400 text-[10px] uppercase px-1 py-0.5 align-middle">
                          Unique
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-stone-400">{m.creature_type}</td>
                    <td className="px-3 py-2 text-stone-400">{m.challenge_rating}</td>
                    <td className="px-3 py-2 text-stone-400">{m.armor_class}</td>
                    <td className="px-3 py-2 text-stone-400">{m.hit_point_average}</td>
                    <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setExpandedMonsterId((cur) => (cur === m.id ? null : m.id))}
                        className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
                      >
                        {expandedMonsterId === m.id ? 'Hide' : 'View'}
                      </button>
                      {m.is_homebrew && (
                        <>
                          <button
                            type="button"
                            onClick={() => navigate(`/campaigns/${campaignId}/monsters/${m.id}/edit`)}
                            className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={deleteMonsterMutation.isPending}
                            onClick={() => {
                              if (confirm(`Delete ${m.name}? This cannot be undone.`)) {
                                deleteMonsterMutation.mutate(m.id);
                              }
                            }}
                            className="text-red-400 hover:text-red-300 text-xs px-1"
                            aria-label={`Delete ${m.name}`}
                          >
                            Delete
                          </button>
                        </>
                      )}
                      {(() => {
                        const alreadySpawned =
                          m.is_unique &&
                          (instancesQuery.data?.monsterInstances.some((mi) => mi.monster_id === m.id) ?? false);
                        return (
                          <button
                            type="button"
                            disabled={spawnMutation.isPending || alreadySpawned}
                            title={alreadySpawned ? 'Unique creature already has an active instance' : undefined}
                            onClick={() => spawnMutation.mutate(m)}
                            className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1 text-xs"
                          >
                            {alreadySpawned ? 'Already spawned' : 'Spawn instance'}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                  {expandedMonsterId === m.id && (
                    <tr className="border-t border-stone-800">
                      <td colSpan={6} className="px-3 py-3 bg-stone-950/40">
                        <StatBlock monster={m} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {filteredMonsters.length === 0 && !bestiaryQuery.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState message="No monsters match this filter." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Monster instances</h2>
        {instancesQuery.isLoading && <Loading />}
        {instancesQuery.isError && <ErrorBanner message={errorMessage(instancesQuery.error)} />}
        {instancesQuery.data && instancesQuery.data.monsterInstances.length === 0 && (
          <EmptyState message="No monster instances yet — spawn one from the bestiary above." />
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
                    onClick={() => deleteInstanceMutation.mutate(mi.id)}
                    className="text-red-400 hover:text-red-300 text-xs"
                    aria-label="Delete instance"
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
              triggerLabel="⚄ Attack"
            />
            {parsedDamage && (
              <DiceRoller
                rollType="damage"
                rollContext={`${monster.name} — ${action.name}${damageTypeName ? ` (${damageTypeName})` : ''}`}
                modifier={parsedDamage.modifier}
                diceSides={parsedDamage.sides}
                diceCount={parsedDamage.count}
                monsterInstanceId={instance.id}
                triggerLabel="🩸 Damage"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
