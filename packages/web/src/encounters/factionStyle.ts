// Single source of truth for the faction -> color mapping shown on both the
// map (Token.tsx) and the VTT roster sidebar (PartyStatsSidebar.tsx) — those
// two previously hand-rolled three separate Records with the same
// player/ally/enemy/neutral -> color-family intent (a border ring on the
// map's full portrait, a bg dot on the map's simplified mobile token, a ring
// on the sidebar's portrait), which could silently drift out of sync.
// Tailwind's class scanner needs complete literal class strings in source
// (not `border-${color}-500`-style interpolation), so this stays a lookup of
// full class names per usage rather than a single color name a caller
// recombines — the "one mapping" the class scanner can see, not one string.
import type { SnapshotParticipant } from '../lib/types';

export const FACTION_STYLES: Record<SnapshotParticipant['faction'], { border: string; bg: string; ring: string }> = {
  player: { border: 'border-sky-500', bg: 'bg-sky-600', ring: 'ring-sky-500' },
  ally: { border: 'border-emerald-500', bg: 'bg-emerald-600', ring: 'ring-emerald-500' },
  enemy: { border: 'border-red-600', bg: 'bg-red-700', ring: 'ring-red-600' },
  neutral: { border: 'border-stone-500', bg: 'bg-stone-600', ring: 'ring-stone-500' },
};
