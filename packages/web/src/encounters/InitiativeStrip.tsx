// Horizontally-scrolling turn-order strip (docs/design-tokens.md mobile
// pass — "initiative order becomes a horizontally scrolling strip pinned to
// one edge, with the active turn always visible without scrolling"). Sits
// above the full-bleed map as the session screen's persistent minimal
// overlay — this IS the "everything about players and monsters, click by
// their names" surface now that there's no permanent side roster: each chip
// is clickable and opens SessionOverlayPanel's participant sheet, same as
// clicking the token itself. `live.participants` arrives pre-sorted by
// turn_order (services/encounters.ts), so no client-side re-sort.

import { useEffect, useRef } from 'react';
import type { Character, SnapshotParticipant } from '../lib/types';
import { Portrait } from '../components/Portrait';
import { TurnTorch } from '../components/TurnTorch';
import { useLocale } from '../i18n/LocaleContext';
import { CONTROL_BADGE_DOT_COLOR, controlBadgeFor, controlBadgeLabel } from './controlBadge';

export function InitiativeStrip({
  participants,
  activeParticipantId,
  onSelect,
  characters,
  myUserId,
}: {
  participants: SnapshotParticipant[];
  activeParticipantId: string | null;
  /** Opens the clicked participant's sheet in the session screen's floating
   * overlay. Optional so this component stays usable as a pure glance view
   * anywhere a click-to-open-sheet affordance doesn't apply. */
  onSelect?: (participantId: string) => void;
  /** UX finding #5 (Iteration 3 audit) — mine/delegated/other's/GM-run
   * control badges (Token.tsx, PartyStatsSidebar.tsx, BattleModeDmPanel.tsx's
   * roster rows) were missing from the one participant-identity surface
   * that's ALWAYS visible, unlike those three. Both optional so this
   * component still renders (just without badges) anywhere that context
   * isn't available. */
  characters?: Character[];
  myUserId?: string;
}) {
  const { t } = useLocale();
  const activeRef = useRef<HTMLLIElement>(null);

  // "Always visible without scrolling" — auto-scroll the active chip into
  // view whenever the turn advances, so a DM/player never has to manually
  // hunt for it after several turns pass.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeParticipantId]);

  if (participants.length === 0) return null;

  return (
    <ol className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" aria-label={t('encounters.initiativeStrip.turnOrder')}>
      {participants.map((p) => {
        const isActive = p.participantId === activeParticipantId;
        const controlBadge = controlBadgeFor(p.characterId, characters, myUserId);
        return (
          <li
            key={p.participantId}
            ref={isActive ? activeRef : undefined}
            className={`flex flex-none flex-col items-center gap-1 rounded-md px-2 py-1.5 min-w-14 ${
              isActive ? 'bg-amber-950/40 outline outline-1 outline-amber-600' : 'bg-stone-900'
            }`}
          >
            {isActive && <TurnTorch size={12} className="text-amber-500" />}
            <button
              type="button"
              onClick={() => onSelect?.(p.participantId)}
              disabled={!onSelect}
              aria-label={t('encounters.initiativeStrip.openSheet', { name: p.name })}
              className={`relative rounded-full ${isActive ? 'outline outline-2 outline-amber-500' : ''} ${onSelect ? 'cursor-pointer' : ''}`}
            >
              <Portrait fileUrl={p.imageUrl} alt={p.name} shape="circle" size="sm" placeholderLabel={p.name} />
              {controlBadge && (
                <span
                  title={controlBadgeLabel(t, controlBadge)}
                  aria-label={controlBadgeLabel(t, controlBadge)}
                  className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-stone-950 ${CONTROL_BADGE_DOT_COLOR[controlBadge]}`}
                />
              )}
            </button>
            <span className={`max-w-14 truncate text-[10px] ${isActive ? 'text-amber-400' : 'text-stone-400'}`}>
              {p.name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
