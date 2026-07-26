// Battle mode (REVISION-PLAN.md §10.2) — the two-column "map + role-specific
// side panel" layout CombatTracker switches to once an encounter's status is
// 'active', replacing the plain prep-mode roster for BOTH the DM and
// players. Pure layout + role branch: renders the shared BattleMap (same
// props MapsPage.tsx passes it, sourced from CombatTracker's own
// useEncounterLive call — not a second subscription) plus BattleModeDmPanel
// or BattleModePlayerPanel. All state/queries/mutations are owned by
// CombatTracker and threaded through as props.

import type { Dispatch, SetStateAction } from 'react';
import type { Character, Encounter, MonsterCatalogEntry, MonsterInstance } from '../lib/types';
import { BattleMap } from './BattleMap';
import { BattleModeDmPanel, type MutationLike } from './BattleModeDmPanel';
import { BattleModePlayerPanel } from './BattleModePlayerPanel';
import type { EncounterLiveState } from './useEncounterLive';

export interface BattleModeProps {
  encounter: Encounter;
  campaignId: number;
  isDm: boolean;
  live: EncounterLiveState;
  myCharacterIds: Set<number>;
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

export function BattleMode({
  encounter,
  campaignId,
  isDm,
  live,
  myCharacterIds,
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
}: BattleModeProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <BattleMap
          encounterId={encounter.id}
          campaignId={campaignId}
          map={live.map}
          participants={live.participants}
          activeParticipantId={live.activeParticipantId}
          isDm={isDm}
        />
      </div>
      <div className="lg:w-80 flex-shrink-0">
        {isDm ? (
          <BattleModeDmPanel
            encounterId={encounter.id}
            live={live}
            characters={characters}
            monsterInstances={monsterInstances}
            monsters={monsters}
            expandedParticipantId={expandedParticipantId}
            setExpandedParticipantId={setExpandedParticipantId}
            showDiceRoller={showDiceRoller}
            setShowDiceRoller={setShowDiceRoller}
            endMutation={endMutation}
            rollInitiativeMutation={rollInitiativeMutation}
            advanceTurnMutation={advanceTurnMutation}
            addParticipantMutation={addParticipantMutation}
            availableCharacters={availableCharacters}
            availableMonsterInstances={availableMonsterInstances}
          />
        ) : (
          <BattleModePlayerPanel
            encounterId={encounter.id}
            live={live}
            myCharacterIds={myCharacterIds}
            characters={characters}
            showDiceRoller={showDiceRoller}
            setShowDiceRoller={setShowDiceRoller}
          />
        )}
      </div>
    </div>
  );
}
