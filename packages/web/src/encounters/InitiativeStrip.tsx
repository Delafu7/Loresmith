// Horizontally-scrolling turn-order strip (docs/design-tokens.md mobile
// pass — "initiative order becomes a horizontally scrolling strip pinned to
// one edge, with the active turn always visible without scrolling"). Sits
// above BattleMode's map+panel split so it's visible immediately, without
// scrolling into either the map or the (already scrollable) detailed
// roster panel below it — this is a compact glance view, not a replacement
// for that panel. `live.participants` arrives pre-sorted by turn_order
// (services/encounters.ts), so no client-side re-sort.

import { useEffect, useRef } from 'react';
import type { SnapshotParticipant } from '../lib/types';
import { TurnTorch } from '../components/TurnTorch';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function InitiativeStrip({
  participants,
  activeParticipantId,
}: {
  participants: SnapshotParticipant[];
  activeParticipantId: number | null;
}) {
  const activeRef = useRef<HTMLLIElement>(null);

  // "Always visible without scrolling" — auto-scroll the active chip into
  // view whenever the turn advances, so a DM/player never has to manually
  // hunt for it after several turns pass.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeParticipantId]);

  if (participants.length === 0) return null;

  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Turn order">
      {participants.map((p) => {
        const isActive = p.participantId === activeParticipantId;
        return (
          <li
            key={p.participantId}
            ref={isActive ? activeRef : undefined}
            className={`flex flex-none flex-col items-center gap-1 rounded-md px-2 py-1.5 min-w-14 ${
              isActive ? 'bg-amber-950/40 outline outline-1 outline-amber-600' : 'bg-stone-900'
            }`}
          >
            {isActive && <TurnTorch size={12} className="text-amber-500" />}
            <div
              className={`flex size-8 items-center justify-center rounded-full text-[10px] font-semibold text-white ${
                isActive ? 'bg-amber-600' : 'bg-stone-700'
              }`}
              aria-hidden="true"
            >
              {initials(p.name)}
            </div>
            <span className={`max-w-14 truncate text-[10px] ${isActive ? 'text-amber-400' : 'text-stone-400'}`}>
              {p.name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
