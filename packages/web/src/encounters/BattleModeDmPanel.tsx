// DM side panel for battle mode (REVISION-PLAN.md §10.2) — everything the DM
// needs while an encounter is 'active' without leaving the map view: whose
// turn it is, a compact roster (HP/AC/stat-lookup, same building blocks the
// prep-mode roster already uses), turn controls, the dice roller, and the
// add-participant form. Every mutation/query here is owned by CombatTracker
// and threaded through as props — this file never fetches or mutates
// anything on its own.

import type { Dispatch, SetStateAction } from 'react';
import type { Character, MonsterCatalogEntry, MonsterInstance } from '../lib/types';
import { isExactHp } from '../lib/types';
import type { EncounterLiveState } from './useEncounterLive';
import { HPBar, HPBandPill } from '../components/HPBar';
import { EmptyState } from '../components/Feedback';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { TurnTorch } from '../components/TurnTorch';
import {
  ActionButton,
  AddParticipantForm,
  ParticipantArmorClassReveal,
  ParticipantStatLookup,
  ResetRevealsButton,
} from './CombatTracker';

// Structural (not TanStack's own UseMutationResult<...>) on purpose — this
// panel only ever calls `.mutate(...)`/reads `.isPending` on whichever
// mutation objects CombatTracker hands it, so a minimal shape keeps this
// file decoupled from the exact TData/TError generics those mutations
// happen to infer.
export interface MutationLike<TVariables = void> {
  mutate: (variables: TVariables) => void;
  isPending: boolean;
}

export interface BattleModeDmPanelProps {
  encounterId: number;
  live: EncounterLiveState;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  expandedParticipantId: number | null;
  setExpandedParticipantId: Dispatch<SetStateAction<number | null>>;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
  endMutation: MutationLike<void>;
  rollInitiativeMutation: MutationLike<boolean>;
  advanceTurnMutation: MutationLike<void>;
  addParticipantMutation: MutationLike<{ characterId?: number; monsterInstanceId?: number }>;
  availableCharacters: Character[];
  availableMonsterInstances: MonsterInstance[];
}

export function BattleModeDmPanel({
  encounterId,
  live,
  characters,
  monsterInstances,
  monsters,
  expandedParticipantId,
  setExpandedParticipantId,
  showDiceRoller,
  setShowDiceRoller,
  endMutation,
  rollInitiativeMutation,
  advanceTurnMutation,
  addParticipantMutation,
  availableCharacters,
  availableMonsterInstances,
}: BattleModeDmPanelProps) {
  const activeParticipant = live.participants.find((p) => p.participantId === live.activeParticipantId);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-800 bg-stone-900 p-3">
        <p className="text-xs uppercase text-stone-500">Round {live.encounter.currentRound}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <TurnTorch size={18} className="text-amber-500 flex-shrink-0" />
          <span className="font-semibold text-stone-100 truncate">
            {activeParticipant ? activeParticipant.name : 'Waiting for initiative…'}
          </span>
        </div>
      </div>

      <ol className="space-y-1.5">
        {live.participants.map((p) => {
          const isActive = p.participantId === live.activeParticipantId;
          const isNpcOrMonster = !(p.characterId != null && characters?.find((c) => c.id === p.characterId)?.is_pc);
          return (
            <li
              key={p.participantId}
              className={`rounded-md border p-2 text-xs ${
                isActive ? 'border-amber-600 bg-amber-950/20' : 'border-stone-800 bg-stone-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isActive && <TurnTorch size={14} className="text-amber-500 flex-shrink-0" />}
                  <span className="font-medium text-stone-100 truncate">{p.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-stone-500 border border-stone-700 rounded px-1" title="Armor Class">
                    AC {p.armorClass ?? '?'}
                  </span>
                  {isNpcOrMonster && (
                    <ParticipantArmorClassReveal characterId={p.characterId} monsterInstanceId={p.monsterInstanceId} />
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedParticipantId((id) => (id === p.participantId ? null : p.participantId))}
                    aria-expanded={expandedParticipantId === p.participantId}
                    aria-label={expandedParticipantId === p.participantId ? `Hide ${p.name}'s stats` : `View ${p.name}'s stats`}
                    title="View full stats"
                    className="inline-flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-200"
                  >
                    {expandedParticipantId === p.participantId ? '▾' : '▸'}
                  </button>
                </div>
              </div>
              <div className="mt-1.5">
                {isExactHp(p.hp) ? (
                  <HPBar current={p.hp.hpCurrent} max={p.hp.hpMax} temp={p.hp.hpTemp} />
                ) : (
                  <HPBandPill band={p.hp.band} />
                )}
              </div>
              {expandedParticipantId === p.participantId && (
                <ParticipantStatLookup
                  participant={p}
                  characters={characters}
                  monsterInstances={monsterInstances}
                  monsters={monsters}
                  encounterId={encounterId}
                  allParticipants={live.participants}
                />
              )}
            </li>
          );
        })}
        {live.participants.length === 0 && <EmptyState message="No participants in this encounter yet." />}
      </ol>

      <div className="flex flex-wrap gap-2">
        <ActionButton onClick={() => rollInitiativeMutation.mutate(false)} pending={rollInitiativeMutation.isPending} variant="secondary">
          Roll initiative
        </ActionButton>
        <ActionButton onClick={() => advanceTurnMutation.mutate()} pending={advanceTurnMutation.isPending}>
          Advance turn
        </ActionButton>
        <ActionButton onClick={() => endMutation.mutate()} pending={endMutation.isPending} variant="danger">
          End encounter
        </ActionButton>
      </div>

      <div className="flex gap-2 items-center justify-between">
        <ActionButton onClick={() => setShowDiceRoller((s) => !s)} variant={showDiceRoller ? 'primary' : 'secondary'}>
          {showDiceRoller ? 'Hide dice' : 'Roll dice'}
        </ActionButton>
        <ResetRevealsButton encounterId={encounterId} />
      </div>
      {showDiceRoller && <QuickDiceRoller encounterId={encounterId} />}

      <AddParticipantForm
        characters={availableCharacters}
        monsterInstances={availableMonsterInstances}
        pending={addParticipantMutation.isPending}
        onAdd={(body) => addParticipantMutation.mutate(body)}
      />
    </div>
  );
}
