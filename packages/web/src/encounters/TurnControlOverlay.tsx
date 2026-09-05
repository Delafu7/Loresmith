// Live Map turn overlay — brings "roll initiative" / "next turn" /
// "previous turn" onto the map canvas itself (a fixed corner panel,
// collapsible), so the DM never has to leave the map view or open the
// separate Manage overlay (BattleModeDmPanel.tsx, still the place for
// roster/HP/effects editing) just to move combat forward. Reuses the exact
// same mutations that panel already calls — this component adds no new
// combat logic, only a second, map-local place to trigger it.
//
// Rendered as the last child inside BattleMap's own pan/zoom container (see
// BattleMap.tsx), OUTSIDE the transformed viewport div, so its screen
// position stays fixed to the map's corner regardless of pan/zoom. Every
// pointer/wheel event is stopped from bubbling to that container's own
// pan/zoom handlers (BattleMap.tsx's handleMapPointerDown + its native wheel
// listener) — the same stopPropagation contract Token.tsx already uses for
// its own drag handle, so this panel can never leak into a map pan the way
// the token-drag regression fixed in 85bd0d5 did.
import { useEffect, useState } from 'react';
import type { Character, EncounterMode, SnapshotParticipant } from '../lib/types';
import { InitiativeStrip } from './InitiativeStrip';
import { TurnTorch } from '../components/TurnTorch';
import { useLocale } from '../i18n/LocaleContext';
import type { MutationLike } from './BattleModeDmPanel';

export interface TurnControlOverlayProps {
  mode: EncounterMode;
  participants: SnapshotParticipant[];
  activeParticipantId: string | null;
  characters?: Character[];
  myUserId?: string;
  onSelect?: (participantId: string) => void;
  rollInitiativeMutation: MutationLike<boolean>;
  advanceTurnMutation: MutationLike<void>;
  previousTurnMutation: MutationLike<void>;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// This overlay is DM-only (every action it triggers requires the DM role
// server-side — requireEncounterDm on /roll-initiative, /advance-turn,
// /previous-turn); a player's initiative order is already always visible in
// the sticky strip above the map (SessionScreen.tsx), so hiding this panel
// for non-DM viewers doesn't remove anything they could otherwise see.
export function TurnControlOverlay({
  mode,
  participants,
  activeParticipantId,
  characters,
  myUserId,
  onSelect,
  rollInitiativeMutation,
  advanceTurnMutation,
  previousTurnMutation,
}: TurnControlOverlayProps) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const inCombat = mode === 'combat';
  const activeParticipant = participants.find((p) => p.participantId === activeParticipantId);

  // Alt+Left/Alt+Right advance/retreat the turn without touching the mouse —
  // scoped to whenever this overlay is mounted (i.e. the map is visible),
  // skipped while focus is on any text input/textarea/select/contenteditable
  // elsewhere on the page (map coordinate fields, terrain notes, chat) so it
  // never hijacks normal text editing.
  useEffect(() => {
    if (!inCombat) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.altKey || isEditableTarget(e.target)) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (!advanceTurnMutation.isPending) advanceTurnMutation.mutate();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!previousTurnMutation.isPending) previousTurnMutation.mutate();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inCombat, advanceTurnMutation, previousTurnMutation]);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      style={{ touchAction: 'auto' }}
      className="absolute top-2 right-2 z-20 w-56 max-w-[calc(100%-1rem)] overflow-hidden rounded-md bg-stone-950/95 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-stone-200">
          <TurnTorch size={14} className="flex-shrink-0 text-amber-500" />
          <span className="truncate">
            {inCombat
              ? (activeParticipant ? activeParticipant.name : t('encounters.tracker.waitingForInitiative'))
              : t('encounters.battleMode.mode.exploration')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('encounters.turnOverlay.expand') : t('encounters.turnOverlay.collapse')}
          title={collapsed ? t('encounters.turnOverlay.expand') : t('encounters.turnOverlay.collapse')}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-800 hover:text-stone-200"
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="space-y-2 border-t border-stone-800 px-2 py-2">
          <InitiativeStrip
            participants={participants}
            activeParticipantId={activeParticipantId}
            onSelect={onSelect}
            characters={characters}
            myUserId={myUserId}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => previousTurnMutation.mutate()}
              disabled={!inCombat || previousTurnMutation.isPending}
              aria-label={t('encounters.turnOverlay.previousTurn')}
              title={t('encounters.turnOverlay.previousTurnShortcut')}
              className="flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md bg-stone-900 px-2 text-xs font-medium text-stone-300 hover:bg-stone-800 disabled:opacity-40"
            >
              ← {t('encounters.turnOverlay.previousTurnShort')}
            </button>
            <button
              type="button"
              onClick={() => advanceTurnMutation.mutate()}
              disabled={!inCombat || advanceTurnMutation.isPending}
              aria-label={t('encounters.turnOverlay.nextTurn')}
              title={t('encounters.turnOverlay.nextTurnShortcut')}
              className="flex min-h-11 min-w-11 flex-1 items-center justify-center rounded-md bg-stone-900 px-2 text-xs font-medium text-stone-300 hover:bg-stone-800 disabled:opacity-40"
            >
              {t('encounters.turnOverlay.nextTurnShort')} →
            </button>
          </div>
          <button
            type="button"
            onClick={() => rollInitiativeMutation.mutate(true)}
            disabled={rollInitiativeMutation.isPending || participants.length === 0}
            aria-label={t('encounters.tracker.rollInitiative')}
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-stone-900 px-2 text-xs font-medium text-stone-300 hover:bg-stone-800 disabled:opacity-40"
          >
            {t('encounters.tracker.rollInitiative')}
          </button>
        </div>
      )}
    </div>
  );
}
