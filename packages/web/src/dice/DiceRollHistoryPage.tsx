import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { DiceRoll } from '../lib/types';
import type { DiceRolledEvent } from '../lib/socketTypes';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useSocket } from '../lib/SocketContext';
import { DieFace, keptDieIndex } from '../components/DiceRoller';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { formatModifier } from '../lib/dnd-math';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

// Campaign-wide roll history (PLAN.md §6.6/Phase 3.4). Two independent data
// sources feed this list rather than one merged cache:
//  - `historyRolls`: paginated via GET /campaigns/:id/dice-rolls (manual
//    cursor state — this repo has no useInfiniteQuery precedent anywhere
//    else, so a plain useState cursor + refetch matches existing style).
//  - `liveRolls`: DICE_ROLLED socket events, prepended as they arrive.
// A roll that arrives live and later also shows up in a page fetch is an
// accepted, harmless duplicate (not worth cross-source deduping) — the two
// lists are rendered back-to-back with source-prefixed React keys so a
// collision is never a *key* collision, only a harmless visual repeat.
export function DiceRollHistoryPage() {
  const { campaignId } = useCampaignShell();
  const { socket } = useSocket();

  const [cursor, setCursor] = useState<string | null>(null);
  const [historyRolls, setHistoryRolls] = useState<DiceRoll[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [liveRolls, setLiveRolls] = useState<DiceRoll[]>([]);
  // Tracks which cursor's page has already been merged into historyRolls,
  // so a background refetch of the *same* cursor (e.g. window refocus)
  // doesn't re-append and duplicate rows. Starts at `undefined`, distinct
  // from any real cursor value (`null` or a server-issued string), so the
  // very first page always merges.
  const appliedCursorRef = useRef<string | null | undefined>(undefined);

  const pageQuery = useQuery({
    queryKey: ['diceRolls', campaignId, cursor],
    queryFn: () =>
      api.get<{ rolls: DiceRoll[]; nextCursor: string | null }>(
        `/campaigns/${campaignId}/dice-rolls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    enabled: Number.isInteger(campaignId),
  });

  useEffect(() => {
    if (!pageQuery.data) return;
    if (appliedCursorRef.current === cursor) return;
    appliedCursorRef.current = cursor;
    setHistoryRolls((prev) => [...prev, ...pageQuery.data.rolls]);
    setNextCursor(pageQuery.data.nextCursor);
  }, [pageQuery.data, cursor]);

  useEffect(() => {
    function onDiceRolled(payload: DiceRolledEvent) {
      if (payload.campaignId !== campaignId) return;
      setLiveRolls((prev) => {
        if (prev.some((r) => r.id === payload.id)) return prev; // rare double-delivery dedupe
        return [socketPayloadToDiceRoll(payload), ...prev];
      });
    }
    socket.on('DICE_ROLLED', onDiceRolled);
    return () => {
      socket.off('DICE_ROLLED', onDiceRolled);
    };
  }, [socket, campaignId]);

  const isInitialLoading = pageQuery.isLoading && cursor === null && historyRolls.length === 0;
  const isEmpty = !isInitialLoading && liveRolls.length === 0 && historyRolls.length === 0;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold">Dice Rolls</h2>

      <QuickDiceRoller />

      {isInitialLoading && <Loading label="Loading roll history…" />}
      {pageQuery.isError && <ErrorBanner message={errorMessage(pageQuery.error)} />}
      {isEmpty && <EmptyState message="No dice rolls yet." />}

      <ul className="space-y-2">
        {liveRolls.map((roll) => (
          <DiceRollRow key={`live-${roll.id}`} roll={roll} />
        ))}
        {historyRolls.map((roll) => (
          <DiceRollRow key={`hist-${roll.id}`} roll={roll} />
        ))}
      </ul>

      {nextCursor && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            disabled={pageQuery.isFetching}
            onClick={() => setCursor(nextCursor)}
            className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 hover:bg-stone-800 disabled:opacity-60"
          >
            {pageQuery.isFetching ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

// DICE_ROLLED's payload has no `visibleToPlayers` field at all (see
// socketTypes.ts) — server-side room filtering already guarantees this
// event only reaches a client allowed to see it, so `true` is accurate from
// the receiving client's own point of view regardless of role.
function socketPayloadToDiceRoll(payload: DiceRolledEvent): DiceRoll {
  return {
    id: payload.id,
    campaign_id: payload.campaignId,
    user_id: payload.userId,
    character_id: payload.characterId,
    monster_instance_id: payload.monsterInstanceId,
    encounter_id: payload.encounterId,
    roll_type: payload.rollType,
    roll_context: payload.rollContext,
    d20_rolls: payload.d20Rolls,
    keep: payload.keep,
    dice_sides: payload.diceSides as DiceRoll['dice_sides'],
    dice_count: payload.diceCount,
    modifier: payload.modifier,
    result_total: payload.resultTotal,
    visible_to_players: true,
    created_at: payload.createdAt,
  };
}

// No name resolution here by design — the socket/REST payloads only carry
// numeric character_id/monster_instance_id/user_id, and fetching display
// names for every roll would mean a new per-roll (or bulk-lookup) request
// this phase doesn't need; roll_context (e.g. "Stealth", "Scimitar") is
// usually informative enough on its own.
function rollerLabel(roll: DiceRoll): string {
  if (roll.character_id) return `Character #${roll.character_id}`;
  if (roll.monster_instance_id) return `Monster #${roll.monster_instance_id}`;
  return `User #${roll.user_id}`;
}

function relativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}

function DiceRollRow({ roll }: { roll: DiceRoll }) {
  const keptIndex = keptDieIndex(roll.d20_rolls, roll.keep);
  return (
    <li className="rounded-md bg-stone-900 shadow-sm p-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 flex-shrink-0">
          {roll.d20_rolls.map((value, i) => (
            <DieFace key={i} value={value} kept={i === keptIndex} sides={roll.dice_sides} />
          ))}
        </div>
        <div className="min-w-0">
          <div className="text-sm text-stone-200 truncate">
            <span className="text-stone-300">{rollerLabel(roll)}</span>
            <span className="text-stone-600"> · </span>
            <span className="capitalize text-stone-400">{roll.roll_type.replace('_', ' ')}</span>
            {roll.roll_context && <span className="text-stone-500"> — {roll.roll_context}</span>}
          </div>
          <div className="text-xs text-stone-500">{relativeTime(roll.created_at)}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-sm flex-shrink-0">
        <span className="text-stone-500">{formatModifier(roll.modifier)}</span>
        <span className="text-stone-500">=</span>
        <span className="font-semibold text-stone-100 text-base">{roll.result_total}</span>
      </div>
    </li>
  );
}
