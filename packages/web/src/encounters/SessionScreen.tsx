// The merged map + session screen (nav point 3) — one map-first layout used
// at EVERY encounter status, replacing both the old separate "prep-mode
// roster" (CombatTracker.tsx used to render its own plain list before an
// encounter went active) and BattleMode.tsx (which only existed once
// status === 'active'). The map is the ONLY permanent element — it always
// fills the full available area. A slim top bar (initiative strip + three
// toggle buttons) is the persistent minimal overlay; everything else
// (participant sheet, DM/player controls, combat log, chat) floats over the
// map in SessionOverlayPanel rather than living in a resizable side column,
// per user feedback that the earlier resizable-split version made the map
// feel cramped and buried per-participant detail in a permanent tab strip.
//
// Clicking a token (BattleMap's onOpenSheet) or an initiative-strip chip
// opens the overlay showing that participant's ParticipantSheetPanel.

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Character, Encounter, MonsterCatalogEntry, MonsterInstance, SnapshotParticipant } from '../lib/types';
import type { ApplyEffectFormInput } from '../components/EffectApplyDialog';
import { EmptyState } from '../components/Feedback';
import { BattleMap } from './BattleMap';
import { BattleModeDmPanel, type MutationLike } from './BattleModeDmPanel';
import { BattleModePlayerPanel } from './BattleModePlayerPanel';
import { InitiativeStrip } from './InitiativeStrip';
import { CombatLogPanel } from './CombatLogPanel';
import { ParticipantSheetPanel } from './ParticipantSheetPanel';
import { SessionOverlayPanel } from './SessionOverlayPanel';
import type { EncounterLiveState } from './useEncounterLive';
import { useLocale } from '../i18n/LocaleContext';

export interface SessionScreenProps {
  encounter: Encounter;
  campaignId: string;
  isDm: boolean;
  live: EncounterLiveState;
  myCharacterIds: Set<string>;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  expandedParticipantId: string | null;
  setExpandedParticipantId: Dispatch<SetStateAction<string | null>>;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
  startMutation: MutationLike<void>;
  endMutation: MutationLike<void>;
  rollInitiativeMutation: MutationLike<boolean>;
  advanceTurnMutation: MutationLike<void>;
  addParticipantMutation: MutationLike<{ characterId?: string; monsterInstanceId?: string }>;
  removeParticipantMutation: MutationLike<string>;
  visibilityMutation: MutationLike<{ participantId: string; visible: boolean }>;
  hpMutation: MutationLike<{ target: 'character' | 'monster'; id: string; delta: number; tempDelta: number }>;
  applyEffectMutation: MutationLike<{ participant: SnapshotParticipant; input: ApplyEffectFormInput }>;
  removeEffectMutation: MutationLike<string>;
  availableCharacters: Character[];
  availableMonsterInstances: MonsterInstance[];
}

type Overlay = 'sheet' | 'manage' | 'log' | 'chat' | null;

export function SessionScreen({
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
  startMutation,
  endMutation,
  rollInitiativeMutation,
  advanceTurnMutation,
  addParticipantMutation,
  removeParticipantMutation,
  visibilityMutation,
  hpMutation,
  applyEffectMutation,
  removeEffectMutation,
  availableCharacters,
  availableMonsterInstances,
}: SessionScreenProps) {
  const { t } = useLocale();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);

  function openSheet(participantId: string) {
    setSelectedParticipantId(participantId);
    setOverlay('sheet');
  }

  const selectedParticipant = selectedParticipantId
    ? (live.participants.find((p) => p.participantId === selectedParticipantId) ?? null)
    : null;

  const overlayTitle =
    overlay === 'sheet'
      ? (selectedParticipant?.name ?? '')
      : overlay === 'manage'
        ? t('encounters.overlay.manageTitle')
        : overlay === 'log'
          ? t('encounters.combatLog.title')
          : t('encounters.sheet.chatButton');

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col gap-2">
      <div className="sticky top-0 z-30 flex flex-shrink-0 items-center gap-2 rounded-md bg-stone-950/95 backdrop-blur-sm py-1.5 -mx-1 px-1">
        <div className="min-w-0 flex-1">
          <InitiativeStrip participants={live.participants} activeParticipantId={live.activeParticipantId} onSelect={openSheet} />
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <OverlayToggleButton active={overlay === 'manage'} onClick={() => setOverlay((o) => (o === 'manage' ? null : 'manage'))}>
            {t('encounters.sheet.manageButton')}
          </OverlayToggleButton>
          <OverlayToggleButton active={overlay === 'log'} onClick={() => setOverlay((o) => (o === 'log' ? null : 'log'))}>
            {t('encounters.sheet.logButton')}
          </OverlayToggleButton>
          <OverlayToggleButton active={overlay === 'chat'} onClick={() => setOverlay((o) => (o === 'chat' ? null : 'chat'))}>
            {t('encounters.sheet.chatButton')}
          </OverlayToggleButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <BattleMap
          encounterId={encounter.id}
          campaignId={campaignId}
          map={live.map}
          participants={live.participants}
          activeParticipantId={live.activeParticipantId}
          encounter={live.encounter}
          isDm={isDm}
          myCharacterIds={myCharacterIds}
          onOpenSheet={openSheet}
        />
      </div>

      <SessionOverlayPanel open={overlay !== null} onClose={() => setOverlay(null)} title={overlayTitle}>
        {overlay === 'sheet' && selectedParticipant && (
          <ParticipantSheetPanel
            participant={selectedParticipant}
            isDm={isDm}
            encounterId={encounter.id}
            characters={characters}
            monsterInstances={monsterInstances}
            monsters={monsters}
            allParticipants={live.participants}
            myCharacterIds={myCharacterIds}
            activeParticipantId={live.activeParticipantId}
            onClose={() => setOverlay(null)}
            onRemoveEffect={isDm ? (effectId) => removeEffectMutation.mutate(effectId) : undefined}
          />
        )}
        {overlay === 'manage' &&
          (isDm ? (
            <BattleModeDmPanel
              encounterId={encounter.id}
              status={live.encounter.status}
              live={live}
              characters={characters}
              monsterInstances={monsterInstances}
              monsters={monsters}
              expandedParticipantId={expandedParticipantId}
              setExpandedParticipantId={setExpandedParticipantId}
              showDiceRoller={showDiceRoller}
              setShowDiceRoller={setShowDiceRoller}
              startMutation={startMutation}
              endMutation={endMutation}
              rollInitiativeMutation={rollInitiativeMutation}
              advanceTurnMutation={advanceTurnMutation}
              addParticipantMutation={addParticipantMutation}
              removeParticipantMutation={removeParticipantMutation}
              visibilityMutation={visibilityMutation}
              hpMutation={hpMutation}
              applyEffectMutation={applyEffectMutation}
              removeEffectMutation={removeEffectMutation}
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
          ))}
        {overlay === 'log' && <CombatLogPanel encounterId={encounter.id} />}
        {overlay === 'chat' && <EmptyState message={t('encounters.sheet.chatComingSoon')} />}
      </SessionOverlayPanel>
    </div>
  );
}

function OverlayToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 rounded-md px-2.5 text-xs font-medium transition-colors ${
        active ? 'bg-amber-950 text-amber-400' : 'bg-stone-900 text-stone-400 hover:bg-stone-800 hover:text-stone-200'
      }`}
    >
      {children}
    </button>
  );
}
