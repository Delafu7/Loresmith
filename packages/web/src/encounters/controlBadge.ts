// Iteration 2 "Character ownership vs. control" — the shared visual-language
// helper for Token.tsx, PartyStatsSidebar.tsx, and BattleModeDmPanel.tsx's
// roster rows: a small corner/inline badge distinguishing "mine,"
// "temporarily mine" (delegated to me), "another player's," and "GM-run,"
// per the plan's explicit call for consistent visual language across all
// three surfaces rather than three independently-invented ones. Deliberately
// NOT a full token recolor — see factionStyle.ts's FACTION_STYLES, which
// already owns the friend/foe color language and shouldn't be fought with a
// second one.
import type { Character } from '../lib/types';
import type { TranslationKey } from '../i18n/LocaleContext';

export type ControlBadgeKind = 'mine' | 'delegated' | 'other' | 'gm';

// Returns null for a monster-instance participant or a DM-run NPC character
// — those aren't part of the ownership/control system at all, so a badge
// there would just be noise. 'gm' is reserved for a PC that's genuinely
// unclaimed (owner_user_id null) and therefore run by the DM until claimed.
export function controlBadgeFor(
  characterId: string | null,
  characters: Character[] | undefined,
  myUserId: string | undefined,
): ControlBadgeKind | null {
  if (characterId == null) return null;
  const c = characters?.find((ch) => ch.id === characterId);
  if (!c || !c.is_pc) return null;
  if (c.owner_user_id == null) return 'gm';
  const effectiveController = c.controller_user_id ?? c.owner_user_id;
  if (effectiveController !== myUserId) return 'other';
  return c.controller_user_id != null && c.controller_user_id !== c.owner_user_id ? 'delegated' : 'mine';
}

export const CONTROL_BADGE_DOT_COLOR: Record<ControlBadgeKind, string> = {
  mine: 'bg-sky-500',
  delegated: 'bg-violet-500',
  other: 'bg-stone-500',
  gm: 'bg-amber-600',
};

const CONTROL_BADGE_LABEL_KEY: Record<ControlBadgeKind, TranslationKey> = {
  mine: 'encounters.control.mine',
  delegated: 'encounters.control.delegated',
  other: 'encounters.control.other',
  gm: 'encounters.control.gm',
};

export function controlBadgeLabel(t: (key: TranslationKey) => string, kind: ControlBadgeKind): string {
  return t(CONTROL_BADGE_LABEL_KEY[kind]);
}
