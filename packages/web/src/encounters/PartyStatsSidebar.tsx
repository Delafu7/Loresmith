// Always-visible participant roster for MapSectionPage.tsx — every
// participant's HP/AC at a glance, matching design/map.html's right-side
// panel pattern (a synced list beside the map) but showing full stats
// rather than just names, per explicit user feedback that positioning
// tokens needs stats visible without opening anything. Single click opens
// the same ParticipantSheetPanel the map's own double-click does — this
// list isn't a move-targeting surface, so it has no reason to withhold the
// sheet the way Token.tsx's single click deliberately does.
import type { Character, SnapshotParticipant } from '../lib/types';
import { Portrait } from '../components/Portrait';
import { ParticipantHpDisplay } from '../components/ParticipantHpDisplay';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { CONTROL_BADGE_DOT_COLOR, controlBadgeFor, controlBadgeLabel } from './controlBadge';

const FACTION_RING: Record<SnapshotParticipant['faction'], string> = {
  player: 'ring-sky-500',
  ally: 'ring-emerald-500',
  enemy: 'ring-red-600',
  neutral: 'ring-stone-500',
};

export function PartyStatsSidebar({
  participants,
  activeParticipantId,
  characters,
  onSelect,
}: {
  participants: SnapshotParticipant[];
  activeParticipantId: string | null;
  /** Iteration 2 "Character ownership vs. control" — undefined renders every
   * row with no control badge, same as before this iteration. */
  characters?: Character[];
  onSelect: (participantId: string) => void;
}) {
  const { t } = useLocale();
  const { user } = useAuth();

  if (participants.length === 0) {
    return <p className="text-sm text-stone-500 italic p-3">{t('encounters.tracker.noParticipantsYet')}</p>;
  }

  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-2">
      {participants.map((p) => {
        const badge = controlBadgeFor(p.characterId, characters, user?.id);
        return (
        <li key={p.participantId}>
          <button
            type="button"
            onClick={() => onSelect(p.participantId)}
            className={`flex w-full items-center gap-2.5 rounded-md bg-stone-900 p-2 text-left shadow-sm transition-colors hover:bg-stone-800 ${
              p.participantId === activeParticipantId ? 'outline outline-1 outline-amber-500' : ''
            }`}
          >
            <div className={`relative flex-shrink-0 rounded-full ring-2 ${FACTION_RING[p.faction]}`}>
              <Portrait fileUrl={p.imageUrl} alt={p.name} shape="circle" size="sm" placeholderLabel={p.name} />
              {badge && (
                <span
                  title={controlBadgeLabel(t, badge)}
                  aria-label={controlBadgeLabel(t, badge)}
                  className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-1 ring-stone-950 ${CONTROL_BADGE_DOT_COLOR[badge]}`}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-stone-100">{p.name}</span>
                <span className="flex-shrink-0 text-[11px] text-stone-500">{t('encounters.tracker.armorClass')} {p.armorClass}</span>
              </div>
              <ParticipantHpDisplay hp={p.hp} />
            </div>
          </button>
        </li>
        );
      })}
    </ul>
  );
}
