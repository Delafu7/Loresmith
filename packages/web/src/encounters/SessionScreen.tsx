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

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Character, Encounter, EncounterDisposition, MonsterCatalogEntry, MonsterInstance, SnapshotParticipant } from '../lib/types';
import type { ApplyEffectFormInput } from '../components/EffectApplyDialog';
import { EmptyState } from '../components/Feedback';
import { BattleMap } from './BattleMap';
import { BattleModeDmPanel, type MutationLike } from './BattleModeDmPanel';
import { BattleModePlayerPanel } from './BattleModePlayerPanel';
import { InitiativeStrip } from './InitiativeStrip';
import { CombatLogPanel } from './CombatLogPanel';
import { ConcentrationCheckPrompt } from './ConcentrationCheckPrompt';
import { LairActionBanner, LairActionsEditor, TerrainNotesPanel } from './LairActions';
import { XpBudgetPanel } from './XpBudgetPanel';
import { DispositionBadge, DispositionHistoryPanel } from './DispositionPanel';
import { ParticipantSheetPanel } from './ParticipantSheetPanel';
import { SessionOverlayPanel } from './SessionOverlayPanel';
import { AddToEncounterOverlay, type AsyncMutationLike } from './AddToEncounterOverlay';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import type { EncounterLiveState } from './useEncounterLive';
import type { SpawnParticipantsBody } from './useEncounterSessionData';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../auth/AuthContext';

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
  startCombatMutation: MutationLike<void>;
  endCombatMutation: MutationLike<void>;
  dispositionMutation: MutationLike<{ toDisposition: EncounterDisposition; note?: string }>;
  forceFullscreenMutation: MutationLike<void>;
  rollInitiativeMutation: MutationLike<boolean>;
  advanceTurnMutation: MutationLike<void>;
  addParticipantMutation: AsyncMutationLike<{ characterId?: string; monsterInstanceId?: string }, { participant: { id: string } }>;
  spawnMutation: AsyncMutationLike<SpawnParticipantsBody, { participants: Array<{ id: string }> }>;
  removeParticipantMutation: MutationLike<string>;
  visibilityMutation: MutationLike<{ participantId: string; visible: boolean }>;
  hpMutation: MutationLike<{ target: 'character' | 'monster'; id: string; delta: number; tempDelta: number }>;
  applyEffectMutation: MutationLike<{ participant: SnapshotParticipant; input: ApplyEffectFormInput }>;
  removeEffectMutation: MutationLike<string>;
  availableCharacters: Character[];
  availableMonsterInstances: MonsterInstance[];
  /** LiveMapPage.tsx (map-first encounter system) already wraps this in a
   * properly height-constrained flex container (no app header above it) —
   * `h-full` there instead of the embedded /session view's own `100dvh`
   * estimate, which assumes a specific amount of chrome above it that the
   * fullscreen route doesn't have. Defaults to the embedded behavior. */
  fullHeight?: boolean;
  /** The reduced Session/prep page (EncountersPage → CombatTracker) no
   * longer shows the map at all — positioning tokens now happens on its own
   * dedicated Map section (MapSectionPage.tsx), so DM roster/prep controls
   * (Manage/Log/Chat overlay, initiative strip) stay here without the
   * battle-grid surface duplicating what the Map section already owns.
   * Defaults to true (LiveMapPage's fullscreen combat view always shows it). */
  showMap?: boolean;
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
  startCombatMutation,
  endCombatMutation,
  dispositionMutation,
  forceFullscreenMutation,
  rollInitiativeMutation,
  advanceTurnMutation,
  addParticipantMutation,
  spawnMutation,
  removeParticipantMutation,
  visibilityMutation,
  hpMutation,
  applyEffectMutation,
  removeEffectMutation,
  availableCharacters,
  availableMonsterInstances,
  fullHeight = false,
  showMap = true,
}: SessionScreenProps) {
  const { t } = useLocale();
  const { user } = useAuth();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [addOverlayOpen, setAddOverlayOpen] = useState(false);

  // Cmd/Ctrl+K trigger, scoped to this screen (not app-global — see
  // AddToEncounterOverlay.tsx's header note on why). DM-only, matching the
  // trigger button below.
  useEffect(() => {
    if (!isDm) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAddOverlayOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDm]);

  function openSheet(participantId: string) {
    setSelectedParticipantId(participantId);
    setOverlay('sheet');
  }

  // UX finding #4 (Iteration 3 audit) — the dice roller used to live INSIDE
  // the Manage overlay's content (BattleModeDmPanel/BattleModePlayerPanel),
  // so switching to the Log or a participant Sheet overlay hid it entirely
  // even though showDiceRoller was still true — checking a stat block, then
  // the log, then rolling dice meant closing and reopening panels three
  // times. Floats independently now, in its own fixed panel, visible
  // alongside whichever (if any) of sheet/manage/log/chat is also open.
  //
  // characterId resolution here is deliberately simpler than
  // BattleModePlayerPanel's own multi-character switcher (first seated
  // match, not the full switcher UI) — this is a quick-access convenience
  // for the common single-character case; a player controlling two
  // characters who needs to roll specifically as the second one still has
  // the full switcher inside the Manage overlay itself.
  const myParticipant = !isDm
    ? live.participants.find((p) => p.characterId != null && myCharacterIds.has(p.characterId))
    : undefined;

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

  // DM roster/HP/add-participant controls (or the player's read-only
  // equivalent) — shared between the map view's floating "Manage" overlay
  // and the mapless Session/prep page below, which shows this INLINE
  // instead: with no map to look at, hiding the roster behind a click left
  // that page looking almost empty by default.
  const managePanel = isDm ? (
    <>
      <TerrainNotesPanel campaignId={campaignId} encounter={encounter} isDm />
      <XpBudgetPanel campaignId={campaignId} encounterId={encounter.id} />
      <LairActionsEditor campaignId={campaignId} encounter={encounter} />
      <BattleModeDmPanel
        encounterId={encounter.id}
        status={live.encounter.status}
        live={live}
        characters={characters}
        monsterInstances={monsterInstances}
        monsters={monsters}
        expandedParticipantId={expandedParticipantId}
        setExpandedParticipantId={setExpandedParticipantId}
        startMutation={startMutation}
        endMutation={endMutation}
        startCombatMutation={startCombatMutation}
        endCombatMutation={endCombatMutation}
        dispositionMutation={dispositionMutation}
        forceFullscreenMutation={forceFullscreenMutation}
        rollInitiativeMutation={rollInitiativeMutation}
        advanceTurnMutation={advanceTurnMutation}
        removeParticipantMutation={removeParticipantMutation}
        visibilityMutation={visibilityMutation}
        hpMutation={hpMutation}
        applyEffectMutation={applyEffectMutation}
        removeEffectMutation={removeEffectMutation}
      />
    </>
  ) : (
    <>
      <TerrainNotesPanel campaignId={campaignId} encounter={encounter} isDm={false} />
      <BattleModePlayerPanel
        encounterId={encounter.id}
        live={live}
        myCharacterIds={myCharacterIds}
        characters={characters}
      />
    </>
  );

  return (
    <div className={`flex min-h-[420px] flex-col gap-2 ${fullHeight ? 'h-full' : 'h-[calc(100dvh-9rem)]'}`}>
      <div className="sticky top-0 z-30 flex flex-shrink-0 items-center gap-2 rounded-md bg-stone-950/95 backdrop-blur-sm py-1.5 -mx-1 px-1">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <DispositionBadge disposition={live.encounter.disposition} />
          <InitiativeStrip
            participants={live.participants}
            activeParticipantId={live.activeParticipantId}
            onSelect={openSheet}
            characters={characters}
            myUserId={user?.id}
          />
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {/* Always visible (not gated by showMap like Manage below) — the
              highest-priority ask this overlay exists for is adding
              creatures without ever leaving the live view, on both the
              fullscreen map and the mapless prep page. */}
          {isDm && (
            <button
              type="button"
              onClick={() => setAddOverlayOpen(true)}
              aria-label={t('encounters.addOverlay.trigger')}
              title={t('encounters.addOverlay.trigger')}
              className="flex min-h-9 items-center justify-center rounded-md bg-stone-900 px-2.5 text-sm font-medium text-stone-400 hover:bg-stone-800 hover:text-stone-200"
            >
              +
            </button>
          )}
          {/* Redundant once the panel is shown inline below (mapless
              Session page) — a toggle for something that's already always
              visible has nothing to do. */}
          {showMap && (
            <OverlayToggleButton active={overlay === 'manage'} onClick={() => setOverlay((o) => (o === 'manage' ? null : 'manage'))}>
              {t('encounters.sheet.manageButton')}
            </OverlayToggleButton>
          )}
          <OverlayToggleButton active={overlay === 'log'} onClick={() => setOverlay((o) => (o === 'log' ? null : 'log'))}>
            {t('encounters.sheet.logButton')}
          </OverlayToggleButton>
          <OverlayToggleButton active={overlay === 'chat'} onClick={() => setOverlay((o) => (o === 'chat' ? null : 'chat'))}>
            {t('encounters.sheet.chatButton')}
          </OverlayToggleButton>
          {/* Independent of `overlay` on purpose — see the showDiceRoller
              comment above (UX finding #4). */}
          <OverlayToggleButton active={showDiceRoller} onClick={() => setShowDiceRoller((s) => !s)}>
            {t('encounters.tracker.rollDice')}
          </OverlayToggleButton>
        </div>
      </div>

      {showMap ? (
        <div className="min-h-0 flex-1">
          <BattleMap
            encounterId={encounter.id}
            campaignId={campaignId}
            map={live.map}
            participants={live.participants}
            mapElements={live.mapElements}
            activeParticipantId={live.activeParticipantId}
            encounter={live.encounter}
            isDm={isDm}
            myCharacterIds={myCharacterIds}
            characters={characters}
            onOpenSheet={openSheet}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">{managePanel}</div>
      )}

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
        {overlay === 'manage' && showMap && managePanel}
        {overlay === 'log' && (
          <div className="space-y-4">
            <DispositionHistoryPanel encounterId={encounter.id} />
            <CombatLogPanel encounterId={encounter.id} participants={live.participants} />
          </div>
        )}
        {overlay === 'chat' && <EmptyState message={t('encounters.sheet.chatComingSoon')} />}
      </SessionOverlayPanel>

      <ConcentrationCheckPrompt encounterId={encounter.id} isDm={isDm} />
      <LairActionBanner encounterId={encounter.id} />

      {showDiceRoller && (
        // Bottom-LEFT and above SessionOverlayPanel's z-40 backdrop+drawer
        // (which docks full-height on the right) — the whole point of this
        // panel is to stay usable and visible while that overlay is also
        // open, not to fight it for the same screen corner.
        <div className="fixed bottom-2 left-2 z-50 w-[min(22rem,calc(100vw-1rem))] max-h-[70vh] overflow-y-auto">
          <QuickDiceRoller encounterId={encounter.id} characterId={myParticipant?.characterId ?? undefined} />
        </div>
      )}

      {isDm && (
        <AddToEncounterOverlay
          open={addOverlayOpen}
          onClose={() => setAddOverlayOpen(false)}
          campaignId={campaignId}
          monsters={monsters}
          availableCharacters={availableCharacters}
          availableMonsterInstances={availableMonsterInstances}
          addParticipantMutation={addParticipantMutation}
          spawnMutation={spawnMutation}
          removeParticipantMutation={removeParticipantMutation}
        />
      )}
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
