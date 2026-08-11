import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  CampaignMember,
  Character,
  DiceRoll,
  DiceRollRequestWithTargets,
  DiceRollType,
  DiceRollVisibility,
} from '../lib/types';
import type { DiceRolledEvent, DiceRollMaskedEvent, DiceRollRequestedEvent, DiceRollRequestUpdatedEvent, DiceRollVoidedEvent } from '../lib/socketTypes';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../lib/SocketContext';
import { DieFace, keptDieIndex } from '../components/DiceRoller';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { formatModifier } from '../lib/dnd-math';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';
import { isUuid } from '../lib/ids';

const VISIBILITY_BADGE_KEYS: Record<Exclude<DiceRollVisibility, 'public'>, TranslationKey> = {
  gm_only: 'dice.visibilityGmOnly',
  private: 'dice.visibilityPrivate',
};

// Campaign-wide roll history (PLAN.md §6.6/Phase 3.4; Iteration 3 §2.3/2.4
// added visibility/manual entry/void/roll requests). Two independent data
// sources feed the roll list rather than one merged cache:
//  - `historyRolls`: paginated via GET /campaigns/:id/dice-rolls (manual
//    cursor state — this repo has no useInfiniteQuery precedent anywhere
//    else, so a plain useState cursor + refetch matches existing style).
//  - `liveRolls`: DICE_ROLLED socket events, prepended as they arrive.
// A roll that arrives live and later also shows up in a page fetch is an
// accepted, harmless duplicate (not worth cross-source deduping) — the two
// lists are rendered back-to-back with source-prefixed React keys so a
// collision is never a *key* collision, only a harmless visual repeat.
export function DiceRollHistoryPage() {
  const { t } = useLocale();
  const { campaignId } = useCampaignShell();
  const { socket } = useSocket();

  const [cursor, setCursor] = useState<string | null>(null);
  const [characterFilter, setCharacterFilter] = useState('');
  const [historyRolls, setHistoryRolls] = useState<DiceRoll[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [liveRolls, setLiveRolls] = useState<DiceRoll[]>([]);
  // Phase 2 "hidden rolls record occurrence" — masked stubs (gm_only/private
  // rolls this viewer isn't allowed to see the value of) get their own list,
  // rendered as a distinct minimal row rather than forced into DiceRoll's
  // full shape with fake result data.
  const [maskedRolls, setMaskedRolls] = useState<DiceRollMaskedEvent[]>([]);
  // Tracks which cursor's page has already been merged into historyRolls,
  // so a background refetch of the *same* cursor (e.g. window refocus)
  // doesn't re-append and duplicate rows. Starts at `undefined`, distinct
  // from any real cursor value (`null` or a server-issued string), so the
  // very first page always merges.
  const appliedCursorRef = useRef<string | null | undefined>(undefined);

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
    enabled: isUuid(campaignId),
  });

  const pageQuery = useQuery({
    queryKey: ['diceRolls', campaignId, cursor, characterFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (characterFilter) params.set('characterId', characterFilter);
      const qs = params.toString();
      return api.get<{ rolls: DiceRoll[]; nextCursor: string | null }>(`/campaigns/${campaignId}/dice-rolls${qs ? `?${qs}` : ''}`);
    },
    // Blocker fix: campaignId is a UUID string (post uuid-primary-keys
    // migration) — Number.isInteger(campaignId) is always false for a
    // string, so this query never ran at all, ever, for any campaign. Live
    // rolls still arrived via the DICE_ROLLED socket event (separate
    // liveRolls state below, not gated by this flag), which is why the bug
    // wasn't "no dice ever show up" but specifically "history never loads."
    enabled: isUuid(campaignId),
  });

  useEffect(() => {
    if (!pageQuery.data) return;
    if (appliedCursorRef.current === cursor) return;
    appliedCursorRef.current = cursor;
    setHistoryRolls((prev) => [...prev, ...pageQuery.data.rolls]);
    setNextCursor(pageQuery.data.nextCursor);
  }, [pageQuery.data, cursor]);

  // Changing the filter starts a fresh page/cursor — same "reset paging
  // state" discipline as any other filtered list in this app.
  function changeCharacterFilter(next: string) {
    setCharacterFilter(next);
    setCursor(null);
    setHistoryRolls([]);
    setNextCursor(null);
    setLiveRolls([]);
    setMaskedRolls([]);
    appliedCursorRef.current = undefined;
  }

  useEffect(() => {
    function onDiceRolled(payload: DiceRolledEvent | DiceRollMaskedEvent) {
      if (payload.campaignId !== campaignId) return;
      if (characterFilter && payload.characterId !== characterFilter) return;
      if (payload.masked) {
        setMaskedRolls((prev) => {
          if (prev.some((r) => r.id === payload.id)) return prev;
          return [payload, ...prev];
        });
        return;
      }
      setLiveRolls((prev) => {
        if (prev.some((r) => r.id === payload.id)) return prev; // rare double-delivery dedupe
        return [socketPayloadToDiceRoll(payload), ...prev];
      });
    }
    function onDiceRollVoided(payload: DiceRollVoidedEvent) {
      if (payload.campaignId !== campaignId) return;
      const markVoided = (rolls: DiceRoll[]) =>
        rolls.map((r) => (r.id === payload.id ? { ...r, voided_at: new Date(payload.serverTimestamp).toISOString() } : r));
      setLiveRolls(markVoided);
      setHistoryRolls(markVoided);
    }
    socket.on('DICE_ROLLED', onDiceRolled);
    socket.on('DICE_ROLL_VOIDED', onDiceRollVoided);
    return () => {
      socket.off('DICE_ROLLED', onDiceRolled);
      socket.off('DICE_ROLL_VOIDED', onDiceRollVoided);
    };
  }, [socket, campaignId, characterFilter]);

  const isInitialLoading = pageQuery.isLoading && cursor === null && historyRolls.length === 0;
  const isEmpty = !isInitialLoading && liveRolls.length === 0 && historyRolls.length === 0 && maskedRolls.length === 0;
  const characters = charactersQuery.data?.characters ?? [];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold">{t('dice.historyTitle')}</h2>

      <QuickDiceRoller />

      <RollRequestsPanel campaignId={campaignId} />

      {characters.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-stone-400">
          {t('dice.characterFilterLabel')}
          <select
            value={characterFilter}
            onChange={(e) => changeCharacterFilter(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-stone-100"
          >
            <option value="">{t('dice.characterFilterAll')}</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {isInitialLoading && <Loading label={t('dice.historyLoadingRolls')} />}
      {pageQuery.isError && <ErrorBanner message={errorMessage(pageQuery.error)} />}
      {isEmpty && <EmptyState message={t('dice.historyNoRolls')} />}

      <ul className="space-y-2">
        {maskedRolls.map((roll) => (
          <MaskedDiceRollRow key={`masked-${roll.id}`} roll={roll} />
        ))}
        {liveRolls.map((roll) => (
          <DiceRollRow key={`live-${roll.id}`} roll={roll} campaignId={campaignId} />
        ))}
        {historyRolls.map((roll) => (
          <DiceRollRow key={`hist-${roll.id}`} roll={roll} campaignId={campaignId} />
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
            {pageQuery.isFetching ? t('dice.historyLoadingMore') : t('dice.historyLoadMore')}
          </button>
        </div>
      )}
    </div>
  );
}

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
    is_critical: payload.isCritical,
    visibility: payload.visibility,
    // Not carried on the socket payload (the client never needs to know
    // WHO a private roll besides itself is addressed to — the server
    // already only delivers it to the DM + that one target) — the badge
    // just says "Private," it doesn't name the recipient.
    visible_to_user_id: null,
    is_manual: payload.isManual,
    voided_at: null,
    voided_by_user_id: null,
    created_at: payload.createdAt,
  };
}

// No name resolution here by design — the socket/REST payloads only carry
// numeric character_id/monster_instance_id/user_id, and fetching display
// names for every roll would mean a new per-roll (or bulk-lookup) request
// this phase doesn't need; roll_context (e.g. "Stealth", "Scimitar") is
// usually informative enough on its own.
function rollerLabel(roll: DiceRoll, t: ReturnType<typeof useLocale>['t']): string {
  if (roll.character_id) return t('dice.historyCharacterLabel', { id: roll.character_id });
  if (roll.monster_instance_id) return t('dice.historyMonsterLabel', { id: roll.monster_instance_id });
  return t('dice.historyUserLabel', { id: roll.user_id });
}

function relativeTime(iso: string, t: ReturnType<typeof useLocale>['t']): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 5) return t('dice.historyJustNow');
  if (diffSec < 60) return t('dice.historySecondsAgo', { count: diffSec });
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return t('dice.historyMinutesAgo', { count: diffMin });
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return t('dice.historyHoursAgo', { count: diffHour });
  const diffDay = Math.round(diffHour / 24);
  return t('dice.historyDaysAgo', { count: diffDay });
}

function DiceRollRow({ roll, campaignId }: { roll: DiceRoll; campaignId: string }) {
  const { t } = useLocale();
  const { user } = useAuth();
  const { role } = useCampaignShell();
  const queryClient = useQueryClient();
  const keptIndex = keptDieIndex(roll.d20_rolls, roll.keep);
  const isVoided = roll.voided_at !== null;
  const canVoid = !isVoided && (role === 'dm' || roll.user_id === user?.id);

  const voidMutation = useMutation({
    mutationFn: () => api.post<{ roll: DiceRoll }>(`/campaigns/${campaignId}/dice-rolls/${roll.id}/void`, {}),
    onSuccess: (data) => {
      // Same cache shape both live/history lists already read from
      // (['diceRolls', campaignId, ...]) — a simple invalidate is enough
      // since void is rare and DICE_ROLL_VOIDED already patches every
      // OTHER connected client's local state live.
      void queryClient.invalidateQueries({ queryKey: ['diceRolls', campaignId] });
      void data;
    },
  });

  return (
    <li className={`rounded-md bg-stone-900 shadow-sm p-3 flex items-center justify-between gap-3 flex-wrap ${isVoided ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1 flex-shrink-0">
          {roll.d20_rolls.map((value, i) => (
            <DieFace key={i} value={value} kept={i === keptIndex} sides={roll.dice_sides} />
          ))}
        </div>
        <div className="min-w-0">
          <div className={`text-sm text-stone-200 truncate ${isVoided ? 'line-through' : ''}`}>
            <span className="text-stone-300">{rollerLabel(roll, t)}</span>
            <span className="text-stone-600"> · </span>
            <span className="capitalize text-stone-400">{roll.roll_type.replace('_', ' ')}</span>
            {roll.roll_context && <span className="text-stone-500"> — {roll.roll_context}</span>}
            {roll.is_critical && <RollBadge tone="amber">{t('dice.historyCritical')}</RollBadge>}
            {roll.is_manual && <RollBadge tone="stone">{t('dice.manualLabel')}</RollBadge>}
            {roll.visibility !== 'public' && <RollBadge tone="violet">{t(VISIBILITY_BADGE_KEYS[roll.visibility])}</RollBadge>}
            {isVoided && <RollBadge tone="red">{t('dice.voidedLabel')}</RollBadge>}
          </div>
          <div className="text-xs text-stone-500">{relativeTime(roll.created_at, t)}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm flex-shrink-0">
        <span className="text-stone-500">{formatModifier(roll.modifier)}</span>
        <span className="text-stone-500">=</span>
        <span className="font-semibold text-stone-100 text-base">{roll.result_total}</span>
        {canVoid && (
          <button
            type="button"
            disabled={voidMutation.isPending}
            onClick={() => {
              if (window.confirm(t('dice.voidConfirm'))) voidMutation.mutate();
            }}
            className="text-[11px] text-stone-500 hover:text-red-400 disabled:opacity-50"
          >
            {voidMutation.isPending ? t('dice.voiding') : t('dice.voidButton')}
          </button>
        )}
      </div>
    </li>
  );
}

// Phase 2 "hidden rolls record occurrence" — the minimal row for a
// DiceRollMaskedEvent: no dice faces, no result, just "something was
// rolled" plus whatever's not spoiler-sensitive (roller, type, context).
function MaskedDiceRollRow({ roll }: { roll: DiceRollMaskedEvent }) {
  const { t } = useLocale();
  const label = roll.characterId
    ? t('dice.historyCharacterLabel', { id: roll.characterId })
    : roll.monsterInstanceId
      ? t('dice.historyMonsterLabel', { id: roll.monsterInstanceId })
      : t('dice.historyUserLabel', { id: roll.userId });

  return (
    <li className="rounded-md bg-stone-900 shadow-sm p-3 flex items-center justify-between gap-3 flex-wrap opacity-80">
      <div className="min-w-0">
        <div className="text-sm text-stone-200 truncate">
          <span className="text-stone-300">{label}</span>
          <span className="text-stone-600"> · </span>
          <span className="capitalize text-stone-400">{roll.rollType.replace('_', ' ')}</span>
          {roll.rollContext && <span className="text-stone-500"> — {roll.rollContext}</span>}
          <RollBadge tone="violet">{t(VISIBILITY_BADGE_KEYS[roll.visibility as 'gm_only' | 'private'])}</RollBadge>
        </div>
        <div className="text-xs text-stone-500">{relativeTime(roll.createdAt, t)}</div>
      </div>
      <span className="text-sm italic text-stone-500 flex-shrink-0">{t('dice.historyHiddenResult')}</span>
    </li>
  );
}

const BADGE_TONE_CLASSES: Record<'amber' | 'stone' | 'violet' | 'red', string> = {
  amber: 'border-amber-500 text-amber-500',
  stone: 'border-stone-600 text-stone-400',
  violet: 'border-violet-500 text-violet-400',
  red: 'border-red-600 text-red-400',
};

function RollBadge({ tone, children }: { tone: 'amber' | 'stone' | 'violet' | 'red'; children: string }) {
  return (
    <span className={`ml-1.5 inline-flex items-center rounded border px-1 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

// ---- Roll requests (Iteration 3 §2.3) ----

const ROLL_REQUEST_TYPES: DiceRollType[] = ['ability_check', 'saving_throw', 'skill_check', 'initiative', 'death_save'];

function RollRequestsPanel({ campaignId }: { campaignId: string }) {
  const { t } = useLocale();
  const { role } = useCampaignShell();
  const isDm = role === 'dm';
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const requestsQuery = useQuery({
    queryKey: ['diceRollRequests', campaignId],
    queryFn: () => api.get<{ requests: DiceRollRequestWithTargets[] }>(`/campaigns/${campaignId}/dice-roll-requests`),
    enabled: isUuid(campaignId),
  });

  useEffect(() => {
    function refetch() {
      void queryClient.invalidateQueries({ queryKey: ['diceRollRequests', campaignId] });
    }
    function onRequested(payload: DiceRollRequestedEvent) {
      if (payload.campaignId === campaignId) refetch();
    }
    function onUpdated(payload: DiceRollRequestUpdatedEvent) {
      if (payload.campaignId === campaignId) refetch();
    }
    socket.on('DICE_ROLL_REQUESTED', onRequested);
    socket.on('DICE_ROLL_REQUEST_UPDATED', onUpdated);
    return () => {
      socket.off('DICE_ROLL_REQUESTED', onRequested);
      socket.off('DICE_ROLL_REQUEST_UPDATED', onUpdated);
    };
  }, [socket, campaignId, queryClient]);

  const membersQuery = useQuery({
    queryKey: ['campaign', campaignId, 'members'],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
    enabled: isDm,
  });

  const requests = requestsQuery.data?.requests ?? [];
  if (!isDm && requests.length === 0) return null; // nothing pending, nothing to show a player

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3">
      <h3 className="text-xs uppercase text-stone-500">{t('dice.requestsTitle')}</h3>
      {isDm && <CreateRollRequestForm campaignId={campaignId} members={membersQuery.data?.members ?? []} />}
      {requestsQuery.isError && <ErrorBanner message={errorMessage(requestsQuery.error)} />}
      {isDm && requests.length === 0 && !requestsQuery.isLoading && <p className="text-xs text-stone-500 italic">{t('dice.requestNoneYet')}</p>}
      <ul className="space-y-2">
        {requests.map(({ request, targets }) => (
          <li key={request.id} className="rounded-md border border-stone-800 bg-stone-950 p-2.5 space-y-1.5">
            <div className="text-xs text-stone-300">
              <span className="capitalize font-medium">{request.roll_type.replace('_', ' ')}</span>
              {request.roll_context && <span className="text-stone-500"> — {request.roll_context}</span>}
              {request.dc != null && <span className="text-stone-500"> (DC {request.dc})</span>}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {targets.map((target) => (
                <RollRequestTargetChip key={target.id} campaignId={campaignId} target={target} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CreateRollRequestForm({ campaignId, members }: { campaignId: string; members: CampaignMember[] }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [rollType, setRollType] = useState<DiceRollType>('saving_throw');
  const [context, setContext] = useState('');
  const [dc, setDc] = useState('');
  const [targetUserIds, setTargetUserIds] = useState<Set<string>>(new Set());
  const players = members.filter((m) => m.role === 'player');

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/campaigns/${campaignId}/dice-roll-requests`, {
        targetUserIds: [...targetUserIds],
        rollType,
        rollContext: context.trim() || undefined,
        dc: dc.trim() ? Number(dc) : undefined,
      }),
    onSuccess: () => {
      setContext('');
      setDc('');
      setTargetUserIds(new Set());
      void queryClient.invalidateQueries({ queryKey: ['diceRollRequests', campaignId] });
    },
  });

  function toggleTarget(userId: string) {
    setTargetUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950 p-2.5 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[11px] text-stone-500">
          {t('dice.requestRollTypeLabel')}
          <select
            value={rollType}
            onChange={(e) => setRollType(e.target.value as DiceRollType)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
          >
            {ROLL_REQUEST_TYPES.map((rt) => (
              <option key={rt} value={rt}>
                {rt.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-stone-500 flex-1 min-w-[8rem]">
          {t('dice.requestContextLabel')}
          <input
            type="text"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-stone-500 w-16">
          {t('dice.requestDcLabel')}
          <input
            type="number"
            value={dc}
            onChange={(e) => setDc(e.target.value)}
            className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-stone-500">{t('dice.requestTargetsLabel')}</span>
        <button
          type="button"
          onClick={() => setTargetUserIds(new Set(players.map((p) => p.user_id)))}
          className="text-[11px] text-amber-500 hover:text-amber-400"
        >
          {t('dice.requestTargetsWholeParty')}
        </button>
        {players.map((p) => (
          <label key={p.user_id} className="flex items-center gap-1 text-[11px] text-stone-400">
            <input type="checkbox" checked={targetUserIds.has(p.user_id)} onChange={() => toggleTarget(p.user_id)} />
            {p.display_name}
          </label>
        ))}
      </div>
      {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
      <button
        type="button"
        disabled={targetUserIds.size === 0 || createMutation.isPending}
        onClick={() => createMutation.mutate()}
        className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
      >
        {createMutation.isPending ? t('dice.requesting') : t('dice.requestButton')}
      </button>
    </div>
  );
}

function RollRequestTargetChip({
  campaignId,
  target,
}: {
  campaignId: string;
  target: DiceRollRequestWithTargets['targets'][number];
}) {
  const { t } = useLocale();
  const { user } = useAuth();
  const { role } = useCampaignShell();
  const queryClient = useQueryClient();
  const isMine = target.user_id === user?.id;
  const [modifier, setModifier] = useState('0');

  const rollMutation = useMutation({
    mutationFn: () =>
      api.post(`/campaigns/${campaignId}/dice-rolls`, {
        rollType: 'saving_throw',
        keep: 'normal',
        diceSides: 20,
        diceCount: 1,
        modifier: Number(modifier) || 0,
        fulfillsRequestTargetId: target.id,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['diceRollRequests', campaignId] }),
  });

  const passMutation = useMutation({
    mutationFn: () => api.post(`/campaigns/${campaignId}/dice-roll-requests/targets/${target.id}/pass`, {}),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['diceRollRequests', campaignId] }),
  });

  const canRespond = target.status === 'pending' && (isMine || role === 'dm');
  const statusLabel =
    target.status === 'pending' ? t('dice.requestStatusPending') : target.status === 'rolled' ? t('dice.requestStatusRolled') : t('dice.requestStatusPassed');
  const tone = target.status === 'pending' ? 'stone' : target.status === 'rolled' ? 'amber' : 'red';

  return (
    <li className="flex items-center gap-1.5 rounded border border-stone-800 bg-stone-900 px-2 py-1 text-[11px]">
      <RollBadge tone={tone}>{statusLabel}</RollBadge>
      {canRespond && (
        <>
          <input
            type="number"
            value={modifier}
            onChange={(e) => setModifier(e.target.value)}
            title={t('dice.rollerRollButton')}
            className="w-10 rounded bg-stone-800 border border-stone-700 px-1 py-0.5 text-stone-100 text-center"
          />
          <button
            type="button"
            disabled={rollMutation.isPending}
            onClick={() => rollMutation.mutate()}
            className="text-amber-500 hover:text-amber-400"
          >
            {t('dice.requestFulfillButton')}
          </button>
          <button
            type="button"
            disabled={passMutation.isPending}
            onClick={() => passMutation.mutate()}
            className="text-stone-500 hover:text-red-400"
          >
            {passMutation.isPending ? t('dice.requestPassing') : t('dice.requestPassButton')}
          </button>
        </>
      )}
    </li>
  );
}
